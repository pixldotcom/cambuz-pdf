# Cambuz PDF Reader

> **A lightweight, fast PDF reader focused on reading, searching, Indian-language support, and high-quality printing — without the bloat of large PDF suites.**

**Project status:** Phase 7 — optional, local OCR UI/IPC and raster-only language fixtures implemented. OCR needs a separately installed Tesseract 4+ engine and language data; this sandbox has no native Tesseract/Electron runtime, so desktop CLI integration remains pending a Windows check.<br>
**Product name:** Cambuz PDF Reader  
**Primary target:** Windows desktop  
**Repository:** GitHub  
**Development approach:** Phase-by-phase, testable milestones

---

## Desktop packaging — Windows x64 build (Phase 9 groundwork)

### Packaging status: `WINDOWS X64 INSTALLER AND PORTABLE BUILT AND SMOKE-TESTED IN CI; LINUX AND macOS EXPERIMENTAL; UNSIGNED; NOT RELEASED`

Packaging was audited before Phase 8. The work added electron-builder configuration,
a staging script, a package contents checker, a runtime smoke test and a CI
workflow. A follow-up fix changed runtime code for the sample buttons and for
text selection (see *Sample buttons and text selection* below). Phase 8 has not
started.

| Target | Command | Output in `dist/` | Verified in CI (`Desktop builds`) |
| --- | --- | --- | --- |
| Windows x64 | `npm run build:win` | `Cambuz-PDF-Reader-1.1.0-win-x64-setup.exe` (NSIS installer); `Cambuz-PDF-Reader-1.1.0-win-x64-portable.exe` (single file); `win-unpacked/Cambuz PDF Reader.exe` | Built; silent install, smoke test of the installed app, and silent uninstall passed; smoke tests of the unpacked and portable builds passed |
| Linux x64 | `npm run build:linux` | `Cambuz-PDF-Reader-1.1.0-linux-x86_64.AppImage`; `linux-unpacked/cambuz-pdf-reader` | Built; smoke test of the unpacked build under Xvfb passed (with `--no-sandbox`); the AppImage itself was not launched |
| macOS arm64 | `npm run build:mac` | `Cambuz-PDF-Reader-1.1.0-mac-arm64.dmg`; `Cambuz-PDF-Reader-1.1.0-mac-arm64.zip` | Built and contents verified; not launched; unsigned and not notarized |

Measured sizes and digests are listed under *Measured sizes* below. The renderer
payload (`app.asar`) is 19.1 MiB; most of each installer is Electron's own runtime.

Artifact formats: Windows NSIS installer (per-user by default, can change the install
folder, Start-menu shortcut, uninstaller) and a portable executable
that extracts itself at launch; Linux AppImage; macOS DMG and ZIP containing an
unsigned `.app`. Each job uploads `SHA256SUMS.txt` next to the files.

#### Building locally

```bash
npm ci              # downloads the Electron runtime for your OS
npm run build:win   # or build:linux / build:mac on the matching OS
```

Packaging needs the Electron runtime download, which restricted networks may
block; `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci` is enough for the tests but not
for packaging. Always build through the `build:*` scripts. They run
`scripts/stage-app.mjs` first (see *How the package is built*).

Checks that can be run on a build:

```bash
node scripts/check-packaged-app.mjs dist/win-unpacked/resources/app.asar
npm run test:packaged -- --app "dist/win-unpacked/Cambuz PDF Reader.exe" --out smoke-test-output
```

`check-packaged-app.mjs` reads the asar header and fails if a required renderer
file is missing or if development-only payloads (tests, scripts, the Electron
toolchain, the Node-only `@napi-rs/canvas` binding, source maps, PDF.js legacy
and viewer builds) were packaged. `test:packaged` starts the executable with
Chromium's remote-debugging port and drives the real window over the DevTools
protocol. It checks the title and the preload bridge; both welcome-screen sample
buttons; a drop-open of `samples/cambuz-demo.pdf`; the canvas, the text layer, its
alignment with the page and what the pointer hits; real mouse selection and
Ctrl+C (with the Windows clipboard on Windows); Hindi and Punjabi selection and
copy; and the refusal for a document that denies copying. It writes a screenshot,
the app log and a JSON report. Mouse and keyboard input go through the DevTools
Input domain, the same path a user's input takes. The test cannot see the native
right-click menu, so that still needs a manual check.

