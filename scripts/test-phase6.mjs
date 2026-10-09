#!/usr/bin/env node
// Cambuz PDF Reader — Phase 6 multilingual quality tests.
//
// Exercises real PDF.js extraction, TextLayer selection/search highlighting,
// vector rasterization, missing-font fallback, Unicode grapheme offsets, and
// the same vector-preserving PDF preparation path used by print preview.
// A native OS clipboard or physical printer is not available in this Node
// sandbox; clipboard serialization is therefore checked from Selection text,
// and printing is checked by reopening/rasterizing the generated print PDF.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import * as pdfjsLib from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import {
  countMatches,
  countTextContentMatches,
  findAllMatches,
  getSearchableText,
  normalizeStr,
  SearchController,
  verifyMatch,
} from '../src/search.js';
import { buildPrintPdf, PRINT_DEFAULTS } from '../src/printing.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SAMPLE_DIR = path.join(ROOT, 'samples');
const MAIN_PDF = path.join(SAMPLE_DIR, 'phase6-indian-languages.pdf');
const EMBEDDED_FONT_PDF = path.join(SAMPLE_DIR, 'phase6-embedded-font.pdf');
const MISSING_FONT_PDF = path.join(SAMPLE_DIR, 'phase6-missing-font.pdf');
const standardFontDataUrl = pathToFileURL(
  path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep
).href;

const LANGUAGES = [
  { name: 'English', page: 2, sample: 'Clear text stays selectable, searchable, and printable in English.', query: 'LANGKEY' },
  { name: 'Hindi', page: 3, sample: 'हिंदी पाठ में क्षत्रिय, प्रज्ञा, श्रेणी और विद्यालय के उदाहरण हैं।', query: 'नमूना' },
  { name: 'Punjabi', page: 4, sample: 'ਪੰਜਾਬੀ ਪਾਠ ਵਿੱਚ ਖੇਤੀ, ਸਿੱਖਿਆ ਅਤੇ ਵੱਖ-ਵੱਖ ਲਗਾਂ ਦੀ ਜਾਂਚ ਹੈ।', query: 'ਕੁੰਜੀ' },
  { name: 'Bengali', page: 5, sample: 'বাংলা ভাষায় শিক্ষা, যুক্তাক্ষর এবং স্বরচিহ্নের পরীক্ষা।', query: 'কীচিহ্ন' },
  { name: 'Gujarati', page: 6, sample: 'ગુજરાતી ભાષામાં વાંચન, શોધ અને છાપકામની ચકાસણી।', query: 'કસોટી' },
  { name: 'Marathi', page: 7, sample: 'मराठी वाचनात ज्ञान, शोध आणि संयुक्ताक्षरांची चाचणी आहे।', query: 'चिन्ह' },
  { name: 'Tamil', page: 8, sample: 'தமிழ் மொழியில் வாசிப்பு, தேடல், தேர்வு மற்றும் அச்சிடுதல் சோதனை।', query: 'குறி' },
  { name: 'Telugu', page: 9, sample: 'తెలుగు భాషలో పఠనం, శోధన, ఎంపిక మరియు ముద్రణ పరీక్ష।', query: 'సంకేతం' },
  { name: 'Kannada', page: 10, sample: 'ಕನ್ನಡ ಭಾಷೆಯಲ್ಲಿ ಓದು, ಹುಡುಕಾಟ, ಆಯ್ಕೆ ಮತ್ತು ಮುದ್ರಣ ಪರೀಕ್ಷೆ।', query: 'ಗುರುತು' },
  { name: 'Malayalam', page: 11, sample: 'മലയാളത്തിൽ വായന, തിരയൽ, തിരഞ്ഞെടുപ്പ്, അച്ചടി എന്നിവ പരിശോധിക്കുക।', query: 'കുറി' },
  { name: 'Odia', page: 12, sample: 'ଓଡ଼ିଆ ଭାଷାରେ ପଢ଼ିବା, ଖୋଜିବା ଓ ଛାପିବା ପରୀକ୍ଷା।', query: 'ଚିହ୍ନ' },
  { name: 'Assamese', page: 13, sample: 'অসমীয়া ভাষাত পঢ়া, বিচৰা আৰু ছপা পৰীক্ষা কৰা হৈছে।', query: 'চাবি' },
  { name: 'Urdu (RTL)', page: 14, sample: 'اردو زبان میں تلاش، انتخاب، نقل اور طباعت کی آزمائش۔', query: 'کلید' },
];

