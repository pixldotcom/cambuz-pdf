#!/usr/bin/env node
// Cambuz PDF Reader — Phase 5 security & forms tests.
//
// A. The permission model (pure functions).
// B. Real encrypted fixtures opened with PDF.js: missing password, wrong
//    password, correct password, and the permission flags each one carries.
// C. AcroForm reading and writing with pdf-lib, including the refusals that
//    keep encrypted documents untouched.
// D. The password dialog controller in jsdom.
// E. The form filling controller in jsdom, against a real PDF.js viewport.
// F. The document security dialog in jsdom.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import {
  NO_SECURITY,
  PERMISSION_BITS,
  buildSecurity,
  classifyPasswordError,
  describeSecurity,
  isAllowed,
  isBlocked,
  permissionMaskFromList,
  readDocumentSecurity,
  refusalMessage,
} from '../src/pdf-security.js';
import {
  FIELD_TYPES,
  dirtyFieldNames,
  describeForm,
  fillFormDocument,
  loadFormDocument,
  readFormFields,
} from '../src/pdf-forms.js';
import { loadEditablePdf, readMetadata } from '../src/pdf-ops.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURES = path.join(ROOT, 'scripts', 'fixtures');
const standardFontDataUrl = pathToFileURL(path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep).href;

const USER_PASSWORD = 'cambuz';
const ALL_PERMISSIONS =
  PERMISSION_BITS.PRINT |
  PERMISSION_BITS.MODIFY_CONTENTS |
  PERMISSION_BITS.COPY |
  PERMISSION_BITS.MODIFY_ANNOTATIONS |
  PERMISSION_BITS.FILL_INTERACTIVE_FORMS |
  PERMISSION_BITS.COPY_FOR_ACCESSIBILITY |
  PERMISSION_BITS.ASSEMBLE |
  PERMISSION_BITS.PRINT_HIGH_QUALITY;

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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const fixture = (name) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));

/** Open with PDF.js, optionally with a password; returns { doc, error }. */
async function openEncrypted(bytes, password = '') {
  try {
    const doc = await pdfjsLib.getDocument({
      data: bytes.slice(),
      password,
      standardFontDataUrl,
    }).promise;
    return { doc, error: null };
  } catch (error) {
    return { doc: null, error };
  }
}

async function pageText(doc, pageNumber = 1) {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items.map((item) => item.str).join(' ').replace(/\s+/g, ' ').trim();
}

console.log('Phase 5 security & forms tests\n');

// ---------------------------------------------------------------------------
section('A1. Permission model');
{
  assert(permissionMaskFromList(null) === null, 'a missing permission list means the document is not encrypted');
  assert(permissionMaskFromList(undefined) === null, 'undefined permission list is treated the same way');
  assert(permissionMaskFromList([]) === 0, 'an empty permission list means encrypted with everything denied');
  assert(
    permissionMaskFromList([4, 16, 256]) === (PERMISSION_BITS.PRINT | PERMISSION_BITS.COPY | PERMISSION_BITS.FILL_INTERACTIVE_FORMS),
    'granted flags are combined into one mask'
  );

  const none = buildSecurity(null);
  assert(none.encrypted === false, 'an unencrypted document reports encrypted=false');
  assert(none.items.every((item) => item.allowed), 'an unencrypted document allows every permission');
  assert(isAllowed(none, 'print') && !isBlocked(none, 'copy'), 'nothing is blocked for an unencrypted document');

  const locked = buildSecurity(0, { unlockedWithPassword: true });
  assert(locked.encrypted === true && locked.unlockedWithPassword === true, 'a mask of 0 is encrypted and remembers the password');
  assert(locked.items.every((item) => !item.allowed), 'a mask of 0 denies every permission');
  assert(isBlocked(locked, 'print') && isBlocked(locked, 'copy') && isBlocked(locked, 'fillForms'), 'locked blocks print, copy and form filling');

  const partial = buildSecurity(PERMISSION_BITS.COPY | PERMISSION_BITS.FILL_INTERACTIVE_FORMS);
  assert(!isBlocked(partial, 'copy') && !isBlocked(partial, 'fillForms'), 'granted permissions are not blocked');
  assert(isBlocked(partial, 'print') && isBlocked(partial, 'modifyContents'), 'missing permissions are blocked');
  assert(NO_SECURITY.items.length === locked.items.length, 'every permission is described once');

  assert(/Encrypted/.test(describeSecurity(locked)), 'the status chip says the document is encrypted');
  assert(/printing/.test(describeSecurity(buildSecurity(ALL_PERMISSIONS & ~PERMISSION_BITS.PRINT))), 'the chip names a denied permission');
  assert(describeSecurity(NO_SECURITY) === '', 'an unencrypted document gets no chip text');

  assert(
    /does not allow printing/.test(refusalMessage(buildSecurity(0), 'print')),
    'the printing refusal explains the document denies it'
  );
  assert(/does not allow copying/.test(refusalMessage(buildSecurity(0), 'copy')), 'the copying refusal explains the reason');
}

section('A2. Password errors are classified from real PDF.js exceptions');
{
  const protectedFile = fixture('secure-open-password.pdf');

  const missing = await openEncrypted(protectedFile, '');
  assert(classifyPasswordError(missing.error) === 'need', 'a missing password is reported as "need"');
  assert(missing.doc === null, 'the document stays closed without a password');

  const wrong = await openEncrypted(protectedFile, 'not-the-password');
  assert(classifyPasswordError(wrong.error) === 'incorrect', 'a wrong password is reported as "incorrect"');
  assert(wrong.doc === null, 'the document stays closed after a wrong password');

  assert(classifyPasswordError(new Error('boom')) === null, 'an unrelated error is not treated as a password problem');
  assert(classifyPasswordError(null) === null, 'a missing error object is handled');
  assert(classifyPasswordError({ name: 'PasswordException', code: 99 }) === null, 'an unknown password code is not guessed at');
}

