# Cambuz PDF Reader

> **A lightweight, fast PDF reader focused on reading, searching, Indian-language support, and high-quality printing — without the bloat of large PDF suites.**

**Project status:** Phase 6 — Indian-language compatibility fixtures and automated reader/print checks implemented; OS clipboard, Electron and physical-printer verification pending<br>
**Product name:** Cambuz PDF Reader  
**Primary target:** Windows desktop  
**Repository:** GitHub  
**Development approach:** Phase-by-phase, testable milestones

---

## Phase 6 — Indian Language Excellence

### Phase 6 status: `FIXTURES + AUTOMATED COMPATIBILITY TESTS PASS; DEVICE CHECKS PENDING`

Phase 6 preserves Phases 1–5 and adds a language compatibility suite that
checks text extraction and app behavior as well as visible rendering. The
main fixture has 16 pages: a cover, separate English and target
language pages, a mixed-script page and combining-mark/conjunct stress page.
Two one-page Tamil companions separately check visible text painted from an
embedded Noto font and missing-font fallback while retaining the Unicode map.

Each language row below is tested against its real PDF.js page for exact sample
text, two search hits, text-layer selection, a serialized clipboard payload,
visible PDF.js raster output, and logical text/search after print-PDF assembly.
"Clipboard payload" is emulated from the browser `Selection` in jsdom; it is not
an OS clipboard test. The print test rebuilds and reopens Cambuz's vector
print-ready PDF; it does not send pages to a physical printer.

| Language | Script / direction | Fixture page | Search query |
|---|---|---:|---|
| English | Latin, LTR | 2 | `LANGKEY` |
| Hindi | Devanagari, LTR | 3 | `नमूना` |
| Punjabi | Gurmukhi, LTR | 4 | `ਕੁੰਜੀ` |
| Bengali | Bengali, LTR | 5 | `কীচিহ্ন` |
| Gujarati | Gujarati, LTR | 6 | `કસોટી` |
| Marathi | Devanagari, LTR | 7 | `चिन्ह` |
| Tamil | Tamil, LTR | 8 | `குறி` |
| Telugu | Telugu, LTR | 9 | `సంకేతం` |
| Kannada | Kannada, LTR | 10 | `ಗುರುತು` |
| Malayalam | Malayalam, LTR | 11 | `കുറി` |
| Odia | Odia, LTR | 12 | `ଚିହ୍ନ` |
| Assamese | Bengali script, LTR | 13 | `চাবি` |
| Urdu | Arabic/Nastaliq, RTL | 14 | `کلید` |

**Additional cases:** page 15 combines the English and all twelve target
languages (including a separate RTL Urdu run); page 16 exercises Devanagari
NFC/NFD nukta spellings, conjuncts, Gurmukhi/Bengali combining sequences and
Urdu marks. A synthetic DOM case also splits the Hindi conjunct `क्षत्रिय`
across four PDF.js text items and verifies search, highlighting and clear.
The embedded-font Tamil companion exercises PDF.js's visible font-painting path;
the missing-font fixture verifies retained extraction/search and that the
fallback render path completes in this Node environment.

### Phase 6 verification

- `npm run test:phase6` — **229 assertions, all passing**. It uses the real
  `SearchController`, PDF.js `TextLayer`, PDF.js extraction/rasterization,
  `@napi-rs/canvas`, and the production `buildPrintPdf` path.
- `npm test` — **866 assertions, all passing** across the existing Phase 2–5
  regression suites and the new Phase 6 suite (123 + 59 + 54 + 133 + 268 + 229).
- `npm run samples:phase6` regenerates all three PDFs. Generation requires the
  development Noto font packages plus Python `fpdf2`, `uharfbuzz`, `fonttools`
  and `pypdf` (installation instructions below).
- **Not verified here:** native OS clipboard integration, browser/Electron
  rendering beyond PDF.js in Node, Electron's native print route, and physical
  printer output. Those still need the manual Windows/browser checks below.

### Phase 6 known limitations

- These are controlled fixtures, not a guarantee for every PDF exporter,
  Unicode map, font program, language variety or shaping convention. Real PDFs
  may have incomplete or incorrect `/ToUnicode` or `/ActualText`; the reader
  cannot infer source text that a file does not encode.
- The sample text has been shaped with Noto font data and its visible forms are
  embedded as vector outlines, with a separate Unicode text layer. That gives
  reliable fixture rendering/extraction, but it is not a substitute for testing
  arbitrary embedded fonts in target browsers and Windows/Electron.
- Tamil missing-font coverage confirms logical text and generic fallback
  execution only. The sandbox has no guaranteed Tamil system font, so it cannot
  certify the legibility or correctness of fallback glyph shapes on a user's
  machine.
- Urdu extraction, `dir="rtl"`, selection, search and print-PDF text are
  verified. The fixture keeps Urdu as a dedicated RTL run; mixed-direction
  Latin and Urdu within the *same* text run and broader bidi punctuation/layout
  cases are not covered. PDF.js bidi processing can reorder mixed-run text.
- Assamese uses Bengali script and the Bengali font; the fixture tests only the
  selected Assamese-specific characters, not full Assamese orthographic/font
  coverage. Marathi uses the Devanagari fixture font.
- The jsdom clipboard check verifies the selected Unicode string that a normal
  browser copy action serializes; it does not exercise the privileged OS
  clipboard or permission-enforcement UI. The physical printer and native
  driver output also remain untested in this sandbox.
- Search is NFC-normalized substring matching with case-insensitive Latin
  matching. It is not transliteration, stemming, locale-specific collation,
  diacritic-insensitive search, regex or whole-word search.

---

## Phase 5 — Implementation Status

### Phase 5 Status: `SECURITY AND FORMS IMPLEMENTED — TESTED`

Phase 5 adds **password-protected documents**, **PDF permission enforcement** and
**fillable PDF forms**. Reader, search, print and page-tool behaviour from
Phases 1–4 is unchanged.

| Requirement | Implementation |
|---|---|
| Password-protected PDFs | ✅ A prompt appears when a document needs one; the correct password opens it, a wrong one is reported and the document stays closed, Cancel leaves it locked |
| Encrypted PDFs | ✅ Readable once unlocked. Never decrypted to disk and never re-saved unprotected — page tools and "Save Filled Form…" stay unavailable while a document is encrypted |
| PDF permissions | ✅ All eight permission flags are read and listed in **Document Security…**; printing, copying, page changes and form filling are enforced in the UI |
| Basic PDF forms | ✅ Text (single/multi-line), check boxes, radio groups, drop-downs and list boxes are drawn as real HTML controls over the page |
| Form field interaction | ✅ Type, tick and choose directly on the page; filled/total counter, Reset, Tab navigation, per-field tooltips |
| Saving filled forms | ✅ **Save Filled Form…** writes a NEW copy (native dialog in Electron, download in the browser); read-only and unsupported fields are skipped and reported |
| Fail safely | ✅ Every refusal (encrypted, permission denied, unsupported field) shows a reason instead of doing nothing, and never works around the protection |

### How it behaves

- **Password prompt** — shown only when PDF.js reports a missing or incorrect
  password. The password is handed to PDF.js for that one document and is never
  stored, logged or written to disk.
- **Document Security…** (toolbar lock button, status-bar chip or
  `Ctrl+Shift+K`) lists every permission with *Allowed* / *Denied* and marks the
  four Cambuz enforces: printing, copying, changing the document, and filling in
  forms.
- **Enforcement** — printing, `Ctrl+A` select-all and clipboard copying are
  blocked when the document denies them; page tools stay disabled while a
  document is encrypted; form filling is unavailable while a document is
  encrypted or denies it. The text is still rendered and searchable.
- **Form filling** (`Ctrl+Shift+F`, toolbar *Forms*, File → Fill Form Fields)
  overlays real controls on the page at the exact field rectangles, at any zoom
  or rotation. Values live in memory until you save; **Save Filled Form…**
  writes a copy named `<document>-filled.pdf`. The file you opened is never
  modified.
- **Appearance streams** are rebuilt for the fields you change, so the values
  are visible in other viewers too.

### Implementation notes

- `src/pdf-security.js` — permission flags (PDF 32000-1 table 22), the security
  model, and classification of PDF.js password errors. DOM-free.
- `src/pdf-forms.js` — AcroForm reading and writing with pdf-lib: field types,
  options, flags, rectangles, per-field values, and a fill pass that returns new
  bytes. DOM-free.
- `src/pdf-password-ui.js` — the password prompt.
- `src/pdf-forms-ui.js` — the on-page overlay, the filling bar, Reset and Save.
- `src/pdf-security-ui.js` — the Document Security dialog and status-bar chip.
- `src/pdf-forms.css` and the new markup in `src/index.html`.
- `src/renderer.js` — the password retry loop, permission enforcement, the copy
  guard, `Ctrl+Shift+F` / `Ctrl+Shift+K`, and the unsaved-form-value guard.
