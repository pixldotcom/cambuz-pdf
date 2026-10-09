// Cambuz PDF Reader — Renderer
// Handles PDF loading, rendering (canvas + selectable text layer),
// navigation, zoom, rotation, search, sidebar, recents and UI events.
//
// Phase 1 and 2 functionality is preserved; Phase 3 adds print preparation and
// preview, Phase 4 the page tools, and Phase 5 password-protected documents,
// PDF permissions and fillable forms.

import { SearchController } from './search.js';
import { SidebarController } from './sidebar.js';
import {
  getRecents,
  addRecent,
  updateRecentPage,
  updateRecentPages,
  removeRecent,
  clearRecents,
  getReopenLast,
  setReopenLast,
  storeBlob,
  getBlob,
  makeId,
  timeAgo,
  formatBytes,
} from './recents.js';
import { PrintController } from './print-ui.js';
import { PageToolsController } from './pdf-ops-ui.js';
import { PasswordController } from './pdf-password-ui.js';
import { FormController } from './pdf-forms-ui.js';
import { SecurityController } from './pdf-security-ui.js';
import { OcrController } from './pdf-ocr-ui.js';
import { pageStatusMessage } from './text-selection.js';
import {
  NO_SECURITY,
  classifyPasswordError,
  isBlocked,
  passwordErrorMessage,
  readDocumentSecurity,
  refusalMessage,
} from './pdf-security.js';

// PDF.js setup
const pdfjsLib = await import('../node_modules/pdfjs-dist/build/pdf.mjs');
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../node_modules/pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).href;
const STANDARD_FONT_DATA_URL = new URL(
  '../node_modules/pdfjs-dist/standard_fonts/',
  import.meta.url
).href;

// --- State ---
let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let currentScale = 1.0;
let rotation = 0; // 0 | 90 | 180 | 270
let fitMode = null; // 'page' | 'width' | null (manual zoom)
let rendering = false;
let pendingPage = null;
let textLayerTask = null;
let currentFileName = 'Document';
let currentFileSize = 0;
let currentFilePath = null; // Electron native path (null in web mode)
let currentRecentId = null;
let originalPdfBytes = null; // stable copy retained for print preparation
let documentGeneration = 0;

// Phase 5: security state of the open document and the viewport of the page
// that is currently on screen (used to place form fields over it).
let documentSecurity = NO_SECURITY;
let openedWithPassword = false;
let lastViewport = null;
let lastViewportPage = 0;

let search = null;
let sidebar = null;
let printing = null;
let pageTools = null;
let passwordPrompt = null;
let forms = null;
let securityUi = null;
let ocrUi = null;

// --- DOM elements ---
const elements = {
  welcomeScreen: document.getElementById('welcome-screen'),
  pdfViewer: document.getElementById('pdf-viewer'),
  pdfContainer: document.getElementById('pdf-container'),
  pageWrapper: document.getElementById('page-wrapper'),
  pdfCanvas: document.getElementById('pdf-canvas'),
  textLayer: document.getElementById('text-layer'),
  dropOverlay: document.getElementById('drop-overlay'),
  errorDisplay: document.getElementById('error-display'),
  errorMessage: document.getElementById('error-message'),
  btnOpen: document.getElementById('btn-open'),
  btnClose: document.getElementById('btn-close'),
  btnPrint: document.getElementById('btn-print'),
  btnPageTools: document.getElementById('btn-pageops'),
  btnForms: document.getElementById('btn-forms'),
  btnSecurity: document.getElementById('btn-security'),
  btnOcr: document.getElementById('btn-ocr'),
  btnPrev: document.getElementById('btn-prev'),
  btnNext: document.getElementById('btn-next'),
  btnZoomIn: document.getElementById('btn-zoom-in'),
  btnZoomOut: document.getElementById('btn-zoom-out'),
  btnFitPage: document.getElementById('btn-fit-page'),
  btnFitWidth: document.getElementById('btn-fit-width'),
  btnTheme: document.getElementById('btn-theme'),
  btnWelcomeOpen: document.getElementById('btn-welcome-open'),
  btnSample: document.getElementById('btn-sample'),
  btnSampleForm: document.getElementById('btn-sample-form'),
  btnErrorDismiss: document.getElementById('btn-error-dismiss'),
  pageInput: document.getElementById('page-input'),
  pageTotal: document.getElementById('page-total'),
  zoomLevel: document.getElementById('zoom-level'),
  docTitle: document.getElementById('doc-title'),
  statusText: document.getElementById('status-text'),
  statusFile: document.getElementById('status-file'),
  statusMeta: document.getElementById('status-meta'),
  statusLock: document.getElementById('status-lock'),
  themeIconDark: document.getElementById('theme-icon-dark'),
  themeIconLight: document.getElementById('theme-icon-light'),
  // Phase 2
  btnSidebar: document.getElementById('btn-sidebar'),
  btnSearch: document.getElementById('btn-search'),
  btnRotateCcw: document.getElementById('btn-rotate-ccw'),
  btnRotateCw: document.getElementById('btn-rotate-cw'),
  btnFullscreen: document.getElementById('btn-fullscreen'),
  btnHelp: document.getElementById('btn-help'),
  sidebar: document.getElementById('sidebar'),
  tabThumbs: document.getElementById('tab-thumbs'),
  tabOutline: document.getElementById('tab-outline'),
  thumbsPanel: document.getElementById('thumbs-panel'),
  outlinePanel: document.getElementById('outline-panel'),
  searchBar: document.getElementById('search-bar'),
  searchInput: document.getElementById('search-input'),
  searchCount: document.getElementById('search-count'),
  btnSearchPrev: document.getElementById('btn-search-prev'),
  btnSearchNext: document.getElementById('btn-search-next'),
  btnSearchClose: document.getElementById('btn-search-close'),
  recentSection: document.getElementById('recent-section'),
  recentList: document.getElementById('recent-list'),
  btnClearRecents: document.getElementById('btn-clear-recents'),
  chkReopenLast: document.getElementById('chk-reopen-last'),
  btnWelcomeShortcuts: document.getElementById('btn-welcome-shortcuts'),
  shortcutsDialog: document.getElementById('shortcuts-dialog'),
  btnShortcutsClose: document.getElementById('btn-shortcuts-close'),
};

// --- Status helpers ---

function setStatus(msg) {
  elements.statusText.textContent = msg;
}