`npm test` also covers the bundled-sample list, the right-click menu template, the
page status text, and the main-process and preload code, which it loads against a
stand-in for the `electron` module.

#### How the package is built

- `scripts/stage-app.mjs` copies only the runtime files (`main.js`, `preload.js`,
  `src/`, two sample PDFs) to `.build-app/` and installs production dependencies
  from the lockfile with `--omit=dev --omit=optional --ignore-scripts`. It then
  removes the PDF.js legacy, viewer and typings folders and all source maps. The
  result is about 21 MiB on disk before compression.
- electron-builder packages `.build-app/` (`directories.app`), not the project
  root. This matters: during an early build that packaged the project root,
  electron-builder rewrote the project's own `package.json` and removed its
  `scripts`, `devDependencies` and `build` sections; later builds then silently
  used default settings. Packaging the staged copy keeps the project file
  untouched. Check `git status` after any packaging run.
- `@napi-rs/canvas` is pulled in by `pdfjs-dist` as an optional dependency. It is
  a Node-only native binding (roughly 37 MiB unpacked for win32 x64), and the
  renderer never loads it, so the staged build leaves it out.
- `productName` is `Cambuz PDF Reader` both in `build` and in `package.json`, so
  the packaged app and `npm start` use the same name. Consequence: the
  per-user data folder for `npm start` is now `Cambuz PDF Reader`, not
  `cambuz-pdf`, and recent-file entries from earlier development runs do not
  carry over.

#### Continuous integration

`.github/workflows/desktop-build.yml` runs on pushes and pull requests that change
files other than Markdown:

- `test` (Ubuntu): `npm test` — the regression suites must pass first.
- `windows-x64` (gating, Windows Server): build; verify packaged contents; write
  `SHA256SUMS.txt`; upload `cambuz-pdf-windows-x64` *before* any runtime check;
  smoke-test the unpacked build; install the NSIS installer silently into a temp
  folder, smoke-test the installed app, uninstall silently and confirm removal;
  smoke-test the portable executable; upload `smoke-test-evidence-windows-x64`.
- `linux-x64` (experimental, `continue-on-error`): AppImage build; verify
  contents; checksums; upload; smoke test of the unpacked build under Xvfb.
- `macos-arm64` (experimental): DMG and ZIP build; verify contents; checksums;
  upload. No runtime test yet.

Each smoke run publishes one summary annotation that lists every check, and a
separate annotation for each failing check. The run's step summary holds the same
table, so results can be read without downloading the evidence.
Builds are unsigned: `CSC_IDENTITY_AUTO_DISCOVERY=false` stops electron-builder
from searching for a signing identity.

#### Sample buttons and text selection (follow-up to the first Windows test)

**Sample buttons.** Both buttons requested `/samples/…` with `fetch()`. Packaged
builds load the page from `file://`, where that path resolves to the file-system
root, so the request failed (`ERR_FILE_NOT_FOUND` in CI). The Electron build now
asks the main process for the bundled sample over a `read-sample` channel. That
channel accepts only the names on the bundled-sample list
(`src/bundled-samples.cjs`), which the staging script and the packaged-contents
check also use. The browser preview still fetches the sample, relative to the
renderer module (`../samples/…`), so the path does not depend on the server's root.

**Text selection.** The PDF.js 4.10 text-layer code, the stacking, the CSS, the
event handlers and the copy path were checked. Findings:

