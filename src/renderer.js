// Cambuz PDF Reader — Renderer
// Handles PDF loading, rendering, navigation, and zoom

// PDF.js setup
const pdfjsLib = await import('../node_modules/pdfjs-dist/build/pdf.mjs');
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../node_modules/pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).href;

// State
let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let currentScale = 1.0;
let fitMode = null; // 'page' | 'width' | null (manual zoom)
let rendering = false;
let pendingRender = false;
let currentFileName = 'Document';

// DOM elements
const elements = {
  welcomeScreen: document.getElementById('welcome-screen'),
  pdfViewer: document.getElementById('pdf-viewer'),
  pdfCanvas: document.getElementById('pdf-canvas'),
  dropOverlay: document.getElementById('drop-overlay'),
  errorDisplay: document.getElementById('error-display'),
  errorMessage: document.getElementById('error-message'),
  btnOpen: document.getElementById('btn-open'),
  btnClose: document.getElementById('btn-close'),
  btnPrev: document.getElementById('btn-prev'),
  btnNext: document.getElementById('btn-next'),
  btnZoomIn: document.getElementById('btn-zoom-in'),
  btnZoomOut: document.getElementById('btn-zoom-out'),
  btnFitPage: document.getElementById('btn-fit-page'),
  btnFitWidth: document.getElementById('btn-fit-width'),
  btnTheme: document.getElementById('btn-theme'),
  btnWelcomeOpen: document.getElementById('btn-welcome-open'),
  btnSample: document.getElementById('btn-sample'),
  btnErrorDismiss: document.getElementById('btn-error-dismiss'),
  pageInput: document.getElementById('page-input'),
  pageTotal: document.getElementById('page-total'),
  zoomLevel: document.getElementById('zoom-level'),
  docTitle: document.getElementById('doc-title'),
  statusText: document.getElementById('status-text'),
  statusFile: document.getElementById('status-file'),
  themeIconDark: document.getElementById('theme-icon-dark'),
  themeIconLight: document.getElementById('theme-icon-light'),
};

// --- PDF Loading ---