function updateStatusMeta() {
  if (!pdfDoc) {
    elements.statusMeta.textContent = '';
    return;
  }
  elements.statusMeta.textContent =
    `Page ${currentPage} / ${totalPages} • ${Math.round(currentScale * 100)}% • ${rotation}°`;
}

// --- PDF Loading ---

/**
 * Open bytes with PDF.js, asking for a password whenever the document needs
 * one. Resolves with null when the user cancels: a protected PDF is never
 * opened without the password, and a wrong password is never worked around.
 */
async function openWithPassword(bytes, fileName) {
  let password = '';
  for (;;) {
    try {
      // PDF.js transfers the buffer to its worker, so hand it a fresh copy on
      // every attempt — a retry cannot reuse detached memory.
      const doc = await pdfjsLib.getDocument({
        data: bytes.slice(),
        password,
        standardFontDataUrl: STANDARD_FONT_DATA_URL,
      }).promise;
      openedWithPassword = Boolean(password);
      return doc;
    } catch (error) {
      const kind = classifyPasswordError(error);
      if (!kind) throw error;
      setStatus('This PDF is protected and needs a password.');
      const answer = await passwordPrompt.request({
        fileName,
        message: passwordErrorMessage(kind, fileName),
      });
      if (answer === null) return null;
      password = answer;
    }
  }
}

