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
//   - removes PDF.js builds and source maps that the app does not load.
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

const RUNTIME_FILES = ['main.js', 'preload.js', 'package-lock.json'];
const RUNTIME_DIRS = ['src'];
// Every sample the welcome-screen buttons can open (src/bundled-samples.cjs).
const RUNTIME_SAMPLES = BUNDLED_SAMPLES;
// The renderer loads only PDF.js's build/ (non-legacy) and standard_fonts/. The
// legacy builds, the web viewer assets and the TypeScript typings are not referenced.
const PRUNE_DIRS = ['pdfjs-dist/legacy', 'pdfjs-dist/web', 'pdfjs-dist/types'];

function removeFilesMatching(dir, predicate) {
  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removed += removeFilesMatching(full, predicate);
    } else if (predicate(entry.name)) {
      fs.rmSync(full);
      removed += 1;
    }
  }
  return removed;
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

function directorySize(dir) {
  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    bytes += entry.isDirectory() ? directorySize(full) : fs.statSync(full).size;
  }
  return bytes;
}

function main() {
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(stageDir, 'samples'), { recursive: true });

  for (const file of RUNTIME_FILES) {
    fs.copyFileSync(path.join(repoRoot, file), path.join(stageDir, file));
  }
  for (const dir of RUNTIME_DIRS) {
    fs.cpSync(path.join(repoRoot, dir), path.join(stageDir, dir), { recursive: true });
  }
  for (const sample of RUNTIME_SAMPLES) {
    fs.copyFileSync(path.join(repoRoot, 'samples', sample), path.join(stageDir, 'samples', sample));
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

  for (const rel of PRUNE_DIRS) {
    fs.rmSync(path.join(nodeModulesDir, rel), { recursive: true, force: true });
  }
  const mapsRemoved = removeFilesMatching(nodeModulesDir, (name) => name.endsWith('.map'));

  removeNativeCanvasScopes(nodeModulesDir);

  const sizeMiB = (directorySize(stageDir) / 1048576).toFixed(1);
  console.log(`Staged runtime app in .build-app/ (${sizeMiB} MiB, ${mapsRemoved} source map(s) removed).`);
}

main();