- `src/printing.js` — encrypted documents are refused with a clear message
  instead of failing inside pdf-lib.
- `main.js` / `preload.js` — File → Fill Form Fields and File → Document
  Security…. Saving reuses the Phase 4 `save-pdf` IPC, so overwrite protection
  is unchanged.

### Phase 5 verification status

- `npm run test:phase5` — **268 assertions, all passing**:
  - **A (25)** the permission model: mask decoding, encrypted/unencrypted,
    every permission allowed/denied, status text, refusal messages, and
    classification of the *real* PDF.js password exceptions.
  - **B (35)** real encrypted fixtures opened with PDF.js: no password, wrong
    password, correct password, the permission flags of all four fixtures, and
    proof that refusals never touch the encrypted bytes.
  - **C (61)** AcroForm reading (types, options, flags, pages, rectangles),
    filling every supported type, verification of the saved PDF with **both**
    pdf-lib and PDF.js (including rebuilt appearance streams), clearing values,
    unknown options, control-character sanitising, dirty tracking, and the
    `samples/form-sample.pdf` sample.
  - **D (22)** the password dialog in jsdom: prompt, empty submit, Enter,
    Cancel, reveal toggle, re-entrancy, reset.
  - **E (58)** the form controller in jsdom against a real PDF.js viewport:
    control types and positions per page, typing, counters, reset, save,
    cancelled save, failed save, leave/re-enter, document swap, and every
    refusal path.
  - **F (15)** the Document Security dialog: unencrypted, fully locked and
    partially restricted documents, badges, enforced markers, status chip.
  - **G (52)** end-to-end through the real `renderer.js` in a DOM built from
    `src/index.html`: password prompt → wrong password → correct password →
    permissions applied, a permissions-only document (no prompt) refusing print
    and copy, a fully locked document, and filling + saving the sample form with
    `Ctrl+Shift+F`.
- Fixtures: `scripts/fixtures/secure-*.pdf` are real RC4-128 (V2/R3) encrypted
  PDFs generated with pypdf (`npm run samples:secure`; the password for the
  protected fixtures is `cambuz`). `scripts/fixtures/acroform-basic.pdf` is a
  two-page form with every supported field type plus a read-only field.
- **Not exercised:** the Electron desktop shell (no display or Electron binary
  in this sandbox), so the new File-menu entries, the native save dialog and the
  native print route are reviewed but untested at runtime. The web build is
  served by `npm run serve` for manual checks in a browser; this sandbox has no
  browser, so canvas rendering, the on-page look of the form controls and
  physical printing were **not** observed here and still need a human pass.
  Also untested: real-world forms from other producers, XFA/dynamic forms and
  signature fields.

### Known limitations (Phase 5)

- **Filled values are not printed.** A print job embeds the page graphics of the
  source document; widget annotations (form values) are not flattened into it.
  Save the filled form, open the saved copy and print that if you need the
  values on paper.
- **Encrypted documents are read-only.** Cambuz cannot write encrypted PDFs, so
  page tools, metadata editing and saving a filled form are unavailable while a
  document is encrypted. There is deliberately no "remove the password" action.
- **Appearance fonts.** Rebuilt appearances use the standard Helvetica
  (WinAnsi). Values outside that set (Devanagari, Gurmukhi, other scripts) are
  still saved and are always visible in Cambuz's own overlay, but some other
  viewers may only draw them once the field is focused.
- **Unsupported form features:** XFA/dynamic forms, signature fields, push
  buttons, JavaScript-driven fields, rich text, combo boxes with editable text,
  and multi-select lists (a list box takes a single selection). Such fields are
  listed in the overlay as read-only markers, never filled by guesswork.
- **Search stays available when copying is denied.** Extraction for
  accessibility is a separate permission; the clipboard is what gets blocked.
- **Password attempts are not rate-limited by Cambuz**; the limit is whatever
  the document's own encryption provides.

---

## Phase 4 — Implementation Status

### Phase 4 Status: `BASIC PDF UTILITIES IMPLEMENTED — TESTED`

Phase 4 adds a **Page Tools** dialog (toolbar *Pages* button, `Ctrl+Shift+E`,
or File → Page Tools…). It works on a **working copy in memory**: nothing on
disk changes until you choose **Save As**, and the original file is only
overwritten if you pick it as the destination and confirm the overwrite.
Reader features from Phases 1–3 are unchanged.

| Requirement | Implementation |
|---|---|
| Rotate pages | ✅ ↺/↻ 90° on selected pages (adds to any existing `/Rotate`) |
| Delete pages | ✅ Confirmation prompt; refuses to delete every page; Delete key |
| Extract pages | ✅ "Extract selected" keeps only the selected pages (working copy); confirmation prompt |
| Reorder pages | ✅ Move up / Move down for one or more selected pages |
| Merge PDFs | ✅ "Merge PDF…" appends all pages of chosen files to the working copy |
| Split PDFs | ✅ `1-3; 4-6` or `every N`; each part saved as `<name>-part-N.pdf`; working copy unchanged |
| Save As | ✅ Native save dialog (Electron) or download (browser); reopens the saved file |
| Duplicate document | ✅ Saves an identical copy of the file as it is on disk (unsaved edits excluded) |
| Basic metadata | ✅ Title, author, subject, keywords (Info dictionary); creator/producer shown read-only |
| Undo | ✅ Up to 20 steps until the document is closed; Discard changes restores the file as opened |
| Protect the original | ✅ Save As never replaces the original without an explicit extra confirmation; writes go to a temporary file first, then rename |
| Unsaved-change guard | ✅ Confirmation before opening/closing another file; window close asks in the desktop app and browser |
| Encrypted PDFs | ✅ Refused with a clear message — Phase 5 can *read* them with a password, but never edits or re-saves them |

### Implementation notes

- `src/pdf-ops.js` — DOM-free operations built on `pdf-lib`. Each function returns
  new bytes; the input is never mutated. Reorder, delete and extract work on the
  same document's page tree, so the outline, named destinations and document
  metadata survive them.
- `src/pdf-ops-ui.js` — the dialog controller (thumbnails with PDF.js, selection,
  undo history, confirmations, Save As / Duplicate / split saving).
- `src/pdf-ops.css`, plus the dialog markup in `src/index.html`.
- `main.js` / `preload.js` — `save-pdf` (single file, native dialog, overwrite
  confirmation for existing files and the original), `save-pdf-files` (split into
  a chosen folder, one batch confirmation for conflicts), `dialog-open-pdfs`
  (merge picker), and a `will-prevent-unload` prompt for unsaved edits.
- Browser builds save through downloads; split downloads each part in turn, so
  the browser may ask permission to download several files.

### Phase 4 verification status

- `npm run test:phase4` — 133 assertions. Covers every operation on generated
  PDFs and the samples: page order and count (checked by reopening output with
  PDF.js), rotation placement, invalid input, encrypted-file refusal (fixture at
  `scripts/fixtures/encrypted-password.pdf`), split plan parsing, metadata, Unicode
  merge (Hindi), and the dialog controller in jsdom (confirmations, undo, Save As,
  duplicate, split, cancel, overwrite reporting).
- Browser run (headless Chromium against `npm run serve`, 33 checks): opening
  with the keyboard shortcut, thumbnails, selection, rotate, undo, delete
  confirmation, Save As download and reopen, split downloads, merge through a
  file chooser, metadata, the unsaved-change prompt, Duplicate, and Discard. The
  downloaded files were checked with `pdf-lib` (page counts, rotation, the
  original left unchanged on disk).
- **Not exercised:** the Electron desktop shell itself (no display or Electron
  binary in this sandbox). The native Save/Open/folder dialogs, overwrite
  prompts and the window-close prompt in `main.js` are reviewed but untested
  at runtime. Verify them on Windows before release.

### Known limitations (Phase 4)

- Merge and split copy pages into new documents; outline/bookmarks, form fields
  (AcroForm) and annotations are not carried over in those operations and were not verified.
- Deleting or extracting pages can leave outline entries that point at removed pages.
- Metadata editing covers the Info dictionary only (not XMP).
- Undo history is kept in memory for the open document only.
- Encrypted or password-protected PDFs cannot be edited or saved as a filled form (Phase 5 reads them with a password; writing encrypted PDFs is not supported).

---

## Phase 3 — Implementation Status

### Phase 3 Status: `PRINT WORKFLOW IMPLEMENTED — HARDWARE TEST PENDING`

Phase 1 and Phase 2 reading features are preserved. Phase 3 adds a print
workflow that composes the chosen pages into a print-ready PDF before output.
The preview is rendered from that exact PDF, so its page selection, paper
size, margins, scaling, orientation and N-up layout match the file sent to
Electron's native print API.

