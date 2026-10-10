#!/usr/bin/env node
// Cambuz PDF Reader — Phase 8 repeatable PDF.js performance probe.
//
// This is a Node/PDF.js + @napi-rs/canvas harness, not an Electron or Chromium
// benchmark. It isolates PDF open/render/search/print work while reporting the
// harness RSS/CPU as a proxy. It deliberately has no pass/fail timing thresholds.
// Synthetic stress PDFs are written to the OS temp directory and removed.
//
// Usage: npm run benchmark:phase8
//        PHASE8_BENCH_TRIALS=1 npm run benchmark:phase8  # quick smoke run

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TRIALS = Math.max(1, Number(process.env.PHASE8_BENCH_TRIALS || 3));
const IS_WORKER = process.argv[2] === '--worker';

function mib(bytes) {
  return Number((bytes / 1048576).toFixed(2));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function createSyntheticPdf({ pages, linesPerPage, charsPerLine, title }) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setProducer('Cambuz Phase 8 benchmark fixture generator');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let seed = 0x8f31a27d;
  const nextLetter = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return String.fromCharCode(65 + (seed >>> 0) % 26);
  };
  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`CAMBUZ PERFORMANCE TEST PAGE ${pageIndex + 1}`, {
      x: 36,
      y: 760,
      font,
      size: 9,
    });
    const lineCount = Math.max(linesPerPage, 1);
    const lineLength = Math.max(charsPerLine, 24);
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
      let suffix = '';
      while (suffix.length < lineLength) suffix += nextLetter();
      const line = `CAMBUZ PERFORMANCE READER ${pageIndex + 1}-${lineIndex + 1} ${suffix.slice(0, lineLength - 32)}`;
      page.drawText(line, {
        x: 36,
        y: 744 - lineIndex * 12,
        font,
        size: 7,
      });
    }
  }
  return await pdf.save({ useObjectStreams: true });
}

async function makeFixtures(tempDir) {
  const simpleBytes = await createSyntheticPdf({
    pages: 100,
    linesPerPage: 1,
    charsPerLine: 60,
    title: 'Cambuz Phase 8 100-page benchmark',
  });
  const largeTextBytes = await createSyntheticPdf({
    pages: 100,
    linesPerPage: 55,
    charsPerLine: 100,
    title: 'Cambuz Phase 8 large text-heavy benchmark',
  });
  const hundredPath = path.join(tempDir, 'phase8-100-page.pdf');
  const largeTextPath = path.join(tempDir, 'phase8-large-text.pdf');
  writeFileSync(hundredPath, simpleBytes);
  writeFileSync(largeTextPath, largeTextBytes);
  return { hundredPath, largeTextPath };
}

async function runWorker(pdfPath, name, query, alsoPrint, render = true) {
  const start = performance.now();
  const child = spawnSync(
    process.execPath,
    ['--expose-gc', fileURLToPath(import.meta.url), '--worker', pdfPath, name, query, String(alsoPrint), String(render)],
    {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 300_000,
    }
  );
  const wallMs = performance.now() - start;
  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw new Error(`${name} benchmark worker failed (exit ${child.status}):\n${child.stderr}\n${child.stdout}`);
  }
  const jsonLine = child.stdout.trim().split(/\r?\n/).at(-1);
  return { ...JSON.parse(jsonLine), freshProcessMs: wallMs };
}

function combineTrials(results) {
  const fields = [
    'inputMiB',
    'pages',
    'idleRssMiB',
    'rssAfterOpenMiB',
    'rssAfterRenderMiB',
    'rssAfterSearchMiB',
    'rssBeforeCloseMiB',
    'rssAfterCloseMiB',
    'openMs',
    'firstPageRenderMs',
    'allPageThumbnailRenderMs',
    'searchFirstMs',
    'searchSecondMs',
    'searchCallsFirst',
    'searchCallsSecond',
    'searchMatchesFirst',
    'printPreparationMs',
    'cpuOpenMs',
    'cpuThumbnailRenderMs',
    'cpuSearchFirstMs',
    'cpuSearchSecondMs',
    'cpuPrintMs',
    'cpuCloseMs',
  ];
  const result = { name: results[0].name, trials: results.length };
  for (const field of fields) {
    const values = results.map((entry) => entry[field]).filter((value) => value !== null && value !== undefined);
    result[field] = values.length ? Number(median(values).toFixed(2)) : null;
  }
  return result;
}

