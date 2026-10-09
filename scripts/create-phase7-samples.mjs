#!/usr/bin/env node
// Create a raster-only OCR quality fixture from the verified Phase 6 language
// pages. No searchable text is copied into the output; the scan is just a PNG
// image placed on each PDF page.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import { renderPdfPageToPng } from '../src/pdf-ocr.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SOURCE_PATH = path.join(ROOT, 'samples', 'phase6-indian-languages.pdf');
const OUTPUT_PATH = path.join(ROOT, 'samples', 'phase7-scanned.pdf');
const PNG_FIXTURE_DIR = path.join(ROOT, 'scripts', 'fixtures');
const STANDARD_FONT_DATA_URL = pathToFileURL(
  path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep
).href;

// NAPI's canvas supplies the same canvas API PDF.js needs in this generator.
globalThis.DOMMatrix = DOMMatrix;
globalThis.ImageData = ImageData;
globalThis.Path2D = Path2D;

const sourceBytes = new Uint8Array(await readFile(SOURCE_PATH));
const source = await pdfjsLib.getDocument({
  data: sourceBytes,
  standardFontDataUrl: STANDARD_FONT_DATA_URL,
}).promise;

const examples = [
  { page: 2, language: 'English', code: 'eng' },
  { page: 3, language: 'Hindi', code: 'hin' },
  { page: 4, language: 'Punjabi', code: 'pan' },
  { page: 14, language: 'Urdu', code: 'urd' },
];
await mkdir(PNG_FIXTURE_DIR, { recursive: true });
const output = await PDFDocument.create();
output.setTitle('Cambuz Phase 7 scanned OCR test');
output.setSubject('Raster-only English, Hindi, Punjabi and Urdu OCR fixture');
output.setProducer('Cambuz PDF Reader test fixture generator');

for (const example of examples) {
  const sourcePage = await source.getPage(example.page);
  const raster = await renderPdfPageToPng(sourcePage, {
    canvasFactory: (width, height) => createCanvas(width, height),
  });
  const image = await output.embedPng(raster.bytes);
  await writeFile(path.join(PNG_FIXTURE_DIR, `phase7-ocr-${example.code}.png`), raster.bytes);
  const view = sourcePage.view;
  const pageWidth = view[2] - view[0];
  const pageHeight = view[3] - view[1];
  const page = output.addPage([pageWidth, pageHeight]);
  page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
  console.log(
    `Added ${example.language} source page ${example.page} as ${raster.width} × ${raster.height} raster pixels.`
  );
}

await writeFile(OUTPUT_PATH, await output.save());
await source.destroy();
console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)} (${examples.length} image-only pages) and matching raster PNG test fixtures.`);