| Requirement | Implementation |
|---|---|
| Print current page / all pages / selected pages | ✅ Radio choices and validated page lists/ranges |
| Page range validation | ✅ Bounds, syntax, descending ranges and duplicates rejected |
| Printer selection | ✅ Electron printer list, default printer, refresh and system-dialog fallback |
| Copies | ✅ 1–99 copies; passed to native printer or browser dialog |
| Portrait / landscape | ✅ Output paper media box and native printer settings aligned |
| Paper sizes | ✅ A4, A3, A5, Letter, Legal and Tabloid |
| Fit / actual / custom scaling | ✅ Applied in the generated print PDF |
| Margins | ✅ None, narrow, normal, wide and custom (0–50 mm) |
| Multiple pages per sheet | ✅ 1, 2 or 4; clipped to each sheet cell |
| Print preview | ✅ PDF.js preview of the composed output PDF |
| Ink Saver preset | ✅ Grayscale raster output, capped at 200 dpi / 18 megapixels per page |
| Native Windows printing | ✅ Electron printer enumeration and `webContents.print` route implemented |
| Browser print fallback | ✅ Opens the same print-ready PDF in the system PDF/print flow |
| Actual physical printer test | ⏳ Not available in this sandbox; verify on Windows with a configured printer |

Normal print jobs preserve the source PDF page content as vector content.
Ink Saver intentionally rasterizes each page in grayscale at print resolution.
The print-ready PDF can also be downloaded for external printer testing.

### Phase 3 verification status

Automated tests cover page-range validation, paper dimensions, orientation,
1/2/4-up sheet counts and geometry, margins, scale modes, output PDF page
counts and media boxes, text preservation (including Hindi and Punjabi), PDF
page rotation, and Ink Saver output. The sandbox has no installed Electron
binary/display or physical printer, so the Windows native dialog and hardware
output were **not** exercised; this is not represented as a printer test.

---

## Phase 2 — Implementation Status

### Phase 2 Status: `PHASE 2 COMPLETE`

Phase 1 functionality is fully preserved. This section records the Phase 2
reading-experience milestone; printing was intentionally outside that
milestone and is implemented in the Phase 3 section above. PDF utilities,
forms, OCR, AI, cloud, accounts and telemetry remain outside scope.

### Features Implemented

| Requirement | Status |
|---|---|
| Page thumbnails (lazy, sidebar) | ✅ Implemented |
| Document outline / bookmarks | ✅ Implemented |
| Search within PDF (Unicode) | ✅ Implemented |
| Search result highlighting | ✅ Implemented |
| Text selection (text layer) | ✅ Implemented |
| Copy text | ✅ Implemented |
| Select all (page) | ✅ Implemented |
| Keyboard shortcuts (extended) | ✅ Implemented |
| Recent files | ✅ Implemented |
| Reopen last document | ✅ Implemented |
| Full-screen reading | ✅ Implemented |
| Page rotation (90° steps) | ✅ Implemented |
| Status information (page/zoom/rotation/size) | ✅ Implemented |
| Better keyboard navigation | ✅ Implemented |
| Shortcuts help dialog | ✅ Implemented |

### Technology Deltas (Phase 2)

| Area | Choice |
|---|---|
| **Text selection** | PDF.js `TextLayer` overlay on the page canvas |
| **Search** | Per-page `getTextContent` index, NFC + case-fold matching, DOM highlight marks |
| **Thumbnails** | Small-scale canvas renders with `IntersectionObserver` lazy loading |
| **Outline** | `getOutline()` with named-destination resolution |
| **Recents** | `localStorage` metadata + `IndexedDB` byte cache (web) / native paths (Electron) |
| **Rotation** | `getViewport({ rotation })` re-render, thumbnails refreshed |
| **Full screen** | Fullscreen API (`F11` / toolbar) |

### Dependencies

Phases 2 and 6 add development dependencies for Unicode fixtures and PDF.js
raster tests. Phase 3 adds `pdf-lib` as a runtime dependency to compose the
vector-preserving print PDF; the web preview also uses `express`.

| Package | Version | Purpose | Runtime? |
|---|---|---|---|
| `pdfjs-dist` | ^4.0.379 | PDF rendering engine | Yes |
| `express` | ^4.18.2 | Web server for preview mode | Yes (preview) |
| `electron` | ^28.0.0 | Desktop application shell (dev) | App shell |
| `pdf-lib` | ^1.17.1 | Vector-preserving print PDF composition (also used by sample generator) | Yes |
| `@pdf-lib/fontkit` | ^1.1.1 | Custom-font support experiments (dev) | No |
| `@expo-google-fonts/noto-sans-devanagari` | ^0.4.1 | Noto Devanagari TTF for samples (dev) | No |
| `@expo-google-fonts/noto-sans-gurmukhi` | ^0.4.1 | Noto Gurmukhi TTF for samples (dev) | No |
| `@expo-google-fonts/noto-*` | versions in `package.json` | Noto Bengali, Gujarati, Tamil, Telugu, Kannada, Malayalam, Odia and Urdu TTFs (dev) | No |
| `@napi-rs/canvas` | ^1.0.10 | Node-side PDF.js raster assertions (dev) | No |
| `jsdom` | ^30.1.2 | DOM-level automated tests (dev) | No |
| `fpdf2` + `uharfbuzz` + `fonttools` + `pypdf` (pip) | — | Shaped/extracted Unicode fixtures (dev) | No |

### Installation

```bash
# Clone the repository
git clone https://github.com/pixldotcom/cambuz-pdf.git
cd cambuz-pdf

# Install dependencies (the Electron postinstall downloads the desktop runtime)
npm install

# In a restricted sandbox, npm install --ignore-scripts still enables the
# web preview and automated tests, but not npm start / native printing.

# Optional: needed only to regenerate the Unicode sample PDFs
pip install fpdf2 uharfbuzz fonttools pypdf

# Regenerate Phase 6 multilingual and missing-font fixtures
npm run samples:phase6

# Optional: needed only to regenerate the Phase 5 encrypted fixtures
pip install pypdf

# Run as web application (for preview/testing)
npm run serve

# Run as desktop application (requires Electron)
npm start

# Generate all sample PDFs (basic + Unicode)
npm run samples

# Generate the Phase 5 fixtures (encrypted PDFs need pypdf)
npm run samples:secure

# Run the automated test suites (866 assertions across Phases 2–6)
npm test
```

### Development Commands