// ---------------------------------------------------------------------------
section('B1. Opening a password-protected PDF');
{
  const file = fixture('secure-open-password.pdf');
  const { doc } = await openEncrypted(file, USER_PASSWORD);
  assert(doc !== null, 'the correct password opens the document');
  if (doc) {
    assert(doc.numPages === 2, 'the decrypted document has its 2 pages');
    assert(/SECURE PAGE 1/.test(await pageText(doc, 1)), 'page 1 text decrypts correctly');
    assert(/SECURE PAGE 2/.test(await pageText(doc, 2)), 'page 2 text decrypts correctly');

    const security = await readDocumentSecurity(doc, { unlockedWithPassword: true });
    assert(security.encrypted === true, 'the opened document reports that it is encrypted');
    assert(security.unlockedWithPassword === true, 'it remembers that a password was used');
    assert(security.mask === ALL_PERMISSIONS, 'every permission is granted in this fixture');
    assert(!isBlocked(security, 'print') && !isBlocked(security, 'copy'), 'printing and copying are allowed');
    await doc.destroy();
  }

  // The bytes on disk are untouched by reading them with a password.
  const after = await openEncrypted(file, USER_PASSWORD);
  assert(after.doc !== null, 'the fixture still needs the password on a second open');
  if (after.doc) await after.doc.destroy();
}

section('B2. Permission flags of each fixture');
{
  const cases = [
    ['secure-open-password.pdf', USER_PASSWORD, { print: true, copy: true, fillForms: true, modifyContents: true }],
    ['secure-no-print.pdf', USER_PASSWORD, { print: false, copy: true, fillForms: true, modifyContents: true }],
    ['secure-locked.pdf', USER_PASSWORD, { print: false, copy: false, fillForms: false, modifyContents: false }],
    ['secure-permissions-only.pdf', '', { print: false, copy: false, fillForms: true, modifyContents: true }],
  ];
  for (const [name, password, expected] of cases) {
    const { doc } = await openEncrypted(fixture(name), password);
    if (!doc) {
      fail(`${name}: opens with the expected password`, 'document did not open');
      continue;
    }
    const security = await readDocumentSecurity(doc);
    const label = `${name}:`;
    assert(security.encrypted === true, `${label} reported as encrypted`);
    for (const [key, allowed] of Object.entries(expected)) {
      assert(isAllowed(security, key) === allowed, `${label} ${key} is ${allowed ? 'allowed' : 'denied'}`);
    }
    if (name === 'secure-permissions-only.pdf') {
      assert(security.unlockedWithPassword === false, `${label} opens without prompting for a password`);
    }
    await doc.destroy();
  }

  // Copying is refused by the locked fixture even though the text is readable.
  const { doc } = await openEncrypted(fixture('secure-locked.pdf'), USER_PASSWORD);
  const security = await readDocumentSecurity(doc);
  assert(isBlocked(security, 'copy') && isBlocked(security, 'print'), 'the locked fixture blocks copying and printing');
  await doc.destroy();
}

section('B3. Encrypted documents are never edited');
{
  const file = fixture('secure-open-password.pdf');
  const before = file.slice();
  await rejects(() => loadEditablePdf(file), 'password-protected or encrypted', 'page operations refuse an encrypted document');
  await rejects(() => loadFormDocument(file), 'password-protected or encrypted', 'form loading refuses an encrypted document');
  await rejects(() => readFormFields(file), 'password-protected or encrypted', 'reading form fields refuses an encrypted document');
  assert(same(Array.from(file), Array.from(before)), 'refusals leave the encrypted bytes completely untouched');
}

// ---------------------------------------------------------------------------
section('C1. Reading an AcroForm');
{
  const bytes = fixture('acroform-basic.pdf');
  const form = await readFormFields(bytes);
  const byName = new Map(form.fields.map((field) => [field.name, field]));

  assert(form.pageCount === 2, 'the fixture has 2 pages');
  assert(form.fields.length === 8, 'all 8 fields are listed');
  assert(byName.get('full_name')?.type === FIELD_TYPES.TEXT, 'full_name is a text field');
  assert(byName.get('agree')?.type === FIELD_TYPES.CHECKBOX, 'agree is a check box');
  assert(byName.get('plan')?.type === FIELD_TYPES.RADIO, 'plan is a radio group');
  assert(byName.get('country')?.type === FIELD_TYPES.DROPDOWN, 'country is a drop-down');
  assert(byName.get('level')?.type === FIELD_TYPES.LIST, 'level is a list box');
  assert(byName.get('notes')?.multiline === true, 'notes is a multi-line text field');
  assert(byName.get('full_name')?.required === true, 'full_name is flagged required');
  assert(byName.get('locked_field')?.readOnly === true, 'locked_field is flagged read-only');
  assert(byName.get('locked_field')?.editable === false, 'a read-only field is not editable');
  assert(byName.get('full_name')?.editable === true, 'a normal text field is editable');
  assert(same(byName.get('plan')?.options, ['basic', 'pro']), 'the radio group lists its options');
  assert(same(byName.get('country')?.options, ['India', 'Other']), 'the drop-down lists its options');
  assert(byName.get('locked_field')?.value === 'Cannot be edited', 'the stored value of a field is read back');
  assert(byName.get('agree')?.value === false, 'an unchecked box reads as false');
  assert(byName.get('notes')?.pageIndex === 1, 'notes is on page 2');
  assert(byName.get('full_name')?.pageIndex === 0, 'full_name is on page 1');
  assert(byName.get('plan')?.widgets.length === 2, 'the radio group has one widget per option');
  assert(byName.get('plan')?.widgets.map((widget) => widget.option).join(',') === 'basic,pro', 'each radio widget carries its option');

  // pdf-lib insets the rectangle by half a point for the field border.
  const rect = byName.get('full_name').widgets[0];
  assert(
    rect.x === 149.5 && rect.y === 654.5 && rect.width === 261 && rect.height === 23,
    'widget rectangles are reported in PDF user space',
    JSON.stringify(rect)
  );

  // A PDF without a form reports an empty field list instead of failing.
  const plain = new Uint8Array(
    await (await (await import('pdf-lib')).PDFDocument.create()).save()
  );
  const empty = await readFormFields(plain);
  assert(empty.fields.length === 0, 'a document without a form has no fields');
}

