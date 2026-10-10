#!/usr/bin/env node
// Cambuz PDF Reader — page context-menu template tests (pure function).
//
// The main process pops this menu on a right-click. Copy must be enabled only
// when there is a selection to copy, and "Select All Text on Page" must run the
// same action as Ctrl+A.

import { buildPageContextMenu } from '../src/context-menu.cjs';

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

const noop = () => {};
const copyItem = (template) => template.find((item) => item.role === 'copy');
const selectAllItem = (template) => template.find((item) => item.label === 'Select All Text on Page');

console.log('\n## Copy follows the selection');
{
  const template = buildPageContextMenu(
    { selectionText: 'Cambuz PDF Reader', editFlags: { canCopy: true } },
    { onSelectAll: noop },
  );
  assert(copyItem(template)?.enabled === true, 'Copy is enabled when text is selected');
  assert(copyItem(template)?.label === 'Copy', 'the copy item is labelled Copy');
}
{
  const template = buildPageContextMenu({ selectionText: '', editFlags: { canCopy: false } }, { onSelectAll: noop });
  assert(copyItem(template)?.enabled === false, 'Copy is disabled with no selection');
}
{
  const template = buildPageContextMenu({ selectionText: 'text', editFlags: { canCopy: false } }, { onSelectAll: noop });
  assert(copyItem(template)?.enabled === false, 'Copy is disabled when the host reports copy is not possible');
}
{
  const template = buildPageContextMenu({ selectionText: '   ' }, { onSelectAll: noop });
  assert(copyItem(template)?.enabled === false, 'whitespace-only selection does not enable Copy');
}

console.log('\n## Text fields get the standard editing commands');
{
  const template = buildPageContextMenu(
    { isEditable: true, selectionText: 'abc', editFlags: { canCut: true, canCopy: true, canPaste: false } },
    { onSelectAll: noop },
  );
  const roles = template.filter((item) => item.role).map((item) => item.role);
  assert(JSON.stringify(roles) === JSON.stringify(['cut', 'copy', 'paste', 'selectAll']), 'a text field offers cut, copy, paste and select all', JSON.stringify(roles));
  assert(template.find((item) => item.role === 'paste').enabled === false, 'paste is disabled when the host says it is not possible');
  assert(template.every((item) => item.label !== 'Select All Text on Page'), 'a text field does not get the page select-all action');
}

console.log('\n## Shape and actions');
{
  let calls = 0;
  const template = buildPageContextMenu({ selectionText: '' }, { onSelectAll: () => { calls += 1; } });
  assert(template.length === 3, 'the menu has Copy, a separator and Select All');
  assert(template[1].type === 'separator', 'a separator sits between the two actions');
  selectAllItem(template).click();
  assert(calls === 1, '"Select All Text on Page" runs the select-all action once');
}
{
  const template = buildPageContextMenu(undefined, { onSelectAll: noop });
  assert(Array.isArray(template) && copyItem(template)?.enabled === false, 'missing event parameters do not throw and disable Copy');
}

console.log('\n==============================');
console.log(`Context menu tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
