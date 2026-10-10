# Cambuz PDF Reader 1.1.0 — Windows pre-release

> **Unsigned pre-release. Not published.** Windows is the primary target. Linux and macOS
> builds are **experimental**: they build and pass headless checks, but they have not yet
> been launched on a real desktop. Please read the limitations before you install.

**Release candidate commit:** `ac2b848` on branch `arena/e73ef198-cambuz-pdf`
(CI: [Desktop builds run 38032232208](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38032232208)).
Release docs were added in a later docs-only commit; they do not change the application.
The official Cambuz icon and the updated About dialog were finalized after this release
candidate; installers built by later CI runs include them.

Application identity: name **Cambuz PDF Reader**, app ID **`com.cambuz.pdfreader`**,
publisher **Cambuz**, licence **MIT**.

## Downloads (Windows x64)

| File | Use | SHA-256 |
| --- | --- | --- |
| `Cambuz-PDF-Reader-1.1.0-win-x64-setup.exe` | Installer (per-user, choose folder, Start Menu entry, `.pdf` association) | `7bd699b57cefc7cb76d46c239db89e02a4a3641fb4b6aa12ab49654b56c0e343` |
| `Cambuz-PDF-Reader-1.1.0-win-x64-portable.exe` | Single file, no installation | `3c100ecd868cc7711d8c4370f16de7c1d3d7ed20ee2f594db9880ba1b37ab45b` |

Verify a download against `SHA256SUMS.txt` in the same CI artifact (`cambuz-pdf-windows-x64`).
Run `Get-FileHash -Algorithm SHA256 <file>` in PowerShell to compute it.

**Windows will warn you.** The builds are not code-signed. SmartScreen may show
"Windows protected your PC". Choose **More info → Run anyway** only if the checksum matches.

Experimental (not recommended for general use yet): Linux x64 AppImage
(`Cambuz-PDF-Reader-1.1.0-linux-x86_64.AppImage`) and macOS arm64 DMG/ZIP
(`Cambuz-PDF-Reader-1.1.0-mac-arm64.dmg`, `.zip`). The macOS build is unsigned and not notarized.
Gatekeeper will block it until you approve it manually.

## What this release contains

- Open PDFs from the Open dialog, drag and drop, the command line, or **Open with** / double-click
  (Windows `.pdf` association).
- Continuous page view with page navigation, zoom, fit width and fit page, rotation, and a
  thumbnails and bookmarks sidebar.
- Search within the document, with next and previous results.
- Text selection and Ctrl+C copy, including Hindi and Punjabi text with valid Unicode mappings.
- Print preview and printing through the Windows print dialog.
- Page tools: rotate, delete, extract, reorder, merge and split, on a working copy.
- Form filling and saving filled forms.
- Password-protected documents, and document permissions (print, copy, forms, changes).
- Optional local OCR for scanned pages, only if you install the Tesseract engine separately.
- Bundled sample PDFs: "Try Sample PDF" and "Try Sample PDF Form".

### Copy restriction (decision recorded)

If a PDF's permissions deny copying, Cambuz **honours that flag**. Text cannot be selected, copied
(Ctrl+C, the context-menu Copy item, Cut) or dragged out of the document in Cambuz, and OCR is
disabled. Editable fields such as the search box still work. Text remains searchable inside Cambuz.

**This is a Cambuz-side policy, not DRM.** It does not stop other software from reading the file,
and it does not stop a person from retyping or photographing the page.

## Changes since the Phase 9 baseline

- macOS application menu restored (Quit, Hide, Services) and Edit copy/cut/paste roles added
  (macOS build; not yet verified in a running macOS app).
- Renderer sandbox set explicitly on the main window (no behaviour change expected).
- Copy restriction enforced for every surface, not only the page text layer.
- About dialog shows the version from the app itself, not a hard-coded string.
- CI checks the installed file version against `package.json`.

## Known limitations

- **Unsigned.** No code-signing certificate or Apple Developer ID is used.
- **Electron 44 runtime.** Installers are about 37 MiB larger than the Electron 28 builds
  (Windows setup 118.3 MiB, previously 81.6 MiB). Idle memory of the Windows app is about
  50 MiB higher in automated measurements. Both changes were accepted for this release.
- **Physical printing is not verified.** CI prepared preview PDFs but did not send a job to a printer.
- **Scanned pages need OCR.** Without the optional engine, they show as images only.
- **Broken font mappings.** Some PDFs have missing or wrong ToUnicode data. Copied text may be
  missing or wrong. Cambuz does not substitute characters.
- **Context-menu Copy stays enabled on restricted documents.** Choosing it shows the refusal
  message and copies nothing.
- **Search speed.** The first search on a 100-page document took about 52–83 ms in automated runs,
  depending on the runner. This is not a defined target.
- **Not verified:** installing and running on real hardware by a person, Windows arm64, and
  the Phase 6 device checks. See the acceptance checklist.
- **Linux and macOS are experimental.** See the README for exactly what was and was not tested.