async function loadPDF(source, fileName) {
  try {
    let data;
    if (source instanceof ArrayBuffer) {
      data = source;
    } else if (typeof source === 'string') {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status}`);
      data = await response.arrayBuffer();
    } else {
      throw new Error('Invalid PDF source');
    }

    const loadingTask = pdfjsLib.getDocument({ data });
    pdfDoc = await loadingTask.promise;
    totalPages = pdfDoc.numPages;
    currentPage = 1;
    currentFileName = fileName || 'Document';

    // Update UI — enable controls
    elements.pageTotal.textContent = totalPages;
    elements.pageInput.max = totalPages;
    elements.pageInput.value = 1;
    elements.pageInput.disabled = false;
    elements.btnClose.disabled = false;
    elements.btnPrev.disabled = true;
    elements.btnNext.disabled = totalPages <= 1;
    elements.btnZoomIn.disabled = false;
    elements.btnZoomOut.disabled = false;
    elements.btnFitPage.disabled = false;
    elements.btnFitWidth.disabled = false;

    // Show viewer, hide welcome
    elements.welcomeScreen.style.display = 'none';
    elements.pdfViewer.style.display = 'flex';
    elements.errorDisplay.style.display = 'none';

    // Set title and status
    elements.docTitle.textContent = currentFileName;
    elements.statusFile.textContent = currentFileName;
    elements.statusText.textContent = `Loaded — ${totalPages} page${totalPages !== 1 ? 's' : ''}`;

    // Initial render — fit to width
    fitMode = 'width';
    const baseScale = await getBaseScale('width');
    currentScale = baseScale;
    updateZoomDisplay();
    await renderPage(currentPage);
  } catch (err) {
    showError(`Failed to open PDF: ${err.message}`);
    console.error('PDF load error:', err);
  }
}

function closePDF() {
  pdfDoc = null;
  totalPages = 0;
  currentPage = 1;
  currentScale = 1.0;
  fitMode = null;
  currentFileName = 'Document';

  // Clear canvas
  const canvas = elements.pdfCanvas;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;

  // Reset UI
  elements.pdfViewer.style.display = 'none';
  elements.welcomeScreen.style.display = 'flex';
  elements.docTitle.textContent = 'Cambuz PDF Reader';
  elements.statusText.textContent = 'Ready';
  elements.statusFile.textContent = '';
  elements.pageInput.disabled = true;
  elements.pageInput.value = 1;
  elements.pageTotal.textContent = '0';
  elements.zoomLevel.textContent = '100%';
  elements.btnClose.disabled = true;
  elements.btnPrev.disabled = true;
  elements.btnNext.disabled = true;
  elements.btnZoomIn.disabled = true;
  elements.btnZoomOut.disabled = true;
  elements.btnFitPage.disabled = true;
  elements.btnFitWidth.disabled = true;
}

// --- Rendering ---

async function renderPage(pageNum) {
  if (!pdfDoc) return;

  if (rendering) {
    pendingRender = true;
    return;
  }

  rendering = true;
  elements.statusText.textContent = `Rendering page ${pageNum}...`;

  try {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: currentScale });

    const canvas = elements.pdfCanvas;
    const ctx = canvas.getContext('2d');

    // Support high-DPI displays
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    await page.render({
      canvasContext: ctx,
      viewport: viewport,
    }).promise;

    elements.statusText.textContent = `Page ${pageNum} of ${totalPages}`;
  } catch (err) {
    showError(`Failed to render page: ${err.message}`);
    console.error('Render error:', err);
  } finally {
    rendering = false;
    if (pendingRender) {
      pendingRender = false;
      renderPage(currentPage);
    }
  }
}

// --- Navigation ---

function goToPage(pageNum) {
  if (!pdfDoc) return;
  const target = Math.max(1, Math.min(totalPages, pageNum));
  if (target === currentPage) return;

  currentPage = target;
  elements.pageInput.value = currentPage;
  elements.btnPrev.disabled = currentPage <= 1;
  elements.btnNext.disabled = currentPage >= totalPages;

  renderPage(currentPage);
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
}

async function getBaseScale(mode) {
  if (!pdfDoc) return 1;
  const page = await pdfDoc.getPage(currentPage);
  const viewport = page.getViewport({ scale: 1 });

  if (mode === 'page') {
    const container = elements.pdfViewer;
    const padding = 40;
    const availW = container.clientWidth - padding;
    const availH = container.clientHeight - padding;
    return Math.min(availW / viewport.width, availH / viewport.height);
  }

  if (mode === 'width') {
    const container = elements.pdfViewer;
    const padding = 40;
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

// --- Theme ---

function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);

  elements.themeIconDark.style.display = next === 'dark' ? 'block' : 'none';
  elements.themeIconLight.style.display = next === 'light' ? 'block' : 'none';
}

// --- Error Handling ---

function showError(message) {
  elements.errorMessage.textContent = message;
  elements.errorDisplay.style.display = 'flex';
  elements.statusText.textContent = 'Error';
}

function hideError() {
  elements.errorDisplay.style.display = 'none';
}

// --- File Opening (works in both Electron and web mode) ---

async function openFile() {
  // Try Electron API first
  if (window.cambuzAPI) {
    const filePath = await window.cambuzAPI.openFile();
    if (filePath) {
      const name = filePath.split(/[\\/]/).pop();
      await loadPDF(filePath, name);
    }
    return;
  }

  // Web fallback — file input
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,application/pdf';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      const buffer = await file.arrayBuffer();
      await loadPDF(buffer, file.name);
    }
  };
  input.click();
}

async function loadSample() {
  await loadPDF('/samples/cambuz-demo.pdf', 'cambuz-demo.pdf');
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
    if (files.length > 0) {
      const file = files[0];
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const buffer = await file.arrayBuffer();
        await loadPDF(buffer, file.name);
      } else {
        showError('Please drop a PDF file.');
      }
    }
  });
}

// --- Keyboard Shortcuts ---

function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    // Don't capture when typing in page input
    if (document.activeElement === elements.pageInput) return;

    switch (e.key) {
      case 'PageUp':
        e.preventDefault();
        prevPage();
        break;
      case 'PageDown':
        e.preventDefault();
        nextPage();
        break;
      case 'Home':
        e.preventDefault();
        goToPage(1);
        break;
      case 'End':
        e.preventDefault();
        goToPage(totalPages);
        break;
      case '+':
      case '=':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          zoomIn();
        }
        break;
      case '-':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          zoomOut();
        }
        break;
      case '0':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          if (e.shiftKey) {
            fitToWidth();
          } else {
            fitToPage();
          }
        }
        break;
    }
  });
}

// --- Event Bindings ---

function setupEvents() {
  // Buttons
  elements.btnOpen.addEventListener('click', openFile);
  elements.btnWelcomeOpen.addEventListener('click', openFile);
  elements.btnSample.addEventListener('click', loadSample);
  elements.btnClose.addEventListener('click', closePDF);
  elements.btnPrev.addEventListener('click', prevPage);
  elements.btnNext.addEventListener('click', nextPage);
  elements.btnZoomIn.addEventListener('click', zoomIn);
  elements.btnZoomOut.addEventListener('click', zoomOut);
  elements.btnFitPage.addEventListener('click', fitToPage);
  elements.btnFitWidth.addEventListener('click', fitToWidth);
  elements.btnTheme.addEventListener('click', toggleTheme);
  elements.btnErrorDismiss.addEventListener('click', hideError);

  // Page input
  elements.pageInput.addEventListener('change', () => {
    const val = parseInt(elements.pageInput.value, 10);
    if (!isNaN(val)) goToPage(val);
  });
  elements.pageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = parseInt(elements.pageInput.value, 10);
      if (!isNaN(val)) goToPage(val);
      elements.pageInput.blur();
    }
  });

  // Mouse wheel zoom
  elements.pdfViewer.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY < 0) zoomIn();
      else zoomOut();
    }
  }, { passive: false });

  // Window resize — re-fit if in fit mode
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

  // Electron menu events
  if (window.cambuzAPI) {
    window.cambuzAPI.onMenuOpenFile(() => openFile());
    window.cambuzAPI.onMenuCloseFile(() => closePDF());
    window.cambuzAPI.onMenuZoomIn(() => zoomIn());
    window.cambuzAPI.onMenuZoomOut(() => zoomOut());
    window.cambuzAPI.onMenuFitPage(() => fitToPage());
    window.cambuzAPI.onMenuFitWidth(() => fitToWidth());
    window.cambuzAPI.onMenuPrevPage(() => prevPage());
    window.cambuzAPI.onMenuNextPage(() => nextPage());
    window.cambuzAPI.onMenuToggleTheme(() => toggleTheme());
  }
}

// --- Initialize ---

export function initApp() {
  setupEvents();
  setupDragDrop();
  setupKeyboard();

  // Check for URL param (for web mode / demo)
  const params = new URLSearchParams(window.location.search);
  const pdfUrl = params.get('pdf');
  if (pdfUrl) {
    loadPDF(pdfUrl);
  }
}