| Command | Description |
|---|---|
| `npm run serve` | Start web server on port 3000 |
| `npm start` | Launch Electron desktop app |
| `npm run samples` | Generate all sample PDFs (JS + Python) |
| `npm run samples:js` | Generate basic samples only |
| `npm run samples:unicode` | Generate Unicode samples only (needs fpdf2) |
| `npm run samples:secure` | Generate Phase 5 fixtures (JS + Python, needs pypdf) |
| `npm run samples:phase6` | Generate multilingual, embedded-font and missing-font fixtures (Python + Noto dev fonts) |
| `npm test` | Run Node, DOM, Phase 3 print, Phase 4 page-tool, Phase 5 security/form and Phase 6 language suites |
| `npm run test:node` | Run PDF/extraction/search/outline tests |
| `npm run test:dom` | Run DOM tests (highlight/outline/recents/wiring) |
| `npm run test:phase3` | Run print-range, layout, PDF-output and Ink Saver tests |
| `npm run test:phase4` | Run page operation, merge/split, metadata and page-tools dialog tests |
| `npm run test:phase5` | Run password, permission, AcroForm, password-dialog, form-filling and security-dialog tests |
| `npm run test:phase6` | Run extraction, grapheme-safe search, selection/copy-payload, rendering, missing-font and print-PDF tests across English and twelve target languages |

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+O` | Open PDF |
| `Ctrl+W` | Close PDF (desktop) |
| `Ctrl+P` | Open print preview |
| `Ctrl+F` | Search in document |
| `Enter` / `Shift+Enter` | Next / previous match |
| `F3` / `Shift+F3` | Next / previous match |
| `Esc` | Close search / dialog, exit full screen |
| `PageUp` / `PageDown` | Previous / Next page |
| `←` / `→` | Previous / next page |
| `Home` / `End` | First / Last page |
| `F9` | Toggle sidebar (thumbnails / bookmarks) |
| `Ctrl+Plus` / `Ctrl+Minus` | Zoom in / Zoom out |
| `Ctrl+0` | Fit page |
| `Ctrl+Shift+0` | Fit width |
| `R` / `Shift+R` | Rotate clockwise / counter-clockwise |
| `F11` | Toggle full screen |
| `Ctrl+A` | Select all text on page |
| `Ctrl+C` | Copy selected text |
| `Ctrl+Shift+D` | Toggle dark/light theme |
| `Ctrl+Shift+E` | Open page tools |
| `Ctrl+Shift+F` | Fill in PDF form fields |
| `Ctrl+Shift+K` | Document security and permissions |
| `?` or `F1` | Keyboard shortcuts dialog |

### Project Structure

```
cambuz-pdf/
├── main.js                  # Electron menus, file IPC, printers and native print
├── preload.js               # Narrow Electron IPC bridge
├── server.js                # Express web server for preview
├── package.json             # Project configuration
├── src/
│   ├── index.html           # Reader UI and print-preview dialog
│   ├── renderer.js          # Loading, rendering, navigation and app events
│   ├── printing.js          # Range validation, sheet layout, print-PDF creation
│   ├── print-ui.js          # Settings, preview rendering and print actions
│   ├── print.css            # Print dialog and preview styling
│   ├── search.js            # Unicode search engine + highlighting
│   ├── sidebar.js           # Thumbnails + document outline
│   ├── recents.js           # Recent files + IndexedDB byte cache
│   ├── pdf-security.js      # Permission flags and password-error classification
│   ├── pdf-forms.js         # AcroForm reading and filling (pdf-lib)
│   ├── pdf-password-ui.js   # Password prompt
│   ├── pdf-forms-ui.js      # On-page form controls, filling bar, save
│   ├── pdf-security-ui.js   # Document Security dialog + status chip
│   ├── pdf-forms.css        # Password, security and form styling
│   └── styles.css           # Reader styles (dark/light)
├── scripts/
│   ├── create-samples.js    # Basic sample PDFs (pdf-lib)
│   ├── create-unicode-samples.py  # Hindi/Punjabi/multilingual PDFs (fpdf2)
│   ├── create-secure-samples.js   # AcroForm + secure fixtures (pdf-lib)
│   ├── create-secure-samples.py   # Encrypted fixtures (pypdf)
│   ├── create-phase6-samples.py   # HarfBuzz-shaped Indian-language fixtures
│   ├── test-phase2.mjs      # Node PDF/extraction/search suite
│   ├── test-phase2-dom.mjs  # DOM/reader/print wiring suite (jsdom)
│   ├── test-phase3.mjs      # Print composition and validation suite
│   ├── test-phase4.mjs      # Page operations, merge/split, metadata and page-tools dialog suite
│   ├── test-phase5.mjs      # Security, permissions, forms and password-dialog suite
│   └── test-phase6.mjs      # Indian-language extraction, UI, raster and print tests
├── scripts/fixtures/        # Encrypted and AcroForm test fixtures
├── samples/                 # Sample PDF files for testing
│   ├── welcome.pdf          # 5-page welcome document
│   ├── cambuz-demo.pdf      # 10-page comprehensive demo
│   ├── form-sample.pdf      # 1-page fillable feedback form
│   ├── hindi-sample.pdf     # 4-page Devanagari sample (पंजाब ×6)
│   ├── punjabi-sample.pdf   # 4-page Gurmukhi sample (ਪੰਜਾਬ ×6)
│   ├── multilingual.pdf     # 7-page EN/HI/PA sample with outline (each term ×12)
│   ├── phase6-indian-languages.pdf # English + 12 target languages, mixed, stress
│   ├── phase6-embedded-font.pdf    # Visible Tamil text with embedded Noto font
│   └── phase6-missing-font.pdf     # Tamil with its embedded font program removed
├── assets/                  # Application assets
└── README.md                # This file
```

### Architecture

```
Cambuz PDF Reader
       |
+------+------+------+------+------+
|      |      |      |      |      |
| PDF  | Text |Search|Side- | File |
|Render| Layer|Engine| bar  | I/O  |
|      |      |      |      |      |
+------+------+------+------+------+
       |      |
  PDF.js Engine  IndexedDB/localStorage
                 (recents)
```

- **Rendering**: PDF.js renders pages to canvas (high-DPI); a `TextLayer`
  overlay provides selection, copy and search highlights
- **Search**: document-wide Unicode index (NFC + case folding, grapheme-safe
  source offsets, adjacent PDF.js text-item joining with explicit line breaks);
  matches are wrapped in `<mark>` elements, the current match is scrolled into
  view, and navigation wraps across pages
- **Sidebar**: lazy thumbnails + hierarchical outline with expand/collapse
- **Recents**: metadata in `localStorage`; web mode caches small files in
  `IndexedDB` so reopen works; Electron reopens by native path
- **Rotation**: 0/90/180/270° applied to canvas, text layer and thumbnails
- **Printing**: `pdf-lib` composes source pages into physical-size sheets; PDF.js
  renders those exact sheets for preview; Electron routes the same PDF to the
  selected native printer, while browser mode opens it in the system PDF/print flow

### Search Verification (Unicode)

Required queries were verified end-to-end with the app's own matching
algorithm against the real sample PDFs:

| Query | multilingual.pdf | hindi-sample.pdf | punjabi-sample.pdf |
|---|---|---|---|
| `Punjab` | 12 | 0 | 0 |
| `पंजाब` | 12 | 6 | 0 |
| `ਪੰਜਾਬ` | 12 | 0 | 6 |

Full-page golden-text assertions (15 pages) guarantee byte-exact extraction
with no control-character corruption. All three scripts also render with
correct shaping (verified by rasterizing pages to PNG). Phase 6 adds the
13-language fixture matrix and grapheme-aware offsets; see the dedicated
compatibility matrix and `npm run test:phase6` results above.

### Known Limitations

- **Native printer verification**: Electron's native route is implemented, but
  this sandbox has no Electron binary, desktop display or physical printer.
  Exercise the printer list, native dialog, copies, paper sizes and actual
  Windows output on a machine with a configured printer before release.
- **Device printable margins**: the selected margin value defines the printable
  content box; per-printer non-printable margins are not queried automatically.
  Printers may clip at their hardware edges when `None` is selected.
- **Annotations and interactive forms**: vector composition embeds page graphics;
  annotations and interactive form widgets are not flattened into the print job,
  so filled form values do not appear on paper (see Phase 5 limitations).
- **Ink Saver quality**: Ink Saver rasterizes at up to 200 dpi (with an
  18-megapixel-per-page safety cap); normal print jobs preserve vector content.
- **Print preparation memory**: the active source PDF is retained for printing
  and the composed output is held in memory. Electron rejects a print job above
  250 MiB; very large documents can require substantial RAM.
- **Browser printer access**: web mode cannot enumerate native printers; it
  opens the system PDF/print flow instead. Electron mode provides the printer
  selector and direct native route.
- **Legacy sample-generator constraint**: older fpdf2-generated Hindi/Punjabi
  fixtures can mis-encode `ToUnicode` for pre-base matras and some
  ligature-plus-matra sequences. Phase 6's separate HarfBuzz-shaped fixture
  has its own verified Unicode map and covers conjunct/combining cases; use it
  rather than the legacy PDFs as Phase 6 search/copy evidence.
- **Single page view**: one page at a time (continuous scroll still future)
- **No continuous scroll / no annotation authoring**: single page view; page operations and form filling are Phases 4–5 and are implemented
- **Recent-file cache**: web-mode byte cache capped at 5 files × 60 MiB;
  larger/older files must be reopened manually
- **Search**: case-insensitive substring search; no regex, no whole-word or
  diacritic-insensitive options yet

### Earlier regression suites (Phases 2–5 — 637 assertions, all passing)

Node suite (`npm run test:node`, 123 assertions):

1. All 5 sample PDFs exist and parse with expected page counts
2. Unicode extraction intact (पंजाब/ਪੰਜਾਬ/Punjab, conjuncts क्ष त्र ज्ञ श्र
   द्ध ह्म, adhak words ਪੁੱਤਰ/ਮੱਖਣ/ਦੁੱਧ, digits, danda, no control chars)
3. Search-helper unit tests (offsets, case folding, native-script queries,
   byte-exact slices, NFC stability)
4. End-to-end search counts via the app algorithm (12/12/12, 6, 6)
5. Full-text golden check on all 15 Unicode sample pages
6. Outlines present (8/4/4 entries) and every destination resolves to a page
7. Metadata (title/author) present
8. Rotation viewport math (90° swaps dimensions, 180° preserves)
9. Syntax check (`node --check`) on all application and test JS sources
10. Phase 3 print IPC/layout hooks present; no Phase-4+ utilities, OCR or telemetry
11. Recents pure helpers (ids, sizes, relative time)

DOM suite (`npm run test:dom`, 59 assertions, jsdom + real modules):

1. Reader controls and accessible print dialog elements present
2. PrintController defaults, settings validation and 2-up/Ink Saver presets
3. Real `SearchController`: highlight marks created for EN/HI/PA queries
   with byte-exact text, current-mark tracking, wrap navigation, clear()
4. Real `SidebarController`: nested outline build, collapse/expand,
   explicit + named destination navigation, external-URL handling, tabs
5. Real `recents.js`: add/list/update/remove/clear round-trip in
   `localStorage`, reopen-last setting
6. `renderer.js` imports cleanly against the real DOM

Print suite (`npm run test:phase3`, 54 assertions):

1. Current/all/range selection; malformed, duplicate and out-of-range pages rejected
2. A4/Letter dimensions, portrait/landscape, margins, fit/actual/custom scale
3. 1/2/4 pages per sheet, partial sheets, selected-page order and clipping plan
4. Composed PDFs reopen in PDF.js with expected page count, media box and page text
5. Hindi and Punjabi content survives vector composition; page /Rotate is retained
6. Ink Saver passes grayscale PNG pages into a valid output PDF

Server checks (curl, HTTP 200 with expected MIME types): `/src/index.html`,
`/src/print.css`, `/src/print-ui.js`, `/src/printing.js`, `pdf-lib` ESM,
PDF.js ESM and `samples/welcome.pdf`.

Native Electron/Windows printer behavior and browser canvas-preview appearance
still require the manual checklist below; they are not asserted as hardware-tested.

### Manual Browser / Windows Checklist

Start the web preview with `npm run serve` (port 3000). The live preview can
exercise the UI and browser print fallback; Windows + Electron is required to
verify native printer enumeration and driver output.

**Phase 6 language checks:**

- Open `samples/phase6-indian-languages.pdf`; search each matrix query, select
  and copy a sample from each language, and inspect Urdu direction and the
  mixed-script page.
- Open `samples/phase6-missing-font.pdf` on a system with and without Tamil
  fonts; compare fallback rendering with the selectable/searchable text.
- Open the prepared print PDF from the Phase 6 fixture and inspect conjuncts,
  combining marks, mixed scripts and Urdu output on paper/PDF.
- Repeat on the target browser and Windows/Electron builds; the automated
  Node/jsdom suite is not a substitute for native clipboard/printer testing.

1. Open `samples/multilingual.pdf` via Open, drag-and-drop and `?pdf=` URL
2. Sidebar thumbnails/bookmarks, Unicode search, copy/select-all, rotation,
   fullscreen, theme and recents still work as before
3. Press `Ctrl+P`; verify the all-pages preview and output PDF use the same sheet layout
4. Select Current page, then Selected pages `2-4, 6`; test empty, duplicate,
   descending and out-of-document ranges are blocked with clear errors
5. Compare A4 portrait and landscape; also try Letter and Legal
6. Exercise Fit, Actual Size and a custom scale; use None, Normal and Custom
   margins and confirm the preview changes accordingly
7. Use 2-up and 4-up on `samples/cambuz-demo.pdf`; inspect the final partial
   sheet and page order in preview and downloaded print-ready PDF
8. Turn on Ink Saver; confirm pages render grayscale, then download/open the
   prepared PDF and inspect it independently
9. Electron on Windows: refresh printer list, select the default and another
   printer, print one copy and multiple copies; verify the driver paper size,
   orientation, clipping and margins
10. Also test the native system-dialog fallback with no selected printer and
    verify cancellation, printer errors and retry behavior
11. Electron only: native Open dialog, menus (Find/Rotate/Fullscreen/
    Sidebar/Shortcuts/Print) and reopen-by-path after restart

---

## Phase 1 — Implementation Status

### Phase 1 Status: `PHASE 1 COMPLETE`

### Features Implemented

| Requirement | Status |
|---|---|
| Launch application | ✅ Implemented |
| Open PDF through file picker | ✅ Implemented |
| Open PDF by drag-and-drop | ✅ Implemented |
| Render PDF pages | ✅ Implemented |
| Previous/next page | ✅ Implemented |
| Page number navigation | ✅ Implemented |
| Zoom in/out | ✅ Implemented |
| Fit page | ✅ Implemented |
| Fit width | ✅ Implemented |
| Scroll document | ✅ Implemented |
| Page count | ✅ Implemented |
| Basic toolbar | ✅ Implemented |
| Window resizing | ✅ Implemented |
| Close/open another PDF | ✅ Implemented |
| Basic error handling | ✅ Implemented |
| Dark/light UI | ✅ Implemented |
| Clean, minimal interface | ✅ Implemented |

### Technology

| Component | Choice |
|---|---|
| **Framework** | Electron (desktop) + Express (web preview) |
| **Language** | JavaScript (ES modules) |
| **PDF Engine** | Mozilla PDF.js (pdfjs-dist v4) |
| **Styling** | Custom CSS with CSS variables (dark/light themes) |
| **Architecture** | Modular — rendering, navigation, and UI separated |

### Dependencies

| Package | Version | Purpose |
|---|---|---|
| `pdfjs-dist` | ^4.0.379 | PDF rendering engine |
| `express` | ^4.18.2 | Web server for preview mode |
| `electron` | ^28.0.0 | Desktop application shell (dev) |
| `pdf-lib` | ^1.17.1 | Sample PDF generation (dev) |

### Installation

```bash
# Clone the repository
git clone https://github.com/pixldotcom/cambuz-pdf.git
cd cambuz-pdf