let passed = 0;
let failed = 0;
const failures = [];
const openDocuments = [];

function pass(name) {
  passed += 1;
  console.log(`  PASS  ${name}`);
}
function fail(name, detail) {
  failed += 1;
  failures.push(name);
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}
function assert(condition, name, detail = '') {
  if (condition) pass(name);
  else fail(name, detail);
}
function section(title) {
  console.log(`\n## ${title}`);
}
function fixtureExists(file, name) {
  try {
    readFileSync(file);
    pass(`${name} exists`);
    return true;
  } catch {
    fail(`${name} exists`, `missing ${path.relative(ROOT, file)}`);
    return false;
  }
}
async function openPdf(bytes, options = {}) {
  const view = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
  const doc = await pdfjsLib.getDocument({
    data: view.slice(),
    standardFontDataUrl,
    ...options,
  }).promise;
  openDocuments.push(doc);
  return doc;
}
async function getTextContent(doc, pageNumber) {
  return (await doc.getPage(pageNumber)).getTextContent();
}
function contentText(textContent) {
  return textContent.items.map((item) => item.str).join('');
}
function countInk(context, width, height) {
  const pixels = context.getImageData(0, 0, width, height).data;
  let ink = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset] < 245 || pixels[offset + 1] < 245 || pixels[offset + 2] < 245) ink += 1;
  }
  return ink;
}
async function renderPageInk(doc, pageNumber, options = {}) {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  await page.render({ canvasContext: context, viewport, ...options }).promise;
  return countInk(context, width, height);
}

console.log('Phase 6 Indian-language excellence tests\n');

// ---------------------------------------------------------------------------
section('A. Fixtures and PDF.js extraction for English + 12 target languages');
const hasMainPdf = fixtureExists(MAIN_PDF, '16-page multilingual fixture');
const hasEmbeddedFontPdf = fixtureExists(EMBEDDED_FONT_PDF, 'visible embedded-Tamil-font fixture');
const hasMissingFontPdf = fixtureExists(MISSING_FONT_PDF, 'Tamil missing-font fixture');
let mainDoc = null;
let embeddedFontDoc = null;
let missingFontDoc = null;
let dom = null;

if (hasMainPdf) {
  mainDoc = await openPdf(readFileSync(MAIN_PDF), { disableFontFace: true, useSystemFonts: true });
  assert(mainDoc.numPages === 16, 'main fixture has cover + 13 language + mixed-script + stress pages', `got ${mainDoc.numPages}`);

  for (const language of LANGUAGES) {
    const textContent = await getTextContent(mainDoc, language.page);
    const pageText = contentText(textContent);
    assert(pageText.includes(language.sample), `${language.name}: complete sample phrase extracts byte-exactly`);
    assert(
      countTextContentMatches(textContent.items, language.query) === 2,
      `${language.name}: PDF.js text items return two searchable key matches`
    );
    assert(
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(pageText),
      `${language.name}: extraction contains no control-character corruption`
    );
  }

  const mixedContent = await getTextContent(mainDoc, 15);
  const mixedText = contentText(mixedContent);
  for (const language of LANGUAGES) {
    assert(mixedText.includes(language.sample), `mixed-script page includes ${language.name} text`);
  }
  assert(mixedText.includes('Mixed scripts on one page'), 'mixed-script page has its heading');

  const rtlContent = await getTextContent(mainDoc, 14);
  const rtlTextItem = rtlContent.items.find((item) => item.str.includes(LANGUAGES.at(-1).sample));
  assert(rtlTextItem?.dir === 'rtl', 'PDF.js identifies the Urdu sample run as RTL');
  assert(contentText(rtlContent).includes(LANGUAGES.at(-1).sample), 'Urdu extraction remains in logical reading order');
}

