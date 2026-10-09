// Cambuz PDF Reader — Phase 7 optional OCR UI.
//
// OCR is a deliberate, per-page action in the desktop app. Recognized text is
// displayed in its own labelled result area and never mixed into the PDF's
// native selectable/searchable text layer.

import { OCR_LANGUAGES, renderPdfPageToPng } from './pdf-ocr.js';

function element(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error(`OCR interface is missing #${id}`);
  return found;
}

function languageLabel(codes) {
  const names = new Map(OCR_LANGUAGES.map((language) => [language.code, language.name]));
  return codes.map((code) => names.get(code) || code).join(' + ');
}

export class OcrController {
  constructor({
    getDoc,
    getCurrentPage,
    getRotation = () => 0,
    getDocumentName = () => 'Document',
    getDocumentGeneration = () => 0,
    isCopyBlocked = () => false,
    getAPI = () => (typeof window !== 'undefined' ? window.cambuzAPI : null),
    renderPage = renderPdfPageToPng,
    onStatus = () => {},
  } = {}) {
    this.getDoc = getDoc;
    this.getCurrentPage = getCurrentPage;
    this.getRotation = getRotation;
    this.getDocumentName = getDocumentName;
    this.getDocumentGeneration = getDocumentGeneration;
    this.isCopyBlocked = isCopyBlocked;
    this.getAPI = getAPI;
    this.renderPage = renderPage;
    this.onStatus = onStatus;

    this.ui = {
      toolbarButton: element('btn-ocr'),
      dialog: element('ocr-dialog'),
      documentLabel: element('ocr-document-label'),
      status: element('ocr-engine-status'),
      languages: element('ocr-languages'),
      languageHelp: element('ocr-language-help'),
      refresh: element('btn-ocr-refresh'),
      run: element('btn-ocr-run'),
      close: element('btn-ocr-close'),
      error: element('ocr-error'),
      result: element('ocr-result'),
      resultLabel: element('ocr-result-label'),
      resultNote: element('ocr-result-note'),
      output: element('ocr-output'),
    };

    this.open = false;
    this.running = false;
    this.allowed = false;
    this.status = null;
    this.statusSequence = 0;
    this.operationSequence = 0;
    this.resultContext = null;
    this.lastFocus = null;

    this.populateLanguages();
    this.ui.toolbarButton.addEventListener('click', () => this.show());
    this.ui.close.addEventListener('click', () => this.hide());
    this.ui.refresh.addEventListener('click', () => this.refreshStatus());
    this.ui.run.addEventListener('click', () => this.runCurrentPage());
    this.ui.languages.addEventListener('change', () => this.onLanguagesChanged());
    this.ui.dialog.addEventListener('click', (event) => {
      if (event.target === this.ui.dialog) this.hide();
    });
    this.updateRunButton();
  }

  get isOpen() {
    return this.open;
  }

  get isRunning() {
    return this.running;
  }

  populateLanguages() {
    this.ui.languages.replaceChildren();
    for (const language of OCR_LANGUAGES) {
      const option = document.createElement('option');
      option.value = language.code;
      option.textContent = `${language.name} (${language.code})`;
      option.disabled = true;
      this.ui.languages.appendChild(option);
    }
  }

  show() {
    if (!this.getDoc || !this.getDoc()) {
      this.onStatus('Open a PDF before using optional OCR.');
      return;
    }
    if (this.isCopyBlocked()) {
      this.onStatus('OCR is unavailable because this PDF does not allow copying text.');
      return;
    }
    if (this.open) return;

    this.open = true;
    this.lastFocus = document.activeElement;
    this.ui.toolbarButton.setAttribute('aria-expanded', 'true');
    this.ui.dialog.style.display = 'flex';
    this.ui.documentLabel.textContent = this.pageLabel();
    this.ui.error.textContent = '';
    this.clearStaleResult();
    const statusRequest = this.refreshStatus();
    this.ui.languages.focus();
    return statusRequest;
  }

  hide(force = false) {
    if (!this.open) return true;
    if (this.running && !force) {
      this.onStatus('OCR is still running for the current page.');
      return false;
    }
    this.open = false;
    this.ui.toolbarButton.setAttribute('aria-expanded', 'false');
    this.ui.dialog.style.display = 'none';
    if (this.lastFocus && typeof this.lastFocus.focus === 'function' && this.lastFocus.isConnected) {
      this.lastFocus.focus();
    } else {
      this.ui.toolbarButton.focus();
    }
    this.lastFocus = null;
    return true;
  }

  toggle() {
    if (this.open) return this.hide();
    this.show();
    return true;
  }

  /** Keep OCR unavailable for documents that forbid copying/extraction. */
  setDocumentAvailable(available) {
    this.allowed = Boolean(available) && !this.isCopyBlocked();
    this.ui.toolbarButton.disabled = !this.allowed;
    this.ui.toolbarButton.title = this.allowed
      ? 'Recognize text on the current page with optional local OCR'
      : this.isCopyBlocked()
        ? 'OCR is disabled because this PDF does not allow copying text'
        : 'Open a PDF to use optional OCR';
    if (!this.allowed && this.open) this.hide(true);
    this.updateRunButton();
  }

