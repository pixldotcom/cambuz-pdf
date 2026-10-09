#!/usr/bin/env node
// Cambuz PDF Reader — bundled sample allow-list tests.
//
// The welcome-screen sample buttons read their PDFs through the main process.
// Only the names on the bundled-sample list may be read, so these tests pin the
// list, the path resolution and the rejection of anything else.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLED_SAMPLES, bundledSamplePath } from '../src/bundled-samples.cjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDirectory = path.join(repoRoot, 'some', 'app');

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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\n## The bundled list');
assert(same([...BUNDLED_SAMPLES], ['cambuz-demo.pdf', 'form-sample.pdf']), 'the list is the two welcome-screen samples', JSON.stringify(BUNDLED_SAMPLES));
assert(Object.isFrozen(BUNDLED_SAMPLES), 'the list cannot be changed at run time');
for (const name of BUNDLED_SAMPLES) {
  const file = path.join(repoRoot, 'samples', name);
  assert(existsSync(file), `${name} exists in samples/`);
  if (existsSync(file)) {
    const head = readFileSync(file).subarray(0, 5).toString('latin1');
    assert(head === '%PDF-', `${name} is a PDF`, JSON.stringify(head));
  }
}

console.log('\n## Resolving a listed name');
for (const name of BUNDLED_SAMPLES) {
  const resolved = bundledSamplePath(appDirectory, name);
  assert(resolved === path.join(appDirectory, 'samples', name), `${name} resolves inside samples/ of the app`, resolved);
}

console.log('\n## Rejecting everything else');
const rejected = [
  ['undefined', undefined],
  ['null', null],
  ['a number', 1],
  ['an empty string', ''],
  ['an unlisted sample in samples/', 'phase6-indian-languages.pdf'],
  ['a different case', 'Cambuz-demo.pdf'],
  ['a parent-directory name', '../package.json'],
  ['a nested relative path', 'x/../cambuz-demo.pdf'],
  ['an absolute path', path.join(repoRoot, 'samples', 'cambuz-demo.pdf')],
  ['a Windows-style path', '..\\package.json'],
  ['a name with a trailing space', 'cambuz-demo.pdf '],
];
for (const [label, value] of rejected) {
  assert(bundledSamplePath(appDirectory, value) === null, `rejects ${label}`);
}

console.log('\n==============================');
console.log(`Sample list tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