section('C2. Filling a form writes a new document');
{
  const bytes = fixture('acroform-basic.pdf');
  const before = bytes.slice();
  const loaded = await loadFormDocument(bytes);
  const result = await fillFormDocument(loaded, {
    full_name: 'Asha Raman',
    email: 'asha@example.com',
    agree: true,
    plan: 'pro',
    country: 'India',
    notes: 'first line\nsecond line',
    level: 'two',
    locked_field: 'changed anyway',
    not_a_field: 'ignored',
  });

  assert(same(result.applied.map((entry) => entry.name).sort(), [
    'agree', 'country', 'email', 'full_name', 'level', 'notes', 'plan',
  ]), 'every fillable field was written');
  const skipped = new Map(result.skipped.map((entry) => [entry.name, entry.reason]));
  assert(/read-only/.test(skipped.get('locked_field') || ''), 'the read-only field is skipped with a reason');
  assert(/no such field/.test(skipped.get('not_a_field') || ''), 'an unknown field name is skipped with a reason');
  assert(same(Array.from(bytes), Array.from(before)), 'filling never touches the source bytes');
  assert(result.warnings.length === 0, 'no appearance warnings for plain Latin values');

  // Verify by reloading the saved PDF with pdf-lib…
  const check = await readFormFields(result.bytes);
  const value = new Map(check.fields.map((field) => [field.name, field.value]));
  assert(value.get('full_name') === 'Asha Raman', 'the text value round-trips');
  assert(value.get('email') === 'asha@example.com', 'a second text value round-trips');
  assert(value.get('agree') === true, 'the check box is checked in the saved file');
  assert(value.get('plan') === 'pro', 'the selected radio option round-trips');
  assert(value.get('country') === 'India', 'the drop-down selection round-trips');
  assert(value.get('level') === 'two', 'the list selection round-trips');
  assert(value.get('notes') === 'first line\nsecond line', 'multi-line text keeps its line breaks');
  assert(value.get('locked_field') === 'Cannot be edited', 'the read-only field keeps its original value');
  assert(check.pageCount === 2, 'the filled document keeps all of its pages');

  // …and by reading the widget values through PDF.js.
  const doc = await pdfjsLib.getDocument({ data: result.bytes.slice(), standardFontDataUrl }).promise;
  const page1 = await doc.getPage(1);
  const widgets = (await page1.getAnnotations()).filter((annotation) => annotation.subtype === 'Widget');
  const widgetValues = new Map(widgets.map((widget) => [widget.fieldName, widget.fieldValue]));
  assert(widgetValues.get('full_name') === 'Asha Raman', 'PDF.js sees the filled text value');
  assert(widgetValues.get('agree') === 'Yes' || widgetValues.get('agree') === 'On', 'PDF.js sees the checked box');
  assert(same(widgetValues.get('country'), ['India']), 'PDF.js sees the drop-down selection');
  const planValues = widgets.filter((widget) => widget.fieldName === 'plan').map((widget) => widget.fieldValue);
  assert(
    planValues.length === 2 && planValues.every((value) => value && value !== 'Off'),
    'PDF.js reports the radio group as selected'
  );
  const page2 = await doc.getPage(2);
  const widgets2 = (await page2.getAnnotations()).filter((annotation) => annotation.subtype === 'Widget');
  assert(
    widgets2.some((widget) => widget.fieldName === 'notes' && /second line/.test(String(widget.fieldValue))),
    'PDF.js sees the multi-line value on page 2'
  );
  await doc.destroy();

  // Appearance streams are rebuilt so other viewers show the values.
  const pdfDoc = await PDFDocument.load(result.bytes);
  const nameWidget = pdfDoc.getForm().getField('full_name').acroField.getWidgets()[0];
  assert(Boolean(nameWidget.dict.get(PDFName.of('AP'))), 'the text field has a rebuilt appearance stream');
  const boxWidget = pdfDoc.getForm().getField('agree').acroField.getWidgets()[0];
  assert(Boolean(boxWidget.dict.get(PDFName.of('AP'))), 'the check box has a rebuilt appearance stream');
}

section('C3. Filling edge cases');
{
  const bytes = fixture('acroform-basic.pdf');

  // Nothing to write.
  const untouched = await fillFormDocument(await loadFormDocument(bytes), {});
  assert(untouched.applied.length === 0, 'an empty value map changes nothing');
  assert(untouched.skipped.length === 0, 'an empty value map skips nothing');

  // Clearing values.
  const loaded = await loadFormDocument(bytes);
  const cleared = await fillFormDocument(loaded, { plan: '', country: '', agree: false, full_name: '' });
  const check = await readFormFields(cleared.bytes);
  const value = new Map(check.fields.map((field) => [field.name, field.value]));
  assert(value.get('full_name') === '', 'a text field can be cleared');
  assert(value.get('agree') === false, 'a check box can be unchecked');
  assert(value.get('plan') === '', 'a radio group can be cleared');
  assert(value.get('country') === '', 'a drop-down can be cleared');

  // An unknown value for a choice field is reported, not silently applied.
  const broken = await fillFormDocument(await loadFormDocument(bytes), { plan: 'enterprise' });
  assert(
    broken.skipped.some((entry) => entry.name === 'plan'),
    'selecting a radio option that does not exist is skipped with a reason'
  );

  // Control characters are stripped from typed text.
  const sanitized = await fillFormDocument(await loadFormDocument(bytes), { full_name: 'A\u0000B\u0007C' });
  const sanitizedValues = new Map(
    (await readFormFields(sanitized.bytes)).fields.map((field) => [field.name, field.value])
  );
  assert(sanitizedValues.get('full_name') === 'A B C', 'control characters become spaces');

  // dirtyFieldNames tracks what actually changed.
  const fields = (await readFormFields(bytes)).fields;
  const values = Object.fromEntries(fields.map((field) => [field.name, field.value]));
  assert(dirtyFieldNames(fields, values).length === 0, 'no field is dirty before anything is typed');
  assert(same(dirtyFieldNames(fields, { ...values, full_name: 'New' }), ['full_name']), 'only the changed field is dirty');
  assert(same(dirtyFieldNames(fields, { ...values, agree: true }), ['agree']), 'ticking a box marks it dirty');
  assert(dirtyFieldNames(fields, { ...values, locked_field: 'x' }).length === 0, 'a read-only field is never dirty');
}

