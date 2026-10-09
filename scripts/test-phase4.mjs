#!/usr/bin/env node
// Cambuz PDF Reader — Phase 4 basic PDF utility tests.
// Part A exercises the pure document operations (rotate, delete, extract,
// reorder, merge, split, metadata, encrypted-file refusal) and verifies page
// order, page counts, page rotation and output validity by reopening every
// generated PDF with pdf-lib and PDF.js. Part B drives the real page tools
// dialog controller in a jsdom DOM built from src/index.html, including the
// confirmation, undo, Save As and split-save paths via a stubbed host API.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import * as pdfjsLib from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import {
  appendPdfs,
  computeMove,
  deletePages,
  extractPages,
  loadEditablePdf,
  parseSplitPlan,
  readMetadata,
  reorderPages,
  rotatePages,
  splitPdf,
  writeMetadata,
} from '../src/pdf-ops.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const standardFontDataUrl = pathToFileURL(path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep).href;

let passed = 0;
let failed = 0;
const failures = [];
function pass(name) {
  passed += 1;
  console.log(`  PASS  ${name}`);
}
function fail(name, detail) {
  failed += 1;
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  failures.push(name);
}
function assert(condition, name, detail) {
  if (condition) pass(name);
  else fail(name, detail);
}
async function rejects(fn, message, name) {
  try {
    await fn();
    fail(name, 'did not reject');
  } catch (error) {
    if (String(error.message).includes(message)) pass(name);
    else fail(name, `unexpected error: ${error.message}`);
  }
}
function section(title) {
  console.log(`\n## ${title}`);
}

// --- Fixtures and verification helpers ------------------------------------

/** A document whose page n has the text "PAGE n" and a width that identifies it. */
async function makeDocument(count, { title = null, author = null } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= count; index += 1) {
    const page = doc.addPage([300 + index * 10, 400]);
    page.drawText(`PAGE ${index}`, { x: 40, y: 300, size: 24, font });
  }
  if (title) doc.setTitle(title);
  if (author) doc.setAuthor(author);
  return new Uint8Array(await doc.save());
}

async function openWithPdfJs(bytes) {
  return pdfjsLib.getDocument({ data: new Uint8Array(bytes).slice(), standardFontDataUrl }).promise;
}

/** Reopen with PDF.js and return the page-number labels in document order. */
async function pageLabels(bytes) {
  const doc = await openWithPdfJs(bytes);
  const labels = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str).join(' ');
    const match = /PAGE\s*(\d+)/.exec(text);
    labels.push(match ? Number(match[1]) : text.trim() || '∅');
  }
  await doc.destroy();
  return labels;
}

async function pageRotations(bytes) {
  const doc = await loadEditablePdf(bytes);
  return doc.getPages().map((page) => page.getRotation().angle);
}