// ---------------------------------------------------------------------------
section('B. Grapheme-safe search offsets and text-item boundaries');
{
  const source = 'Cafe\u0301 and café';
  const cafeMatches = findAllMatches(source, 'café');
  assert(cafeMatches.length === 2, 'NFC query matches composed and decomposed Latin accents');
  assert(source.slice(cafeMatches[0]?.index, cafeMatches[0]?.index + cafeMatches[0]?.length) === 'Cafe\u0301', 'decomposed match maps back to the complete original grapheme');
  assert(cafeMatches.every((match) => verifyMatch(source, match.index, match.length, 'café')), 'both normalized Latin ranges verify safely');

  const devanagari = 'NFC: क़िला   NFD: क़िला';
  const nuktaMatches = findAllMatches(devanagari, 'क़िला');
  assert(nuktaMatches.length === 2, 'Devanagari nukta spellings compare canonically');
  assert(
    nuktaMatches.map((match) => devanagari.slice(match.index, match.index + match.length)).join('|') === 'क़िला|क़िला',
    'normalized matches retain correct NFC/NFD source offsets'
  );
  assert(nuktaMatches.every((match) => verifyMatch(devanagari, match.index, match.length, 'क़िला')), 'both nukta ranges pass verifyMatch');

  assert(countMatches('İ', 'i') === 1, 'case-fold expansion does not count a grapheme twice');
  assert(countMatches('Istanbul', 'istan', false) === 1, 'case-insensitive Latin search remains active');
  assert(countMatches('Istanbul', 'istan', true) === 0, 'match-case search remains case-sensitive');

  const streamItems = [{ str: 'foo', hasEOL: true }, { str: 'bar' }];
  assert(getSearchableText(streamItems) === 'foo\nbar', 'PDF.js end-of-line markers become real search separators');
  assert(countTextContentMatches(streamItems, 'foobar') === 0, 'search does not join words across an explicit PDF line break');
  assert(
    countTextContentMatches([{ str: 'क्ष' }, { str: 'त्रि' }, { str: 'य' }], 'क्षत्रिय') === 1,
    'search finds a conjunct split across adjacent PDF.js text items'
  );
}