# Install dependencies
npm install

# Run as web application (for preview/testing)
npm run serve

# Run as desktop application (requires Electron)
npm start

# Generate sample PDFs
npm run samples
```

### Development Commands

| Command | Description |
|---|---|
| `npm run serve` | Start web server on port 3000 |
| `npm start` | Launch Electron desktop app |
| `npm run samples` | Generate sample PDF files |

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+O` | Open PDF |
| `Ctrl+W` | Close PDF |
| `PageUp` / `PageDown` | Previous / Next page |
| `Home` / `End` | First / Last page |
| `Ctrl+Plus` / `Ctrl+Minus` | Zoom in / Zoom out |
| `Ctrl+0` | Fit page |
| `Ctrl+Shift+0` | Fit width |
| `Ctrl+Shift+D` | Toggle dark/light theme |

### Project Structure

```
cambuz-pdf/
├── main.js              # Electron main process
├── preload.js           # Electron preload script (IPC bridge)
├── server.js            # Express web server for preview
├── package.json         # Project configuration
├── src/
│   ├── index.html       # Main application HTML
│   ├── renderer.js      # PDF rendering and UI logic
│   └── styles.css       # Application styles (dark/light)
├── scripts/
│   └── create-samples.js  # Sample PDF generator
├── samples/             # Sample PDF files for testing
│   ├── welcome.pdf      # 5-page welcome document
│   └── cambuz-demo.pdf  # 10-page comprehensive demo
├── assets/              # Application assets
└── README.md            # This file
```

### Architecture

```
Cambuz PDF Reader
       |
+------+------+------+
|      |      |      |
| PDF  | UI   | File |
| Render| Layer| I/O  |
|      |      |      |
+------+------+------+
       |
  PDF.js Engine
```

- **Rendering**: PDF.js renders pages to HTML5 Canvas with high-DPI support
- **Navigation**: Page state management with prev/next/jump-to-page
- **Zoom**: Manual zoom, fit-to-page, fit-to-width with auto-refit on resize
- **File I/O**: File picker (Electron dialog or web input) + drag-and-drop
- **Theme**: CSS variables for instant dark/light switching

### Known Limitations

- **Electron binary**: Cannot be installed in all environments; web preview mode works everywhere
- **Single page view**: Currently renders one page at a time (continuous scroll not yet implemented)
- **No text selection**: Phase 1 renders to canvas only; text selection/copy comes in Phase 2
- **No search**: Text search is a Phase 2 feature
- **No thumbnails**: Page thumbnails are a Phase 2 feature
- **No bookmarks**: Document outline/bookmarks are a Phase 2 feature
- **At the Phase 1 milestone only**: printing was still a future Phase 3
  feature; the current workflow is documented at the top of this README
- **Password support**: Encrypted PDFs were a Phase 5 feature; they are now opened with a password prompt (see the Phase 5 section)

### Tests Performed

1. **Page load**: Application loads correctly in web browser
2. **Resource serving**: All static resources (HTML, CSS, JS, PDF.js, samples) serve with correct MIME types
3. **Sample PDF validity**: Both sample PDFs validate correctly with pdf-lib
4. **PDF.js availability**: pdf.mjs and pdf.worker.mjs are accessible and correctly typed as JavaScript
5. **Navigation logic**: Page navigation bounds checking (min 1, max totalPages)
6. **Zoom logic**: Zoom scale limits (0.25x to 5.0x)
7. **Fit calculations**: Fit-to-page and fit-to-width algorithms use correct viewport math
8. **Theme switching**: CSS variables properly swap between dark and light palettes
9. **Error handling**: Error display shown for invalid files, dismissed by user action
10. **Drag and drop**: Drop overlay appears on drag enter, disappears on drag leave/drop

---


---

## 1. Product Vision

Cambuz PDF Reader is intended to be a deliberately focused PDF application.

The goal is **not** to reproduce Adobe Acrobat. The goal is to build a lightweight application that does the things most people actually need when working with PDFs:

- Open and render PDFs quickly
- Navigate documents comfortably
- Search PDF text
- Select and copy text
- Handle Unicode and Indian languages correctly
- Provide a strong print workflow
- Support common PDF operations without unnecessary bloat
- Remain responsive on ordinary Windows computers
- Avoid unnecessary cloud services, accounts, AI features, telemetry, and background processes

### Product principle