async function pageCountOf(bytes) {
  const doc = await openWithPdfJs(bytes);
  const count = doc.numPages;
  await doc.destroy();
  return count;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
console.log('Phase 4 basic PDF utility tests\n');
section('A1. Input handling and encrypted-file refusal');
{
  const encrypted = new Uint8Array(readFileSync(path.join(ROOT, 'scripts', 'fixtures', 'encrypted-password.pdf')));
  await rejects(
    () => loadEditablePdf(encrypted),
    'password-protected or encrypted',
    'encrypted PDF is refused with a clear message'
  );
  await rejects(
    () => rotatePages(encrypted, [1], 90),
    'cannot be edited yet',
    'rotate refuses encrypted input instead of altering it'
  );
  await rejects(
    () => loadEditablePdf(new TextEncoder().encode('not a pdf at all')),
    'not a readable PDF',
    'non-PDF input is rejected'
  );

  const source = await makeDocument(3);
  const before = source.slice();
  await rotatePages(source, [1], 90);
  assert(same(Array.from(source), Array.from(before)), 'operations never mutate their input bytes');
}

section('A2. Rotate pages');
{
  const source = await makeDocument(4);
  const rotated = await rotatePages(source, [2, 4], 90);
  assert(same(await pageRotations(rotated), [0, 90, 0, 90]), 'clockwise rotation sets /Rotate on selected pages only');
  assert(same(await pageLabels(rotated), [1, 2, 3, 4]), 'rotation keeps page order and content');

  const turned = await rotatePages(rotated, [2], 90);
  assert(same(await pageRotations(turned), [0, 180, 0, 90]), 'rotation adds to an existing /Rotate (90 + 90 = 180)');

  const counter = await rotatePages(source, [1], -90);
  assert(same(await pageRotations(counter), [270, 0, 0, 0]), 'counter-clockwise from 0 wraps to 270');

  await rejects(() => rotatePages(source, [1], 45), 'only be rotated by 90', 'non-quarter-turn rotation is rejected');
  await rejects(() => rotatePages(source, [9], 90), 'outside this document', 'out-of-range page is rejected');
  await rejects(() => rotatePages(source, [], 90), 'at least one page', 'empty selection is rejected');
  await rejects(() => rotatePages(source, [2, 2], 90), 'more than once', 'duplicate pages are rejected');
  assert(await pageCountOf(turned) === 4, 'rotated output reopens with the same page count');
}

section('A3. Delete pages');
{
  const source = await makeDocument(5);
  const result = await deletePages(source, [2, 4]);
  assert(await pageCountOf(result) === 3, 'delete two of five leaves three pages');
  assert(same(await pageLabels(result), [1, 3, 5]), 'delete keeps the remaining pages in their original order');
  await rejects(
    () => deletePages(source, [1, 2, 3, 4, 5]),
    'at least one page',
    'deleting every page is refused'
  );
  const single = await deletePages(source, [5]);
  assert(same(await pageLabels(single), [1, 2, 3, 4]), 'deleting the last page works');
}

section('A4. Extract pages');
{
  const source = await makeDocument(5);
  const extracted = await extractPages(source, [4, 1]);
  assert(same(await pageLabels(extracted), [4, 1]), 'extract keeps the requested order');
  assert(await pageCountOf(extracted) === 2, 'extract produces a two-page document');
  const all = await extractPages(source, [1, 2, 3, 4, 5]);
  assert(same(await pageLabels(all), [1, 2, 3, 4, 5]), 'extracting every page reproduces the document');
  await rejects(() => extractPages(source, [7]), 'outside this document', 'extract rejects out-of-range pages');
}

section('A5. Reorder pages and keep document metadata');
{
  const source = await makeDocument(4, { title: 'Quarterly report', author: 'Cambuz' });
  const reordered = await reorderPages(source, [3, 1, 4, 2]);
  assert(same(await pageLabels(reordered), [3, 1, 4, 2]), 'reorder produces the exact requested sequence');
  const meta = await readMetadata(reordered);
  assert(meta.title === 'Quarterly report' && meta.author === 'Cambuz', 'reorder preserves the document title and author');
  await rejects(() => reorderPages(source, [1, 2, 3]), 'every page exactly once', 'reorder needs every page listed');
  await rejects(() => reorderPages(source, [1, 1, 2, 3]), 'more than once', 'reorder rejects repeated pages');
}

section('A6. Move pages (order and selection maths)');
{
  const cases = [
    ['up block of two', 6, [2, 3], 'up', [1, 3, 4, 2, 5, 6], [1, 2]],
    ['down block of two', 6, [2, 3], 'down', [1, 2, 5, 3, 4, 6], [3, 4]],
    ['up at the top is a no-op', 6, [0], 'up', [1, 2, 3, 4, 5, 6], [0]],
    ['down at the bottom is a no-op', 6, [5], 'down', [1, 2, 3, 4, 5, 6], [5]],
    ['mixed selection moves each block', 6, [1, 4], 'up', [2, 1, 3, 5, 4, 6], [0, 3]],
  ];
  for (const [label, count, selected, direction, order, selection] of cases) {
    const result = computeMove(count, selected, direction);
    assert(
      same(result.order, order) && same(result.selected, selection),
      `move ${label}`,
      `got ${JSON.stringify(result)}`
    );
  }

  const source = await makeDocument(4);
  const move = computeMove(4, [1], 'down');
  const moved = await reorderPages(source, move.order);
  assert(same(await pageLabels(moved), [1, 3, 2, 4]), 'a computed move applied with reorderPages reorders the real PDF');
}

section('A7. Merge (append) PDFs');
{
  const base = await makeDocument(2);
  const more = await makeDocument(3);
  const merged = await appendPdfs(base, [more]);
  assert(same(await pageLabels(merged), [1, 2, 1, 2, 3]), 'merge appends all pages in order');
  const twice = await appendPdfs(base, [more, more]);
  assert(await pageCountOf(twice) === 8, 'merging the same file twice appends it twice');

  const hindi = new Uint8Array(readFileSync(path.join(ROOT, 'samples', 'hindi-sample.pdf')));
  const hindiCount = (await PDFDocument.load(hindi, { updateMetadata: false })).getPageCount();
  const mixed = await appendPdfs(base, [hindi]);
  assert(await pageCountOf(mixed) === 2 + hindiCount, 'merging a Unicode sample keeps its page count');
  const doc = await openWithPdfJs(mixed);
  const lastPage = await doc.getPage(doc.numPages);
  const text = (await lastPage.getTextContent()).items.map((item) => item.str).join('');
  await doc.destroy();
  assert(/[\u0900-\u097F]/.test(text), 'merged Hindi page keeps Devanagari text');

  await rejects(
    () => appendPdfs(base, [new TextEncoder().encode('garbage')]),
    'Could not merge file 1',
    'merge names the file that failed'
  );
}

section('A8. Split documents');
{
  const source = await makeDocument(6);
  const parts = await splitPdf(source, [[1, 2], [3, 4, 5], [6]]);
  assert(parts.length === 3, 'split produces one document per group');
  assert(same(parts.map((part) => part.pageCount), [2, 3, 1]), 'split reports the page count of each part');
  assert(same(await pageLabels(parts[1].bytes), [3, 4, 5]), 'split part keeps its requested page order');
  assert(same(await pageLabels(parts[2].bytes), [6]), 'single-page part is valid');
  const reversed = await splitPdf(source, [[4, 2]]);
  assert(same(await pageLabels(reversed[0].bytes), [4, 2]), 'split honours a non-ascending group');
  await rejects(() => splitPdf(source, []), 'at least one part', 'split with no parts is refused');
  await rejects(() => splitPdf(source, [[1, 9]]), 'outside this document', 'split rejects out-of-range pages');
}

section('A9. Split plan parsing');
{
  assert(same(parseSplitPlan('1-3; 4-6', 6), [[1, 2, 3], [4, 5, 6]]), '"1-3; 4-6" makes two parts');
  assert(same(parseSplitPlan('1-2, 5; 3', 5), [[1, 2, 5], [3]]), 'commas join pages inside one part');
  assert(same(parseSplitPlan('every 2', 5), [[1, 2], [3, 4], [5]]), '"every 2" makes equal chunks with a short last part');
  assert(same(parseSplitPlan('every 9', 5), [[1, 2, 3, 4, 5]]), '"every N" larger than the document keeps one part');
  for (const [input, message, name] of [
    ['', 'Enter how to split', 'empty split plan is refused'],
    ['1-3;', 'extra ";"', 'trailing semicolon is refused'],
    ['every 0', 'page count of 1 or more', '"every 0" is refused'],
    ['7', 'between 1 and 5', 'split page beyond the document is refused'],
    ['2-1', 'backwards', 'backwards range is refused'],
    ['1,1', 'more than once', 'duplicate page within a part is refused'],
    ['abc', 'not a valid page', 'non-numeric plan is refused'],
  ]) {
    try {
      parseSplitPlan(input, 5);
      fail(name, 'did not throw');
    } catch (error) {
      if (error.message.includes(message)) pass(name);
      else fail(name, error.message);
    }
  }
}

section('A10. Document information (metadata)');
{
  const source = await makeDocument(2, { title: 'Original', author: 'Jane' });
  const before = await readMetadata(source);
  assert(before.title === 'Original' && before.author === 'Jane' && before.pageCount === 2, 'metadata reads title, author and page count');

  const updated = await writeMetadata(source, {
    title: '  Board pack  ',
    subject: 'Q3 review',
    keywords: 'finance, draft',
  });
  const meta = await readMetadata(updated);
  assert(meta.title === 'Board pack', 'title is trimmed and saved');
  assert(meta.subject === 'Q3 review' && meta.keywords === 'finance, draft', 'subject and keywords are saved');
  assert(meta.author === 'Jane', 'fields omitted from the update keep their value');
  assert(same(await pageLabels(updated), [1, 2]), 'metadata edits leave page content untouched');

  const cleared = await writeMetadata(updated, { keywords: '' });
  assert((await readMetadata(cleared)).keywords === '', 'an empty field clears that value');

  const sanitized = await writeMetadata(source, { title: 'A\u0000B\u0007C' });
  assert((await readMetadata(sanitized)).title === 'A B C', 'control characters are replaced in metadata');
  await rejects(
    () => writeMetadata(source, { title: 'x'.repeat(2001) }),
    'must be 2000 characters or fewer',
    'overlong metadata is rejected'
  );

  const rotated = await rotatePages(source, [1], 90);
  const producerBefore = before.producer;
  assert((await readMetadata(rotated)).producer === producerBefore, 'unrelated operations keep the original Producer field');
}

section('A11. Generated PDFs are valid and reopen');
{
  const source = await makeDocument(5, { title: 'Round trip' });
  const pipeline = await reorderPages(
    await deletePages(
      await rotatePages(source, [2], 90),
      [4]
    ),
    [4, 3, 2, 1]
  );
  assert(same(await pageLabels(pipeline), [5, 3, 2, 1]), 'chained rotate → delete → reorder yields the right order');
  assert(same(await pageRotations(pipeline), [0, 0, 90, 0]), 'chained operations keep rotation on the right page');
  const doc = await PDFDocument.load(pipeline);
  assert(doc.getPageCount() === 4 && doc.getTitle() === 'Round trip', 'output passes a pdf-lib reload with title intact');
}

section('A12. Sample documents survive the operations');
{
  for (const file of ['cambuz-demo.pdf', 'multilingual.pdf', 'punjabi-sample.pdf', 'welcome.pdf']) {
    const bytes = new Uint8Array(readFileSync(path.join(ROOT, 'samples', file)));
    const count = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
    const reversed = await reorderPages(bytes, Array.from({ length: count }, (_, index) => count - index));
    assert(await pageCountOf(reversed) === count, `${file}: reversed document keeps ${count} page(s)`);
    const rotated = await rotatePages(bytes, [1], 90);
    assert(await pageCountOf(rotated) === count, `${file}: rotated document reopens`);
  }
}

// ---------------------------------------------------------------------------
section('B1. Page tools dialog is wired to index.html');
const html = readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
const virtualConsole = new VirtualConsole();
const dom = new JSDOM(html, { url: 'http://localhost:3000/src/index.html', virtualConsole });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;

const { PageToolsController } = await import('../src/pdf-ops-ui.js');

const requiredIds = [
  'pageops-dialog', 'pageops-doc-label', 'pageops-dirty', 'btn-pageops-close', 'btn-pageops',
  'pageops-grid', 'pageops-grid-scroll', 'btn-po-rotate-ccw', 'btn-po-rotate-cw', 'btn-po-move-up',
  'btn-po-move-down', 'btn-po-select-all', 'btn-po-delete', 'btn-po-extract', 'btn-po-undo', 'btn-po-add',
  'po-meta-title', 'po-meta-author', 'po-meta-subject', 'po-meta-keywords', 'po-meta-info',
  'btn-po-meta-apply', 'po-split-spec', 'po-split-error', 'btn-po-split', 'btn-po-discard',
  'btn-po-duplicate', 'btn-po-save-as', 'pageops-status',
];
const missing = requiredIds.filter((id) => !document.getElementById(id));
assert(missing.length === 0, 'every page-tools element id exists in index.html', missing.join(', '));
assert(document.querySelector('link[href="pdf-ops.css"]') !== null, 'page tools stylesheet is linked');
assert(document.getElementById('pageops-dialog').style.display === 'none', 'page tools dialog starts hidden');

section('B2. Page tools controller behaviour (jsdom + PDF.js)');
const confirmLog = [];
let confirmAnswer = true;
window.confirm = (message) => {
  confirmLog.push(message);
  return confirmAnswer;
};
const saveCalls = [];
const savePdfResult = { value: { ok: true, path: '/docs/report-edited.pdf', name: 'report-edited.pdf' } };
const saveFilesCalls = [];
const savedDocs = [];
window.cambuzAPI = {
  savePdf: async (bytes, options) => {
    saveCalls.push({ bytes: new Uint8Array(bytes).slice(), options });
    return typeof savePdfResult.value === 'function' ? savePdfResult.value(options) : savePdfResult.value;
  },
  savePdfFiles: async (files, options) => {
    saveFilesCalls.push({ files, options });
    return { ok: true, directory: '/docs/split', files: files.map((file) => file.name) };
  },
  openPdfPaths: async () => [],
};

let docGeneration = 1;
let sourceBytes = await makeDocument(4, { title: 'Report' });
let filePath = '/docs/report.pdf';
let mergeFiles = [];
const pdfToolsEvents = [];

const controller = new PageToolsController({
  pdfjsLib,
  standardFontDataUrl,
  getSourceBytes: () => sourceBytes,
  getDocumentName: () => 'report.pdf',
  getDocumentGeneration: () => docGeneration,
  getCurrentFilePath: () => filePath,
  pickPdfFiles: async () => mergeFiles,
  onSaved: async (payload) => {
    savedDocs.push(payload);
    pdfToolsEvents.push('saved');
  },
  onStatus: () => {},
});

const cells = () => [...document.querySelectorAll('#pageops-grid .po-cell')];
const selectedPositions = () => cells().map((cell, index) => (cell.classList.contains('is-selected') ? index : -1)).filter((i) => i >= 0);
const statusText = () => document.getElementById('pageops-status').textContent;
const clickCell = (index, init = {}) => cells()[index].dispatchEvent(new window.MouseEvent('click', { bubbles: true, ...init }));
const workingLabels = () => pageLabels(controller.session.bytes);

await controller.open();
assert(controller.isOpen, 'open() shows the dialog');
assert(document.getElementById('pageops-dialog').style.display === 'flex', 'dialog becomes visible');
assert(cells().length === 4, 'grid has one cell per page');
assert(!controller.isDirty, 'a freshly opened document is clean');
assert(document.getElementById('btn-po-save-as').disabled === false, 'Save As is enabled for an open document');
assert(document.getElementById('btn-po-rotate-cw').disabled === true, 'rotate is disabled until a page is selected');

clickCell(1);
assert(same(selectedPositions(), [1]), 'clicking a page selects only that page');
clickCell(3, { ctrlKey: true });
assert(same(selectedPositions(), [1, 3]), 'Ctrl-click adds pages to the selection');
clickCell(0, { shiftKey: true });
assert(same(selectedPositions(), [0, 1, 2, 3]), 'Shift-click selects the range from the anchor');
clickCell(2);
assert(same(selectedPositions(), [2]), 'a plain click replaces the selection');

clickCell(1);
await controller.rotateSelected(90);
assert(controller.isDirty, 'an operation marks the working copy as changed');
assert(same(await pageRotations(controller.session.bytes), [0, 90, 0, 0]), 'rotate applies to the working copy');
assert(same(await pageRotations(sourceBytes), [0, 0, 0, 0]), 'the original bytes are untouched by rotate');
assert(document.getElementById('pageops-dirty').hidden === false, 'the unsaved-changes badge is visible');

clickCell(1);
await controller.moveSelected('down');
assert(same(await workingLabels(), [1, 3, 2, 4]), 'move down reorders the working copy');
assert(same(selectedPositions(), [2]), 'the moved page stays selected at its new position');

clickCell(2);
confirmAnswer = false;
await controller.extractSelected();
assert(confirmLog.length === 1 && /Keep only the 1 selected page/.test(confirmLog[0]), 'extract asks for confirmation');
assert(same(await workingLabels(), [1, 3, 2, 4]), 'declined extract changes nothing');
confirmAnswer = true;

clickCell(0);
clickCell(3, { ctrlKey: true });
await controller.deleteSelected();
assert(/Delete 2 pages/.test(confirmLog.at(-1)), 'delete asks for confirmation with the page count');
assert(same(await workingLabels(), [3, 2]), 'delete removes the selected pages from the working copy');
assert(cells().length === 2, 'the grid is rebuilt after delete');

await controller.undo();
assert(same(await workingLabels(), [1, 3, 2, 4]), 'undo restores the previous working copy');

// Deleting every page is refused before any confirmation is shown.
controller.selected = new Set([0, 1, 2, 3]);
const promptsBeforeRefusal = confirmLog.length;
await controller.deleteSelected();
assert(confirmLog.length === promptsBeforeRefusal, 'deleting every page is refused without a prompt');
assert(/at least one page/.test(statusText()), 'refusing to delete everything explains why');
assert(controller.session.pageCount === 4, 'the working copy keeps its pages after a refused delete');

// Extraction removes pages only from the working copy.
clickCell(0);
clickCell(2, { ctrlKey: true });
await controller.extractSelected();
assert(same(await workingLabels(), [1, 2]), 'extract keeps only selected pages in the working copy');
assert(await pageCountOf(sourceBytes) === 4, 'extract never changes the original file');

// Metadata: apply to the working copy.
document.getElementById('po-meta-title').value = 'Board pack';
await controller.applyMetadata();
assert((await readMetadata(controller.session.bytes)).title === 'Board pack', 'metadata applied to the working copy');
assert((await readMetadata(sourceBytes)).title === 'Report', 'metadata edit leaves the original title intact');

// Merge: append pages of another file.
mergeFiles = [{ name: 'appendix.pdf', bytes: await makeDocument(2) }];
await controller.addPdfs();
assert(controller.session.pageCount === 4, 'merge appends the chosen file to the working copy');

// Split: parts saved via the host, working copy unchanged.
const workingBefore = controller.session.bytes;
document.getElementById('po-split-spec').value = '1-2; 3-4';
await controller.splitDocument();
assert(saveFilesCalls.length === 1, 'split hands its parts to the host in one batch');
const parts = saveFilesCalls[0].files;
assert(
  parts.length === 2 && parts[0].name === 'report-part-1.pdf' && parts[1].name === 'report-part-2.pdf',
  'split parts get numbered names based on the document name'
);
assert(same(await pageLabels(parts[0].bytes), [1, 2]), 'first split part holds the first requested pages');
assert(same(await pageLabels(parts[1].bytes), [1, 2]), 'second split part holds the appended pages in order');
assert(saveFilesCalls[0].options.originalPath === '/docs/report.pdf', 'split passes the original path so overwrites can be checked');
assert(controller.session.bytes === workingBefore, 'split leaves the working copy unchanged');

document.getElementById('po-split-spec').value = '1-9';
await controller.splitDocument();
assert(/between 1 and 4/.test(document.getElementById('po-split-error').textContent), 'invalid split plan shows an inline error');
assert(saveFilesCalls.length === 1, 'invalid split plan writes nothing');

// Save As: writes the working copy through the host and reopens it.
await controller.saveAs();
assert(saveCalls.length === 1, 'Save As calls the host save path once');
assert(saveCalls[0].options.originalPath === '/docs/report.pdf', 'Save As tells the host which file is the original');
assert(saveCalls[0].options.suggestedName === 'report-edited.pdf', 'Save As suggests a non-destructive name');
assert(same(await pageLabels(saveCalls[0].bytes), [1, 2, 1, 2]), 'Save As writes the working copy (with the merged pages), not the original');
assert(savedDocs.length === 1 && savedDocs[0].name === 'report-edited.pdf', 'after Save As the viewer is pointed at the saved file');
assert(!controller.isOpen, 'a successful save closes the dialog');

// The controller is reset when the viewer swaps documents.
await controller.onDocumentChanged();
assert(controller.session === null && !controller.isDirty, 'changing documents discards the session');

// Duplicate copies the file as opened, never the working copy.
docGeneration += 1;
sourceBytes = await makeDocument(3, { title: 'Second' });
await controller.open();
clickCell(0);
await controller.rotateSelected(-90);
assert(controller.isDirty, 'second document is dirty after rotating');
savePdfResult.value = { ok: true, path: '/docs/second (copy).pdf', name: 'second (copy).pdf' };
const savesBefore = savedDocs.length;
await controller.duplicate();
const duplicateCall = saveCalls.at(-1);
assert(same(await pageRotations(duplicateCall.bytes), [0, 0, 0]), 'duplicate copies the file as it is on disk (no unsaved rotation)');
assert(savedDocs.length === savesBefore, 'duplicate does not reopen or replace the open document');
assert(controller.isDirty, 'duplicate keeps the unsaved working copy');

// Cancelling the save dialog keeps everything.
savePdfResult.value = { ok: false, canceled: true };
const savesBeforeCancel = savedDocs.length;
await controller.saveAs();
assert(savedDocs.length === savesBeforeCancel && controller.isDirty, 'cancelling Save As keeps the unsaved edits');
assert(/Save cancelled/.test(statusText()), 'cancelled save explains nothing changed');

// Discarding asks first and then restores the file as opened.
confirmAnswer = false;
const discardPrompt = controller.confirmDiscardIfDirty('Opening another file');
assert(discardPrompt === false, 'opening another file is blocked when the user keeps the edits');
confirmAnswer = true;
await controller.discardChanges();
assert(!controller.isDirty && controller.session.pageCount === 3, 'discard restores the document as opened');

// Overwriting the original is reported to the host as such (confirmed in main).
savePdfResult.value = (options) => ({ ok: true, path: options.originalPath, name: 'second.pdf', overwroteOriginal: true });
await controller.saveAs();
assert(savedDocs.at(-1).path === '/docs/report.pdf' && savedDocs.at(-1).name === 'second.pdf', 'an overwrite save hands the original path back to the viewer');

// Encrypted originals never reach the editor.
docGeneration += 1;
sourceBytes = new Uint8Array(readFileSync(path.join(ROOT, 'scripts', 'fixtures', 'encrypted-password.pdf')));
await controller.open().catch(() => {});
assert(/cannot be used for page tools|password-protected|encrypted/i.test(statusText()), 'page tools report an encrypted document clearly');
assert(document.getElementById('btn-po-save-as').disabled === true, 'Save As stays disabled for an encrypted document');
controller.close(false);

// ---------------------------------------------------------------------------
console.log('\n==============================');
console.log(`Phase 4 tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