section('C4. The sample form in samples/ is a usable fillable PDF');
{
  const bytes = new Uint8Array(readFileSync(path.join(ROOT, 'samples', 'form-sample.pdf')));
  const form = await readFormFields(bytes);
  assert(form.fields.length >= 6, 'the sample form has several fields', `${form.fields.length}`);
  assert(
    form.fields.every((field) => field.widgets.length > 0 && field.widgets[0].width > 0),
    'every sample field has a rectangle on a page'
  );
  const loaded = await loadFormDocument(bytes);
  const filled = await fillFormDocument(loaded, { name: 'Test User', rating: 'good', comments: 'Nice reader' });
  const values = new Map((await readFormFields(filled.bytes)).fields.map((field) => [field.name, field.value]));
  assert(values.get('name') === 'Test User', 'the sample form accepts a name');
  assert(values.get('rating') === 'good', 'the sample form accepts a rating');
  assert(values.get('comments') === 'Nice reader', 'the sample form accepts comments');
  const meta = await readMetadata(filled.bytes);
  assert(meta.pageCount === 1, 'the filled sample keeps its single page');
}

// ---------------------------------------------------------------------------
const html = readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
const virtualConsole = new VirtualConsole();
const dom = new JSDOM(html, { url: 'http://localhost:3000/src/index.html', virtualConsole });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;

const { PasswordController } = await import('../src/pdf-password-ui.js');
const { FormController, widgetRectToCss } = await import('../src/pdf-forms-ui.js');
const { SecurityController } = await import('../src/pdf-security-ui.js');

section('D1. Password dialog markup');
{
  const requiredIds = [
    'password-dialog', 'password-file-label', 'password-message', 'password-input', 'password-error',
    'password-reveal', 'btn-password-ok', 'btn-password-cancel',
    'security-dialog', 'security-doc-label', 'security-summary', 'security-permissions', 'security-notes',
    'btn-security', 'btn-security-close', 'btn-security-close-2', 'status-lock',
    'form-bar', 'form-bar-summary', 'btn-form-save', 'btn-form-reset', 'btn-form-done',
    'btn-forms', 'form-layer',
  ];
  const missing = requiredIds.filter((id) => !document.getElementById(id));
  assert(missing.length === 0, 'every Phase 5 element id exists in index.html', missing.join(', '));
  assert(document.querySelector('link[href="pdf-forms.css"]') !== null, 'the Phase 5 stylesheet is linked');
  assert(document.getElementById('password-dialog').style.display === 'none', 'the password dialog starts hidden');
  assert(document.getElementById('password-input').type === 'password', 'the password field hides what is typed');
}

section('D2. Password dialog behaviour');
{
  const statusLog = [];
  const prompt = new PasswordController({ onStatus: (message) => statusLog.push(message) });
  const dialog = document.getElementById('password-dialog');
  const input = document.getElementById('password-input');

  const first = prompt.request({ fileName: 'secure.pdf', message: 'Enter the password to open it.' });
  assert(dialog.style.display === 'flex', 'requesting a password shows the dialog');
  assert(document.getElementById('password-file-label').textContent.includes('secure.pdf'), 'the dialog names the file');
  assert(document.getElementById('password-message').textContent === 'Enter the password to open it.', 'the dialog shows the caller message');

  // An empty submit is refused without closing.
  document.getElementById('btn-password-ok').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert(/Enter the password/.test(document.getElementById('password-error').textContent), 'an empty password is refused inline');
  assert(dialog.style.display === 'flex', 'the dialog stays open after an empty submit');
  assert(prompt.isOpen, 'the request is still pending');

  input.value = USER_PASSWORD;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  document.getElementById('btn-password-ok').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert(await first === USER_PASSWORD, 'submitting resolves with the typed password');
  assert(dialog.style.display === 'none', 'the dialog closes after a successful submit');
  assert(!prompt.isOpen, 'the request is no longer pending');

  // Enter in the field submits as well.
  const second = prompt.request({ fileName: 'secure.pdf' });
  input.value = 'typed-and-entered';
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert(await second === 'typed-and-entered', 'Enter submits the password');

  // Cancel resolves with null, which means "do not open the document".
  const third = prompt.request({ fileName: 'secure.pdf' });
  document.getElementById('btn-password-cancel').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert(await third === null, 'cancelling resolves with null');
  assert(statusLog.some((message) => /Open cancelled/.test(message)), 'cancelling explains that the document was not opened');
  assert(dialog.style.display === 'none', 'cancelling closes the dialog');

  // A second simultaneous request is refused instead of stealing the answer.
  const fourth = prompt.request({ fileName: 'a.pdf' });
  const fifth = prompt.request({ fileName: 'b.pdf' });
  assert(await fifth === null, 'a second request while the dialog is open is refused');
  prompt.cancel();
  assert(await fourth === null, 'cancelling the dialog resolves the pending request with null');

  // The reveal toggle changes the field type only.
  prompt.request({ fileName: 'secure.pdf' });
  const reveal = document.getElementById('password-reveal');
  reveal.checked = true;
  reveal.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(input.type === 'text', 'the reveal checkbox shows the password');
  reveal.checked = false;
  reveal.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(input.type === 'password', 'unchecking it hides the password again');
  prompt.reset();
  assert(!prompt.isOpen, 'reset closes a pending prompt');
}

