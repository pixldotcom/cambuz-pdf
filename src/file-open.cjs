// Cambuz PDF Reader — opening PDFs from the operating system (main process).
//
// When the user double-clicks a PDF, uses "Open with Cambuz", or launches the
// app with a file path, the OS delivers the path: on Windows/Linux as a
// command-line argument, on macOS through Electron's `open-file` event. A
// second launch while Cambuz runs arrives via `second-instance`. None of these
// paths may execute anything — they only name a document for the existing,
// sandboxed `read-file` channel — but they do need shared parsing so the
// argv, second-instance, and open-file routes agree on what counts as a PDF.
//
// Cambuz shows one document at a time, so when several are offered only the
// first usable one opens; the choice is deterministic (argument order).

/**
 * True for a plausible PDF path: a non-empty string ending in `.pdf`
 * (any case) that is not a command-line flag.
 */
function isPdfPath(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('-')) return false;
  return trimmed.toLowerCase().endsWith('.pdf');
}

/**
 * First PDF path in a command line, or null.
 *
 * `argv[0]` (the executable itself) is always skipped; the scan also skips
 * Chromium/Electron switches (`--remote-debugging-port=…`, `--no-sandbox`,
 * …), bare `--` separators, and non-PDF arguments. Paths with spaces or
 * non-ASCII characters pass through untouched — callers must never re-split
 * or re-encode the returned string.
 */
function pdfPathFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  for (const arg of argv.slice(1)) {
    if (typeof arg !== 'string') continue;
    if (arg === '--') continue;
    if (isPdfPath(arg)) return arg;
  }
  return null;
}

module.exports = { isPdfPath, pdfPathFromArgv };
