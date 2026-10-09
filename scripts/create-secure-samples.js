#!/usr/bin/env node
// Cambuz PDF Reader — Phase 5 security & forms fixtures.
//
// Creates the plain (unencrypted) PDFs used by the Phase 5 tests and the
// application samples:
//
//   scripts/fixtures/acroform-basic.pdf   AcroForm fixture: every field type we
//                                         support, on two pages, plus a
//                                         read-only field that must never be
//                                         written to.
//   scripts/fixtures/secure-source.pdf    The document that
//                                         scripts/create-secure-samples.py
//                                         encrypts into the password fixtures.
//   samples/form-sample.pdf               A friendlier form for manual testing.
//
// The encrypted fixtures themselves need a real PDF encryption pass, which
// pdf-lib cannot do — they are produced by the Python script above.

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(ROOT, 'scripts', 'fixtures');
const SAMPLES = path.join(ROOT, 'samples');

if (!fs.existsSync(FIXTURES)) fs.mkdirSync(FIXTURES, { recursive: true });
if (!fs.existsSync(SAMPLES)) fs.mkdirSync(SAMPLES, { recursive: true });

const INK = rgb(0.12, 0.16, 0.24);
const MUTED = rgb(0.35, 0.38, 0.45);

function label(page, text, x, y, font, size = 11) {
  page.drawText(text, { x, y, size, font, color: MUTED });
}

/**
 * The AcroForm test fixture. Two pages, one field of every supported type.
 * Field names, types, pages and rectangles are asserted by
 * scripts/test-phase5.mjs, so change both together.
 */
async function createAcroFormFixture() {
  const doc = await PDFDocument.create();
  doc.setTitle('Cambuz AcroForm Fixture');
  doc.setSubject('Phase 5 form fixture');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = doc.getForm();

  const page1 = doc.addPage([612, 792]);
  page1.drawText('Cambuz AcroForm Fixture', { x: 50, y: 730, size: 20, font: bold, color: INK });
  page1.drawText('Page 1 — every supported field type', { x: 50, y: 708, size: 11, font, color: MUTED });

  label(page1, 'Full name', 50, 665);
  const fullName = form.createTextField('full_name');
  fullName.enableRequired();
  fullName.addToPage(page1, { x: 150, y: 655, width: 260, height: 22 });

  label(page1, 'Email', 50, 625);
  const email = form.createTextField('email');
  email.addToPage(page1, { x: 150, y: 615, width: 260, height: 22 });

  label(page1, 'Read-only', 50, 585);
  const locked = form.createTextField('locked_field');
  locked.setText('Cannot be edited');
  locked.enableReadOnly();
  locked.addToPage(page1, { x: 150, y: 575, width: 260, height: 22 });

  label(page1, 'I agree', 50, 545);
  const agree = form.createCheckBox('agree');
  agree.addToPage(page1, { x: 150, y: 538, width: 18, height: 18 });

  label(page1, 'Plan', 50, 505);
  const plan = form.createRadioGroup('plan');
  plan.addOptionToPage('basic', page1, { x: 150, y: 498, width: 16, height: 16 });
  plan.addOptionToPage('pro', page1, { x: 200, y: 498, width: 16, height: 16 });
  label(page1, 'basic', 170, 500, font, 9);
  label(page1, 'pro', 220, 500, font, 9);

  label(page1, 'Country', 50, 465);
  const country = form.createDropdown('country');
  country.addOptions(['India', 'Other']);
  country.addToPage(page1, { x: 150, y: 455, width: 160, height: 20 });

  const page2 = doc.addPage([612, 792]);
  page2.drawText('Page 2', { x: 50, y: 730, size: 20, font: bold, color: INK });

  label(page2, 'Notes (multiline)', 50, 665);
  const notes = form.createTextField('notes');
  notes.enableMultiline();
  notes.addToPage(page2, { x: 150, y: 600, width: 300, height: 70 });

  label(page2, 'Level (list)', 50, 555);
  const level = form.createOptionList('level');
  level.addOptions(['one', 'two', 'three']);
  level.addToPage(page2, { x: 150, y: 480, width: 110, height: 70 });

  const bytes = await doc.save();
  fs.writeFileSync(path.join(FIXTURES, 'acroform-basic.pdf'), bytes);
  console.log(`Created: scripts/fixtures/acroform-basic.pdf (2 pages, ${form.getFields().length} fields)`);
}

