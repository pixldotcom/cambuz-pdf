// Cambuz PDF Reader — Phase 4 basic PDF utilities.
//
// Pure, DOM-free document operations built on pdf-lib. Every function takes the
// bytes of a PDF and returns NEW bytes (or several new documents for split);
// the input bytes are never mutated and nothing is written to disk here. Saving
// is the job of the host (Electron IPC or a browser download), which keeps the
// original file untouched unless the user explicitly chooses to overwrite it.
//
// Page numbers are one-based at this API boundary, matching the print module.

import { parsePageRanges } from './printing.js';

export const MAX_PAGE_OPS_BYTES = 250 * 1024 * 1024;
export const MAX_METADATA_LENGTH = 2000;

async function pdfLib() {
  return import('pdf-lib');
}

function toUint8Array(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new Error('The PDF data is not available.');
}

/**
 * Parse PDF bytes for editing. Encrypted/password-protected files are refused
 * (password support belongs to Phase 5), so they are never silently altered.
 */
export async function loadEditablePdf(input) {
  const { PDFDocument } = await pdfLib();
  const bytes = toUint8Array(input);
  if (bytes.byteLength > MAX_PAGE_OPS_BYTES) {
    throw new Error('This PDF is larger than the 250 MiB limit for page operations.');
  }
  try {
    // updateMetadata:false keeps Producer/ModDate exactly as the source file had them.
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    const message = String(error?.message || '');
    if (error?.name === 'EncryptedPDFError' || /encrypted/i.test(message)) {
      throw new Error(
        'This PDF is password-protected or encrypted. It cannot be edited yet; password support arrives in Phase 5.'
      );
    }
    throw new Error(`This file is not a readable PDF: ${message || 'unknown error'}`);
  }
}

async function saveBytes(doc) {
  const bytes = await doc.save();
  if (bytes.byteLength > MAX_PAGE_OPS_BYTES) {
    throw new Error('The resulting PDF would exceed the 250 MiB limit.');
  }
  return bytes;
}

/** Validate a list of one-based page numbers against the page count. */
export function assertPageNumbers(pageNumbers, pageCount, { allowAll = true } = {}) {
  if (!Array.isArray(pageNumbers) || pageNumbers.length === 0) {
    throw new Error('Select at least one page first.');
  }
  const seen = new Set();
  for (const page of pageNumbers) {
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      throw new Error(`Page ${page} is outside this document (1–${pageCount}).`);
    }
    if (seen.has(page)) throw new Error(`Page ${page} is listed more than once.`);
    seen.add(page);
  }
  if (!allowAll && seen.size === pageCount) {
    throw new Error('A PDF must keep at least one page.');
  }
  return pageNumbers;
}

/** Rotate the given pages by +90 or -90 degrees (added to any existing /Rotate). */
export async function rotatePages(input, pageNumbers, quarterTurns) {
  const { degrees } = await pdfLib();
  if (quarterTurns !== 90 && quarterTurns !== -90) {
    throw new Error('Pages can only be rotated by 90 degrees at a time.');
  }
  const doc = await loadEditablePdf(input);
  const pages = doc.getPages();
  assertPageNumbers(pageNumbers, pages.length);
  for (const pageNumber of pageNumbers) {
    const page = pages[pageNumber - 1];
    const current = page.getRotation().angle;
    const next = (((current + quarterTurns) % 360) + 360) % 360;
    page.setRotation(degrees(next));
  }
  return saveBytes(doc);
}

/**
 * Re-establish the page tree so that exactly `orderedPageNumbers` remain, in
 * that order. Works on the same document, so catalog-level data (outline,
 * names, AcroForm) survives; pages not listed are removed from the tree.
 */
async function setPageSequence(doc, orderedPageNumbers) {
  const pages = doc.getPages();
  const kept = orderedPageNumbers.map((pageNumber) => pages[pageNumber - 1]);
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    doc.removePage(index);
  }
  kept.forEach((page, index) => doc.insertPage(index, page));
}

/** Delete the given pages. Refuses to delete every page. */
export async function deletePages(input, pageNumbers) {
  const doc = await loadEditablePdf(input);
  const pageCount = doc.getPageCount();
  assertPageNumbers(pageNumbers, pageCount, { allowAll: false });
  const remove = new Set(pageNumbers);
  const keep = [];
  for (let page = 1; page <= pageCount; page += 1) {
    if (!remove.has(page)) keep.push(page);
  }
  await setPageSequence(doc, keep);
  return saveBytes(doc);
}

/** Keep only the given pages, in the order supplied. */
export async function extractPages(input, pageNumbers) {
  const doc = await loadEditablePdf(input);
  assertPageNumbers(pageNumbers, doc.getPageCount());
  await setPageSequence(doc, pageNumbers);
  return saveBytes(doc);
}

/** Reorder all pages. `newOrder` must be a permutation of 1..pageCount. */
export async function reorderPages(input, newOrder) {
  const doc = await loadEditablePdf(input);
  const pageCount = doc.getPageCount();
  if (!Array.isArray(newOrder) || newOrder.length !== pageCount) {
    throw new Error('The new page order must list every page exactly once.');
  }
  assertPageNumbers(newOrder, pageCount);
  await setPageSequence(doc, newOrder);
  return saveBytes(doc);
}