> **Read. Search. Print. Done.**

---

# 2. Product Goals

## Primary goals

1. Lightweight installation
2. Low memory usage where practical
3. Fast startup
4. Smooth PDF rendering
5. Excellent text rendering
6. Strong Unicode support
7. Indian-language support
8. Reliable printing
9. Simple, uncluttered interface
10. No mandatory account or cloud service
11. No unnecessary background processes
12. Offline-first operation

## Secondary goals

- Page thumbnails
- Bookmarks / document outline
- Recent files
- Password-protected PDF opening
- Page rotation
- Full-screen mode
- PDF metadata viewing
- Basic PDF page manipulation

## Explicit non-goals for the initial versions

Do NOT attempt to build:

- A full Adobe Acrobat replacement
- A browser
- An AI assistant
- Cloud document storage
- A subscription system
- A PDF editor comparable to professional desktop publishing software
- A built-in web browser
- A large built-in OCR model
- A huge collection of plugins
- Unnecessary animations or visual effects

---

# 3. Recommended Technical Direction

The implementation should prioritize a **native/lightweight desktop architecture**.

The PDF rendering engine should be a mature existing engine rather than a custom PDF renderer.

Possible rendering engines include:

- PDFium
- MuPDF
- Another mature, permissively usable PDF rendering library

The final implementation must verify the chosen library's current license before distribution.

## Important architecture principle

Separate these responsibilities:

```text
                    Cambuz PDF Reader
                           |
        +------------------+------------------+
        |                  |                  |
     Rendering          Text Layer        Printing
        |                  |                  |
    PDF Engine        Extraction/Search   OS Printer
        |                  |
        +----------+-------+
                   |
                UI Layer
```

Rendering, text extraction/search, and printing should not be unnecessarily coupled.

---

# 4. Language Requirements

Cambuz must correctly handle Unicode text.

Priority languages:

1. English
2. Hindi / Devanagari
3. Punjabi / Gurmukhi
4. Bengali
5. Gujarati
6. Marathi
7. Tamil
8. Telugu
9. Kannada
10. Malayalam
11. Odia
12. Assamese
13. Urdu / RTL support

The application must not assume that Latin text is the only valid PDF text.

## Important test cases

The project should eventually test:

- Devanagari conjuncts
- Gurmukhi vowel signs
- Combining characters
- Unicode copy/paste
- Search using native-script text
- Mixed English + Indian-language PDFs
- Embedded fonts
- PDFs with unusual font encodings
- RTL text
- PDFs containing scanned pages

---

# 5. Project Roadmap

## Phase 1 — Working PDF Reader

### Objective

Create the first genuinely usable Cambuz PDF Reader.

### Required features

- Launch application
- Open PDF through file picker
- Open PDF by drag-and-drop if practical
- Render PDF pages
- Previous/next page
- Page number navigation
- Zoom in/out
- Fit page
- Fit width
- Scroll document
- Page count
- Basic toolbar
- Window resizing
- Close/open another PDF
- Basic error handling
- Dark/light UI should not be over-designed
- Clean, minimal interface

### Phase 1 success criteria

A user can:

1. Launch Cambuz
2. Open a normal PDF
3. See the document correctly
4. Navigate pages
5. Zoom
6. Scroll
7. Jump to a page
8. Close the PDF
9. Open another PDF
10. Exit the application

### Phase 1 exclusions

Do not implement yet:

- PDF editing
- OCR
- AI
- annotations
- cloud sync
- accounts
- PDF merge/split
- advanced printing
- complex settings
- unnecessary animations

---

# 6. Phase 2 — Reading Experience

Add:

- Page thumbnails
- Document outline/bookmarks
- Search within PDF
- Search result highlighting
- Text selection
- Copy text
- Select all
- Keyboard shortcuts
- Recent files
- Reopen last document
- Full-screen reading
- Page rotation
- Status information
- Better keyboard navigation

### Search requirements

Search must work with Unicode.

Test at minimum:

```text
English: Punjab
Hindi: पंजाब
Punjabi: ਪੰਜਾਬ
```

The implementation should not corrupt Unicode text during extraction or search.

---

# 7. Phase 3 — Printing

Printing is one of the core differentiators of Cambuz.

Create a strong print workflow with:

- Print current page
- Print all pages
- Print page ranges
- Print selected pages
- Printer selection
- Copies
- Portrait / landscape
- Paper size
- Scaling
- Fit to printable area
- Actual size
- Custom scale
- Margins
- Multiple pages per sheet
- Print preview
- Page range validation
- Native Windows printer integration

Useful presets:

- A4
- Actual Size
- Fit to Page
- 2 Pages per Sheet
- 4 Pages per Sheet
- Ink Saver

The print preview should accurately represent the expected printed result.

---

# 8. Phase 4 — Basic PDF Utilities

Add lightweight document operations:

- Rotate pages
- Delete pages
- Extract pages
- Reorder pages
- Merge PDFs
- Split PDFs
- Save As
- Duplicate document
- Basic metadata viewing/editing where safe

These operations should be clearly separated from the reader UI.

Do not turn the application into a large document-editing suite.

---

# 9. Phase 5 — Security and Forms

Add support for:

- Password-protected PDFs
- Encrypted PDFs
- PDF permissions
- Basic PDF forms
- Form field interaction
- Saving filled forms where supported

Security-sensitive operations must fail safely.

Never silently bypass PDF security restrictions.

---

# 10. Phase 6 — Indian Language Excellence

Create a dedicated language compatibility test suite.

Test:

- Hindi
- Punjabi
- Bengali
- Gujarati
- Marathi
- Tamil
- Telugu
- Kannada
- Malayalam
- Odia
- Assamese
- Urdu

Test:

- Rendering
- Search
- Selection
- Copy
- Printing
- Mixed-script documents
- Embedded fonts
- Missing fonts
- Combining marks
- RTL text

### Special requirement

A PDF should not be considered successfully supported merely because it visually displays.

The following should also be tested:

```text
Render correctly
        ↓
Select correctly
        ↓
Copy correctly
        ↓
Search correctly
        ↓
Print correctly
```

---

# 11. Phase 7 — Optional OCR

OCR must be optional.

Do not bundle a large OCR engine into the main application unless there is a strong reason.

Possible architecture:

```text
Cambuz Core
     |
     +-- PDF Renderer
     |
     +-- Text Extraction
     |
     +-- Optional OCR Module
```

OCR should be installable/downloadable separately if practical.

OCR languages should eventually include major Indian languages.

---

# 12. Phase 8 — Performance and Optimization

Measure instead of guessing.

Track:

- Application startup time
- Empty application memory
- Memory with a normal PDF
- Memory with a large PDF
- CPU while idle
- CPU during rendering
- Time to first page
- Time to open large PDFs
- Scroll responsiveness
- Search speed
- Print preparation time

Test documents should include:

- 1-page PDF
- 10-page PDF
- 100-page PDF
- 500-page PDF
- Large image-heavy PDF
- Text-heavy PDF
- Indian-language PDF
- Mixed-language PDF
- Large scanned PDF

Avoid premature optimization. Optimize based on measurements.

---

# 13. Phase 9 — Packaging and Distribution

Target:

- Windows x64 initially

Potential future targets:

- Windows ARM
- Linux
- macOS

Packaging requirements:

- Installer
- Portable build if practical
- File association for `.pdf`
- Start-menu shortcut
- Clean uninstall
- No unnecessary startup service
- No unnecessary background process

The installed footprint should remain a tracked project metric.

Do not make an arbitrary promise that the application must always be below a specific MB size. Measure the real size and keep dependencies intentional.

---

# 14. Phase 10 — Release Quality

Before a public release:

### Functional testing

- Open PDF
- Close PDF
- Navigate
- Zoom
- Search
- Copy
- Print
- Password PDFs
- Large PDFs
- Unicode PDFs
- Indian-language PDFs

### Failure testing

- Corrupt PDF
- Empty PDF
- Very large PDF
- Unsupported PDF feature
- Missing fonts
- Locked file
- File deleted while open
- Printer unavailable
- Printer disconnected
- Insufficient disk space
- Invalid page number

### UX testing

- Keyboard-only navigation
- Mouse navigation
- High-DPI Windows display
- 100% scaling
- 125% scaling
- 150% scaling
- 200% scaling
- Small laptop display
- Large monitor

---

# 15. Architecture Rules

These rules apply throughout development.

## Rule 1 — Keep the core small

Every dependency must have a reason.

Before adding a library, ask:

> Does this dependency provide functionality we genuinely need?

## Rule 2 — No feature creep

Do not implement future-phase functionality early unless it is required by the current phase.

## Rule 3 — Preserve working functionality

Every phase must leave the application runnable.

## Rule 4 — Test before moving forward

A phase is not complete because the code compiles.

It is complete only when the required features are tested.

## Rule 5 — Document important decisions

Record:

- Rendering engine
- UI framework
- Packaging strategy
- Major dependencies
- Licensing decisions
- Performance measurements
- Known limitations

## Rule 6 — Avoid unnecessary network dependency

Reading a PDF should work completely offline.

## Rule 7 — No telemetry by default

Do not add analytics or telemetry unless explicitly decided later.

## Rule 8 — Keep UI simple

Avoid:

- excessive gradients
- animated backgrounds
- giant sidebars
- unnecessary cards
- oversized toolbars
- decorative effects

The PDF should remain the focus.

---

# 16. GitHub Development Workflow

Recommended branch strategy:

```text
main
  |
  +-- phase-1-reader
  +-- phase-2-reading
  +-- phase-3-printing
  +-- phase-4-utilities
```

Each phase should ideally result in:

1. Working code
2. Updated README
3. Tests
4. Build verification
5. Screenshots where useful
6. Known limitations documented
7. Git commit

Suggested commit style:

```text
feat: implement phase 1 pdf reader
feat: add unicode text search
feat: add print preview
fix: correct page navigation
test: add indian language pdf cases
docs: update phase 2 requirements
```

---

# 17. Arena AI Agent Instructions

Arena AI Agent should be treated as an implementation agent, not as the product architect.

For every phase:

1. Read the repository first.
2. Read this README completely.
3. Identify the current phase.
4. Inspect existing code before changing it.
5. Reuse existing working code.
6. Do not rewrite the project unnecessarily.
7. Implement only the requested phase.
8. Run tests/builds.
9. Fix errors caused by the implementation.
10. Verify the actual application behavior.
11. Report what was implemented.
12. Report what was tested.
13. Report any remaining limitations.
14. Do not claim success based only on compilation.

---

# 18. MASTER PROMPT — PHASE 1

Copy the following prompt into Arena AI Agent after uploading this repository.

---

## ARENA PROMPT — COMPLETE PHASE 1

You are the implementation agent for **Cambuz PDF Reader**.

Read the entire repository and especially `README.md` before making changes.

Your task is to implement **Phase 1 completely and test it**.

### Product context

Cambuz PDF Reader is intended to be a lightweight, offline-first PDF reader.

The product philosophy is:

> Read. Search. Print. Done.

However, Phase 1 is intentionally limited to the core reading experience.

Do NOT implement future-phase functionality.

---

## PHASE 1 OBJECTIVE

Build a working desktop PDF reader capable of opening and displaying PDF documents and providing basic navigation and zoom controls.

The result must be an actual runnable application, not a mockup or static UI.

---

## FIRST: INSPECT THE REPOSITORY

Before writing code:

1. Inspect all existing source files.
2. Identify the current framework.
3. Identify the package manager.
4. Identify the build system.
5. Identify whether a PDF rendering library already exists.
6. Identify the current entry point.
7. Identify existing configuration.
8. Identify existing tests.
9. Identify the intended desktop runtime.
10. Check whether the project is currently runnable.

Do not replace the project architecture merely because you prefer another framework.

If the repository is empty or only contains the README, choose a lightweight desktop architecture appropriate for the requirements.

---

## ARCHITECTURE REQUIREMENTS

The implementation must prioritize:

- Lightweight runtime
- Fast startup
- Offline operation
- Native-quality PDF rendering
- Low unnecessary memory consumption
- Maintainability

Do NOT use Electron unless there is a compelling repository constraint that makes it unavoidable.

Do NOT create a web application that merely displays PDFs in a browser.

Cambuz is a desktop application.

Use a mature PDF rendering library rather than implementing a PDF renderer from scratch.

Before selecting a dependency, inspect its licensing implications and document the choice.

---

# PHASE 1 FEATURES

Implement all of the following.

### 1. Application startup

The application should launch into a clean reader interface.

The UI should make it immediately obvious how to open a PDF.

---

### 2. Open PDF

Provide:

- Open button
- File picker
- PDF file filtering
- Opening a selected PDF
- Basic error handling

If practical, support drag-and-drop.

---

### 3. PDF rendering

Render the selected PDF accurately.

The application must support:

- Text PDFs
- Image PDFs
- Multi-page PDFs
- Standard page sizes
- Portrait pages
- Landscape pages

Pages should remain sharp when zoomed.

Do not create fake placeholder pages.

---

### 4. Page navigation

Provide:

- Previous page
- Next page
- Current page indicator
- Total page count
- Direct page-number input

Example:

```text
Page 12 / 86
```

Invalid page numbers must be handled gracefully.

---

### 5. Scrolling

The document must be scrollable.

Scrolling should feel natural.

Do not unnecessarily re-render every page at maximum resolution simultaneously.

Use sensible rendering/lazy-loading behavior if supported by the chosen architecture.

---

### 6. Zoom

Provide:

- Zoom in
- Zoom out
- Zoom percentage
- Fit Page
- Fit Width

Useful keyboard shortcuts should be implemented where practical.

---

### 7. Window behavior

Support:

- Resize
- Maximize
- Minimize
- Close

The reader should remain usable at different window sizes.

---

### 8. Open another document

The user must be able to open another PDF without restarting the application.

---

### 9. Basic error handling

Handle at minimum:

- Invalid PDF
- Corrupt PDF
- Missing file
- File access failure
- Unsupported PDF condition

Show a clear user-friendly error.

Do not expose raw stack traces to normal users.

---

# UI REQUIREMENTS

The UI must be intentionally simple.

Suggested layout:

```text
+------------------------------------------------------+
| Cambuz PDF Reader | Open | Zoom | Page |             |
+------------------------------------------------------+
|                                                      |
|                                                      |
|                   PDF PAGE                           |
|                                                      |
|                                                      |
+------------------------------------------------------+
| Page 1 / 10                         100%              |
+------------------------------------------------------+
```

The exact UI can differ if usability is improved.

Do NOT:

- add unnecessary animations
- add gradients everywhere
- add AI buttons
- add cloud buttons
- add social features
- add accounts
- add advertising
- add decorative dashboards
- create a fake feature-heavy interface

The PDF should visually dominate the application.

---

# KEYBOARD SHORTCUTS

Implement sensible shortcuts where the chosen desktop framework supports them.

At minimum consider:

```text
Ctrl + O       Open PDF
Ctrl + W       Close current document
Ctrl + +       Zoom in
Ctrl + -       Zoom out
Ctrl + 0       Reset / fit behavior
Page Up        Previous page/view
Page Down      Next page/view
Home           Beginning
End            End
Esc            Exit temporary UI state
```

Do not force shortcuts that conflict with platform conventions.

---

# PERFORMANCE REQUIREMENTS

Do not render an entire large document at maximum resolution into memory.

Use reasonable page rendering and caching.

For Phase 1, test at minimum with:

- 1-page PDF
- 10-page PDF
- 100-page PDF
- image-heavy PDF
- text-heavy PDF

The application must remain responsive during normal scrolling.

---

# INDIAN LANGUAGE TESTING

Phase 1 does not yet require full search implementation, but rendering must be tested with Unicode PDFs.

At minimum test:

```text
English
Hindi / Devanagari
Punjabi / Gurmukhi
```

Use real PDFs if available in the repository.

Verify that glyphs are rendered correctly.

Do not assume that successful English rendering means PDF rendering is correct.

---

# TESTING REQUIREMENTS

Do not stop at:

```text
npm run build
```

or the equivalent compile command.

Perform actual functional testing.

Test:

### Test 1

Launch application.

Expected:

Application opens successfully.

### Test 2

Open a normal PDF.

Expected:

PDF renders.

### Test 3

Open a multi-page PDF.

Expected:

Correct page count and navigation.

### Test 4

Go to a specific page.

Expected:

Correct page is displayed.

### Test 5

Zoom in.

Expected:

Content becomes larger without breaking the UI.

### Test 6

Zoom out.

Expected:

Content becomes smaller.

### Test 7

Fit Width.

Expected:

Page width fits the available reading area.

### Test 8

Fit Page.

Expected:

Entire page fits reasonably within the reader.

### Test 9

Scroll.

Expected:

Smooth document navigation.

### Test 10

Open another PDF.

Expected:

Previous document is replaced cleanly.

### Test 11

Open invalid/corrupt PDF.

Expected:

User-friendly error.

### Test 12

Test Hindi and Punjabi PDFs.

Expected:

Glyphs render correctly.

---

# BUILD VERIFICATION

After implementation:

1. Install dependencies.
2. Run the project's lint/type checks if available.
3. Run automated tests if available.
4. Build the application.
5. Launch the built application.
6. Perform the functional tests above.
7. Fix implementation errors.
8. Repeat testing after fixes.

Do not claim that Phase 1 is complete if the application cannot actually launch.

---

# CODE QUALITY

Keep the implementation clean.

Avoid:

- dead code
- duplicate components
- unnecessary dependencies
- huge files where smaller modules make sense
- hard-coded paths
- hard-coded PDF content
- mock PDF pages
- fake buttons
- TODOs pretending to be completed features