// ---------------------------------------------------------------------------
section('E1. Form controller: markup and widget placement');
{
  const bytes = fixture('acroform-basic.pdf');
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(), standardFontDataUrl }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const rect = { x: 150, y: 655, width: 260, height: 22 };
  const css = widgetRectToCss(rect, viewport);
  assert(css.left === 150 && css.width === 260, 'a field keeps its horizontal position and width at 100% zoom');
  assert(css.top === 792 - 655 - 22, 'a field is flipped into top-left CSS coordinates', JSON.stringify(css));
  assert(css.height === 22, 'a field keeps its height');

  const zoomed = page.getViewport({ scale: 2 });
  const css2 = widgetRectToCss(rect, zoomed);
  assert(css2.left === 300 && css2.width === 520 && css2.height === 44, 'fields scale with the page zoom');
  await doc.destroy();
}

section('E2. Form controller: filling and saving');
{
  const statuses = [];
  let sourceBytes = fixture('acroform-basic.pdf');
  let generation = 1;
  let security = NO_SECURITY;
  let pageNumber = 1;
  let viewport = null;
  let viewportPage = 0;
  const saveCalls = [];
  const savedDocs = [];
  let saveResult = { ok: true, name: 'acroform-basic-filled.pdf', path: '/docs/acroform-basic-filled.pdf' };

  const pdfDoc = await pdfjsLib.getDocument({ data: sourceBytes.slice(), standardFontDataUrl }).promise;
  const page = await pdfDoc.getPage(1);
  viewport = page.getViewport({ scale: 1 });
  viewportPage = 1;

  const controller = new FormController({
    getSourceBytes: () => sourceBytes,
    getDocumentGeneration: () => generation,
    getDocumentName: () => 'acroform-basic.pdf',
    getCurrentPage: () => pageNumber,
    getCurrentViewport: () => (viewportPage === pageNumber ? { pageNumber: viewportPage, viewport } : null),
    getSecurity: () => security,
    saveBytes: async (bytes, suggestedName) => {
      saveCalls.push({ bytes: new Uint8Array(bytes).slice(), suggestedName });
      return saveResult;
    },
    onSaved: async (payload) => savedDocs.push(payload),
    onStatus: (message) => statuses.push(message),
  });

  assert(document.getElementById('form-bar').style.display === 'none', 'the form bar starts hidden');
  assert(controller.fieldCount === 0, 'no fields are known before form filling is enabled');

  const enabled = await controller.enable();
  assert(enabled === true, 'enabling form filling succeeds on a fillable PDF');
  assert(controller.isEnabled, 'the controller reports it is enabled');
  assert(controller.fieldCount === 8, 'all 8 fields were read');
  assert(controller.editableCount === 7, 'the read-only field is not editable');
  assert(document.getElementById('form-bar').style.display === 'flex', 'the form bar appears');
  assert(document.getElementById('btn-forms').getAttribute('aria-pressed') === 'true', 'the toolbar button is pressed');

  const controls = () => [...document.querySelectorAll('#form-layer .form-widget')];
  assert(controls().length === 7, 'page 1 shows one control per widget (7)', `${controls().length}`);
  const byField = (name) => controls().filter((node) => node.dataset.field === name);
  assert(byField('full_name')[0]?.tagName === 'INPUT', 'a single-line text field becomes an input');
  assert(byField('notes').length === 0, 'a field on page 2 is not drawn on page 1');
  assert(byField('agree')[0]?.type === 'checkbox', 'a check box becomes a checkbox input');
  assert(byField('plan').length === 2 && byField('plan')[0].type === 'radio', 'a radio group becomes one radio per option');
  assert(byField('country')[0]?.tagName === 'SELECT' && byField('country')[0].options.length === 3, 'a drop-down becomes a select with a blank option');
  assert(byField('locked_field')[0]?.disabled === true, 'the read-only field is rendered disabled');

  // Page 2 only draws its own fields.
  const page2 = await pdfDoc.getPage(2);
  const viewport2 = page2.getViewport({ scale: 1 });
  pageNumber = 2;
  viewport = viewport2;
  viewportPage = 2;
  controller.renderOverlay(2, viewport2);
  assert(controls().length === 2, 'page 2 shows its two fields');
  assert(byField('notes')[0]?.tagName === 'TEXTAREA', 'a multi-line field becomes a textarea');
  assert(byField('level')[0]?.tagName === 'SELECT', 'a list box becomes a select');

  pageNumber = 1;
  viewport = page.getViewport({ scale: 1 });
  viewportPage = 1;
  controller.renderOverlay(1, viewport);

  // Typing into a control marks the form dirty.
  assert(!controller.isDirty, 'the form starts clean');
  const nameInput = byField('full_name')[0];
  nameInput.value = 'Asha Raman';
  nameInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert(controller.isDirty, 'typing a value marks the form dirty');
  assert(controller.filledCount === 1, 'the filled counter follows the controls');
  assert(/1 of 7 filled/.test(document.getElementById('form-bar-summary').textContent), 'the bar reports progress');
  assert(document.getElementById('btn-form-save').disabled === false, 'Save becomes available once something changed');

  const agree = byField('agree')[0];
  agree.checked = true;
  agree.dispatchEvent(new window.Event('change', { bubbles: true }));
  const proRadio = byField('plan')[1];
  proRadio.checked = true;
  proRadio.dispatchEvent(new window.Event('change', { bubbles: true }));
  const country = byField('country')[0];
  country.value = 'India';
  country.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(controller.filledCount === 4, 'check boxes, radios and selects all count as filled');

  // Saving nothing (reset first) is refused with an explanation.
  controller.resetValues();
  assert(!controller.isDirty, 'reset restores the stored values');
  await controller.save();
  assert(saveCalls.length === 0, 'saving with no changes writes nothing');
  assert(/Nothing to save yet/.test(statuses.at(-1)), 'saving with no changes explains why nothing happened');

  // Fill again and save.
  nameInput.value = 'Asha Raman';
  nameInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await controller.save();
  assert(saveCalls.length === 1, 'saving hands the filled PDF to the host once');
  assert(saveCalls[0].suggestedName === 'acroform-basic-filled.pdf', 'the suggested name keeps the document name');
  const saved = await readFormFields(saveCalls[0].bytes);
  const savedValues = new Map(saved.fields.map((field) => [field.name, field.value]));
  assert(savedValues.get('full_name') === 'Asha Raman', 'the saved PDF carries the typed value');
  assert(savedValues.get('locked_field') === 'Cannot be edited', 'the read-only field is untouched in the saved PDF');
  assert(saved.pageCount === 2, 'the saved PDF keeps both pages');
  assert(savedDocs.length === 1 && savedDocs[0].name === 'acroform-basic-filled.pdf', 'the viewer is pointed at the saved file');
  assert(!controller.isEnabled, 'a successful save leaves form filling');

  // A cancelled save keeps everything.
  await controller.enable();
  byField('full_name')[0].value = 'Second try';
  byField('full_name')[0].dispatchEvent(new window.Event('input', { bubbles: true }));
  saveResult = { ok: false, canceled: true };
  const callsBefore = saveCalls.length;
  await controller.save();
  assert(saveCalls.length === callsBefore + 1, 'a cancelled save still asks the host once');
  assert(savedDocs.length === 1, 'a cancelled save does not reopen anything');
  assert(controller.isDirty, 'a cancelled save keeps the typed values');
  assert(/Save cancelled/.test(statuses.at(-1)), 'a cancelled save says nothing changed');
  saveResult = { ok: true, name: 'acroform-basic-filled.pdf', path: '/docs/acroform-basic-filled.pdf' };

  // A failed save is reported, not swallowed.
  saveResult = { ok: false, error: 'The file is open in another program.' };
  await controller.save();
  assert(/open in another program/.test(statuses.at(-1)), 'a failing save reports the host error');
  saveResult = { ok: true, name: 'acroform-basic-filled.pdf', path: '/docs/acroform-basic-filled.pdf' };

  // Disabling clears the overlay but keeps the document state.
  controller.disable();
  assert(controls().length === 0, 'leaving form filling removes the controls');
  assert(document.getElementById('form-bar').style.display === 'none', 'leaving form filling hides the bar');
  assert(controller.fieldCount === 8, 'the field model is kept while the document stays open');

  // Changing the document discards the session.
  generation += 1;
  sourceBytes = fixture('acroform-basic.pdf');
  await controller.onDocumentChanged();
  assert(controller.session === null && !controller.isDirty, 'a new document discards the form session');

  await pdfDoc.destroy();
}