function fmt(value, suffix = '') {
  return value === null || value === undefined ? 'n/a' : `${Number(value).toFixed(2)}${suffix}`;
}

async function runParent() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'cambuz-phase8-bench-'));
  try {
    const synthetic = await makeFixtures(tempDir);
    const cases = [
      { path: path.join(ROOT, 'samples', 'phase6-embedded-font.pdf'), name: 'one-page', query: 'Cambuz', print: false },
      { path: path.join(ROOT, 'samples', 'cambuz-demo.pdf'), name: 'ten-page', query: 'Cambuz', print: true },
      { path: synthetic.hundredPath, name: 'hundred-page', query: 'CAMBUZ', print: true },
      { path: synthetic.largeTextPath, name: 'large-text-heavy', query: 'PERFORMANCE', print: false },
      { path: path.join(ROOT, 'samples', 'phase7-scanned.pdf'), name: 'image-heavy-scanned', query: 'Cambuz', print: false, render: false },
      { path: path.join(ROOT, 'samples', 'hindi-sample.pdf'), name: 'hindi', query: 'पंजाब', print: false },
      { path: path.join(ROOT, 'samples', 'punjabi-sample.pdf'), name: 'punjabi', query: 'ਪੰਜਾਬ', print: false },
      { path: path.join(ROOT, 'samples', 'phase6-indian-languages.pdf'), name: 'mixed-language', query: 'Punjab', print: false },
    ];

    const output = [];
    for (const benchmark of cases) {
      const trials = [];
      for (let run = 0; run < TRIALS; run += 1) {
        trials.push(await runWorker(benchmark.path, benchmark.name, benchmark.query, benchmark.print, benchmark.render !== false));
      }
      output.push(combineTrials(trials));
    }

    const cpus = os.cpus();
    console.log('Cambuz Phase 8 PDF.js performance probe');
    console.log(`Environment: ${os.type()} ${os.release()} ${os.arch()}, Node ${process.version}`);
    console.log(`CPU: ${cpus[0]?.model || 'unknown'} (${cpus.length} logical CPUs); total RAM: ${mib(os.totalmem())} MiB`);
    console.log(`Trials: ${TRIALS}; reported values are per-worker medians; synthetic PDFs are temporary.`);
    console.log('Note: PDF.js + Node canvas results are not native Electron/Chromium timings or app memory.');
    console.log('');
    console.log('| Fixture | Pages | PDF MiB | Open ms | First-page render ms | All-page thumbnail renders ms | First search ms | Repeat search ms | RSS after search MiB | RSS after close MiB | Print prep ms |');
    console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const row of output) {
      console.log(
        `| ${row.name} | ${row.pages} | ${fmt(row.inputMiB)} | ${fmt(row.openMs)} | ${fmt(row.firstPageRenderMs)} | ${fmt(row.allPageThumbnailRenderMs)} | ${fmt(row.searchFirstMs)} | ${fmt(row.searchSecondMs)} | ${fmt(row.rssAfterSearchMiB)} | ${fmt(row.rssAfterCloseMiB)} | ${fmt(row.printPreparationMs)} |`
      );
    }
    console.log('');
    console.log('RSS snapshots (MiB; idle is after GC before opening the PDF):');
    console.log('| Fixture | Idle | After open | After first render | After search | Before close | After destroy + GC |');
    console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const row of output) {
      console.log(`| ${row.name} | ${fmt(row.idleRssMiB)} | ${fmt(row.rssAfterOpenMiB)} | ${fmt(row.rssAfterRenderMiB)} | ${fmt(row.rssAfterSearchMiB)} | ${fmt(row.rssBeforeCloseMiB)} | ${fmt(row.rssAfterCloseMiB)} |`);
    }
    console.log('');
    console.log('Operation CPU time (ms; idle CPU was not sampled):');
    console.log('| Fixture | Open | Thumbnail pass | Search first | Search repeat | Print prep | Close |');
    console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const row of output) {
      console.log(`| ${row.name} | ${fmt(row.cpuOpenMs)} | ${fmt(row.cpuThumbnailRenderMs)} | ${fmt(row.cpuSearchFirstMs)} | ${fmt(row.cpuSearchSecondMs)} | ${fmt(row.cpuPrintMs)} | ${fmt(row.cpuCloseMs)} |`);
    }
    console.log('');
    console.log(JSON.stringify({ environment: { os: `${os.type()} ${os.release()}`, arch: os.arch(), node: process.version, cpu: cpus[0]?.model, logicalCpus: cpus.length }, trials: TRIALS, results: output }, null, 2));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runBenchmarkWorker() {
  const [, , , pdfPath, name, query, printFlag, renderFlag] = process.argv;
  const { createCanvas, DOMMatrix, ImageData, Path2D } = await import('@napi-rs/canvas');
  const { JSDOM } = await import('jsdom');
  const pdfjsLib = await import('../node_modules/pdfjs-dist/legacy/build/pdf.mjs');
  const { SearchController } = await import('../src/search.js');
  const { buildPrintPdf, PRINT_DEFAULTS } = await import('../src/printing.js');
  globalThis.DOMMatrix = DOMMatrix;
  globalThis.ImageData = ImageData;
  globalThis.Path2D = Path2D;
  const standardFontDataUrl = new URL(
    `file://${path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts')}${path.sep}`
  ).href;
  let bytes = new Uint8Array(readFileSync(pdfPath));
  const inputMiB = mib(bytes.byteLength);
  const memory = () => process.memoryUsage();
  const cpu = () => process.cpuUsage();
  const cpuMs = (start) => {
    const delta = process.cpuUsage(start);
    return Number(((delta.user + delta.system) / 1000).toFixed(2));
  };
  global.gc?.();
  const idleRssMiB = mib(memory().rss);
  let peakRss = memory().rss;
  const observeMemory = () => {
    peakRss = Math.max(peakRss, memory().rss);
  };

  const openCpu = cpu();
  const openStart = performance.now();
  let doc = await pdfjsLib.getDocument({
    data: bytes.slice(),
    standardFontDataUrl,
  }).promise;
  const openMs = performance.now() - openStart;
  const cpuOpenMs = cpuMs(openCpu);
  observeMemory();
  const rssAfterOpenMiB = mib(memory().rss);

  let firstPageRenderMs = null;
  let allPageThumbnailRenderMs = null;
  let cpuThumbnailRenderMs = null;
  let rssAfterRenderMiB = null;
  if (renderFlag === 'true') {
    const firstPage = await doc.getPage(1);
    const unitViewport = firstPage.getViewport({ scale: 1 });
    const renderScale = Math.min(1, 1100 / unitViewport.width, 1500 / unitViewport.height);
    const firstViewport = firstPage.getViewport({ scale: renderScale });
    const firstCanvas = createCanvas(Math.ceil(firstViewport.width), Math.ceil(firstViewport.height));
    const firstContext = firstCanvas.getContext('2d');
    firstContext.fillStyle = '#fff';
    firstContext.fillRect(0, 0, firstCanvas.width, firstCanvas.height);
    const firstRenderStart = performance.now();
    await firstPage.render({ canvasContext: firstContext, viewport: firstViewport }).promise;
    firstPageRenderMs = performance.now() - firstRenderStart;
    firstCanvas.width = 0;
    firstCanvas.height = 0;
    firstPage.cleanup();
    observeMemory();
    rssAfterRenderMiB = mib(memory().rss);

    // Simulate browsing through every page by painting a low-resolution thumbnail
    // one at a time. This is a backend/PDF.js probe; it does not include DOM/scroll.
    const thumbCpu = cpu();
    const thumbStart = performance.now();
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(148 / base.width, 2000 / base.height) });
      const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
      const context = canvas.getContext('2d');
      await page.render({ canvasContext: context, viewport }).promise;
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
      observeMemory();
    }
    allPageThumbnailRenderMs = performance.now() - thumbStart;
    cpuThumbnailRenderMs = cpuMs(thumbCpu);
  }

  const dom = new JSDOM('<!doctype html><div id="text-layer"></div>', { url: 'http://localhost/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  let currentPage = 1;
  let textContentCalls = 0;
  let observedDoc = {
    numPages: doc.numPages,
    getPage: async (pageNumber) => {
      const page = await doc.getPage(pageNumber);
      return {
        getTextContent: async () => {
          textContentCalls += 1;
          return page.getTextContent();
        },
        cleanup: () => page.cleanup(),
      };
    },
  };
  let matchTotal = 0;
  let controller = new SearchController({
    getDoc: () => observedDoc,
    getCurrentPage: () => currentPage,
    goToPage: async (pageNumber) => { currentPage = pageNumber; },
    getTextLayerEl: () => document.getElementById('text-layer'),
    onStatus: () => {},
    onCount: () => {},
  });
  const searchCpuFirst = cpu();
  const searchStart = performance.now();
  await controller.setQuery(query);
  const searchFirstMs = performance.now() - searchStart;
  const cpuSearchFirstMs = cpuMs(searchCpuFirst);
  const searchCallsFirst = textContentCalls;
  matchTotal = controller.total;
  observeMemory();

  const searchCpuSecond = cpu();
  const searchSecondStart = performance.now();
  const secondQuery = query.toLowerCase() === 'performance' ? 'CAMBUZ' : 'performance';
  await controller.setQuery(secondQuery);
  const searchSecondMs = performance.now() - searchSecondStart;
  const cpuSearchSecondMs = cpuMs(searchCpuSecond);
  const searchCallsSecond = textContentCalls - searchCallsFirst;
  observeMemory();
  const rssAfterSearchMiB = mib(memory().rss);

  let printPreparationMs = null;
  let cpuPrintMs = null;
  if (printFlag === 'true') {
    const printCpu = cpu();
    const printStart = performance.now();
    await buildPrintPdf({
      sourceBytes: bytes,
      settings: { ...PRINT_DEFAULTS, pageMode: 'all' },
      pageCount: doc.numPages,
    });
    printPreparationMs = performance.now() - printStart;
    cpuPrintMs = cpuMs(printCpu);
    observeMemory();
  }
  const pageCount = doc.numPages;
  global.gc?.();
  const rssBeforeCloseMiB = mib(memory().rss);
  const closeCpu = cpu();
  controller.clearDocument();
  await doc.destroy();
  const cpuCloseMs = cpuMs(closeCpu);
  doc = null;
  observedDoc = null;
  controller = null;
  bytes = null;
  dom.window.close();
  globalThis.window = undefined;
  globalThis.document = undefined;
  global.gc?.();
  await new Promise((resolve) => setImmediate(resolve));
  global.gc?.();
  const rssAfterCloseMiB = mib(memory().rss);

  console.log(JSON.stringify({
    name,
    pages: pageCount,
    inputMiB,
    idleRssMiB,
    rssAfterOpenMiB,
    rssAfterRenderMiB,
    rssAfterSearchMiB,
    rssBeforeCloseMiB,
    rssAfterCloseMiB,
    peakRssMiB: mib(peakRss),
    openMs,
    firstPageRenderMs,
    allPageThumbnailRenderMs,
    searchFirstMs,
    searchSecondMs,
    searchCallsFirst,
    searchCallsSecond,
    searchMatchesFirst: matchTotal,
    printPreparationMs,
    cpuOpenMs,
    cpuThumbnailRenderMs,
    cpuSearchFirstMs,
    cpuSearchSecondMs,
    cpuPrintMs,
    cpuCloseMs,
  }));
}

if (IS_WORKER) {
  await runBenchmarkWorker();
} else {
  await runParent();
}