| Area | Finding |
| --- | --- |
| PDF.js text layer | Spans are placed as percentages of the page size, and the layer is sized from `--scale-factor`, which the renderer sets. Layer setup is correct. |
| Stacking and canvas | The text layer (z-index 2) sits above the canvas (z-index 1) and is what the pointer hits. |
| CSS | `html, body` set `user-select: none` and `.textLayer` sets `user-select: text`. Selection works with that combination. |
| Event handlers | No global mouse, selection or copy handler blocks input. Ctrl+C is not intercepted, and Ctrl+A selects the page text. |
| Copy permission | **The only code path that disables selection.** When a PDF's permissions deny copying (Phase 5), the text layer gets `no-copy`, which applies `user-select: none`. Before this change the only cue was a small lock chip in the status bar. |
| Scanned pages | A page with no text layer has nothing to select. OCR is a separate optional feature and its result is not added to the text layer. |

What was verified:

- Ordinary text PDFs (the English, Hindi, Punjabi, Tamil and multilingual samples): a real
  mouse drag selects multi-line text, Ctrl+C fires the copy event with that text,
  and the Hindi and Punjabi selections are Unicode. Checked in headless Chromium
  119, 121 and 153, and on a `file://` page.
- Alignment: the layer matches the canvas size and position, and spans sit over
  painted glyphs, at 100%, 125% and 150% scale.
- Packaged builds, through the smoke test: both sample buttons and the form sample
  fields, selection, Ctrl+C, the Windows clipboard, Hindi and Punjabi copy, and the
  copy-denied refusal. Checked on the Windows installed, unpacked and portable
  builds and on the Linux unpacked build under Xvfb.

The status bar now says why a page cannot be selected: *copying not allowed by this
document*, or *no selectable text on this page (scanned image?)*. Right-click on a
page offers Copy and Select All Text on Page. In a text field it offers the
standard editing commands.

#### Known limitations and blockers before a public release