// Set up a browser-like DOM for PDF.js TextLayer, native selections and the
// production SearchController. NAPI canvas bridges PDF.js's canvas probes.
if (mainDoc) {
  dom = new JSDOM('<!doctype html><html><body><div id="text-layer" class="textLayer"></div></body></html>', {
    url: 'http://localhost/phase6-test.html',
    pretendToBeVisual: true,
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMMatrix = DOMMatrix;
  globalThis.ImageData = ImageData;
  globalThis.Path2D = Path2D;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

  const createElement = document.createElement.bind(document);
  document.createElement = function createCanvasCompatibleElement(name, ...args) {
    const element = createElement(name, ...args);
    if (String(name).toLowerCase() === 'canvas') {
      const canvas = createCanvas(1, 1);
      const context = canvas.getContext('2d');
      // PDF.js cleanup expects browser HTMLCanvasElement.remove().
      canvas.remove = () => {};
      context.canvas.remove = () => {};
      element.getContext = () => context;
    }
    return element;
  };

  const textLayer = document.getElementById('text-layer');
  async function renderTextLayer(doc, pageNumber) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    textLayer.replaceChildren();
    textLayer.style.setProperty('--scale-factor', String(viewport.scale));
    const task = new pdfjsLib.TextLayer({ textContentSource: textContent, container: textLayer, viewport });
    await task.render();
    return { page, textContent, text: textLayer.textContent };
  }

  function selectText(root, expected) {
    const showText = root.ownerDocument.defaultView.NodeFilter.SHOW_TEXT;
    const walker = root.ownerDocument.createTreeWalker(root, showText);
    let node = walker.nextNode();
    while (node) {
      const offset = node.data.indexOf(expected);
      if (offset >= 0) {
        const range = root.ownerDocument.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + expected.length);
        const selection = root.ownerDocument.defaultView.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return selection;
      }
      node = walker.nextNode();
    }
    return null;
  }

  section('C. Real PDF.js TextLayer selection/copy payload, search and highlights');
  for (const language of LANGUAGES) {
    const { textContent, text: initialText } = await renderTextLayer(mainDoc, language.page);
    const selection = selectText(textLayer, language.query);
    assert(selection?.toString() === language.query, `${language.name}: text-layer selection returns exact logical Unicode`);

    // jsdom does not implement the browser's privileged clipboard action.
    // Model only the UA's normal behavior of serializing Selection as text/plain.
    let copyPayload = '';
    const copyEvent = new window.Event('copy', { bubbles: true, cancelable: true });
    const clipboardData = { setData: (type, value) => { if (type === 'text/plain') copyPayload = value; } };
    Object.defineProperty(copyEvent, 'clipboardData', { value: clipboardData });
    const emulateBrowserCopy = (event) => {
      if (!event.defaultPrevented) event.clipboardData.setData('text/plain', window.getSelection().toString());
    };
    textLayer.addEventListener('copy', emulateBrowserCopy, { once: true });
    textLayer.dispatchEvent(copyEvent);
    assert(copyPayload === language.query, `${language.name}: selected text serializes unchanged as a clipboard payload`);

    const rtlSpan = [...textLayer.querySelectorAll('span')].find((span) => span.textContent.includes(language.query));
    if (language.name === 'Urdu (RTL)') {
      assert(rtlSpan?.getAttribute('dir') === 'rtl', 'Urdu TextLayer carries dir="rtl"');
    }

    let currentPage = language.page;
    const search = new SearchController({
      getDoc: () => mainDoc,
      getCurrentPage: () => currentPage,
      goToPage: async (pageNumber) => { currentPage = pageNumber; },
      getTextLayerEl: () => textLayer,
      onStatus: () => {},
      onCount: () => {},
    });
    await search.setQuery(language.query);
    assert(search.pageMatches?.[language.page]?.count === 2, `${language.name}: app SearchController indexes two page matches`);
    const marks = [...textLayer.querySelectorAll('mark.search-highlight')];
    assert(marks.length === 2, `${language.name}: app creates two highlight marks`);
    assert(marks.every((mark) => mark.textContent === language.query), `${language.name}: highlight text is not reordered or corrupted`);
    assert(textLayer.querySelectorAll('mark.search-highlight.current').length === 1, `${language.name}: exactly one current result is marked`);
    search.clear();
    assert(textLayer.textContent === initialText, `${language.name}: clearing search restores the exact TextLayer text`);
    window.getSelection().removeAllRanges();
  }

  // The generator places every script on page 15; make the UI search/highlight
  // cross mixed-script text items as well as single-language pages.
  {
    const { text: initialText } = await renderTextLayer(mainDoc, 15);
    let currentPage = 15;
    const mixedSearch = new SearchController({
      getDoc: () => mainDoc,
      getCurrentPage: () => currentPage,
      goToPage: async (pageNumber) => { currentPage = pageNumber; },
      getTextLayerEl: () => textLayer,
      onStatus: () => {},
      onCount: () => {},
    });
    await mixedSearch.setQuery('বাংলা');
    assert(mixedSearch.pageMatches?.[15]?.count === 1, 'mixed-script page has a Bengali match in its own page index');
    assert([...textLayer.querySelectorAll('mark.search-highlight')].some((mark) => mark.textContent === 'বাংলা'), 'mixed-script page highlights Bengali text in the correct script');
    mixedSearch.clear();
    assert(textLayer.textContent === initialText, 'mixed-script highlighting clears without changing source text');
  }

  // Exercise one HarfBuzz conjunct whose UTF-16 grapheme is divided over
  // multiple PDF.js text items and DOM spans.
  {
    const conjunct = 'क्षत्रिय';
    const pieces = ['क्', 'ष', 'त्रि', 'य'];
    const splitLayer = document.createElement('div');
    splitLayer.className = 'textLayer';
    document.body.appendChild(splitLayer);
    for (const piece of pieces) {
      const span = document.createElement('span');
      span.textContent = piece;
      splitLayer.appendChild(span);
    }
    const splitDoc = {
      numPages: 1,
      getPage: async () => ({
        getTextContent: async () => ({ items: pieces.map((str) => ({ str })) }),
        cleanup: () => {},
      }),
    };
    const splitSearch = new SearchController({
      getDoc: () => splitDoc,
      getCurrentPage: () => 1,
      goToPage: async () => {},
      getTextLayerEl: () => splitLayer,
      onStatus: () => {},
      onCount: () => {},
    });
    await splitSearch.setQuery(conjunct);
    const splitMarks = [...splitLayer.querySelectorAll('mark.search-highlight')];
    assert(splitSearch.total === 1, 'SearchController finds one conjunct split across four text items');
    assert(splitMarks.length === 4 && splitMarks.map((mark) => mark.textContent).join('') === conjunct, 'cross-item highlight fragments reassemble into the exact conjunct');
    assert(splitLayer.querySelectorAll('mark.search-highlight.current').length === 1, 'a multi-span match has exactly one current-mark fragment');
    splitSearch.clear();
    assert(splitLayer.textContent === conjunct, 'clearing a cross-item highlight preserves the exact conjunct');
    splitLayer.remove();
  }

  // NFC/NFD comparison also has to map two canonically equivalent source forms
  // back to independent DOM ranges without swallowing adjacent characters.
  {
    const { text: initialText } = await renderTextLayer(mainDoc, 16);
    let currentPage = 16;
    const stressSearch = new SearchController({
      getDoc: () => mainDoc,
      getCurrentPage: () => currentPage,
      goToPage: async (pageNumber) => { currentPage = pageNumber; },
      getTextLayerEl: () => textLayer,
      onStatus: () => {},
      onCount: () => {},
    });
    await stressSearch.setQuery('क़िला');
    const marks = [...textLayer.querySelectorAll('mark.search-highlight')];
    assert(stressSearch.pageMatches?.[16]?.count === 2, 'combining-mark stress page indexes both canonical spellings');
    assert(marks.length === 2 && marks.every((mark) => normalizeStr(mark.textContent) === normalizeStr('क़िला')), 'NFC and NFD spellings both highlight their original source range');
    stressSearch.clear();
    assert(textLayer.textContent === initialText, 'clearing NFC/NFD highlights restores original combining marks');
  }
}

