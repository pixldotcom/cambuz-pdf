// Cambuz PDF Reader — electron-builder afterPack hook.
//
// Runs on the unpacked app (dist/<platform>-unpacked) before installers are
// built. It:
//   1. removes Chromium's SwiftShader software-Vulkan rasteriser on Windows and
//      Linux. Chromium 152 (Electron 44) only loads SwiftShader for WebGL, and
//      since the automatic software-WebGL fallback was deprecated, only with
//      --enable-unsafe-swiftshader. Cambuz draws pages with PDF.js on a 2D
//      canvas and uses no WebGL or WebGPU. Without a usable GPU Chromium
//      composites in software (and Windows always has the WARP D3D11 adapter),
//      which does not use SwiftShader. macOS is left untouched: that build is
//      unsigned, experimental and never launched in CI, so it gets no
//      binary-level edits that CI cannot check;
//   2. prints the unpacked (installed) size and its largest files, as GitHub
//      Actions notices in CI, so size regressions are visible on every build.
//
// Chromium locale packs are trimmed by electron-builder itself
// (`electronLanguages` in package.json), before this hook runs.

const fs = require('node:fs');
const path = require('node:path');

// Files that are safe to drop, by electron-builder platform name. Each entry is
// relative to the unpacked app directory. A missing file is reported, not an
// error, so a future Electron that moves or drops them still builds.
const REMOVABLE = {
  win32: ['vk_swiftshader.dll', 'vk_swiftshader_icd.json'],
  linux: ['libvk_swiftshader.so', 'vk_swiftshader_icd.json'],
};

const MiB = 1048576;
const formatMiB = (bytes) => `${(bytes / MiB).toFixed(1)} MiB`;
const inCi = process.env.GITHUB_ACTIONS === 'true';

function listFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) listFiles(full, base, out);
    else out.push({ rel: path.relative(base, full).split(path.sep).join('/'), size: fs.statSync(full).size });
  }
  return out;
}

function notice(message) {
  console.log(inCi ? `::notice title=Installed size::${message}` : `  • ${message}`);
}

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName: platform } = context;

  let removedBytes = 0;
  for (const rel of REMOVABLE[platform] ?? []) {
    const full = path.join(appOutDir, rel);
    if (!fs.existsSync(full)) {
      console.log(`  • after-pack: ${rel} not present in this Electron build, nothing to remove`);
      continue;
    }
    removedBytes += fs.statSync(full).size;
    fs.rmSync(full);
    console.log(`  • after-pack: removed ${rel}`);
  }

  const files = listFiles(appOutDir);
  const total = files.reduce((sum, f) => sum + f.size, 0);
  const locales = files.filter((f) => /(^|\/)locales\/[^/]+\.pak$/.test(f.rel) || /\.lproj\//.test(f.rel));
  const largest = [...files].sort((a, b) => b.size - a.size).slice(0, 8);

  notice(
    `${platform} unpacked app ${formatMiB(total)} in ${files.length} files` +
      ` (SwiftShader removed: ${formatMiB(removedBytes)}; locale files kept: ${locales.length})`,
  );
  notice(`${platform} largest files: ${largest.map((f) => `${f.rel} ${formatMiB(f.size)}`).join(', ')}`);
};