section('E3. Form controller: refusals');
{
  const statuses = [];
  const sourceBytes = fixture('acroform-basic.pdf');
  let security = NO_SECURITY;
  const controller = new FormController({
    getSourceBytes: () => sourceBytes,
    getDocumentGeneration: () => 7,
    getDocumentName: () => 'acroform-basic.pdf',
    getCurrentPage: () => 1,
    getCurrentViewport: () => null,
    getSecurity: () => security,
    saveBytes: async () => ({ ok: true, name: 'x.pdf', path: '/docs/x.pdf' }),
    onStatus: (message) => statuses.push(message),
  });

  // A document that denies filling in forms.
  security = buildSecurity(PERMISSION_BITS.FILL_INTERACTIVE_FORMS === 0 ? 0 : ALL_PERMISSIONS & ~PERMISSION_BITS.FILL_INTERACTIVE_FORMS);
  const denied = await controller.enable();
  assert(denied === false, 'form filling is refused when the permissions deny it');
  assert(/does not allow filling in form fields/.test(statuses.at(-1)), 'the refusal names the reason');

  // An encrypted document: readable, but a filled copy cannot be saved.
  statuses.length = 0;
  security = buildSecurity(ALL_PERMISSIONS, { unlockedWithPassword: true });
  const encrypted = await controller.enable();
  assert(encrypted === false, 'form filling is refused while the document is encrypted');
  assert(/encrypted/.test(statuses.at(-1)), 'the refusal explains the encryption');
  assert(!controller.isEnabled, 'the controller stays disabled after a refusal');

  // The toolbar button is disabled and explains itself.
  controller.setDocumentAvailable(true);
  assert(document.getElementById('btn-forms').disabled === true, 'the toolbar button is disabled for an encrypted document');
  assert(/encrypted/.test(document.getElementById('btn-forms').title), 'the button tooltip explains why');

  // No document open at all.
  statuses.length = 0;
  security = NO_SECURITY;
  const noDoc = new FormController({
    getSourceBytes: () => null,
    getDocumentGeneration: () => 8,
    getDocumentName: () => '',
    getCurrentPage: () => 1,
    getCurrentViewport: () => null,
    getSecurity: () => NO_SECURITY,
    saveBytes: async () => ({ ok: true, name: 'x.pdf', path: null }),
    onStatus: (message) => statuses.push(message),
  });
  assert(await noDoc.enable() === false, 'form filling is refused with no document open');
  assert(/Open a PDF/.test(statuses.at(-1)), 'the refusal asks for a document first');
}

section('E4. A PDF without a form reports it');
{
  const statuses = [];
  const doc = await (await import('pdf-lib')).PDFDocument.create();
  doc.addPage([300, 300]);
  const plain = new Uint8Array(await doc.save());
  const controller = new FormController({
    getSourceBytes: () => plain,
    getDocumentGeneration: () => 9,
    getDocumentName: () => 'plain.pdf',
    getCurrentPage: () => 1,
    getCurrentViewport: () => null,
    getSecurity: () => NO_SECURITY,
    saveBytes: async () => ({ ok: true, name: 'x.pdf', path: null }),
    onStatus: (message) => statuses.push(message),
  });
  assert(await controller.enable() === false, 'a document without a form cannot be filled');
  assert(/no fillable form fields/.test(statuses.at(-1)), 'the message says the PDF has no form fields');
}