  pageLabel() {
    const page = Number(this.getCurrentPage?.()) || 1;
    const total = Number(this.getDoc?.()?.numPages) || 0;
    const name = this.getDocumentName?.() || 'Document';
    return `${name} · page ${page}${total ? ` of ${total}` : ''}`;
  }

  clearStaleResult() {
    if (!this.resultContext) return;
    const sameDocument = this.resultContext.generation === this.getDocumentGeneration?.();
    const samePage = this.resultContext.page === this.getCurrentPage?.();
    if (!sameDocument || !samePage) this.clearResult();
  }

  clearResult() {
    this.resultContext = null;
    this.ui.result.hidden = true;
    this.ui.resultLabel.textContent = '';
    this.ui.resultNote.textContent = '';
    this.ui.output.value = '';
  }

  async refreshStatus() {
    const sequence = ++this.statusSequence;
    this.ui.status.textContent = 'Checking the optional OCR engine…';
    this.ui.status.dataset.state = 'checking';
    this.ui.refresh.disabled = true;

    let status;
    const api = this.getAPI?.();
    if (!api || typeof api.getOcrStatus !== 'function' || typeof api.ocrPage !== 'function') {
      status = {
        available: false,
        version: '',
        languages: [],
        error: 'Local OCR is available in the desktop app only. The web preview cannot access a system OCR engine.',
      };
    } else {
      try {
        status = await api.getOcrStatus();
      } catch (error) {
        status = {
          available: false,
          version: '',
          languages: [],
          error: error?.message || 'Could not check the optional OCR engine.',
        };
      }
    }

    if (sequence !== this.statusSequence) return;
    this.status = status && typeof status === 'object'
      ? {
          available: Boolean(status.available),
          version: String(status.version || ''),
          languages: Array.isArray(status.languages)
            ? status.languages.filter((code) => OCR_LANGUAGES.some((language) => language.code === code))
            : [],
          error: String(status.error || ''),
        }
      : { available: false, version: '', languages: [], error: 'The OCR engine returned an invalid status.' };

    this.renderStatus();
    this.ui.refresh.disabled = this.running;
  }

  renderStatus() {
    const status = this.status || { available: false, languages: [], error: '' };
    const installed = new Set(status.languages);
    let selectedInstalled = false;
    for (const option of this.ui.languages.options) {
      const available = status.available && installed.has(option.value);
      option.disabled = !available || this.running;
      const language = OCR_LANGUAGES.find((candidate) => candidate.code === option.value);
      option.textContent = `${language.name} (${language.code})${available ? '' : ' — not installed'}`;
      if (option.selected && available) selectedInstalled = true;
    }

    if (!selectedInstalled && status.available) {
      const firstAvailable = [...this.ui.languages.options].find((option) => !option.disabled);
      if (firstAvailable) firstAvailable.selected = true;
    }

    if (!status.available) {
      this.ui.status.textContent = status.error || 'Optional Tesseract OCR is not available.';
      this.ui.status.dataset.state = 'unavailable';
      this.ui.languageHelp.textContent =
        'Install Tesseract OCR 4 or newer separately, including the language data you need, add it to PATH, then restart Cambuz or choose Check again.';
    } else if (!status.languages.length) {
      this.ui.status.textContent = status.error || 'Tesseract is installed, but no supported language data was found.';
      this.ui.status.dataset.state = 'unavailable';
      this.ui.languageHelp.textContent = 'Install at least one supported Tesseract language pack, then choose Check again.';
    } else {
      this.ui.status.textContent = `Local Tesseract ${status.version || ''} is ready. ${status.languages.length} supported language pack${status.languages.length === 1 ? '' : 's'} found.`;
      this.ui.status.dataset.state = 'ready';
      this.ui.languageHelp.textContent =
        'Choose one to three installed languages. For mixed-script pages, select more than one with Ctrl-click (Windows/Linux) or Command-click (macOS).';
    }

    this.ui.refresh.disabled = this.running;
    this.updateRunButton();
  }

  onLanguagesChanged() {
    const selected = [...this.ui.languages.options].filter((option) => option.selected);
    if (selected.length > 3) {
      for (const option of selected.slice(3)) option.selected = false;
      this.ui.error.textContent = 'Choose no more than three languages for one page.';
    } else {
      this.ui.error.textContent = '';
    }
    this.updateRunButton();
  }

  selectedLanguages() {
    return [...this.ui.languages.options]
      .filter((option) => option.selected && !option.disabled)
      .map((option) => option.value);
  }

  updateRunButton() {
    this.ui.run.disabled =
      this.running ||
      !this.allowed ||
      !this.status?.available ||
      this.selectedLanguages().length < 1;
    this.ui.run.textContent = this.running ? 'Recognizing page…' : 'Recognize current page';
  }

