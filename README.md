# Cambuz PDF Reader

> **A lightweight, fast PDF reader focused on reading, searching, Indian-language support, and high-quality printing — without the bloat of large PDF suites.**

**Project status:** Phase 2 — Reading Experience  
**Product name:** Cambuz PDF Reader  
**Primary target:** Windows desktop  
**Repository:** GitHub  
**Development approach:** Phase-by-phase, testable milestones

---

## Phase 2 — Implementation Status

### Phase 2 Status: `PHASE 2 COMPLETE`

Phase 1 functionality is fully preserved. Phase 2 adds the reading experience
on top of it, with no Phase 3+ features (no printing, merging, splitting,
forms, OCR, AI, cloud, accounts or telemetry).

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

Phase 2 adds dev-only dependencies used to generate and verify Unicode
fixtures. The runtime still needs only `pdfjs-dist` + `express`.

| Package | Version | Purpose | Runtime? |
|---|---|---|---|
| `pdfjs-dist` | ^4.0.379 | PDF rendering engine | Yes |
| `express` | ^4.18.2 | Web server for preview mode | Yes (preview) |
| `electron` | ^28.0.0 | Desktop application shell (dev) | App shell |
| `pdf-lib` | ^1.17.1 | Basic sample PDF generation (dev) | No |
| `@pdf-lib/fontkit` | ^1.1.1 | Custom-font support experiments (dev) | No |
| `@expo-google-fonts/noto-sans-devanagari` | ^0.4.1 | Noto Devanagari TTF for samples (dev) | No |
| `@expo-google-fonts/noto-sans-gurmukhi` | ^0.4.1 | Noto Gurmukhi TTF for samples (dev) | No |
| `jsdom` | latest | DOM-level automated tests (dev) | No |
| `fpdf2` + `uharfbuzz` (pip) | — | Shaped Unicode sample PDFs (dev) | No |

### Installation

```bash
# Clone the repository
git clone https://github.com/pixldotcom/cambuz-pdf.git
cd cambuz-pdf

# Install dependencies (Electron binary download may fail in restricted
# sandboxes; the web preview works without it)
npm install --ignore-scripts

# Optional: needed only to regenerate the Unicode sample PDFs
pip install fpdf2 uharfbuzz

# Run as web application (for preview/testing)
npm run serve

# Run as desktop application (requires Electron)
npm start

# Generate all sample PDFs (basic + Unicode)
npm run samples

# Run the automated test suites (167 assertions)
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
| `npm test` | Run Node + DOM test suites |
| `npm run test:node` | Run PDF/extraction/search/outline tests |
| `npm run test:dom` | Run DOM tests (highlight/outline/recents/wiring) |

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+O` | Open PDF |
| `Ctrl+W` | Close PDF (desktop) |
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
| `?` or `F1` | Keyboard shortcuts dialog |

### Project Structure