// ---------------------------------------------------------------------------
section('F1. Document security dialog');
{
  const statuses = [];
  let security = NO_SECURITY;
  const controller = new SecurityController({
    getSecurity: () => security,
    getDocumentName: () => 'secure-locked.pdf',
    onStatus: (message) => statuses.push(message),
  });

  // Unencrypted.
  controller.show();
  assert(document.getElementById('security-dialog').style.display === 'flex', 'the dialog opens');
  assert(/not encrypted/.test(document.getElementById('security-summary').textContent), 'an unencrypted document is reported as such');
  assert(document.getElementById('status-lock').style.display === 'none', 'no lock chip for an unencrypted document');
  controller.hide();

  // Encrypted with everything denied.
  security = buildSecurity(0, { unlockedWithPassword: true });
  controller.show();
  const rows = () => [...document.querySelectorAll('#security-permissions tr')];
  assert(rows().length === 8, 'all eight permissions are listed');
  const badges = [...document.querySelectorAll('#security-permissions .secure-badge')].map((node) => node.textContent);
  assert(badges.every((text) => text === 'Denied'), 'a locked document shows every permission denied');
  assert(
    [...document.querySelectorAll('#security-permissions .secure-enforced')].length === 4,
    'the four permissions Cambuz enforces are marked as blocked'
  );
  assert(/password you entered/.test(document.getElementById('security-summary').textContent), 'the summary notes the password was used');
  assert(document.getElementById('status-lock').style.display === 'inline-flex', 'the lock chip appears');
  assert(/Encrypted/.test(document.getElementById('status-lock').textContent), 'the chip says the document is encrypted');
  assert(/Encrypted/.test(document.getElementById('status-lock').textContent), 'the chip describes the restrictions');
  controller.hide();

  // Partially restricted.
  security = buildSecurity(ALL_PERMISSIONS & ~PERMISSION_BITS.PRINT);
  controller.show();
  const mixed = [...document.querySelectorAll('#security-permissions .secure-badge')].map((node) => node.textContent);
  assert(mixed.filter((text) => text === 'Denied').length === 1, 'only printing is denied');
  assert(
    [...document.querySelectorAll('#security-permissions tr')].findIndex((row) => row.className === 'secure-denied') === 0,
    'the denied row is the printing row'
  );
  assert(/printing/.test(document.getElementById('status-lock').textContent), 'the chip names printing as denied');
  controller.hide();
  assert(document.getElementById('security-dialog').style.display === 'none', 'the dialog closes');

  // Clicking the chip opens the dialog again.
  document.getElementById('status-lock').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert(controller.isOpen, 'the status chip opens the security dialog');
  controller.hide();
}

// ---------------------------------------------------------------------------
// G. End-to-end: the real renderer module (renderer.js) in a jsdom built from
//    the real index.html. Canvas rendering is not available in jsdom, so the
//    page image itself is not verified here — everything else about the wiring
//    (password prompt, permission enforcement, form filling, saving) is.
section('G1. The app asks for a password and then honours the permissions');

let appCase = 0;
// jsdom has no canvas or Path2D. This stub is just complete enough for PDF.js
// to walk a page's operator list without drawing anything, so rendering fails
// fast (and harmlessly) instead of spending a minute in the real rasteriser.
const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
function canvasStub(canvas) {
  const state = {
    canvas,
    getTransform: () => IDENTITY,
    getImageData: (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    createImageData: (w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    measureText: () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }),
    isPointInPath: () => false,
  };
  return new Proxy(state, {
    get: (target, prop) => (prop in target ? target[prop] : () => {}),
    set: (target, prop, value) => {
      target[prop] = value;
      return true;
    },
  });
}

/** Boot the real app with `?pdf=<url>` and hand the DOM to `body`. */
async function withApp(pdfUrl, body) {
  const dom = new JSDOM(html, {
    url: `http://localhost:3000/src/index.html?pdf=${encodeURIComponent(pdfUrl)}`,
    virtualConsole: new VirtualConsole(),
    pretendToBeVisual: true,
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.fetch = async (url) => {
    const target = path.join(ROOT, String(url).replace('http://localhost:3000', ''));
    const buffer = await import('node:fs/promises').then((fsp) => fsp.readFile(target));
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    };
  };
  dom.window.HTMLCanvasElement.prototype.getContext = function getContext() {
    return canvasStub(this);
  };
  dom.window.Path2D = class Path2D {
    constructor() {}
    addPath() {} moveTo() {} lineTo() {} bezierCurveTo() {} quadraticCurveTo() {}
    closePath() {} rect() {} arc() {} ellipse() {} transform() {}
  };
  globalThis.Path2D = dom.window.Path2D;
  const downloads = [];
  dom.window.URL.createObjectURL = () => 'blob:cambuz-test';
  dom.window.URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function click() {
    if (this.download) downloads.push(this.download);
  };
  dom.window.confirm = () => true;

  const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));
  // A fresh module instance per case: renderer.js caches DOM elements at import.
  const renderer = await import(`../src/renderer.js?case=${(appCase += 1)}`);
  await renderer.initApp();
  try {
    await body({ window: dom.window, document: dom.window.document, settle, downloads });
  } finally {
    dom.window.close();
  }
}

const app = (id) => document.getElementById(id);
const click = (id, win) =>
  app(id).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

await withApp('/scripts/fixtures/secure-open-password.pdf', async ({ window: win, settle }) => {
  await settle(600);
  assert(app('password-dialog').style.display === 'flex', 'G1: opening a protected PDF shows the password prompt');
  assert(app('password-file-label').textContent.includes('secure-open-password.pdf'), 'G1: the prompt names the file');
  assert(app('doc-title').textContent === 'Cambuz PDF Reader', 'G1: nothing is opened before the password is entered');

  app('password-input').value = 'wrong-one';
  click('btn-password-ok', win);
  await settle(800);
  assert(app('password-dialog').style.display === 'flex', 'G1: a wrong password keeps the prompt open');
  assert(/did not open/.test(app('password-message').textContent), 'G1: a wrong password is reported in the dialog');
  assert(app('doc-title').textContent === 'Cambuz PDF Reader', 'G1: a wrong password never opens the document');

  app('password-input').value = USER_PASSWORD;
  click('btn-password-ok', win);
  await settle(1200);
  assert(app('password-dialog').style.display === 'none', 'G1: the correct password closes the prompt');
  assert(app('doc-title').textContent === 'secure-open-password.pdf', 'G1: the correct password opens the document');
  assert(app('status-lock').style.display === 'inline-flex', 'G1: the status bar shows the lock chip');
  assert(/Encrypted/.test(app('status-lock').textContent), 'G1: the chip says the document is encrypted');
  assert(app('btn-print').disabled === false, 'G1: printing stays enabled when the document allows it');
  assert(app('btn-pageops').disabled === true, 'G1: page tools stay disabled while the document is encrypted');
  assert(app('btn-forms').disabled === true, 'G1: form filling stays disabled while the document is encrypted');
  assert(/encrypted/.test(app('btn-forms').title), 'G1: the disabled forms button explains why');
});

