#!/usr/bin/env node
// Cambuz PDF Reader — Phase 7 optional OCR tests.
//
// The default suite verifies the local-only IPC boundary, image/language
// validation, OCR-page rasterization, separate result UI, permission checks,
// and that the committed scanned fixture has no embedded page text. When a
// system Tesseract 4+ binary and a test language pack are installed, it also
// runs real scanned-page recognition and checks output tokens.

import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import * as pdfjsLib from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import { OCR_LANGUAGES, renderPdfPageToPng } from '../src/pdf-ocr.js';

const require = createRequire(import.meta.url);
const {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  asPngBuffer,
  getOcrStatus,
  normalizeLanguages,
  recognizePng,
  versionTuple,
} = require('../src/ocr-engine.cjs');

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SAMPLE_PDF = path.join(ROOT, 'samples', 'phase7-scanned.pdf');
const PNG_FIXTURE_DIR = path.join(ROOT, 'scripts', 'fixtures');
const standardFontDataUrl = pathToFileURL(
  path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep
).href;
globalThis.DOMMatrix = DOMMatrix;
globalThis.ImageData = ImageData;
globalThis.Path2D = Path2D;

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];
const openDocuments = [];

function pass(name) {
  passed += 1;
  console.log(`  PASS  ${name}`);
}
function fail(name, detail = '') {
  failed += 1;
  failures.push(name);
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}
function skip(name, reason) {
  skipped += 1;
  console.log(`  SKIP  ${name}${reason ? ` — ${reason}` : ''}`);
}
function assert(condition, name, detail = '') {
  if (condition) pass(name);
  else fail(name, detail);
}
function section(title) {
  console.log(`\n## ${title}`);
}
function makePngHeader(width, height) {
  const png = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 4, 'ascii');
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  png[24] = 8;
  png[25] = 2;
  // Remaining color/compression/filter/interlace fields are zero.
  return png;
}
function expectThrow(callback, pattern, name) {
  try {
    callback();
    fail(name, 'did not throw');
  } catch (error) {
    if (pattern.test(String(error.message))) pass(name);
    else fail(name, `unexpected error: ${error.message}`);
  }
}
async function expectReject(callback, pattern, name) {
  try {
    await callback();
    fail(name, 'did not reject');
  } catch (error) {
    if (pattern.test(String(error.message))) pass(name);
    else fail(name, `unexpected error: ${error.message}`);
  }
}
async function openPdf(bytes, options = {}) {
  const data = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice()
    : new Uint8Array(bytes).slice();
  const doc = await pdfjsLib.getDocument({ data, standardFontDataUrl, ...options }).promise;
  openDocuments.push(doc);
  return doc;
}
function normalizedWords(text) {
  return new Set(
    String(text || '')
      .normalize('NFC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
      .trim()
      .split(/\s+/u)
      .filter(Boolean)
  );
}

console.log('Phase 7 optional OCR tests\n');

// ---------------------------------------------------------------------------
section('A. Optional engine boundary, input limits and language validation');

assert(
  JSON.stringify(OCR_LANGUAGES.map(({ code }) => code)) ===
    JSON.stringify(['eng', 'hin', 'pan', 'urd', 'ben', 'guj', 'mar', 'tam', 'tel', 'kan', 'mal', 'ori', 'asm']),
  'English and the priority Indian language codes are declared in the OCR UI'
);
assert(versionTuple('tesseract 5.3.0\n leptonica-1.83.0')?.join('.') === '5.3.0', 'Tesseract version output parses correctly');
assert(versionTuple('no engine here') === null, 'an unrecognized engine version is rejected');
assert(normalizeLanguages('eng')?.join('+') === 'eng', 'one language normalizes');
assert(normalizeLanguages('eng+hin+urd')?.length === 3, 'a mixed-script selection supports up to three languages');
expectThrow(() => normalizeLanguages('eng+eng'), /different/, 'duplicate language codes are rejected');
expectThrow(() => normalizeLanguages('eng+hin+pan+urd'), /one to three/, 'more than three languages are rejected');
expectThrow(() => normalizeLanguages('eng;--psm 6'), /not supported/, 'arbitrary Tesseract arguments are rejected');
expectThrow(() => normalizeLanguages(''), /one to three/, 'empty language selections are rejected');

const validHeader = makePngHeader(1200, 1600);
assert(asPngBuffer(validHeader).equals(validHeader), 'a bounded PNG header is accepted');
expectThrow(() => asPngBuffer(Buffer.from('not a png')), /empty|20 MiB/, 'short or non-image input is rejected');
const invalidSignature = makePngHeader(100, 100);
invalidSignature[0] = 0;
expectThrow(() => asPngBuffer(invalidSignature), /PNG image/, 'non-PNG image data is rejected');
expectThrow(() => asPngBuffer(makePngHeader(MAX_IMAGE_DIMENSION + 1, 1)), /dimensions/, 'oversized PNG dimensions are rejected');
expectThrow(() => asPngBuffer(makePngHeader(4001, 4001)), /dimensions/, 'images above the 16-megapixel cap are rejected');
assert(MAX_IMAGE_BYTES === 20 * 1024 * 1024 && MAX_IMAGE_PIXELS === 16_000_000, 'IPC image memory limits are explicit');

const engineStatus = await getOcrStatus();
assert(
  engineStatus && typeof engineStatus.available === 'boolean' && Array.isArray(engineStatus.languages),
  'optional engine detection returns a stable status object'
);
console.log(
  `  info  Tesseract ${engineStatus.version || 'not detected'}; ` +
    `${engineStatus.languages.join(', ') || 'no supported language packs reported'}`
);
const preloadSource = readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
const mainSource = readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const engineSource = readFileSync(path.join(ROOT, 'src', 'ocr-engine.cjs'), 'utf8');
assert(preloadSource.includes('getOcrStatus') && preloadSource.includes('ocrPage'), 'preload exposes only the OCR status and page-recognition IPC calls');
assert(mainSource.includes("ipcMain.handle('ocr-page'") && mainSource.includes('recognizePng'), 'main process owns the OCR IPC handler');
assert(engineSource.includes('execFile(') && !engineSource.includes('shell: true'), 'OCR calls a fixed executable without invoking a shell');

// ---------------------------------------------------------------------------
section('B. Bounded page rasterization');

let renderedViewport = null;
let fillCalled = false;
const mockCanvasFactory = (width, height) => ({
  width,
  height,
  getContext: () => ({
    fillStyle: '',
    save() {},
    restore() {},
    fillRect() { fillCalled = true; },
  }),
  toBuffer: () => makePngHeader(width, height),
});
const mockPage = {
  getViewport: ({ scale, rotation }) => ({ width: 612 * scale, height: 792 * scale, scale, rotation }),
  render: ({ viewport }) => {
    renderedViewport = viewport;
    return { promise: Promise.resolve() };
  },
};
const renderedMock = await renderPdfPageToPng(mockPage, { canvasFactory: mockCanvasFactory });
assert(renderedMock.width <= 8_000 && renderedMock.height <= 8_000, 'page raster dimensions remain bounded');
assert(renderedMock.width * renderedMock.height <= 16_000_000, 'page raster stays within the 16-megapixel cap');
assert(renderedViewport.scale <= 300 / 72 + 0.001, 'normal pages target at most 300 dpi');
assert(fillCalled && Buffer.from(renderedMock.bytes.subarray(0, 8)).equals(validHeader.subarray(0, 8)), 'rasterization paints a white page and exports PNG');
await expectReject(
  () => renderPdfPageToPng(mockPage, { rotation: 45, canvasFactory: mockCanvasFactory }),
  /rotation/,
  'unsupported viewer rotations are rejected before rendering'
);
const embeddedFontDoc = await openPdf(
  await readFile(path.join(ROOT, 'samples', 'phase6-embedded-font.pdf')),
  { disableFontFace: true, useSystemFonts: true }
);
const embeddedPage = await embeddedFontDoc.getPage(1);
const realRaster = await renderPdfPageToPng(embeddedPage, {
  canvasFactory: (width, height) => createCanvas(width, height),
  maxPixels: 1_000_000,
});
assert(
  realRaster.bytes.byteLength > 100 &&
    realRaster.width * realRaster.height <= 1_000_000 &&
    Buffer.from(realRaster.bytes.subarray(0, 8)).equals(validHeader.subarray(0, 8)),
  'production rasterizer renders a real PDF.js page to a memory-bounded PNG'
);
await embeddedFontDoc.destroy();

// ---------------------------------------------------------------------------
section('C. Scanned fixture: page imagery is not native PDF text');

let scannedBytes;
try {
  scannedBytes = new Uint8Array(await readFile(SAMPLE_PDF));
  pass('four-page OCR sample exists');
} catch (error) {
  fail('four-page OCR sample exists', error.message);
}

let scannedDoc = null;
if (scannedBytes) {
  scannedDoc = await openPdf(scannedBytes);
  assert(scannedDoc.numPages === 4, 'scanned OCR fixture has English, Hindi, Punjabi and Urdu pages');
  for (let pageNumber = 1; pageNumber <= scannedDoc.numPages; pageNumber += 1) {
    const content = await (await scannedDoc.getPage(pageNumber)).getTextContent();
    assert(content.items.length === 0, `scanned page ${pageNumber} contains no selectable embedded text`);
  }
  const englishRaster = new Uint8Array(await readFile(path.join(PNG_FIXTURE_DIR, 'phase7-ocr-eng.png')));
  const englishImage = asPngBuffer(englishRaster);
  const englishWidth = englishImage.readUInt32BE(16);
  const englishHeight = englishImage.readUInt32BE(20);
  assert(
    englishWidth * englishHeight <= MAX_IMAGE_PIXELS,
    `controlled English scan fixture is bounded (${englishWidth} × ${englishHeight})`
  );

  if (engineStatus.available && engineStatus.languages.includes('eng')) {
    const output = await recognizePng(englishRaster, 'eng');
    const actual = normalizedWords(output.text);
    const expected = ['clear', 'text', 'stays', 'selectable', 'searchable', 'printable', 'english'];
    const matched = expected.filter((word) => actual.has(word));
    assert(
      matched.length >= 5,
      'real English OCR recognizes at least five of seven controlled scan words',
      `${matched.length}/7 recognized; output: ${output.text.slice(0, 220)}`
    );
    assert(output.languages.join('+') === 'eng' && output.version === engineStatus.version, 'OCR result reports the selected language and engine version');
  } else {
    skip(
      'real English scanned-page OCR quality',
      engineStatus.available
        ? 'Tesseract is present but its English traineddata pack is not installed'
        : (engineStatus.error || 'Tesseract is not installed in this environment')
    );
  }
} else {
  skip('scanned-page fixture tests', 'the Phase 7 scanned fixture is missing');
}

if (scannedDoc) await scannedDoc.destroy();

// When installed, test the target Indian-script scan PNGs as actual raster OCR.
if (engineStatus.available && scannedBytes) {
  const indicCases = [
    { language: 'hin', words: ['हिंदी', 'नमूना', 'विद्यालय'] },
    { language: 'pan', words: ['ਪੰਜਾਬੀ', 'ਕੁੰਜੀ'] },
    { language: 'urd', words: ['اردو', 'زبان'] },
  ];
  for (const sample of indicCases) {
    if (!engineStatus.languages.includes(sample.language)) {
      skip(`${sample.language} scanned-page OCR quality`, `the ${sample.language} traineddata pack is not installed`);
      continue;
    }
    const imageBytes = new Uint8Array(
      await readFile(path.join(PNG_FIXTURE_DIR, `phase7-ocr-${sample.language}.png`))
    );
    const output = await recognizePng(imageBytes, sample.language);
    const actual = normalizedWords(output.text);
    const matched = sample.words.filter((word) => actual.has(word.normalize('NFC').toLocaleLowerCase()));
    assert(
      matched.length >= 1,
      `${sample.language} OCR detects a target-script fixture word`,
      `no expected word found; output: ${output.text.slice(0, 220)}`
    );
  }
} else if (!engineStatus.available) {
  skip('Hindi/Punjabi/Urdu scanned-page OCR quality', 'Tesseract is not installed in this environment');
}

// If OCR is not installed, the service must fail with an actionable message,
// never silently return an empty result or attempt a network fallback.
if (!engineStatus.available) {
  try {
    await recognizePng(validHeader, 'eng');
    fail('missing OCR runtime fails explicitly', 'recognition unexpectedly returned');
  } catch (error) {
    assert(/Tesseract|OCR/.test(error.message), 'missing OCR runtime fails with an install hint', error.message);
  }
}

// ---------------------------------------------------------------------------
section('D. Separate, explicit OCR result UI and document-permission guard');

const html = readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost:3000/src/index.html', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMMatrix = DOMMatrix;
globalThis.ImageData = ImageData;
globalThis.Path2D = Path2D;
const { OcrController } = await import('../src/pdf-ocr-ui.js');

const requiredIds = [
  'btn-ocr', 'ocr-dialog', 'ocr-engine-status', 'ocr-languages', 'btn-ocr-refresh',
  'btn-ocr-run', 'btn-ocr-close', 'ocr-error', 'ocr-result', 'ocr-result-label',
  'ocr-result-note', 'ocr-output',
];
assert(requiredIds.every((id) => document.getElementById(id)), 'OCR toolbar and accessible dialog controls exist');
assert(document.getElementById('ocr-dialog').getAttribute('aria-modal') === 'true', 'OCR results are presented in a modal dialog');
assert(document.getElementById('ocr-output').readOnly, 'OCR text is shown in its own read-only selectable field');
assert(/not (?:text )?embedded in the PDF|not added/i.test(html), 'dialog copy explicitly labels OCR as separate from embedded PDF text');
assert(!readFileSync(path.join(ROOT, 'src', 'search.js'), 'utf8').includes('ocr-output'), 'OCR output is not added to normal document search');

let apiRecognitions = 0;
let statusCalls = 0;
let copyBlocked = false;
let currentPage = 2;
let generation = 7;
const fakePage = { pageNumber: 2 };
const fakeDocument = {
  numPages: 4,
  getPage: async (pageNumber) => {
    assert(pageNumber === currentPage, 'OCR requests only the page currently selected');
    return fakePage;
  },
};
const fakeApi = {
  async getOcrStatus() {
    statusCalls += 1;
    return { available: true, version: '5.3.0', languages: ['eng', 'hin'] };
  },
  async ocrPage(bytes, languages) {
    apiRecognitions += 1;
    assert(bytes instanceof Uint8Array && languages === 'eng', 'the OCR action sends only the rendered page PNG and chosen language');
    return { ok: true, text: 'OCR-generated sample text', version: '5.3.0', languages: ['eng'] };
  },
};
const ocrController = new OcrController({
  getDoc: () => fakeDocument,
  getCurrentPage: () => currentPage,
  getRotation: () => 90,
  getDocumentName: () => 'scan.pdf',
  getDocumentGeneration: () => generation,
  isCopyBlocked: () => copyBlocked,
  getAPI: () => fakeApi,
  renderPage: async (page, options) => {
    assert(page === fakePage && options.rotation === 90, 'OCR renders the current page at the viewer rotation');
    return { bytes: new Uint8Array([137, 80, 78, 71]), width: 100, height: 200 };
  },
});
ocrController.setDocumentAvailable(true);
assert(!ocrController.ui.toolbarButton.disabled, 'OCR becomes available for an open document without requiring an OCR engine');
assert(apiRecognitions === 0, 'opening a document never starts OCR automatically');
ocrController.ui.toolbarButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
assert(ocrController.isOpen, 'one OCR toolbar click opens the dialog');
await new Promise((resolve) => setTimeout(resolve, 0));
assert(statusCalls > 0 && ocrController.status.languages.includes('eng'), 'opening OCR checks the optional engine and its installed packs');
assert(apiRecognitions === 0, 'checking engine availability does not OCR the page');
assert(ocrController.selectedLanguages().includes('eng'), 'English is selected when its optional pack is installed');
await ocrController.runCurrentPage();
assert(apiRecognitions === 1, 'recognition starts only after the explicit current-page action');
assert(document.getElementById('ocr-output').value === 'OCR-generated sample text', 'recognized text stays in the distinct OCR output area');
assert(document.getElementById('ocr-result-label').textContent.includes('OCR-generated text · page 2'), 'OCR output identifies its source and page');
assert(/not text embedded in the PDF/.test(document.getElementById('ocr-result-note').textContent), 'the result explains it is not native PDF text');

copyBlocked = true;
ocrController.setDocumentAvailable(true);
assert(ocrController.ui.toolbarButton.disabled, 'OCR is blocked when PDF permissions deny copying');
copyBlocked = false;
ocrController.setDocumentAvailable(true);
ocrController.onDocumentChanged();
assert(document.getElementById('ocr-result').hidden && !ocrController.isOpen, 'changing documents invalidates OCR output and closes the dialog');
assert(document.getElementById('btn-ocr').getAttribute('aria-expanded') === 'false', 'the toolbar reports the OCR dialog closed accessibly');

for (const doc of openDocuments) {
  try { await doc.destroy(); } catch { /* test cleanup */ }
}

console.log(`\n==============================`);
console.log(`Phase 7 tests: ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failures.length) {
  console.log('Failures:');
  for (const failure of failures) console.log(`  - ${failure}`);
}
process.exit(failed ? 1 : 0);