/**
 * Source document for the encrypted fixtures. Deliberately contains a form
 * field so the tests can prove that filled forms cannot be saved while a
 * document is encrypted.
 */
async function createSecureSource() {
  const doc = await PDFDocument.create();
  doc.setTitle('Cambuz Secure Fixture');
  doc.setAuthor('Cambuz PDF Reader');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  for (const pageNumber of [1, 2]) {
    const page = doc.addPage([612, 792]);
    page.drawText(`SECURE PAGE ${pageNumber}`, { x: 50, y: 700, size: 28, font: bold, color: INK });
    page.drawText('This document is used by the Phase 5 security tests.', {
      x: 50,
      y: 660,
      size: 12,
      font,
      color: MUTED,
    });
  }

  const form = doc.getForm();
  const note = form.createTextField('secure_note');
  note.addToPage(doc.getPage(0), { x: 50, y: 560, width: 260, height: 22 });

  const bytes = await doc.save();
  fs.writeFileSync(path.join(FIXTURES, 'secure-source.pdf'), bytes);
  console.log('Created: scripts/fixtures/secure-source.pdf (2 pages, 1 field)');
}

/** A form users can open from the welcome screen to try form filling. */
async function createFormSample() {
  const doc = await PDFDocument.create();
  doc.setTitle('Cambuz Feedback Form');
  doc.setAuthor('Cambuz PDF Reader');
  doc.setSubject('Sample PDF form for Phase 5');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const page = doc.addPage([595, 842]); // A4 portrait
  page.drawRectangle({ x: 0, y: 782, width: 595, height: 60, color: INK });
  page.drawText('Cambuz Feedback Form', { x: 40, y: 800, size: 22, font: bold, color: rgb(1, 1, 1) });
  page.drawText('Fill in the fields and use “Save Filled Form…” to keep your answers.', {
    x: 40,
    y: 750,
    size: 11,
    font,
    color: MUTED,
  });

  const form = doc.getForm();
  const row = (y, text) => label(page, text, 40, y, font, 12);

  row(700, 'Your name');
  const name = form.createTextField('name');
  name.addToPage(page, { x: 40, y: 672, width: 300, height: 24 });

  row(640, 'Email address');
  const email = form.createTextField('email');
  email.addToPage(page, { x: 40, y: 612, width: 300, height: 24 });

  row(580, 'How is Cambuz working for you?');
  const rating = form.createRadioGroup('rating');
  rating.addOptionToPage('good', page, { x: 40, y: 552, width: 16, height: 16 });
  rating.addOptionToPage('okay', page, { x: 130, y: 552, width: 16, height: 16 });
  rating.addOptionToPage('poor', page, { x: 220, y: 552, width: 16, height: 16 });
  page.drawText('Good', { x: 62, y: 554, size: 11, font, color: INK });
  page.drawText('Okay', { x: 152, y: 554, size: 11, font, color: INK });
  page.drawText('Poor', { x: 242, y: 554, size: 11, font, color: INK });

  row(510, 'Which feature do you use most?');
  const feature = form.createDropdown('feature');
  feature.addOptions(['Reading', 'Search', 'Printing', 'Page tools']);
  feature.addToPage(page, { x: 40, y: 482, width: 220, height: 22 });

  row(450, 'Send me release notes');
  const subscribe = form.createCheckBox('subscribe');
  subscribe.addToPage(page, { x: 40, y: 428, width: 18, height: 18 });

  row(390, 'Comments');
  const comments = form.createTextField('comments');
  comments.enableMultiline();
  comments.addToPage(page, { x: 40, y: 300, width: 440, height: 88 });

  page.drawText('Cambuz PDF Reader — Phase 5 sample form', {
    x: 40,
    y: 40,
    size: 10,
    font,
    color: MUTED,
  });

  const bytes = await doc.save();
  fs.writeFileSync(path.join(SAMPLES, 'form-sample.pdf'), bytes);
  console.log(`Created: samples/form-sample.pdf (1 page, ${form.getFields().length} fields)`);
}

async function main() {
  console.log('Generating Phase 5 security & forms fixtures...');
  await createAcroFormFixture();
  await createSecureSource();
  await createFormSample();
  console.log('Done! Encrypted fixtures: run `python3 scripts/create-secure-samples.py`.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