section('G2. Permissions are enforced without a password prompt');
await withApp('/scripts/fixtures/secure-permissions-only.pdf', async ({ window: win, settle }) => {
  await settle(1500);
  assert(app('password-dialog').style.display === 'none', 'G2: a document with no user password opens without prompting');
  assert(app('doc-title').textContent === 'secure-permissions-only.pdf', 'G2: the document opens');
  assert(app('btn-print').disabled === true, 'G2: printing is disabled because the document denies it');
  assert(app('text-layer').classList.contains('no-copy'), 'G2: copying is blocked at the text layer');
  assert(app('btn-pageops').disabled === true, 'G2: page tools are disabled');
  assert(app('btn-forms').disabled === true, 'G2: form filling is disabled');

  // Ctrl+P is refused with a visible reason instead of opening the dialog.
  document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true }));
  await settle(200);
  assert(app('error-display').style.display === 'flex', 'G2: refusing a print shows the error panel');
  assert(/does not allow printing/.test(app('error-message').textContent), 'G2: the refusal explains the printing permission');
  assert(app('print-dialog').style.display === 'none', 'G2: the print dialog never opens');

  // Ctrl+A refuses to select the page text for copying.
  document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
  await settle(200);
  assert(/does not allow copying/.test(app('status-text').textContent), 'G2: select-all refuses to hand the text over');

  // The security dialog reports the same restrictions.
  click('btn-security', win);
  await settle(200);
  assert(app('security-dialog').style.display === 'flex', 'G2: the security dialog opens');
  const rows = [...document.querySelectorAll('#security-permissions tr')];
  assert(rows.length === 8, 'G2: all eight permissions are listed');
  assert(
    rows[0].querySelector('.secure-badge').textContent === 'Denied',
    'G2: printing is shown as denied'
  );
  assert(/encrypted/i.test(app('security-summary').textContent), 'G2: the summary says the document is encrypted');
});

section('G3. A fully locked document blocks everything except reading');
await withApp('/scripts/fixtures/secure-locked.pdf', async ({ window: win, settle }) => {
  await settle(600);
  app('password-input').value = USER_PASSWORD;
  click('btn-password-ok', win);
  await settle(1200);
  assert(app('doc-title').textContent === 'secure-locked.pdf', 'G3: the locked document opens with its password');
  assert(app('btn-print').disabled === true, 'G3: printing is blocked');
  assert(app('text-layer').classList.contains('no-copy'), 'G3: copying is blocked');
  assert(app('btn-pageops').disabled === true, 'G3: page tools are blocked');
  assert(app('btn-forms').disabled === true, 'G3: form filling is blocked');
  const text = await pageText(
    await pdfjsLib.getDocument({ data: fixture('secure-locked.pdf').slice(), password: USER_PASSWORD, standardFontDataUrl }).promise
  );
  assert(/SECURE PAGE 1/.test(text), 'G3: the text is still readable once unlocked');
});

section('G4. Filling and saving a form through the real app');
await withApp('/samples/form-sample.pdf', async ({ window: win, settle, downloads }) => {
  await settle(1200);
  assert(app('doc-title').textContent === 'form-sample.pdf', 'G4: the form sample opens');
  assert(app('btn-forms').disabled === false, 'G4: form filling is available for an unprotected PDF');
  assert(app('btn-print').disabled === false, 'G4: printing is available');
  assert(!app('text-layer').classList.contains('no-copy'), 'G4: copying is allowed');

  document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  await settle(1200);
  assert(app('form-bar').style.display === 'flex', 'G4: Ctrl+Shift+F starts form filling');
  assert(app('search-bar').style.display === 'none', 'G4: Ctrl+Shift+F does not open search instead');

  const controls = () => [...document.querySelectorAll('#form-layer .form-widget')];
  assert(controls().length === 8, 'G4: every field of the sample is drawn over the page', `${controls().length}`);
  assert(
    controls().every((node) => node.style.left && node.style.top && parseFloat(node.style.width) > 0),
    'G4: every control is positioned and sized over the page'
  );

  const byName = (name) => controls().filter((node) => node.dataset.field === name);
  const nameInput = byName('name')[0];
  assert(nameInput && nameInput.tagName === 'INPUT' && nameInput.value === '', 'G4: the name field is an empty text input');
  nameInput.value = 'Asha Raman';
  nameInput.dispatchEvent(new win.Event('input', { bubbles: true }));
  await settle(150);
  assert(/1 of 6 filled/.test(app('form-bar-summary').textContent), 'G4: the bar counts the filled fields');
  assert(app('btn-form-save').disabled === false, 'G4: Save Filled Form becomes available');

  const rating = byName('rating')[0];
  rating.checked = true;
  rating.dispatchEvent(new win.Event('change', { bubbles: true }));
  await settle(100);
  assert(/2 of 6 filled/.test(app('form-bar-summary').textContent), 'G4: a radio button counts as filled');

  click('btn-form-save', win);
  await settle(1500);
  assert(downloads.length === 1, 'G4: saving writes one file');
  assert(downloads[0] === 'form-sample-filled.pdf', 'G4: the download is named after the document', downloads.join(','));
  assert(app('form-bar').style.display === 'none', 'G4: form filling ends after a successful save');

  // Escape also leaves form filling.
  document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  await settle(800);
  assert(app('form-bar').style.display === 'flex', 'G4: form filling can be started again');
  document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await settle(200);
  assert(app('form-bar').style.display === 'none', 'G4: Escape stops form filling');
  assert(controls().length === 0, 'G4: Escape removes the controls from the page');
});

// ---------------------------------------------------------------------------
console.log('\n==============================');
console.log(`Phase 5 tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