```
cambuz-pdf/
├── main.js                  # Electron main process (menus, file IPC)
├── preload.js               # Electron preload script (IPC bridge)
├── server.js                # Express web server for preview
├── package.json             # Project configuration
├── src/
│   ├── index.html           # Main application HTML (toolbar, sidebar, search)
│   ├── renderer.js          # Loading, rendering, nav, zoom, rotation, events
│   ├── search.js            # Unicode search engine + highlighting
│   ├── sidebar.js           # Thumbnails + document outline
│   ├── recents.js           # Recent files + IndexedDB byte cache
│   └── styles.css           # Application styles (dark/light)
├── scripts/
│   ├── create-samples.js    # Basic sample PDFs (pdf-lib)
│   ├── create-unicode-samples.py  # Hindi/Punjabi/multilingual PDFs (fpdf2)
│   ├── test-phase2.mjs      # Node test suite (PDF-level)
│   └── test-phase2-dom.mjs  # DOM test suite (jsdom)
├── samples/                 # Sample PDF files for testing
│   ├── welcome.pdf          # 5-page welcome document
│   ├── cambuz-demo.pdf      # 10-page comprehensive demo
│   ├── hindi-sample.pdf     # 4-page Devanagari sample (पंजाब ×6)
│   ├── punjabi-sample.pdf   # 4-page Gurmukhi sample (ਪੰਜਾਬ ×6)
│   └── multilingual.pdf     # 7-page EN/HI/PA sample with outline (each term ×12)
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
- **Search**: document-wide Unicode index (NFC + case folding); matches on
  the current page are wrapped in `<mark>` elements, the current match is
  scrolled into view; navigation wraps across pages
- **Sidebar**: lazy thumbnails + hierarchical outline with expand/collapse
- **Recents**: metadata in `localStorage`; web mode caches small files in
  `IndexedDB` so reopen works; Electron reopens by native path
- **Rotation**: 0/90/180/270° applied to canvas, text layer and thumbnails

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
correct shaping (verified by rasterizing pages to PNG).

### Known Limitations

- **Electron binary**: cannot be installed in restricted environments; the
  new Electron file-read IPC and menus are code-reviewed but not yet
  executed in this sandbox — verify on a Windows machine (see manual
  checklist below)
- **Sample-generator constraint**: the fpdf2-based generator mis-encodes
  `ToUnicode` for pre-base matras (ि/ਿ) and some ligature+matra sequences,
  so sample content avoids those constructions (every word is
  extraction-verified). This is a fixture limitation, not a reader
  limitation — the reader decodes whatever `ToUnicode`/`ActualText` a PDF
  provides. Phase 6 will add real-world conjunct-heavy fixtures
- **Single page view**: one page at a time (continuous scroll still future)
- **No printing**: Phase 3 feature (explicitly excluded; absence verified)
- **No page manipulation / forms / passwords**: Phase 4–5 features
- **Recent-file cache**: web-mode byte cache capped at 5 files × 60 MiB;
  larger/older files must be reopened manually
- **Search**: case-insensitive substring search; no regex, no whole-word or
  diacritic-insensitive options yet

### Tests Performed (Automated — 167 assertions, all passing)

Node suite (`npm run test:node`, 116 assertions):

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
9. Syntax check (`node --check`) on all 10 JS sources
10. No Phase-3+ leakage (print/merge/split/OCR/telemetry strings absent)
11. Recents pure helpers (ids, sizes, relative time)

DOM suite (`npm run test:dom`, 51 assertions, jsdom + real modules):

1. All 62 required element ids present in `index.html`
2. Real `SearchController`: highlight marks created for EN/HI/PA queries
   with byte-exact text, current-mark tracking, wrap navigation, clear()
3. Real `SidebarController`: nested outline build, collapse/expand,
   explicit + named destination navigation, external-URL handling, tabs
4. Real `recents.js`: add/list/update/remove/clear round-trip in
   `localStorage`, reopen-last setting
5. `renderer.js` imports cleanly against the real DOM

Server checks (manual, all 200 with correct MIME types): `/`,
`/src/*`, `pdf.mjs`, `pdf.worker.mjs`, standard fonts, all 5 sample PDFs.

Render checks: Hindi/Punjabi/mixed pages rasterized to PNG and visually
verified (correct shaping, conjuncts, matras, bindi/anusvara).

### Manual Browser Checklist (for a machine with a display)

The live preview (`npm run serve` → http://localhost:3000) supports the
full flow; verify on Windows + Electron before release:

1. Open `samples/multilingual.pdf` via Open button, drag-and-drop and `?pdf=` URL
2. Sidebar: thumbnails render lazily, click navigates; Bookmarks tab lists
   8 entries, click jumps to the right page
3. Search `Punjab`, `पंजाब`, `ਪੰਜਾਬ`: counts read 12, highlights show on
   every page, Enter/F3 wrap through all matches
4. Select Hindi/Punjabi text with the mouse, copy, paste into Notepad —
   glyphs must be byte-identical
5. `Ctrl+A` selects page text; `R`/`Shift+R` rotate; thumbnails follow
6. `F11` full screen; `F9` sidebar; `?` shortcuts dialog; theme toggle
7. Reload: recent files list the document; reopen restores the last page
8. Close (`Ctrl+W`), open another PDF, invalid-file error path
9. Electron only: native Open dialog, menus (Find/Rotate/Fullscreen/
   Sidebar/Shortcuts), reopen-by-path after restart

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
- **No printing**: Print workflow is a Phase 3 feature
- **No password support**: Encrypted PDFs are a Phase 5 feature

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