  async runCurrentPage() {
    if (this.running) return;
    if (!this.getDoc?.()) {
      this.ui.error.textContent = 'Open a PDF before recognizing a page.';
      return;
    }
    if (this.isCopyBlocked()) {
      this.ui.error.textContent = 'OCR is disabled because this PDF does not allow copying text.';
      this.setDocumentAvailable(false);
      return;
    }

    const api = this.getAPI?.();
    const languages = this.selectedLanguages();
    if (!api || typeof api.ocrPage !== 'function') {
      this.ui.error.textContent = 'Local OCR is only available in the desktop app.';
      return;
    }
    if (!languages.length || languages.length > 3) {
      this.ui.error.textContent = 'Choose one to three installed OCR languages.';
      return;
    }

    const doc = this.getDoc();
    const pageNumber = Number(this.getCurrentPage?.()) || 1;
    const generation = this.getDocumentGeneration?.();
    const sequence = ++this.operationSequence;
    this.running = true;
    this.ui.documentLabel.textContent = this.pageLabel();
    this.ui.error.textContent = '';
    this.clearResult();
    this.ui.status.textContent = `Rendering page ${pageNumber} for local OCR…`;
    this.ui.status.dataset.state = 'checking';
    this.setControlsBusy(true);
    this.updateRunButton();

    try {
      const page = await doc.getPage(pageNumber);
      const rendered = await this.renderPage(page, { rotation: this.getRotation?.() || 0 });
      if (!this.isCurrentOperation(sequence, doc, pageNumber, generation)) return;

      this.ui.status.textContent = `Recognizing page ${pageNumber} locally with ${languageLabel(languages)}…`;
      const result = await api.ocrPage(rendered.bytes, languages.join('+'));
      if (!this.isCurrentOperation(sequence, doc, pageNumber, generation)) return;
      if (!result || !result.ok) {
        throw new Error(result?.error || 'The optional OCR engine could not recognize this page.');
      }

      const text = String(result.text || '').trim();
      this.ui.output.value = text;
      this.ui.resultLabel.textContent =
        `OCR-generated text · page ${pageNumber} · ${languageLabel(languages)}${result.version ? ` · Tesseract ${result.version}` : ''}`;
      this.ui.resultNote.textContent = text
        ? 'This is OCR output, not text embedded in the PDF. It is not added to the PDF text layer or Cambuz document search. Select this box to copy the recognized text.'
        : 'No text was recognized. This OCR result is separate from the PDF text layer and is not added to Cambuz document search.';
      this.ui.result.hidden = false;
      this.resultContext = { generation, page: pageNumber };
      this.ui.status.textContent = text
        ? `OCR finished for page ${pageNumber}. Check the OCR-generated result below; recognition may contain errors.`
        : `OCR finished for page ${pageNumber}; no text was found.`;
      this.ui.status.dataset.state = 'ready';
      this.onStatus(`OCR finished for page ${pageNumber}.`);
    } catch (error) {
      if (this.isCurrentOperation(sequence, doc, pageNumber, generation)) {
        this.ui.error.textContent = error?.message || 'OCR failed for this page.';
        this.ui.status.textContent = 'OCR did not finish.';
        this.ui.status.dataset.state = 'unavailable';
      }
    } finally {
      if (sequence === this.operationSequence) {
        this.running = false;
        this.setControlsBusy(false);
        this.renderStatus();
        if (this.ui.status.dataset.state === 'ready' && this.ui.result.hidden === false) {
          const text = this.ui.output.value.trim();
          this.ui.status.textContent = text
            ? `OCR finished for page ${pageNumber}. Check the OCR-generated result below; recognition may contain errors.`
            : `OCR finished for page ${pageNumber}; no text was found.`;
        }
        this.updateRunButton();
      }
    }
  }

  isCurrentOperation(sequence, doc, pageNumber, generation) {
    return (
      sequence === this.operationSequence &&
      this.getDoc?.() === doc &&
      this.getCurrentPage?.() === pageNumber &&
      this.getDocumentGeneration?.() === generation
    );
  }

  setControlsBusy(busy) {
    this.ui.languages.disabled = busy || !this.status?.available;
    this.ui.refresh.disabled = busy;
    this.ui.close.disabled = busy;
    this.ui.toolbarButton.disabled = busy || !this.allowed;
    for (const option of this.ui.languages.options) {
      const available = this.status?.available && this.status.languages.includes(option.value);
      option.disabled = busy || !available;
    }
    if (!busy) this.renderStatus();
  }

  /** Invalidate prior OCR results when the underlying document is replaced. */
  onDocumentChanged() {
    this.operationSequence += 1;
    this.statusSequence += 1;
    this.running = false;
    this.clearResult();
    this.ui.error.textContent = '';
    this.ui.status.textContent = '';
    this.ui.languages.disabled = false;
    this.ui.refresh.disabled = false;
    this.ui.close.disabled = false;
    this.ui.toolbarButton.disabled = true;
    for (const option of this.ui.languages.options) option.disabled = true;
    this.hide(true);
    this.updateRunButton();
  }
}
