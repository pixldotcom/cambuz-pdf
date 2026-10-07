# Cambuz PDF Reader

> **A lightweight, fast PDF reader focused on reading, searching, Indian-language support, and high-quality printing — without the bloat of large PDF suites.**

**Project status:** Phase 1 — Initial desktop reader  
**Product name:** Cambuz PDF Reader  
**Primary target:** Windows desktop  
**Repository:** GitHub  
**Development approach:** Phase-by-phase, testable milestones

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