/**
 * Compute a one-step move of the selected positions (0-based) through the
 * current order. Returns the new permutation of old indices and the new
 * selected positions. Blocks already at the edge do not move.
 */
export function computeMove(pageCount, selectedPositions, direction) {
  if (direction !== 'up' && direction !== 'down') throw new Error('Unknown move direction.');
  // `order` holds the original (0-based) index of the page now at each position.
  const order = Array.from({ length: pageCount }, (_, index) => index);
  const selected = new Set(selectedPositions.filter((p) => Number.isInteger(p) && p >= 0 && p < pageCount));
  if (direction === 'up') {
    for (let position = 1; position < pageCount; position += 1) {
      if (selected.has(order[position]) && !selected.has(order[position - 1])) {
        [order[position - 1], order[position]] = [order[position], order[position - 1]];
      }
    }
  } else {
    for (let position = pageCount - 2; position >= 0; position -= 1) {
      if (selected.has(order[position]) && !selected.has(order[position + 1])) {
        [order[position], order[position + 1]] = [order[position + 1], order[position]];
      }
    }
  }
  const newSelected = [];
  order.forEach((original, position) => {
    if (selected.has(original)) newSelected.push(position);
  });
  return { order: order.map((original) => original + 1), selected: newSelected };
}

/** Append every page of `additional` (array of PDF byte arrays) to `input`. */
export async function appendPdfs(input, additional) {
  const doc = await loadEditablePdf(input);
  for (let index = 0; index < additional.length; index += 1) {
    let source;
    try {
      source = await loadEditablePdf(additional[index]);
    } catch (error) {
      throw new Error(`Could not merge file ${index + 1}: ${error.message}`);
    }
    const copied = await doc.copyPages(source, source.getPageIndices());
    copied.forEach((page) => doc.addPage(page));
  }
  return saveBytes(doc);
}

/**
 * Split into new documents. `groups` is an array of page-number arrays; each
 * group becomes one PDF with its pages in the given order.
 */
export async function splitPdf(input, groups) {
  const source = await loadEditablePdf(input);
  const pageCount = source.getPageCount();
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error('Define at least one part to split into.');
  }
  const { PDFDocument } = await pdfLib();
  const parts = [];
  for (const group of groups) {
    assertPageNumbers(group, pageCount);
    const output = await PDFDocument.create();
    const copied = await output.copyPages(source, group.map((page) => page - 1));
    copied.forEach((page) => output.addPage(page));
    parts.push({ bytes: await saveBytes(output), pageCount: group.length, pages: group });
  }
  return parts;
}

/**
 * Parse a split specification. Either "every N" (N-page chunks) or parts
 * separated by semicolons, each part a page list such as "1-3, 5".
 */
export function parseSplitPlan(text, pageCount) {
  const value = String(text ?? '').trim();
  if (!value) throw new Error('Enter how to split, for example "1-3; 4-6" or "every 2".');
  const every = /^every\s+(\d+)$/i.exec(value);
  if (every) {
    const size = Number(every[1]);
    if (!Number.isSafeInteger(size) || size < 1) throw new Error('"every" needs a page count of 1 or more.');
    if (size >= pageCount && pageCount > 0) {
      return [Array.from({ length: pageCount }, (_, index) => index + 1)];
    }
    const groups = [];
    for (let start = 1; start <= pageCount; start += size) {
      const group = [];
      for (let page = start; page < Math.min(start + size, pageCount + 1); page += 1) group.push(page);
      groups.push(group);
    }
    return groups;
  }
  const parts = value.split(';').map((part) => part.trim());
  if (parts.some((part) => part === '')) {
    throw new Error('Remove the extra ";" — each part needs at least one page.');
  }
  return parts.map((part) => parsePageRanges(part, pageCount));
}

function cleanText(value) {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim();
}

/** Read basic document information (Info dictionary + page count). */
export async function readMetadata(input) {
  const doc = await loadEditablePdf(input);
  return {
    title: doc.getTitle() ?? '',
    author: doc.getAuthor() ?? '',
    subject: doc.getSubject() ?? '',
    keywords: doc.getKeywords() ?? '',
    creator: doc.getCreator() ?? '',
    producer: doc.getProducer() ?? '',
    pageCount: doc.getPageCount(),
  };
}

/**
 * Update the editable Info fields (title, author, subject, keywords). Omitted
 * fields keep their current value. Creator/Producer and XMP are not touched.
 */
export async function writeMetadata(input, fields) {
  const doc = await loadEditablePdf(input);
  const names = ['title', 'author', 'subject', 'keywords'];
  for (const name of names) {
    if (!(name in fields)) continue;
    const value = cleanText(fields[name]);
    if (value.length > MAX_METADATA_LENGTH) {
      throw new Error(`${name[0].toUpperCase()}${name.slice(1)} must be ${MAX_METADATA_LENGTH} characters or fewer.`);
    }
    if (name === 'title') doc.setTitle(value);
    if (name === 'author') doc.setAuthor(value);
    if (name === 'subject') doc.setSubject(value);
    if (name === 'keywords') doc.setKeywords([value]);
  }
  return saveBytes(doc);
}