// ---------------------------------------------------------------------------
section('D. Embedded-outline + embedded-font rendering and Tamil missing-font fallback');
if (mainDoc) {
  for (const language of LANGUAGES) {
    try {
      const ink = await renderPageInk(mainDoc, language.page);
      assert(ink > 1_000, `${language.name}: embedded shaped outlines render visible ink`, `got ${ink} dark pixels`);
    } catch (error) {
      fail(`${language.name}: embedded shaped outlines render visible ink`, error.message);
    }
  }

  try {
    const ink = await renderPageInk(mainDoc, 16);
    assert(ink > 1_000, 'combining-mark/conjunct stress page renders visible vector outlines', `got ${ink} dark pixels`);
  } catch (error) {
    fail('combining-mark/conjunct stress page renders visible vector outlines', error.message);
  }
}

if (hasEmbeddedFontPdf) {
  const embeddedBytes = readFileSync(EMBEDDED_FONT_PDF);
  assert(embeddedBytes.toString('latin1').includes('/FontFile2'), 'embedded-font fixture contains an embedded TrueType font program');
  embeddedFontDoc = await openPdf(embeddedBytes, { disableFontFace: false, useSystemFonts: true });
  assert(embeddedFontDoc.numPages === 1, 'embedded-font fixture opens as one page');
  const embeddedContent = await getTextContent(embeddedFontDoc, 1);
  const tamilFontSample = 'தமிழ் மொழியில் வாசிப்பு, தேடல், தேர்வு மற்றும் அச்சிடுதல் சோதனை।';
  assert(contentText(embeddedContent).includes(tamilFontSample), 'embedded-font fixture exposes its full Tamil sample through ToUnicode');
  assert(countTextContentMatches(embeddedContent.items, 'சோதனை') === 1, 'embedded-font Tamil text remains searchable');
  try {
    const ink = await renderPageInk(embeddedFontDoc, 1);
    assert(ink > 1_000, 'PDF.js paints visible text from the embedded Noto Tamil font', `got ${ink} dark pixels`);
  } catch (error) {
    fail('PDF.js paints visible text from the embedded Noto Tamil font', error.message);
  }
}

