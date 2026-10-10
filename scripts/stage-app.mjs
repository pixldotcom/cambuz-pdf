#!/usr/bin/env node
// Cambuz PDF Reader — stage the desktop app for electron-builder.
//
// Builds a clean, runtime-only copy of the app in .build-app/ so that the
// packaged payload does not depend on which files happen to be in the working
// tree or on how electron-builder walks node_modules:
//   - copies only what the Electron main/renderer processes load;
//   - installs production dependencies exactly as locked, skipping dev-only
//     packages, optional native packages (the Node-only @napi-rs/canvas binding
//     that pdfjs-dist can load in Node but the renderer never does) and
//     lifecycle scripts;
//   - keeps, inside node_modules, only the files the app actually loads (an
//     allowlist, see RUNTIME_PACKAGE_FILES) plus every package's manifest and
//     licence files. CommonJS/ES module trees, TypeScript sources, minified
//     duplicates, legacy builds, source maps and READMEs never reach the asar.
//
// Usage: node scripts/stage-app.mjs

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLED_SAMPLES } from '../src/bundled-samples.cjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stageDir = path.join(repoRoot, '.build-app');
const nodeModulesDir = path.join(stageDir, 'node_modules');

const RUNTIME_FILES = ['main.js', 'preload.js', 'package-lock.json', 'LICENSE', 'THIRD-PARTY-NOTICES.md'];
const RUNTIME_DIRS = ['src'];
// The window/taskbar icon referenced by main.js (`assets/icon.png`). The
// per-platform installer icons live in build/ and are read by electron-builder
// directly; they are not part of the runtime payload.
const RUNTIME_ASSETS = ['icon.png'];
// Every sample the welcome-screen buttons can open (src/bundled-samples.cjs).
const RUNTIME_SAMPLES = BUNDLED_SAMPLES;
// Everything the packaged app loads from node_modules. The renderer imports
// PDF.js's non-legacy build and points it at standard_fonts/ (src/renderer.js);
// the import map in src/index.html resolves 'pdf-lib' to its self-contained ESM
// bundle, which already inlines pako, tslib and @pdf-lib/* (so those packages
// ship their manifest and licence only). No cMapUrl is configured, so PDF.js's
// cmaps/ are never fetched; the scripting sandbox and image decoders are not
// enabled either. Entries ending in '/' keep a whole directory. Staging fails
// if an entry is missing, so a dependency layout change cannot silently ship a
// broken app.
const RUNTIME_PACKAGE_FILES = {
  'pdfjs-dist': ['build/pdf.mjs', 'build/pdf.worker.mjs', 'standard_fonts/'],
  'pdf-lib': ['dist/pdf-lib.esm.js'],
};
// Kept at the root of every staged package: its manifest and licence texts.
const PACKAGE_METADATA = /^(package\.json|licen[cs]e|notice|copying)(\.[a-z0-9]+)?$/i;

function* packageDirectories(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.name.startsWith('@')) {
      for (const scoped of fs.readdirSync(full, { withFileTypes: true })) {
        if (scoped.isDirectory()) yield { name: `${entry.name}/${scoped.name}`, dir: path.join(full, scoped.name) };
      }
    } else {
      yield { name: entry.name, dir: full };
    }
  }
}

// Remove every file of a package that is neither package metadata nor on the
// runtime allowlist. Returns the number of bytes removed.
function prunePackage(name, packageDir) {
  const keep = RUNTIME_PACKAGE_FILES[name] ?? [];
  for (const rel of keep) {
    if (!fs.existsSync(path.join(packageDir, rel))) {
      throw new Error(`Staging failed: runtime file ${name}/${rel} is missing from the installed package`);
    }
  }
  const isKept = (rel) =>
    (!rel.includes('/') && PACKAGE_METADATA.test(rel)) ||
    keep.some((entry) => (entry.endsWith('/') ? rel.startsWith(entry) : rel === entry));

  let removedBytes = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const rel = path.relative(packageDir, full).split(path.sep).join('/');
      if (!isKept(rel)) {
        removedBytes += fs.statSync(full).size;
        fs.rmSync(full);
      }
    }
  };
  walk(packageDir);
  return removedBytes;
}