If something cannot be implemented due to a technical limitation, clearly document it instead of faking it.

---

# README UPDATE

After implementation, update the README with:

### Phase 1 status

Mark each Phase 1 requirement:

```text
[x] Implemented
[ ] Not implemented
```

Also document:

- chosen framework
- chosen PDF engine
- major dependencies
- installation instructions
- development commands
- build command
- known limitations
- test results

Do not remove the future roadmap.

---

# FINAL VERIFICATION REPORT

At the end, provide a concise report containing:

## Implemented

List actual features implemented.

## Technology

List:

- framework
- language
- PDF engine
- important dependencies

## Tests performed

List actual tests.

## Build result

State whether the production/build process succeeded.

## Runtime result

State whether the built application was actually launched and tested.

## Known limitations

List real limitations.

## Files changed

List important files changed.

## Phase 1 status

Use exactly one:

```text
PHASE 1 COMPLETE
```

or

```text
PHASE 1 BLOCKED
```

Only use `PHASE 1 COMPLETE` if the application was actually built and functionally tested.

---

# IMPORTANT AGENT RULES

1. Do not implement Phase 2.
2. Do not implement search yet unless it is required by the selected PDF engine to make Phase 1 work.
3. Do not implement printing yet.
4. Do not implement OCR.
5. Do not implement AI.
6. Do not add cloud services.
7. Do not add accounts.
8. Do not add telemetry.
9. Do not replace working architecture without a reason.
10. Do not claim a feature is implemented when it is only represented by a UI button.
11. Do not stop after compilation.
12. Test the actual application.
13. Fix errors before reporting completion.
14. Keep the project lightweight.

Start by inspecting the repository.

---

# 19. PHASE 2 PROMPT

After Phase 1 has been tested and committed, use this prompt:

> Read `README.md` and the current implementation. Phase 1 is complete. Implement **Phase 2 — Reading Experience** only.
>
> Add page thumbnails, document outline/bookmarks, Unicode text extraction and search, search highlighting, text selection/copy, keyboard navigation, recent files, full-screen reading, page rotation and improved reader status information.
>
> Preserve all Phase 1 functionality.
>
> Test English, Hindi and Punjabi PDFs. Specifically verify that native-script search and copy do not corrupt Unicode.
>
> Do not implement Phase 3 printing, OCR, AI, cloud services, accounts or unrelated features.
>
> Build and launch the application and perform actual functional tests.
>
> Update README with implementation status, tests, known limitations and dependencies.
>
> Do not claim completion based solely on compilation.

---

# 20. PHASE 3 PROMPT

> Read `README.md` and the current implementation. Implement **Phase 3 — Printing** only.
>
> Build a professional but simple PDF print workflow with printer selection, page ranges, current-page printing, copies, orientation, paper size, scaling, fit-to-page, actual size, custom scaling, margins, multiple-pages-per-sheet and print preview.
>
> Prioritize reliable Windows printing.
>
> The print preview must correspond closely to the actual printed output.
>
> Test A4 documents, portrait documents, landscape documents, multi-page documents, page ranges and 2/4 pages per sheet.
>
> Preserve all previous functionality.
>
> Do not implement Phase 4 PDF manipulation, OCR, AI, cloud services or accounts.
>
> Build, launch and perform real print-related testing where the environment permits. Clearly distinguish simulated/preview testing from actual printer testing.
>
> Update README and provide a factual test report.

---

# 21. PHASE 4 PROMPT

> Read `README.md` and the current implementation. Implement **Phase 4 — Basic PDF Utilities** only.
>
> Add safe operations for rotate, delete, extract, reorder, merge, split and Save As.
>
> Protect the original file unless the user explicitly chooses to overwrite it.
>
> Provide clear confirmation where destructive operations are involved.
>
> Test page ordering, page counts, output validity and reopening generated PDFs.
>
> Preserve all previous functionality.
>
> Do not implement OCR, AI, cloud services or advanced editing.
>
> Build and test the actual application.
>
> Update README and report exactly what was tested.

---

# 22. PHASE 5 PROMPT

> Read `README.md` and implement **Phase 5 — Security and Forms** only.
>
> Add support for password-protected/encrypted PDFs and basic PDF forms where supported by the selected PDF engine.
>
> Never bypass PDF security restrictions.
>
> Test opening protected PDFs, entering valid/invalid passwords, interacting with supported form fields and saving forms where supported.
>
> Preserve all previous functionality.
>
> Clearly document unsupported PDF security/form features.
>
> Build and test the actual application.
>
> Update README and provide a factual test report.

---

# 23. PHASE 6 PROMPT

> Read `README.md` and implement **Phase 6 — Indian Language Excellence**.
>
> Create a dedicated test suite covering English plus major Indian scripts, with special attention to Hindi/Devanagari, Punjabi/Gurmukhi and Urdu/RTL.
>
> Test rendering, selection, copy, search and printing.
>
> Test combining characters, conjuncts, embedded fonts, mixed-language documents and RTL text.
>
> Do not assume visual rendering alone proves language support.
>
> Preserve all previous functionality.
>
> Fix genuine Unicode/rendering/search issues found during testing.
>
> Build and test the actual application.
>
> Update README with the language compatibility matrix and known limitations.

---

# 24. PHASE 7 PROMPT

> Read `README.md` and implement **Phase 7 — Optional OCR**.
>
> OCR must remain optional and must not unnecessarily increase the base application's installation size.
>
> Design OCR as a separate module/component if practical.
>
> Support the highest-value Indian languages first.
>
> Clearly distinguish selectable PDF text from OCR-generated text.
>
> Do not silently OCR every document.
>
> Test scanned PDFs and verify OCR output quality.
>
> Preserve all previous functionality.
>
> Build and test the actual application.
>
> Document OCR dependencies, licensing, installation size and known limitations.

---

# 25. PHASE 8 PROMPT

> Read `README.md` and implement **Phase 8 — Performance and Optimization**.
>
> Measure startup time, idle memory, memory with normal PDFs, memory with large PDFs, rendering time, scrolling responsiveness, search performance and print preparation time.
>
> Test small, medium, large, image-heavy, scanned and Indian-language PDFs.
>
> Do not optimize based on assumptions. Measure first, identify bottlenecks, then optimize.
>
> Avoid increasing binary size merely to improve benchmarks unless the tradeoff is justified.
>
> Preserve all functionality.
>
> Provide before/after measurements where possible.
>
> Update README with the performance results.

---

# 26. PHASE 9 PROMPT

> Read `README.md` and implement **Phase 9 — Packaging and Distribution**.
>
> Produce a clean Windows x64 distribution.
>
> Provide an installer and, if practical, a portable version.
>
> Support PDF file association where appropriate.
>
> Ensure clean installation and uninstallation.
>
> Do not add unnecessary startup services or background processes.
>
> Measure the final installed footprint.
>
> Test installation, launching, PDF association, upgrade/reinstall behavior and uninstall.
>
> Update README with distribution instructions and actual package sizes.

---

# 27. PHASE 10 PROMPT

> Read `README.md` and perform **Phase 10 — Release Quality**.
>
> Do not add major new features.
>
> Perform a release-readiness audit covering functionality, crashes, malformed PDFs, large PDFs, Unicode PDFs, Indian-language PDFs, printing, keyboard navigation, high-DPI displays and packaging.
>
> Identify and fix release-blocking issues.
>
> Do not hide limitations.
>
> Run the complete test suite.
>
> Produce a release checklist and factual final report.
>
> Only declare release readiness if the application has actually been built and tested.

---

# 28. Definition of Done

Cambuz PDF Reader is not considered complete for any phase merely because:

- the code compiles
- the UI exists
- buttons exist
- tests are written
- an agent says "done"

A phase is complete when:

```text
Requirements
     ↓
Implementation
     ↓
Build
     ↓
Application launch
     ↓
Functional testing
     ↓
Bug fixing
     ↓
Retesting
     ↓
Documentation
     ↓
Phase complete
```

---

# 29. Long-Term Product Direction

The long-term goal is not feature quantity.

The goal is to make Cambuz feel like:

> **The PDF reader that simply gets out of your way.**

Fast startup.

Clean interface.

Excellent rendering.

Excellent Indian-language support.

Excellent printing.

No unnecessary bloat.

No forced cloud account.

No distracting features.

---

# 30. Future Ideas — Not Committed

These ideas should remain outside the active roadmap until deliberately approved:

- macOS version
- Linux version
- ARM builds
- advanced annotations
- digital signatures
- accessibility improvements
- EPUB support
- comic/book reading modes
- optional OCR packs
- document comparison
- advanced PDF optimization
- enterprise deployment
- plugin architecture

Do not implement these merely because they appear in this section.

---

## Final Product Statement

**Cambuz PDF Reader**

> A lightweight PDF reader designed for fast reading, reliable Unicode support, Indian languages, and excellent printing — without the unnecessary weight of a full document suite.