if (hasMissingFontPdf) {
  const missingFontBytes = readFileSync(MISSING_FONT_PDF);
  const missingFontSource = missingFontBytes.toString('latin1');
  const tamilDescriptorStart = missingFontSource.indexOf('/FontName /CambuzTamil');
  const tamilDescriptorEnd = missingFontSource.indexOf('endobj', tamilDescriptorStart);
  const tamilDescriptor = tamilDescriptorStart >= 0 && tamilDescriptorEnd > tamilDescriptorStart
    ? missingFontSource.slice(tamilDescriptorStart, tamilDescriptorEnd)
    : '';
  assert(
    Boolean(tamilDescriptor) && !/\/FontFile[23]\s+\d+\s+\d+\s+R/u.test(tamilDescriptor),
    'missing-font fixture has a Tamil descriptor without an embedded font stream'
  );
  missingFontDoc = await openPdf(missingFontBytes, {
    disableFontFace: false,
    useSystemFonts: true,
  });
  assert(missingFontDoc.numPages === 1, 'missing-font fixture opens as one page');
  const content = await getTextContent(missingFontDoc, 1);
  const text = contentText(content);
  assert(text.includes(LANGUAGES[6].sample), 'missing-font Tamil text remains selectable/extractable through ToUnicode');
  assert(countTextContentMatches(content.items, LANGUAGES[6].query) === 2, 'missing-font Tamil query remains searchable twice');
  assert(Object.values(content.styles).some((style) => style.fontFamily === 'sans-serif'), 'PDF.js exposes a generic fallback family for the missing embedded font');
  try {
    const ink = await renderPageInk(missingFontDoc, 1);
    assert(ink > 0, 'missing-font page fallback render completes with nonzero visible ink', `got ${ink} dark pixels`);
  } catch (error) {
    fail('missing-font page fallback render completes without a canvas crash', error.message);
  }
}

// ---------------------------------------------------------------------------
section('E. Print-PDF assembly preserves searchable multilingual pages');
if (hasMainPdf && mainDoc) {
  try {
    const bytes = new Uint8Array(readFileSync(MAIN_PDF));
    const printJob = await buildPrintPdf({
      sourceBytes: bytes,
      settings: { ...PRINT_DEFAULTS, pageMode: 'all', pagesPerSheet: 1, inkSaver: false },
      currentPage: 1,
      pageCount: mainDoc.numPages,
    });
    assert(printJob.pageCount === 16, 'print preparation preserves all 16 selected pages', `got ${printJob.pageCount}`);

    const printedDoc = await openPdf(printJob.bytes, { disableFontFace: true, useSystemFonts: true });
    assert(printedDoc.numPages === 16, 'generated print-ready PDF opens in PDF.js with 16 sheets');
    for (const language of LANGUAGES) {
      const content = await getTextContent(printedDoc, language.page);
      assert(contentText(content).includes(language.sample), `${language.name}: print PDF retains logical text for copy/search`);
      assert(countTextContentMatches(content.items, language.query) === 2, `${language.name}: print PDF remains searchable`);
    }
    for (const pageNumber of [2, 8, 14]) {
      const ink = await renderPageInk(printedDoc, pageNumber);
      assert(ink > 1_000, `print PDF page ${pageNumber} retains visible vector content`, `got ${ink} dark pixels`);
    }
  } catch (error) {
    fail('print-PDF assembly preserves searchable multilingual pages', error.stack || error.message);
  }
}

// ---------------------------------------------------------------------------
for (const doc of openDocuments.reverse()) {
  try {
    await doc.destroy();
  } catch {
    // Best-effort PDF.js teardown; the test assertions are already complete.
  }
}
dom?.window.close();

globalThis.DOMMatrix = undefined;
globalThis.ImageData = undefined;
globalThis.Path2D = undefined;

console.log(`\n==============================`);
console.log(`Phase 6 tests: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log(`Failures: ${failures.join('; ')}`);
  process.exitCode = 1;
}