async function loadPDF(source, fileName, meta = {}) {
  try {
    let stableBytes;

    if (source instanceof ArrayBuffer) {
      stableBytes = new Uint8Array(source).slice();
    } else if (ArrayBuffer.isView(source)) {
      stableBytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice();
    } else if (typeof source === 'string') {
      setStatus('Loading document…');
      const response = await fetch(source);
      if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status}`);
      stableBytes = new Uint8Array(await response.arrayBuffer());
    } else {
      throw new Error('Invalid PDF source');
    }

    const doc = await openWithPassword(stableBytes, fileName);
    if (!doc) {
      setStatus('Open cancelled — the document was not opened.');
      return;
    }

    // Swap in the new document only after PDF.js has opened the candidate.
    ocrUi?.onDocumentChanged();
    await printing?.onDocumentChanged();
    await pageTools?.onDocumentChanged();
    await forms?.onDocumentChanged();
    if (pdfDoc) {
      try {
        await pdfDoc.destroy();
      } catch (_) {
        // ignore cleanup errors
      }
    }
    pdfDoc = doc;
    originalPdfBytes = stableBytes;
    // Phase 5: read the permission flags before anything else can act on them.
    documentSecurity = await readDocumentSecurity(doc, { unlockedWithPassword: openedWithPassword });
    documentGeneration += 1;
    totalPages = pdfDoc.numPages;
    currentFileName = fileName || fileNameFromUrl(typeof source === 'string' ? source : '') || 'Document';
    currentFileSize = meta.size || stableBytes.byteLength;
    currentFilePath = meta.path || null;
    rotation = 0;
    fitMode = 'width';

    // Reset search + sidebar for the new document.
    search.clear();
    elements.searchInput.value = '';
    sidebar.closeDocument();

    // Start page: explicit request, else remembered page for known files.
    let startPage = 1;
    if (meta.startPage) {
      startPage = Math.max(1, Math.min(totalPages, meta.startPage));
    }
    currentPage = startPage;

    // Remember in recents.
    const mtime = meta.mtime || 0;
    const entry = addRecent({
      name: currentFileName,
      path: currentFilePath,
      size: currentFileSize,
      pages: totalPages,
      mtime,
    });
    currentRecentId = entry.id;
    if (!meta.startPage && entry.lastPage > 1) {
      currentPage = Math.min(totalPages, entry.lastPage);
    }
    updateRecentPages(currentRecentId, totalPages);

    // Cache bytes for reopen (web mode only; Electron reopens via path).
    if (stableBytes && !currentFilePath) {
      storeBlob(currentRecentId, stableBytes.buffer.slice(0)).catch(() => {});
    }

    // Update UI — enable controls.
    elements.pageTotal.textContent = totalPages;
    elements.pageInput.max = totalPages;
    elements.pageInput.value = currentPage;
    elements.pageInput.disabled = false;
    elements.btnClose.disabled = false;
    elements.btnPrint.disabled = false;
    elements.btnPageTools.disabled = false;
    elements.btnPrev.disabled = currentPage <= 1;
    elements.btnNext.disabled = currentPage >= totalPages;
    elements.btnZoomIn.disabled = false;
    elements.btnZoomOut.disabled = false;
    elements.btnFitPage.disabled = false;
    elements.btnFitWidth.disabled = false;
    elements.btnSidebar.disabled = false;
    elements.btnSearch.disabled = false;
    elements.btnRotateCcw.disabled = false;
    elements.btnRotateCw.disabled = false;

    // Phase 5: enforce the permissions this document carries.
    applyDocumentAvailability();

    // Show viewer, hide welcome.
    elements.welcomeScreen.style.display = 'none';
    elements.pdfViewer.style.display = 'flex';
    elements.errorDisplay.style.display = 'none';

    // Title and status.
    elements.docTitle.textContent = currentFileName;
    const sizeLabel = formatBytes(currentFileSize);
    elements.statusFile.textContent = sizeLabel
      ? `${currentFileName} • ${sizeLabel}`
      : currentFileName;
    const securityNote = documentSecurity.encrypted ? ' • encrypted' : '';
    setStatus(`Loaded — ${totalPages} page${totalPages !== 1 ? 's' : ''}${securityNote}`);

    // Sidebar content.
    await sidebar.openDocument(pdfDoc);
    sidebar.setActivePage(currentPage);

    // Initial render — fit to width.
    const baseScale = await getBaseScale('width');
    currentScale = baseScale;
    updateZoomDisplay();
    updateStatusMeta();
    await renderPage(currentPage);

    // The form sample opens straight into form filling so the feature is
    // visible without hunting for the button.
    if (meta.openForms) {
      forms?.enable();
    }

    renderRecents();
  } catch (err) {
    console.error('PDF load error:', err);
    showError(`Failed to open PDF: ${err.message}`);
  }
}

function fileNameFromUrl(url) {
  if (!url) return '';
  try {
    const parts = url.split('?')[0].split('/');
    return decodeURIComponent(parts[parts.length - 1] || '');
  } catch (_) {
    return '';
  }
}

function closePDF() {
  if (!canReplaceDocument('Closing the document')) return;
  ocrUi?.onDocumentChanged();
  printing?.onDocumentChanged().catch(() => {});
  pageTools?.onDocumentChanged().catch(() => {});
  forms?.onDocumentChanged().catch(() => {});
  passwordPrompt?.reset();
  originalPdfBytes = null;
  documentSecurity = NO_SECURITY;
  openedWithPassword = false;
  lastViewport = null;
  lastViewportPage = 0;
  documentGeneration += 1;
  search.cancel();
  search.clear();
  elements.searchInput.value = '';
  elements.searchBar.style.display = 'none';
  sidebar.closeDocument();
  sidebar.setOpen(false);

  if (pdfDoc) {
    pdfDoc.destroy().catch(() => {});
  }
  pdfDoc = null;
  totalPages = 0;
  currentPage = 1;
  currentScale = 1.0;
  rotation = 0;
  fitMode = null;
  pendingPage = null;
  currentFileName = 'Document';
  currentFileSize = 0;
  currentFilePath = null;
  currentRecentId = null;

  if (textLayerTask) {
    try {
      textLayerTask.cancel();
    } catch (_) {
      // ignore
    }
    textLayerTask = null;
  }

  // Clear canvas + text layer.
  const canvas = elements.pdfCanvas;
  const ctx = canvas.getContext('2d');
  if (canvas.width && canvas.height) ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;
  canvas.style.width = '0px';
  canvas.style.height = '0px';
  elements.textLayer.innerHTML = '';
  elements.pageWrapper.style.width = 'auto';
  elements.pageWrapper.style.height = 'auto';

  // Reset UI.
  elements.pdfViewer.style.display = 'none';
  elements.welcomeScreen.style.display = 'flex';
  elements.docTitle.textContent = 'Cambuz PDF Reader';
  setStatus('Ready');
  elements.statusFile.textContent = '';
  elements.statusMeta.textContent = '';
  elements.pageInput.disabled = true;
  elements.pageInput.value = 1;
  elements.pageTotal.textContent = '0';
  elements.zoomLevel.textContent = '100%';
  elements.btnClose.disabled = true;
  elements.btnPrint.disabled = true;
  elements.btnPageTools.disabled = true;
  elements.btnPrev.disabled = true;
  elements.btnNext.disabled = true;
  elements.btnZoomIn.disabled = true;
  elements.btnZoomOut.disabled = true;
  elements.btnFitPage.disabled = true;
  elements.btnFitWidth.disabled = true;
  elements.btnSidebar.disabled = true;
  elements.btnSearch.disabled = true;
  elements.btnRotateCcw.disabled = true;
  elements.btnRotateCw.disabled = true;
  elements.textLayer.classList.remove('no-copy');

  applyDocumentAvailability();
  renderRecents();
}

// --- Phase 5: document security and permissions ----------------------------

/** Enable/disable every entry point, then apply the document's permissions. */
function applyDocumentAvailability() {
  const available = Boolean(pdfDoc);
  pageTools?.setDocumentAvailable(available);
  forms?.setDocumentAvailable(available);
  securityUi?.setDocumentAvailable(available);
  applySecurityRestrictions();
}

/**
 * Honour the permission flags of the open document. Restrictions are enforced
 * here rather than deep inside the features, so a refused action always has a
 * visible reason instead of silently failing later.
 */
function applySecurityRestrictions() {
  const available = Boolean(pdfDoc);

  const printBlocked = isBlocked(documentSecurity, 'print');
  elements.btnPrint.disabled = !available || printBlocked;
  elements.btnPrint.title = printBlocked
    ? refusalMessage(documentSecurity, 'print')
    : 'Print PDF (Ctrl+P)';

  // Page tools need to rewrite the file, which is impossible while it is
  // encrypted — whatever the permission flags say. Say so up front.
  const editBlocked = Boolean(documentSecurity.encrypted) || isBlocked(documentSecurity, 'modifyContents');
  elements.btnPageTools.disabled = !available || editBlocked;
  elements.btnPageTools.title = editBlocked
    ? documentSecurity.encrypted
      ? 'Page tools are not available while the document is encrypted.'
      : refusalMessage(documentSecurity, 'modifyContents')
    : 'Page Tools — rotate, delete, extract, reorder, merge, split (Ctrl+Shift+E)';

  // Copying is blocked at the layer level: the text still renders (and can be
  // searched) but it cannot be selected or copied out.
  const copyBlocked = isBlocked(documentSecurity, 'copy');
  elements.textLayer.classList.toggle('no-copy', copyBlocked);
  // OCR converts visible page pixels back into text, so it must respect the
  // same no-copy permission as native PDF text selection/copying.
  ocrUi?.setDocumentAvailable(available && !copyBlocked);

  securityUi?.updateChip(documentSecurity);
  forms?.setDocumentAvailable(available);
}

/** Open print preview — unless the document forbids printing. */
function openPrint() {
  if (!pdfDoc) {
    setStatus('Open a PDF before printing.');
    return;
  }
  if (isBlocked(documentSecurity, 'print')) {
    const message = refusalMessage(documentSecurity, 'print');
    setStatus(message);
    showError(message);
    return;
  }
  printing?.open();
}

/** Open page tools — unless the document forbids changing it. */
function openPageTools() {
  if (!pdfDoc) {
    setStatus('Open a PDF before using page tools.');
    return;
  }
  if (documentSecurity.encrypted) {
    const message =
      'Page tools are not available while this document is encrypted. Open a copy that is not protected to edit its pages.';
    setStatus(message);
    showError(message);
    return;
  }
  if (isBlocked(documentSecurity, 'modifyContents')) {
    const message = refusalMessage(documentSecurity, 'modifyContents');
    setStatus(message);
    showError(message);
    return;
  }
  pageTools?.open();
}

/** Toggle form filling, reporting why it is unavailable when it is. */
function toggleForms() {
  if (!pdfDoc) {
    setStatus('Open a PDF before filling in a form.');
    return;
  }
  forms?.toggle();
}

// --- Rendering (canvas + selectable text layer) ---

async function renderPage(pageNum) {
  if (!pdfDoc) return;
  if (rendering) {
    pendingPage = pageNum;
    return;
  }
  rendering = true;
  setStatus(`Rendering page ${pageNum}…`);
  try {
    await renderPageNow(pageNum);
  } finally {
    rendering = false;
    if (pendingPage !== null) {
      const p = pendingPage;
      pendingPage = null;
      renderPage(p);
    }
  }
}

async function renderPageNow(pageNum) {
  const tokenPage = pageNum;
  try {
    const page = await pdfDoc.getPage(pageNum);
    if (!pdfDoc || tokenPage !== currentPage) return;
    const viewport = page.getViewport({ scale: currentScale, rotation });

    const canvas = elements.pdfCanvas;
    const ctx = canvas.getContext('2d');

    // High-DPI support.
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(viewport.width);
    const h = Math.floor(viewport.height);
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    elements.pageWrapper.style.width = `${w}px`;
    elements.pageWrapper.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Remember the viewport and place the form fields before the (potentially
    // slow) canvas render: the overlay only needs the geometry, and it then
    // stays correct even if the page itself cannot be drawn.
    lastViewport = viewport;
    lastViewportPage = pageNum;
    forms?.renderOverlay(pageNum, viewport);

    await page.render({ canvasContext: ctx, viewport }).promise;
    if (!pdfDoc || tokenPage !== currentPage) return;

    await renderTextLayer(page, viewport);
    if (!pdfDoc || tokenPage !== currentPage) return;

    // Say why text cannot be selected here, rather than leaving a silent refusal.
    setStatus(
      pageStatusMessage({
        pageNumber: pageNum,
        totalPages,
        hasText: elements.textLayer.textContent.trim().length > 0,
        copyBlocked: isBlocked(documentSecurity, 'copy'),
      })
    );
    updateStatusMeta();
    sidebar.setActivePage(pageNum);
    if (sidebar.open) sidebar.scrollActiveIntoView();
    search.applyHighlights();
    search.syncCurrentToPage(pageNum);
    search.updateCount();
  } catch (err) {
    if (err && err.name === 'RenderingCancelledException') return;
    console.error('Render error:', err);
    showError(`Failed to render page: ${err.message}`);
  }
}

async function renderTextLayer(page, viewport) {
  const layer = elements.textLayer;
  if (textLayerTask) {
    try {
      textLayerTask.cancel();
    } catch (_) {
      // ignore
    }
    textLayerTask = null;
  }
  layer.innerHTML = '';
  // PDF.js positions text with calc(var(--scale-factor) * …) — required.
  layer.style.setProperty('--scale-factor', String(viewport.scale));

  let task = null;
  try {
    const textContent = await page.getTextContent();
    task = new pdfjsLib.TextLayer({
      textContentSource: textContent,
      container: layer,
      viewport,
    });
    textLayerTask = task;
    await task.render();
  } catch (err) {
    if (err && (err.name === 'AbortException' || err.name === 'RenderingCancelledException')) {
      return;
    }
    // The canvas is already rendered; a text-layer failure only disables
    // selection/search-highlighting on this page — never a fatal error.
    console.warn('Text layer render failed:', err);
  } finally {
    if (textLayerTask === task) textLayerTask = null;
  }
}

// --- Navigation ---

async function goToPage(pageNum) {
  if (!pdfDoc) return;
  const target = Math.max(1, Math.min(totalPages, pageNum));
  const changed = target !== currentPage;
  currentPage = target;
  elements.pageInput.value = currentPage;
  elements.btnPrev.disabled = currentPage <= 1;
  elements.btnNext.disabled = currentPage >= totalPages;
  updateStatusMeta();
  updateRecentPage(currentRecentId, currentPage);
  if (changed) {
    // Reset viewer scroll to top for the new page.
    elements.pdfViewer.scrollTop = 0;
    elements.pdfViewer.scrollLeft = 0;
  }
  await renderPage(currentPage);
}

function prevPage() {
  goToPage(currentPage - 1);
}

function nextPage() {
  goToPage(currentPage + 1);
}

// --- Zoom ---

function updateZoomDisplay() {
  elements.zoomLevel.textContent = `${Math.round(currentScale * 100)}%`;
  updateStatusMeta();
}

async function getBaseScale(mode) {
  if (!pdfDoc) return 1;
  const page = await pdfDoc.getPage(currentPage);
  const viewport = page.getViewport({ scale: 1, rotation });
  const container = elements.pdfViewer;
  const padding = 40;

  if (mode === 'page') {
    const availW = container.clientWidth - padding;
    const availH = container.clientHeight - padding;
    return Math.min(availW / viewport.width, availH / viewport.height);
  }
  if (mode === 'width') {
    const availW = container.clientWidth - padding;
    return availW / viewport.width;
  }
  return currentScale;
}

async function zoomIn() {
  if (!pdfDoc) return;
  fitMode = null;
  currentScale = Math.min(currentScale * 1.25, 5.0);
  updateZoomDisplay();
  await renderPage(currentPage);
}

async function zoomOut() {
  if (!pdfDoc) return;
  fitMode = null;
  currentScale = Math.max(currentScale / 1.25, 0.25);
  updateZoomDisplay();
  await renderPage(currentPage);
}

async function fitToPage() {
  if (!pdfDoc) return;
  fitMode = 'page';
  currentScale = await getBaseScale('page');
  updateZoomDisplay();
  await renderPage(currentPage);
}

async function fitToWidth() {
  if (!pdfDoc) return;
  fitMode = 'width';
  currentScale = await getBaseScale('width');
  updateZoomDisplay();
  await renderPage(currentPage);
}

// --- Rotation (Phase 2) ---

async function setRotation(deg) {
  if (!pdfDoc) return;
  rotation = ((deg % 360) + 360) % 360;
  // Keep fit modes accurate in the new orientation.
  if (fitMode === 'page' || fitMode === 'width') {
    currentScale = await getBaseScale(fitMode);
    updateZoomDisplay();
  }
  updateStatusMeta();
  setStatus(`Rotation: ${rotation}°`);
  await renderPage(currentPage);
  sidebar.refreshAll().catch(() => {});
}

function rotateCW() {
  setRotation(rotation + 90);
}

function rotateCCW() {
  setRotation(rotation - 90);
}

// --- Full screen (Phase 2) ---

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  } catch (err) {
    setStatus('Full screen is not available in this environment');
  }
}

// --- Text selection (Phase 2) ---

function selectPageText() {
  if (!pdfDoc) return;
  if (isBlocked(documentSecurity, 'copy')) {
    const message = refusalMessage(documentSecurity, 'copy');
    setStatus(message);
    return;
  }
  const layer = elements.textLayer;
  if (!layer || !layer.textContent || !layer.textContent.trim()) {
    setStatus('No selectable text on this page (it may be a scanned image)');
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(layer);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  setStatus('Page text selected — press Ctrl+C to copy');
}

// --- Theme ---

function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  elements.themeIconDark.style.display = next === 'dark' ? 'block' : 'none';
  elements.themeIconLight.style.display = next === 'light' ? 'block' : 'none';
}

// --- Search UI (Phase 2) ---

let searchDebounce = null;

function toggleSearch(force) {
  if (!pdfDoc) return;
  const show = typeof force === 'boolean'
    ? force
    : elements.searchBar.style.display === 'none';
  elements.searchBar.style.display = show ? 'flex' : 'none';
  if (show) {
    elements.searchInput.focus();
    elements.searchInput.select();
  } else {
    if (searchDebounce) clearTimeout(searchDebounce);
    search.clear();
    elements.searchInput.value = '';
    if (pdfDoc) setStatus(`Page ${currentPage} of ${totalPages}`);
    elements.pdfViewer.focus?.();
  }
}

function setupSearchEvents() {
  elements.btnSearch.addEventListener('click', () => toggleSearch());
  elements.btnSearchClose.addEventListener('click', () => toggleSearch(false));
  elements.btnSearchNext.addEventListener('click', () => search.next());
  elements.btnSearchPrev.addEventListener('click', () => search.prev());

  elements.searchInput.addEventListener('input', () => {
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      search.setQuery(elements.searchInput.value.trim());
    }, 250);
  });

  elements.searchInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      if (searchDebounce) clearTimeout(searchDebounce);
      const q = elements.searchInput.value.trim();
      if (q !== search.query) {
        search.setQuery(q);
      } else if (e.shiftKey) {
        search.prev();
      } else {
        search.next();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      toggleSearch(false);
    }
  });
}

// --- Shortcuts dialog (Phase 2) ---

function toggleShortcuts(force) {
  const show = typeof force === 'boolean'
    ? force
    : elements.shortcutsDialog.style.display === 'none';
  elements.shortcutsDialog.style.display = show ? 'flex' : 'none';
}

// --- Recent files UI (Phase 2) ---

function renderRecents() {
  const list = getRecents();
  elements.recentSection.style.display = list.length ? 'block' : 'none';
  elements.chkReopenLast.checked = getReopenLast();
  elements.recentList.innerHTML = '';
  for (const entry of list) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'recent-item';
    const canReopen = isElectron() ? !!entry.path : true;
    btn.title = canReopen ? `Open ${entry.name}` : 'File bytes unavailable — open it again manually';

    const icon = document.createElement('span');
    icon.className = 'recent-icon';
    icon.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
      '<polyline points="14 2 14 8 20 8"/></svg>';

    const info = document.createElement('span');
    info.className = 'recent-info';
    const name = document.createElement('span');
    name.className = 'recent-name';
    name.textContent = entry.name;
    const metaBits = [];
    if (entry.pages) metaBits.push(`${entry.pages} pages`);
    if (entry.size) metaBits.push(formatBytes(entry.size));
    metaBits.push(timeAgo(entry.openedAt));
    if (entry.lastPage > 1) metaBits.push(`page ${entry.lastPage}`);
    const meta = document.createElement('span');
    meta.className = 'recent-meta';
    meta.textContent = metaBits.join(' • ');
    info.appendChild(name);
    info.appendChild(meta);

    const remove = document.createElement('span');
    remove.className = 'recent-remove';
    remove.textContent = '✕';
    remove.title = 'Remove from recent files';
    remove.setAttribute('role', 'button');
    remove.setAttribute('aria-label', `Remove ${entry.name} from recent files`);
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      removeRecent(entry.id);
      renderRecents();
    });

    btn.appendChild(icon);
    btn.appendChild(info);
    btn.appendChild(remove);
    btn.addEventListener('click', () => openRecent(entry));
    li.appendChild(btn);
    elements.recentList.appendChild(li);
  }
}

async function openRecent(entry) {
  if (!canReplaceDocument('Opening this file')) return;
  try {
    if (isElectron() && entry.path) {
      const { buffer, size } = await readElectronFile(entry.path);
      await loadPDF(buffer, entry.name, {
        path: entry.path,
        size,
        startPage: entry.lastPage,
      });
      return;
    }
    if (isElectron() && !entry.path) {
      showError('This file was opened in a browser session — please open it again with Open.');
      return;
    }
    const blob = await getBlob(entry.id).catch(() => null);
    if (blob) {
      await loadPDF(blob, entry.name, { size: entry.size, startPage: entry.lastPage });
    } else {
      showError(
        `"${entry.name}" is no longer cached in this browser session. Please open it again with Open or drag-and-drop.`
      );
    }
  } catch (err) {
    console.error('Reopen failed:', err);
    showError(`Could not reopen "${entry.name}": ${err.message}`);
  }
}

async function maybeReopenLast() {
  if (!getReopenLast()) return;
  const list = getRecents();
  if (list.length === 0) return;
  const entry = list[0];
  try {
    if (isElectron()) {
      if (!entry.path) return;
      const { buffer, size } = await readElectronFile(entry.path);
      await loadPDF(buffer, entry.name, { path: entry.path, size, startPage: entry.lastPage });
    } else {
      const blob = await getBlob(entry.id).catch(() => null);
      if (!blob) return;
      await loadPDF(blob, entry.name, { size: entry.size, startPage: entry.lastPage });
    }
  } catch (err) {
    console.warn('Reopen last document failed:', err);
    // Stay on the welcome screen — never strand the user on an error.
  }
}

// --- Page tools (Phase 4) ---

/** Returns false when the user keeps unsaved edits and declines to discard them. */
function canReplaceDocument(actionText) {
  if (pageTools?.isDirty) return pageTools.confirmDiscardIfDirty(actionText);
  // Phase 5: values typed into a form live in memory until they are saved.
  if (forms?.isDirty) {
    return window.confirm(
      `You have unsaved form values. ${actionText} will discard them. Continue?`
    );
  }
  return true;
}

/** True while anything is unsaved, for the leave-page guard. */
function hasUnsavedWork() {
  return Boolean(pageTools?.isDirty || forms?.isDirty);
}

/** Save the filled form: native dialog in Electron, download in the browser. */
async function saveFilledFormBytes(bytes, suggestedName) {
  if (isElectron()) {
    return window.cambuzAPI.savePdf(bytes, {
      suggestedName,
      originalPath: currentFilePath || '',
    });
  }
  downloadPdfBytes(bytes, suggestedName);
  return { ok: true, name: suggestedName, path: null };
}

function downloadPdfBytes(bytes, name) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Window-scoped so the timer dies with the page instead of outliving it.
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Open a saved file (Save As result) in the viewer. */
async function openSavedDocument({ bytes, name, path }) {
  const copy = new Uint8Array(bytes).slice();
  await loadPDF(copy.buffer, name, { path: path || undefined, size: copy.byteLength });
}

/** Files to merge into the working copy: native picker in Electron, file input in the browser. */
async function pickPdfFilesForMerge() {
  if (isElectron()) {
    const paths = await window.cambuzAPI.openPdfPaths();
    const files = [];
    for (const filePath of paths || []) {
      const { buffer, name, size } = await readElectronFile(filePath);
      files.push({ name, bytes: new Uint8Array(buffer), size });
    }
    return files;
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,application/pdf';
    input.multiple = true;
    input.addEventListener('cancel', () => resolve([]));
    input.onchange = async () => {
      const files = await Promise.all(
        [...input.files].map(async (file) => ({
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
          size: file.size,
        }))
      );
      resolve(files);
    };
    input.click();
  });
}

function saveAsRequested() {
  if (!pdfDoc) {
    setStatus('Open a PDF before saving.');
    return;
  }
  pageTools?.saveAs();
}

function duplicateRequested() {
  if (!pdfDoc) {
    setStatus('Open a PDF before duplicating it.');
    return;
  }
  pageTools?.duplicate();
}

// --- Error Handling ---

function showError(message) {
  elements.errorMessage.textContent = message;
  elements.errorDisplay.style.display = 'flex';
  setStatus('Error');
}

function hideError() {
  elements.errorDisplay.style.display = 'none';
}

// --- File Opening ---

function isElectron() {
  return !!window.cambuzAPI;
}

/** The bytes of a successful host file-read result, as an ArrayBuffer. */
function hostFileBuffer(res) {
  if (!res || !res.ok) {
    throw new Error((res && res.error) || 'Could not read file');
  }
  const data = res.data;
  let buffer = null;
  if (data instanceof ArrayBuffer) {
    buffer = data;
  } else if (ArrayBuffer.isView(data)) {
    buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  } else if (data && data.type === 'Buffer' && Array.isArray(data.data)) {
    buffer = new Uint8Array(data.data).buffer;
  }
  if (!buffer) throw new Error('Unexpected file data from host');
  return buffer;
}

/** Read a native file via the Electron host. Returns { buffer, name, size }. */
async function readElectronFile(filePath) {
  const res = await window.cambuzAPI.readFile(filePath);
  return { buffer: hostFileBuffer(res), name: res.name, size: res.size };
}

/** Read a bundled sample via the Electron host. Returns { buffer, name, size }. */
async function readElectronSample(fileName) {
  const res = await window.cambuzAPI.readSample(fileName);
  return { buffer: hostFileBuffer(res), name: res.name, size: res.size };
}

async function openFile() {
  if (!canReplaceDocument('Opening another file')) return;
  // Electron — native dialog + native file read.
  if (isElectron()) {
    try {
      const filePath = await window.cambuzAPI.openFile();
      if (!filePath) return;
      const { buffer, name, size } = await readElectronFile(filePath);
      await loadPDF(buffer, name, { path: filePath, size });
    } catch (err) {
      console.error('Open failed:', err);
      showError(`Failed to open PDF: ${err.message}`);
    }
    return;
  }

  // Web fallback — file input.
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,application/pdf';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const buffer = await file.arrayBuffer();
        await loadPDF(buffer, file.name, { size: file.size, mtime: file.lastModified });
      } catch (err) {
        console.error('Open failed:', err);
        showError(`Failed to open PDF: ${err.message}`);
      }
    }
  };
  input.click();
}

async function loadSample() {
  await openBundledSample('cambuz-demo.pdf');
}

/** The Phase 5 form sample — a PDF with real AcroForm fields. */
async function loadFormSample() {
  await openBundledSample('form-sample.pdf', { openForms: true });
}

/**
 * Open one of the bundled sample PDFs.
 *
 * In Electron the page is loaded from file://, where a root-relative fetch such
 * as fetch('/samples/…') resolves to the file-system root and fails, so the
 * main process reads the sample and sends the bytes over IPC. In the browser
 * preview the samples are ordinary static files next to the viewer.
 */
async function openBundledSample(fileName, meta = {}) {
  if (!canReplaceDocument('Opening the sample')) return;
  try {
    if (isElectron()) {
      const { buffer, size } = await readElectronSample(fileName);
      await loadPDF(buffer, fileName, { ...meta, size });
    } else {
      const url = new URL(`../samples/${fileName}`, import.meta.url).href;
      await loadPDF(url, fileName, meta);
    }
  } catch (err) {
    console.error('Sample open failed:', err);
    showError(`Failed to open PDF: ${err.message}`);
  }
}

// --- Drag and Drop ---

let dragCounter = 0;

function setupDragDrop() {
  const mainContent = document.getElementById('main-content');

  mainContent.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    elements.dropOverlay.style.display = 'flex';
  });

  mainContent.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      elements.dropOverlay.style.display = 'none';
    }
  });

  mainContent.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  mainContent.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    elements.dropOverlay.style.display = 'none';

    const files = e.dataTransfer.files;
    if (files.length > 0 && !canReplaceDocument('Opening the dropped file')) {
      return;
    }
    if (files.length > 0) {
      const file = files[0];
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        try {
          const buffer = await file.arrayBuffer();
          await loadPDF(buffer, file.name, { size: file.size, mtime: file.lastModified });
        } catch (err) {
          console.error('Drop open failed:', err);
          showError(`Failed to open PDF: ${err.message}`);
        }
      } else {
        showError('Please drop a PDF file.');
      }
    }
  });
}

// --- Keyboard Shortcuts ---

function isTypingTarget() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return !!el.isContentEditable;
}

function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;

    // Escape always closes transient UI (dialog first, then search).
    if (key === 'Escape') {
      if (passwordPrompt?.isOpen) {
        e.preventDefault();
        passwordPrompt.cancel();
        return;
      }
      if (elements.shortcutsDialog.style.display !== 'none') {
        e.preventDefault();
        toggleShortcuts(false);
        return;
      }
      if (ocrUi?.isOpen) {
        e.preventDefault();
        ocrUi.hide();
        return;
      }
      if (securityUi?.isOpen) {
        e.preventDefault();
        securityUi.hide();
        return;
      }
      if (pageTools?.isOpen) {
        e.preventDefault();
        pageTools.close(true);
        return;
      }
      if (printing?.isOpen) {
        e.preventDefault();
        printing.close(true);
        return;
      }
      if (forms?.isEnabled) {
        e.preventDefault();
        forms.disable();
        return;
      }
      if (elements.searchBar.style.display !== 'none') {
        e.preventDefault();
        toggleSearch(false);
        return;
      }
      return;
    }

    // Keep shortcuts intended for the document behind the modal from leaking
    // through while the print settings/preview dialog is active.
    if (printing?.isOpen || pageTools?.isOpen || ocrUi?.isOpen) return;

    if (key === 'F1') {
      e.preventDefault();
      toggleShortcuts();
      return;
    }

    if (key === 'F11') {
      e.preventDefault();
      toggleFullscreen();
      return;
    }

    if (key === 'F9') {
      if (pdfDoc && !isTypingTarget()) {
        e.preventDefault();
        sidebar.toggle();
      }
      return;
    }

    // Ctrl+F is search; Ctrl+Shift+F (Phase 5) is form filling.
    if (mod && !e.shiftKey && (key === 'f' || key === 'F')) {
      e.preventDefault();
      toggleSearch(true);
      return;
    }

    if (mod && (key === 'a' || key === 'A')) {
      if (pdfDoc && !isTypingTarget()) {
        e.preventDefault();
        selectPageText();
      }
      return;
    }

    if (mod && (key === 'o' || key === 'O')) {
      e.preventDefault();
      openFile();
      return;
    }

    if (mod && e.shiftKey && (key === 'E' || key === 'e')) {
      e.preventDefault();
      openPageTools();
      return;
    }

    // Phase 5: toggle form filling.
    if (mod && e.shiftKey && (key === 'F' || key === 'f')) {
      e.preventDefault();
      toggleForms();
      return;
    }

    // Phase 5: document security dialog.
    if (mod && e.shiftKey && (key === 'K' || key === 'k')) {
      e.preventDefault();
      if (pdfDoc) securityUi?.toggle();
      else setStatus('Open a PDF to see its security settings.');
      return;
    }

    if (mod && e.shiftKey && (key === 'S' || key === 's')) {
      e.preventDefault();
      saveAsRequested();
      return;
    }

    if (mod && (key === 'p' || key === 'P')) {
      e.preventDefault();
      openPrint();
      return;
    }

    if (key === 'F3') {
      if (search && search.query) {
        e.preventDefault();
        if (e.shiftKey) search.prev();
        else search.next();
      }
      return;
    }

    // Everything below is disabled while typing in an input.
    if (isTypingTarget()) return;

    switch (key) {
      case 'PageUp':
        e.preventDefault();
        prevPage();
        break;
      case 'PageDown':
        e.preventDefault();
        nextPage();
        break;
      case 'ArrowLeft':
        if (pdfDoc) {
          e.preventDefault();
          prevPage();
        }
        break;
      case 'ArrowRight':
        if (pdfDoc) {
          e.preventDefault();
          nextPage();
        }
        break;
      case 'Home':
        e.preventDefault();
        goToPage(1);
        break;
      case 'End':
        e.preventDefault();
        goToPage(totalPages);
        break;
      case '?':
        e.preventDefault();
        toggleShortcuts();
        break;
      case 'r':
        if (pdfDoc && !mod) {
          e.preventDefault();
          rotateCW();
        }
        break;
      case 'R':
        if (pdfDoc && !mod) {
          e.preventDefault();
          rotateCCW();
        }
        break;
      case '+':
      case '=':
        if (mod) {
          e.preventDefault();
          zoomIn();
        }
        break;
      case '-':
        if (mod) {
          e.preventDefault();
          zoomOut();
        }
        break;
      case '0':
        if (mod) {
          e.preventDefault();
          if (e.shiftKey) {
            fitToWidth();
          } else {
            fitToPage();
          }
        }
        break;
      case 'D':
        if (mod && e.shiftKey) {
          e.preventDefault();
          toggleTheme();
        }
        break;
    }
  });
}

// --- Event Bindings ---

function setupEvents() {
  // Phase 1 buttons
  elements.btnOpen.addEventListener('click', openFile);
  elements.btnWelcomeOpen.addEventListener('click', openFile);
  elements.btnSample.addEventListener('click', loadSample);
  elements.btnSampleForm?.addEventListener('click', loadFormSample);
  elements.btnClose.addEventListener('click', closePDF);
  elements.btnPrev.addEventListener('click', prevPage);
  elements.btnNext.addEventListener('click', nextPage);
  elements.btnZoomIn.addEventListener('click', zoomIn);
  elements.btnZoomOut.addEventListener('click', zoomOut);
  elements.btnFitPage.addEventListener('click', fitToPage);
  elements.btnFitWidth.addEventListener('click', fitToWidth);
  elements.btnTheme.addEventListener('click', toggleTheme);
  elements.btnErrorDismiss.addEventListener('click', hideError);

  // Phase 2 buttons
  elements.btnSidebar.addEventListener('click', () => sidebar.toggle());
  elements.btnRotateCw.addEventListener('click', rotateCW);
  elements.btnRotateCcw.addEventListener('click', rotateCCW);
  elements.btnFullscreen.addEventListener('click', toggleFullscreen);
  elements.btnHelp.addEventListener('click', () => toggleShortcuts(true));
  elements.btnWelcomeShortcuts.addEventListener('click', () => toggleShortcuts(true));
  elements.btnShortcutsClose.addEventListener('click', () => toggleShortcuts(false));
  elements.shortcutsDialog.addEventListener('click', (e) => {
    if (e.target === elements.shortcutsDialog) toggleShortcuts(false);
  });
  elements.btnClearRecents.addEventListener('click', () => {
    clearRecents();
    renderRecents();
  });
  elements.chkReopenLast.addEventListener('change', () => {
    setReopenLast(elements.chkReopenLast.checked);
  });

  // Phase 5: refuse to hand the page text to the clipboard when the document
  // denies copying. The text still renders and stays searchable.
  elements.textLayer.addEventListener('copy', (event) => {
    if (isBlocked(documentSecurity, 'copy')) {
      event.preventDefault();
      const message = refusalMessage(documentSecurity, 'copy');
      setStatus(message);
      showError(message);
    }
  });

  // The status-bar lock chip is a button as well as a label.
  elements.statusLock.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      securityUi?.show();
    }
  });

  // Page input
  elements.pageInput.addEventListener('change', () => {
    const val = parseInt(elements.pageInput.value, 10);
    if (!isNaN(val)) goToPage(val);
  });
  elements.pageInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = parseInt(elements.pageInput.value, 10);
      if (!isNaN(val)) goToPage(val);
      elements.pageInput.blur();
    } else if (e.key === 'Escape') {
      elements.pageInput.blur();
    }
  });

  // Mouse wheel zoom
  elements.pdfViewer.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY < 0) zoomIn();
        else zoomOut();
      }
    },
    { passive: false }
  );

  // Window resize — re-fit if in fit mode.
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(async () => {
      if (!pdfDoc || !fitMode) return;
      if (fitMode === 'page') {
        currentScale = await getBaseScale('page');
      } else if (fitMode === 'width') {
        currentScale = await getBaseScale('width');
      }
      updateZoomDisplay();
      await renderPage(currentPage);
    }, 150);
  });

  // Full-screen status feedback.
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
      setStatus('Full screen — press Esc or F11 to exit');
    } else if (pdfDoc) {
      setStatus(`Page ${currentPage} of ${totalPages}`);
    }
  });

  // Electron menu events.
  if (isElectron()) {
    const api = window.cambuzAPI;
    if (api.onMenuOpenFile) api.onMenuOpenFile(() => openFile());
    if (api.onMenuCloseFile) api.onMenuCloseFile(() => closePDF());
    if (api.onMenuPrint) api.onMenuPrint(() => openPrint());
    if (api.onMenuZoomIn) api.onMenuZoomIn(() => zoomIn());
    if (api.onMenuZoomOut) api.onMenuZoomOut(() => zoomOut());
    if (api.onMenuFitPage) api.onMenuFitPage(() => fitToPage());
    if (api.onMenuFitWidth) api.onMenuFitWidth(() => fitToWidth());
    if (api.onMenuPrevPage) api.onMenuPrevPage(() => prevPage());
    if (api.onMenuNextPage) api.onMenuNextPage(() => nextPage());
    if (api.onMenuToggleTheme) api.onMenuToggleTheme(() => toggleTheme());
    if (api.onMenuFind) api.onMenuFind(() => toggleSearch(true));
    if (api.onMenuSelectAll) api.onMenuSelectAll(() => selectPageText());
    if (api.onMenuRotateCW) api.onMenuRotateCW(() => rotateCW());
    if (api.onMenuRotateCCW) api.onMenuRotateCCW(() => rotateCCW());
    if (api.onMenuFullscreen) api.onMenuFullscreen(() => toggleFullscreen());
    if (api.onMenuSidebar) api.onMenuSidebar(() => pdfDoc && sidebar.toggle());
    if (api.onMenuShortcuts) api.onMenuShortcuts(() => toggleShortcuts(true));
    if (api.onMenuPageTools) api.onMenuPageTools(() => openPageTools());
    if (api.onMenuSaveAs) api.onMenuSaveAs(() => saveAsRequested());
    if (api.onMenuDuplicate) api.onMenuDuplicate(() => duplicateRequested());
    if (api.onMenuForms) api.onMenuForms(() => toggleForms());
    if (api.onMenuSecurity) api.onMenuSecurity(() => pdfDoc && securityUi?.show());
  }

  // Unsaved page edits and form values live only in memory; warn before
  // leaving the page. (Electron shows its own prompt via the main process's
  // will-prevent-unload hook.)
  window.addEventListener('beforeunload', (event) => {
    if (hasUnsavedWork()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}

// --- Initialize ---

export function initApp() {
  search = new SearchController({
    getDoc: () => pdfDoc,
    getCurrentPage: () => currentPage,
    goToPage: (n) => goToPage(n),
    getTextLayerEl: () => elements.textLayer,
    onStatus: (msg) => setStatus(msg),
    onCount: (msg) => {
      elements.searchCount.textContent = msg;
    },
  });

  sidebar = new SidebarController({
    sidebarEl: elements.sidebar,
    thumbsPanel: elements.thumbsPanel,
    outlinePanel: elements.outlinePanel,
    tabThumbs: elements.tabThumbs,
    tabOutline: elements.tabOutline,
    getDoc: () => pdfDoc,
    getRotation: () => rotation,
    goToPage: (n) => goToPage(n),
    onStatus: (msg) => setStatus(msg),
  });

  printing = new PrintController({
    pdfjsLib,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    getDoc: () => pdfDoc,
    getSourceBytes: () => originalPdfBytes,
    getCurrentPage: () => currentPage,
    getTotalPages: () => totalPages,
    getDocumentName: () => currentFileName,
    getDocumentGeneration: () => documentGeneration,
    onStatus: (msg) => setStatus(msg),
  });

  pageTools = new PageToolsController({
    pdfjsLib,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    getSourceBytes: () => originalPdfBytes,
    getDocumentName: () => currentFileName,
    getDocumentGeneration: () => documentGeneration,
    getCurrentFilePath: () => currentFilePath,
    pickPdfFiles: pickPdfFilesForMerge,
    onSaved: openSavedDocument,
    onStatus: (msg) => setStatus(msg),
  });

  passwordPrompt = new PasswordController({
    onStatus: (msg) => setStatus(msg),
  });

  forms = new FormController({
    getSourceBytes: () => originalPdfBytes,
    getDocumentGeneration: () => documentGeneration,
    getDocumentName: () => currentFileName,
    getCurrentPage: () => currentPage,
    getCurrentViewport: () =>
      lastViewport && lastViewportPage === currentPage
        ? { pageNumber: lastViewportPage, viewport: lastViewport }
        : null,
    getSecurity: () => documentSecurity,
    saveBytes: saveFilledFormBytes,
    onSaved: openSavedDocument,
    onStatus: (msg) => setStatus(msg),
  });

  securityUi = new SecurityController({
    getSecurity: () => documentSecurity,
    getDocumentName: () => currentFileName,
    onStatus: (msg) => setStatus(msg),
  });

  ocrUi = new OcrController({
    getDoc: () => pdfDoc,
    getCurrentPage: () => currentPage,
    getRotation: () => rotation,
    getDocumentName: () => currentFileName,
    getDocumentGeneration: () => documentGeneration,
    isCopyBlocked: () => isBlocked(documentSecurity, 'copy'),
    onStatus: (msg) => setStatus(msg),
  });

  setupEvents();
  setupSearchEvents();
  setupDragDrop();
  setupKeyboard();
  renderRecents();

  // Startup: explicit ?pdf= URL wins, otherwise optionally reopen last doc.
  const params = new URLSearchParams(window.location.search);
  const pdfUrl = params.get('pdf');
  if (pdfUrl) {
    loadPDF(pdfUrl, fileNameFromUrl(pdfUrl));
  } else {
    maybeReopenLast();
  }
}