1. **Electron 28.3.3 is end-of-life.** Electron supports only its three latest
   stable major versions ([endoflife.date](https://endoflife.date/electron)). The
   npm registry lists 44.7.0 as the current release. This is the largest release
   risk: the shipped runtime (Chromium 120) no longer receives security fixes.
   Moving to a supported major changes APIs and needs a full regression pass
   (printing, dialogs, menus, file handling). It was not attempted here.
2. **Unsigned builds.** Windows SmartScreen may warn about the installer, and
   macOS Gatekeeper will not open an unsigned, un-notarized download without a
   manual override. A code-signing certificate (Windows) and a Developer ID
   signature with notarization (macOS) are needed for distribution. No
   certificates or secrets were available.
3. **Copying can be turned off by the PDF itself.** When a document's permissions
   deny copying, Cambuz keeps that restriction (Phase 5). Its text then cannot be
   selected or copied, and the status bar says so. Whether Cambuz should honour
   that flag at all is a product decision that has not been made. The options are
   to keep the restriction, or to ignore it.
   Scanned pages have no text layer, so they cannot be selected either.
   OCR results are shown in a separate box and are not added to the text layer.
4. **No PDF file association and no open-with handling.** `main.js` does not read
   `process.argv`, and there is no `second-instance` or `open-file` handling, so
   launching the app with a PDF path would not open it. Phase 9's `.pdf`
   association should wait until that is implemented.
5. **No application icon.** `main.js` points at `assets/icon.png`, which does not
   exist, and there is no `.ico` or `.icns`; builds use Electron's default icon.
6. **No LICENSE file.** `package.json` declares MIT, but the repository has no
   license text. The packaged app contains third-party code (Electron, PDF.js,
   pdf-lib and their dependencies); their notices must ship with it. Electron's
   license text is already copied into each Windows install folder.
7. **Unused runtime dependency.** `express` is listed under `dependencies` but is
   only used by the `npm run serve` preview. It is packaged (a small share of the
   app payload). Moving it to `devDependencies` is a Phase 9 cleanup.
8. **Identifiers still to confirm:** the application ID `com.cambuz.pdfreader`
   and the publisher name. The ID is permanent once users install the app.
9. **Linux sandbox.** The CI smoke test passes `--no-sandbox`, because
   unprivileged user namespaces are restricted on the runner. An AppImage on a
   desktop distribution with the same restriction may need the same flag or an
   AppArmor profile; that was not tested.
10. **macOS** is arm64-only, its menu template has no macOS application menu
    (no `appMenu` role), and the build was never launched.

#### Measured sizes

From the green `Desktop builds` run for commit `bf2b525` (the `Build output`
annotations of each job):

| File | Size | SHA-256 |
| --- | --- | --- |
| `Cambuz-PDF-Reader-1.1.0-win-x64-setup.exe` | 81.6 MiB | `ae6c4a3aeb41110a3a5f5301c4e03a05b259fcc75e7986f5541b49c635dd01e3` |
| `Cambuz-PDF-Reader-1.1.0-win-x64-portable.exe` | 81.4 MiB | `f83c26a4d77a0370fa7d8ff55518427bc66bec90fa67a5ad8bf27da08c66d385` |
| `Cambuz-PDF-Reader-1.1.0-linux-x86_64.AppImage` | 105.5 MiB | `0eaffacbe14dbefdf277e38963ae50a6829c247f9b66380c79dfae9608050f77` |
| `Cambuz-PDF-Reader-1.1.0-mac-arm64.dmg` | 96.6 MiB | `07b79c8bc0c1edcd8e36af3a6c0c86609d0eba9b059733a9be43d364cb2b102b` |
| `Cambuz-PDF-Reader-1.1.0-mac-arm64.zip` | 93.3 MiB | `4dd8a8f302345877de552e1ffbaf36e5d814a15055ac318a12fc367b8f990bc0` |
| `app.asar` inside the Windows build (renderer payload) | 19.1 MiB | - |

Digests identify one build, not one commit. The AppImage digest changed between
runs `0341f52` and `bf2b525` although the packaging inputs were identical (only a
comment in `scripts/stage-app.mjs` changed), so builds are not reproducible
bit-for-bit. Verify a download against the `SHA256SUMS.txt` in the same run's
artifact.

---

## Phase 7 — Optional OCR

### Phase 7 status: `OPTIONAL LOCAL OCR IMPLEMENTED; NATIVE DESKTOP CHECK PENDING`

OCR is an explicit, optional action for the **current page**. The reader never
starts OCR automatically. In the desktop app, the OCR dialog checks for a local
Tesseract 4+ command and the language data installed on the machine; a user must
choose one to three installed languages and press **Recognize current page**.
The page is rasterized locally (up to 300 dpi, bounded at 8,000 pixels per side
and 16 megapixels) and passed to the local `tesseract` executable through a
restricted Electron IPC bridge. The image is limited to 20 MiB and an OCR
operation is stopped after two minutes.

Recognized text is displayed in a separate selectable OCR result box, labelled
with page, language and engine version. It is **not embedded in the source PDF,
not merged into PDF.js's native text layer, and not included in normal document
search or printing**. Users can select/copy the OCR result from its box. OCR is
unavailable when document permissions deny copying, matching the existing
Phase 5 restriction. Results are temporary and are not stored or uploaded.

The desktop OCR adapter is separate from PDF.js text extraction and uses only
Node's built-in `child_process`/filesystem APIs. No OCR executable, traineddata,
new npm runtime dependency, auto-download or network service is bundled. Web
preview mode explains that it cannot access the desktop OCR engine.

**Languages:** `eng`, `hin`, `pan`, `urd`, `ben`, `guj`, `mar`, `tam`, `tel`,
`kan`, `mal`, `ori` and `asm` (English, Hindi, Punjabi, Urdu, Bengali, Gujarati,
Marathi, Tamil, Telugu, Kannada, Malayalam, Odia and Assamese). Only languages
reported by the local engine are selectable. Indic recognition quality depends
on the separately installed model, scan quality, layout and script; the list
is an available-engine matrix, not a guarantee of perfect recognition.

### Installing the optional OCR engine

Cambuz does not install or download Tesseract. Install a trusted Tesseract 4 or
newer build separately, include the language data you need, and make the
`tesseract` executable available on `PATH`. In a new terminal,
`tesseract --version` should report version 4 or newer and
`tesseract --list-langs` should list selected codes such as `eng`, `hin`,
`pan` or `urd`. Restart Cambuz after changing PATH or language data, open a PDF,
choose **OCR**, and use **Check OCR again** to refresh the detected language
packs. On Windows, use a trusted Windows Tesseract build and its language-data
selection; on Linux/macOS, use the distribution's package manager and review
that package's notices. Cambuz does not require network access while recognizing
text.

### Dependencies, licensing and size

- Cambuz adds **no Tesseract engine or model bytes** to the base package and
  adds no OCR npm dependency. The Electron main process calls the separately
  installed local CLI with a fixed argument list; it does not invoke a shell.
- Tesseract OCR is distributed upstream under Apache-2.0. Official upstream
  Tesseract language-data repositories also publish Apache-2.0 model data;
  downstream installers and third-party packs may have additional notices.
  Because Cambuz redistributes neither, users should review the license and
  notices for the engine/model packages they choose.
- The actual installed size of a native engine plus selected language models
  varies by platform, build and models. It was **not measured here** because no
  native OCR package is installed. The project has no completed installer in
  this checkout, so an installer-size delta cannot be reported; the base app
  includes no OCR binary or traineddata. The checked-in scanned PDF is a small
  327 KiB test/sample asset, not an application runtime dependency.

### Phase 7 verification and limitations

- `npm run samples:phase7` generates `samples/phase7-scanned.pdf`, a four-page
  image-only sample (English, Hindi, Punjabi and Urdu), plus the corresponding
  raster PNG fixtures used by quality tests. PDF.js confirms all four pages
  contain no native selectable text.
- `npm run test:phase7` — **54 passed, 0 failed, 2 skipped** in the default
  sandbox because no native Tesseract executable is installed. Through the
  same `execFile` adapter, a temporary Tesseract-compatible shim backed by
  Tesseract.js 7 WebAssembly plus `eng`/`hin`/`pan`/`urd` data completed **58
  passed, 0 failed, 0 skipped**; the English, Hindi, Punjabi and Urdu scan
  assertions exercised actual recognition output. No shim or OCR package is
  checked in or added to the application dependencies.
- `npm test` — **920 passed, 0 failed, 2 skipped** across the Phase 2–7 suites.
- **Still not verified here:** the native Tesseract executable itself, actual
  Electron IPC/window launch, Windows packaging, and a Windows UI session. The
  WebAssembly adapter check validates the same OCR call contract and controlled
  scan quality, but is not a native-CLI or Windows integration test.
- OCR is current-page-only and does not create a searchable PDF. Whole-document
  OCR, OCR-layer export, progress/cancel controls, handwriting, tables and
  automatic orientation correction remain out of scope. The native engine and
  language packages still need functional verification on a Windows desktop.

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
- Before Phase 7, the Phase 2–6 regression suites totaled 866 assertions
  (123 + 59 + 54 + 133 + 268 + 229). The current combined Phase 2–7 result is
  reported in the Phase 7 section above.
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

# Generate the Phase 7 raster-only English/Hindi/Punjabi/Urdu OCR sample
npm run samples:phase7

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

# Run the automated test suites (Phase 2–7 regression and OCR tests)
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
| `npm run samples:phase7` | Generate a raster-only English/Hindi/Punjabi/Urdu OCR sample and PNG test images |
| `npm test` | Run the complete Phase 2–7 regression, language and optional OCR suites |
| `npm run test:node` | Run PDF/extraction/search/outline tests |
| `npm run test:dom` | Run DOM tests (highlight/outline/recents/wiring) |
| `npm run test:phase3` | Run print-range, layout, PDF-output and Ink Saver tests |
| `npm run test:phase4` | Run page operation, merge/split, metadata and page-tools dialog tests |
| `npm run test:phase5` | Run password, permission, AcroForm, password-dialog, form-filling and security-dialog tests |
| `npm run test:phase6` | Run extraction, grapheme-safe search, selection/copy-payload, rendering, missing-font and print-PDF tests across English and twelve target languages |
| `npm run test:phase7` | Test OCR input safety, page rasterization, scanned-PDF text separation, optional-engine detection, permissions and real OCR quality when Tesseract/model packs are installed |

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
├── main.js                  # Electron menus, file IPC, printers, print and OCR adapters
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
│   ├── pdf-ocr.js           # Bounded page-to-PNG OCR rasterizer + language list
│   ├── pdf-ocr-ui.js        # Explicit per-page OCR dialog and separate results
│   ├── ocr-engine.cjs       # Optional local Tesseract adapter (not bundled)
│   ├── pdf-forms.css        # Password, security and form styling
│   ├── pdf-ocr.css          # OCR dialog styling
│   └── styles.css           # Reader styles (dark/light)
├── scripts/
│   ├── create-samples.js    # Basic sample PDFs (pdf-lib)
│   ├── create-unicode-samples.py  # Hindi/Punjabi/multilingual PDFs (fpdf2)
│   ├── create-secure-samples.js   # AcroForm + secure fixtures (pdf-lib)
│   ├── create-secure-samples.py   # Encrypted fixtures (pypdf)
│   ├── create-phase6-samples.py   # HarfBuzz-shaped Indian-language fixtures
│   ├── create-phase7-samples.mjs  # Raster-only English/Indic OCR sample
│   ├── test-phase2.mjs      # Node PDF/extraction/search suite
│   ├── test-phase2-dom.mjs  # DOM/reader/print wiring suite (jsdom)
│   ├── test-phase3.mjs      # Print composition and validation suite
│   ├── test-phase4.mjs      # Page operations, merge/split, metadata and page-tools dialog suite
│   ├── test-phase5.mjs      # Security, permissions, forms and password-dialog suite
│   ├── test-phase6.mjs      # Indian-language extraction, UI, raster and print tests
│   └── test-phase7.mjs      # Optional OCR safety, scanned fixtures and quality checks
├── scripts/fixtures/        # Security/form fixtures and Phase 7 raster PNGs
├── samples/                 # Sample PDF files for testing
│   ├── welcome.pdf          # 5-page welcome document
│   ├── cambuz-demo.pdf      # 10-page comprehensive demo
│   ├── form-sample.pdf      # 1-page fillable feedback form
│   ├── hindi-sample.pdf     # 4-page Devanagari sample (पंजाब ×6)
│   ├── punjabi-sample.pdf   # 4-page Gurmukhi sample (ਪੰਜਾਬ ×6)
│   ├── multilingual.pdf     # 7-page EN/HI/PA sample with outline (each term ×12)
│   ├── phase6-indian-languages.pdf # English + 12 target languages, mixed, stress
│   ├── phase6-embedded-font.pdf    # Visible Tamil text with embedded Noto font
│   ├── phase6-missing-font.pdf     # Tamil with its embedded font program removed
│   └── phase7-scanned.pdf          # Four image-only English/Hindi/Punjabi/Urdu pages
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
10. Phase 3 print IPC/layout hooks remain present; the optional OCR engine stays in a separate module
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

Server checks cover `/src/index.html`, `/src/print.css`, `/src/print-ui.js`,
`/src/pdf-ocr.css`, `/src/pdf-ocr-ui.js`, `/src/printing.js`, PDF.js ESM and
`samples/phase7-scanned.pdf`.

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

**Phase 7 OCR checks (desktop app + separately installed Tesseract):**

- Verify `tesseract --version` and that `tesseract --list-langs` lists each
  installed model code. Open `samples/phase7-scanned.pdf`; its text layer should
  be empty, unlike selectable text in `samples/phase6-indian-languages.pdf`.
- Run OCR explicitly on pages 1–4 with `eng`, `hin`, `pan` and `urd` (install
  those models first). Compare OCR output with the visible page and confirm the
  separate OCR result is selectable but does not enter normal Search or save
  back into the PDF.
- Repeat with a PDF whose permission flags deny copying; the OCR button/action
  must remain blocked. Also check missing engine/model status, the **Check OCR
  again** control, a mixed-language selection, large/skewed scans and a slow
  OCR run. Confirm no page is processed until **Recognize current page** is
  clicked.
- Use the web preview to verify that it explains local OCR is desktop-only.
  The Node/jsdom suite and the controlled Tesseract.js model probe do not replace
  native Tesseract/Windows/Electron verification.

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
10. **Drag and drop**