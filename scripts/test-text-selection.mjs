#!/usr/bin/env node
// Cambuz PDF Reader — text-selection status tests (pure function).
//
// A page that can be selected keeps the plain "Page N of M" message. When copying
// is denied by the document, or the page has no text layer, the status bar says so.

import { pageStatusMessage } from '../src/text-selection.js';

let passed = 0;
let failed = 0;
const failures = [];
function assert(condition, name, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\n## Page status');
assert(
  pageStatusMessage({ pageNumber: 2, totalPages: 5, hasText: true, copyBlocked: false }) === 'Page 2 of 5',
  'a selectable page keeps the plain status (the smoke test relies on it)',
);
const copyBlocked = pageStatusMessage({ pageNumber: 1, totalPages: 2, hasText: true, copyBlocked: true });
assert(copyBlocked === 'Page 1 of 2 • copying not allowed by this document', 'a copy-denied document says so on every page', copyBlocked);
const scanned = pageStatusMessage({ pageNumber: 3, totalPages: 4, hasText: false, copyBlocked: false });
assert(scanned === 'Page 3 of 4 • no selectable text on this page (scanned image?)', 'a page without text says it may be a scanned image', scanned);
const both = pageStatusMessage({ pageNumber: 1, totalPages: 1, hasText: false, copyBlocked: true });
assert(
  both === 'Page 1 of 1 • copying not allowed by this document • no selectable text on this page (scanned image?)',
  'both reasons are shown, in order',
  both,
);

console.log('\n==============================');
console.log(`Text selection status tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