// The Node-only canvas binding must not be staged anywhere in the tree. npm can
// leave an empty @napi-rs scope folder behind when it skips the optional packages;
// remove that, and fail if any package was actually installed into the scope.
function removeNativeCanvasScopes(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (entry.name === '@napi-rs') {
      if (fs.readdirSync(full).length > 0) {
        throw new Error(`Staging failed: ${path.relative(repoRoot, full)} contains packages that must not ship`);
      }
      fs.rmdirSync(full);
      continue;
    }
    removeNativeCanvasScopes(full);
  }
}

// `npm ci --omit=dev --omit=optional` leaves the scope folders of skipped
// packages behind as empty directories. They carry no runtime value, so sweep
// them (and any other emptied folder) rather than shipping clutter in the asar.
function removeEmptyDirectories(dir) {
  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    removed += removeEmptyDirectories(full);
    if (fs.readdirSync(full).length === 0) {
      fs.rmdirSync(full);
      removed += 1;
    }
  }
  return removed;
}

function directorySize(dir) {
  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    bytes += entry.isDirectory() ? directorySize(full) : fs.statSync(full).size;
  }
  return bytes;
}

function main() {
  // Fail fast when a packaging input is missing: electron-builder would
  // otherwise fall back to its default icon or ship without notices.
  for (const resource of [
    'LICENSE',
    'THIRD-PARTY-NOTICES.md',
    'assets/icon.png',
    'build/icon.ico',
    'build/icon.icns',
    'build/icon.png',
  ]) {
    if (!fs.existsSync(path.join(repoRoot, resource))) {
      throw new Error(`Staging failed: required packaging resource is missing: ${resource}`);
    }
  }

  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(stageDir, 'samples'), { recursive: true });
  fs.mkdirSync(path.join(stageDir, 'assets'), { recursive: true });

  for (const file of RUNTIME_FILES) {
    fs.copyFileSync(path.join(repoRoot, file), path.join(stageDir, file));
  }
  for (const dir of RUNTIME_DIRS) {
    fs.cpSync(path.join(repoRoot, dir), path.join(stageDir, dir), { recursive: true });
  }
  for (const sample of RUNTIME_SAMPLES) {
    fs.copyFileSync(path.join(repoRoot, 'samples', sample), path.join(stageDir, 'samples', sample));
  }
  for (const asset of RUNTIME_ASSETS) {
    fs.copyFileSync(path.join(repoRoot, 'assets', asset), path.join(stageDir, 'assets', asset));
  }

  // Keep devDependencies in the staged manifest only long enough for `npm ci`
  // to accept the lockfile; they are removed before electron-builder reads it.
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const { scripts: _scripts, build: _build, ...stagedManifest } = manifest;
  fs.writeFileSync(path.join(stageDir, 'package.json'), `${JSON.stringify(stagedManifest, null, 2)}\n`);

  execSync('npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund', {
    cwd: stageDir,
    stdio: 'inherit',
  });

  const { devDependencies: _dev, ...runtimeManifest } = stagedManifest;
  fs.writeFileSync(path.join(stageDir, 'package.json'), `${JSON.stringify(runtimeManifest, null, 2)}\n`);
  fs.rmSync(path.join(stageDir, 'package-lock.json'));

  for (const name of Object.keys(RUNTIME_PACKAGE_FILES)) {
    if (!fs.existsSync(path.join(nodeModulesDir, name))) {
      throw new Error(`Staging failed: runtime package ${name} was not installed`);
    }
  }
  // npm's hidden lockfile only speeds up later npm runs in this folder.
  fs.rmSync(path.join(nodeModulesDir, '.package-lock.json'), { force: true });
  let prunedBytes = 0;
  for (const { name, dir } of packageDirectories(nodeModulesDir)) {
    prunedBytes += prunePackage(name, dir);
  }

  removeNativeCanvasScopes(nodeModulesDir);
  const emptyDirsRemoved = removeEmptyDirectories(nodeModulesDir);

  const sizeMiB = (directorySize(stageDir) / 1048576).toFixed(1);
  const prunedMiB = (prunedBytes / 1048576).toFixed(1);
  console.log(`Staged runtime app in .build-app/ (${sizeMiB} MiB; ${prunedMiB} MiB of unused package files and ${emptyDirsRemoved} empty director(ies) removed).`);
}

main();
