// Cambuz PDF Reader — Phase 4 page tools dialog.
//
// Edits happen on a *working copy* held in memory. The file on disk is only
// changed when the user chooses Save As and confirms the target (overwriting
// the original requires an extra explicit confirmation in the native dialog).
// Undo keeps a short in-memory history until the document is closed.

import {
  appendPdfs,
  computeMove,
  deletePages,
  extractPages,
  parseSplitPlan,
  readMetadata,
  reorderPages,
  rotatePages,
  splitPdf,
  writeMetadata,
} from './pdf-ops.js';

const HISTORY_LIMIT = 20;
const THUMB_CSS_WIDTH = 124;
const DOWNLOAD_GAP_MS = 400;

function element(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Page tools interface is missing #${id}`);
  return found;
}

function baseName(name) {
  return String(name || 'document').replace(/\.pdf$/i, '') || 'document';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PageToolsController {
  constructor({
    pdfjsLib,
    standardFontDataUrl,
    getSourceBytes,
    getDocumentName,
    getDocumentGeneration,
    getCurrentFilePath,
    pickPdfFiles = null,
    onSaved = async () => {},
    onStatus = () => {},
  }) {
    this.pdfjsLib = pdfjsLib;
    this.standardFontDataUrl = standardFontDataUrl;
    this.getSourceBytes = getSourceBytes;
    this.getDocumentName = getDocumentName;
    this.getDocumentGeneration = getDocumentGeneration;
    this.getCurrentFilePath = getCurrentFilePath;
    this.pickPdfFiles = pickPdfFiles;
    this.onSaved = onSaved;
    this.onStatus = onStatus;

    this.ui = {
      dialog: element('pageops-dialog'),
      documentLabel: element('pageops-doc-label'),
      dirtyBadge: element('pageops-dirty'),
      closeButton: element('btn-pageops-close'),
      toolbarButton: element('btn-pageops'),
      grid: element('pageops-grid'),
      gridScroll: element('pageops-grid-scroll'),
      rotateLeft: element('btn-po-rotate-ccw'),
      rotateRight: element('btn-po-rotate-cw'),
      moveUp: element('btn-po-move-up'),
      moveDown: element('btn-po-move-down'),
      selectAll: element('btn-po-select-all'),
      deletePages: element('btn-po-delete'),
      extract: element('btn-po-extract'),
      undo: element('btn-po-undo'),
      addPdf: element('btn-po-add'),
      metaTitle: element('po-meta-title'),
      metaAuthor: element('po-meta-author'),
      metaSubject: element('po-meta-subject'),
      metaKeywords: element('po-meta-keywords'),
      metaInfo: element('po-meta-info'),
      metaApply: element('btn-po-meta-apply'),
      splitSpec: element('po-split-spec'),
      splitError: element('po-split-error'),
      splitButton: element('btn-po-split'),
      discard: element('btn-po-discard'),
      duplicate: element('btn-po-duplicate'),
      saveAs: element('btn-po-save-as'),
      status: element('pageops-status'),
    };

    this.opened = false;
    this.session = null;
    this.selected = new Set();
    this.anchor = null;
    this.busy = false;
    this.loadVersion = 0;
    this.thumbDoc = null;
    this.cells = [];
    this.observer = null;

    this.bindEvents();
    this.updateActionState();
  }

  get isOpen() {
    return this.opened;
  }

  /** True when the working copy has changes that are not yet saved. */
  get isDirty() {
    return !!this.session && this.session.bytes !== this.session.baseline;
  }

  /** Ask before an action that would replace the open document. */
  confirmDiscardIfDirty(actionText) {
    if (!this.isDirty) return true;
    return window.confirm(`You have unsaved page changes. ${actionText} will discard them. Continue?`);
  }

  bindEvents() {
    this.ui.toolbarButton.addEventListener('click', () => this.open());
    this.ui.closeButton.addEventListener('click', () => this.close(true));
    this.ui.dialog.addEventListener('click', (event) => {
      if (event.target === this.ui.dialog) this.close(true);
    });
    this.ui.dialog.addEventListener('keydown', (event) => this.onKeydown(event));

    this.ui.rotateLeft.addEventListener('click', () => this.rotateSelected(-90));
    this.ui.rotateRight.addEventListener('click', () => this.rotateSelected(90));
    this.ui.moveUp.addEventListener('click', () => this.moveSelected('up'));
    this.ui.moveDown.addEventListener('click', () => this.moveSelected('down'));
    this.ui.selectAll.addEventListener('click', () => this.selectAllPages());
    this.ui.deletePages.addEventListener('click', () => this.deleteSelected());
    this.ui.extract.addEventListener('click', () => this.extractSelected());
    this.ui.undo.addEventListener('click', () => this.undo());
    this.ui.addPdf.addEventListener('click', () => this.addPdfs());
    this.ui.metaApply.addEventListener('click', () => this.applyMetadata());
    this.ui.splitButton.addEventListener('click', () => this.splitDocument());
    this.ui.splitSpec.addEventListener('input', () => {
      this.ui.splitError.textContent = '';
    });
    this.ui.discard.addEventListener('click', () => this.discardChanges());
    this.ui.duplicate.addEventListener('click', () => this.saveDocument({ duplicate: true }));
    this.ui.saveAs.addEventListener('click', () => this.saveDocument({ duplicate: false }));
  }

  onKeydown(event) {
    if (this.busy) return;
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (typing) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.deleteSelected();
    } else if ((event.ctrlKey || event.metaKey) && (event.key === 'a' || event.key === 'A')) {
      event.preventDefault();
      this.selectAllPages();
    }
  }

  // --- Lifecycle -----------------------------------------------------------

  /** Create (or reuse) the working copy for the open document and show the dialog. */
  async open() {
    if (!this.ensureSession()) {
      this.onStatus('Open a PDF before using page tools.');
      return;
    }
    this.opened = true;
    this.ui.dialog.style.display = 'flex';
    this.ui.toolbarButton.setAttribute('aria-expanded', 'true');
    this.ui.documentLabel.textContent = `${this.session.name} — working copy`;
    this.setStatus(
      this.isDirty
        ? 'Unsaved page changes are kept. Save As to write them to a file.'
        : 'Select pages to rotate, move, delete or extract. The original file is not changed until you Save As.'
    );
    await this.withBusy(() => this.refresh());
    this.ui.closeButton.focus();
  }

  close(restoreFocus = true) {
    if (!this.opened) return;
    this.opened = false;
    this.ui.dialog.style.display = 'none';
    this.ui.toolbarButton.setAttribute('aria-expanded', 'false');
    this.disposeThumbnails();
    if (restoreFocus) this.ui.toolbarButton.focus();
  }

  /** Called when the viewer replaces or closes the document. */
  async onDocumentChanged() {
    this.session = null;
    this.selected = new Set();
    this.anchor = null;
    this.loadVersion += 1;
    this.disposeThumbnails();
    if (this.opened) this.close(false);
    this.updateActionState();
  }

  /** Enable the toolbar entry point only while a document is open. */
  setDocumentAvailable(available) {
    this.ui.toolbarButton.disabled = !available;
  }

  ensureSession() {
    const source = this.getSourceBytes();
    if (!source) return null;
    const generation = this.getDocumentGeneration();
    if (!this.session || this.session.generation !== generation) {
      this.session = {
        generation,
        baseline: source,
        bytes: source,
        history: [],
        pageCount: 0,
        name: this.getDocumentName() || 'document.pdf',
      };
      this.selected = new Set();
      this.anchor = null;
    }
    return this.session;
  }

  // --- Thumbnails and selection ---------------------------------------------

  async refresh() {
    const session = this.session;
    if (!session) return;
    const version = this.loadVersion + 1;
    this.loadVersion = version;
    this.disposeThumbnails();
    try {
      const doc = await this.pdfjsLib.getDocument({
        data: session.bytes.slice(),
        standardFontDataUrl: this.standardFontDataUrl,
      }).promise;
      if (version !== this.loadVersion) {
        doc.destroy().catch(() => {});
        return;
      }
      this.thumbDoc = doc;
      session.pageCount = doc.numPages;
      await this.fillMetadata(version);
      if (version !== this.loadVersion) return;
      this.clampSelection();
      this.buildGrid();
    } catch (error) {
      this.setStatus(`This document cannot be used for page tools: ${error.message}`, true);
    }
  }

  /** Run an async step with the dialog locked against other actions. */
  async withBusy(step) {
    this.setBusy(true);
    try {
      await step();
    } finally {
      this.setBusy(false);
    }
  }

  async fillMetadata(version) {
    const meta = await readMetadata(this.session.bytes);
    if (version !== this.loadVersion) return;
    this.ui.metaTitle.value = meta.title;
    this.ui.metaAuthor.value = meta.author;
    this.ui.metaSubject.value = meta.subject;
    this.ui.metaKeywords.value = meta.keywords;
    this.ui.metaInfo.textContent =
      `${meta.pageCount} page${meta.pageCount === 1 ? '' : 's'} · Creator: ${meta.creator || '—'} · Producer: ${meta.producer || '—'}`;
  }

  disposeThumbnails() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.thumbDoc) {
      const doc = this.thumbDoc;
      this.thumbDoc = null;
      doc.destroy().catch(() => {});
    }
    this.cells = [];
    this.ui.grid.innerHTML = '';
  }

  buildGrid() {
    const grid = this.ui.grid;
    grid.innerHTML = '';
    this.cells = [];
    const pageCount = this.session ? this.session.pageCount : 0;
    for (let position = 0; position < pageCount; position += 1) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'po-cell';
      cell.dataset.position = String(position);
      cell.setAttribute('aria-label', `Page ${position + 1}`);
      const frame = document.createElement('span');
      frame.className = 'po-thumb';
      const canvas = document.createElement('canvas');
      canvas.className = 'po-canvas';
      frame.appendChild(canvas);
      const label = document.createElement('span');
      label.className = 'po-label';
      label.textContent = String(position + 1);
      cell.append(frame, label);
      cell.addEventListener('click', (event) => this.onCellClick(position, event));
      grid.appendChild(cell);
      this.cells.push({ cell, canvas, rendered: false, pending: false });
    }
    this.syncSelectionClasses();
    this.observeThumbnails();
    this.updateActionState();
  }

  observeThumbnails() {
    if (typeof IntersectionObserver === 'undefined') {
      this.cells.forEach((_, position) => this.renderThumbnail(position));
      return;
    }
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.renderThumbnail(Number(entry.target.dataset.position));
          }
        }
      },
      { root: this.ui.gridScroll, rootMargin: '200px 0px' }
    );
    for (const { cell } of this.cells) this.observer.observe(cell);
  }

  async renderThumbnail(position) {
    const entry = this.cells[position];
    const doc = this.thumbDoc;
    if (!entry || !doc || entry.rendered || entry.pending) return;
    const version = this.loadVersion;
    entry.pending = true;
    try {
      const page = await doc.getPage(position + 1);
      if (version !== this.loadVersion) return;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: THUMB_CSS_WIDTH / base.width });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = entry.canvas;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      await page.render({ canvasContext: ctx, viewport }).promise;
      if (version === this.loadVersion) entry.rendered = true;
    } catch (error) {
      if (version === this.loadVersion) entry.cell.title = 'Preview unavailable';
    } finally {
      entry.pending = false;
    }
  }

  onCellClick(position, event) {
    if (this.busy) return;
    if (event.shiftKey && this.anchor !== null) {
      const from = Math.min(this.anchor, position);
      const to = Math.max(this.anchor, position);
      const range = new Set();
      for (let index = from; index <= to; index += 1) range.add(index);
      this.selected = event.ctrlKey || event.metaKey ? new Set([...this.selected, ...range]) : range;
    } else if (event.ctrlKey || event.metaKey) {
      if (this.selected.has(position)) this.selected.delete(position);
      else this.selected.add(position);
      this.anchor = position;
    } else {
      this.selected = new Set([position]);
      this.anchor = position;
    }
    this.syncSelectionClasses();
    this.updateActionState();
  }

  selectAllPages() {
    if (!this.session || this.busy) return;
    this.selected = new Set(Array.from({ length: this.session.pageCount }, (_, index) => index));
    this.syncSelectionClasses();
    this.updateActionState();
  }

  clampSelection() {
    const count = this.session ? this.session.pageCount : 0;
    this.selected = new Set([...this.selected].filter((position) => position < count));
    if (this.anchor !== null && this.anchor >= count) this.anchor = null;
  }

  syncSelectionClasses() {
    this.cells.forEach(({ cell }, position) => {
      const on = this.selected.has(position);
      cell.classList.toggle('is-selected', on);
      cell.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /** One-based page numbers of the current selection, in document order. */
  selectedPageNumbers() {
    return [...this.selected].sort((a, b) => a - b).map((position) => position + 1);
  }

  // --- State and busy handling --------------------------------------------

  setBusy(busy) {
    this.busy = busy;
    this.updateActionState();
  }

  setStatus(message, isError = false) {
    this.ui.status.textContent = message;
    this.ui.status.dataset.error = isError ? 'true' : 'false';
    if (isError) this.onStatus(message);
  }

  updateActionState() {
    const session = this.session;
    const hasDoc = !!session && session.pageCount > 0;
    const idle = !this.busy;
    const hasSelection = this.selected.size > 0;
    const pageCount = session ? session.pageCount : 0;
    const canEdit = hasDoc && idle;
    const canSelect = canEdit && hasSelection;

    this.ui.rotateLeft.disabled = !canSelect;
    this.ui.rotateRight.disabled = !canSelect;
    this.ui.moveUp.disabled = !canSelect;
    this.ui.moveDown.disabled = !canSelect;
    this.ui.selectAll.disabled = !canEdit;
    this.ui.deletePages.disabled = !canSelect || this.selected.size >= pageCount;
    this.ui.extract.disabled = !canSelect;
    this.ui.undo.disabled = !canEdit || session.history.length === 0;
    this.ui.addPdf.disabled = !session || !idle || !this.pickPdfFiles;
    this.ui.metaApply.disabled = !canEdit;
    this.ui.splitButton.disabled = !canEdit;
    this.ui.discard.disabled = !canEdit || !this.isDirty;
    this.ui.duplicate.disabled = !session || !idle;
    this.ui.saveAs.disabled = !canEdit;
    this.ui.dirtyBadge.hidden = !this.isDirty;
    this.setDocumentAvailable(!!this.getSourceBytes());
  }

  // --- Operations -----------------------------------------------------------

  /**
   * Run a page operation on the working copy. `work(bytes, pages)` resolves to
   * `{ bytes, selected }`. The previous state is pushed to the undo history.
   */
  async runOperation(label, work, { confirmMessage = null } = {}) {
    const session = this.session;
    if (!session) return false;
    if (this.busy) return this.notBusy();
    if (confirmMessage && !window.confirm(confirmMessage)) return false;

    this.setBusy(true);
    this.setStatus(`${label}…`);
    try {
      const result = await work(session.bytes, this.selectedPageNumbers());
      if (this.session !== session) return false; // document changed underneath us
      session.history.push(session.bytes);
      if (session.history.length > HISTORY_LIMIT) session.history.shift();
      session.bytes = result.bytes;
      this.selected = new Set(result.selected || []);
      this.anchor = null;
      this.updateActionState();
      await this.refresh();
      this.syncSelectionClasses();
      this.setStatus(`${label} — ${session.pageCount} page${session.pageCount === 1 ? '' : 's'} in working copy`);
      return true;
    } catch (error) {
      this.setStatus(error.message, true);
      return false;
    } finally {
      this.setBusy(false);
    }
  }

  /** Explain why a request was ignored, instead of silently doing nothing. */
  notBusy() {
    this.setStatus('Still working on the previous action — please wait a moment.');
    return false;
  }

  requireSelection() {
    if (this.selected.size === 0) {
      this.setStatus('Select one or more pages first. Click a page; Ctrl/Cmd-click or Shift-click for more.', true);
      return false;
    }
    return true;
  }

  rotateSelected(quarterTurns) {
    if (!this.requireSelection()) return;
    const label = quarterTurns > 0 ? 'Rotated clockwise' : 'Rotated counter-clockwise';
    return this.runOperation(label, async (bytes, pages) => ({
      bytes: await rotatePages(bytes, pages, quarterTurns),
      selected: [...this.selected],
    }));
  }

  moveSelected(direction) {
    if (!this.requireSelection()) return;
    const count = this.session.pageCount;
    const move = computeMove(count, [...this.selected], direction);
    const unchanged = move.order.every((page, index) => page === index + 1);
    if (unchanged) {
      this.setStatus(`The selected pages are already at the ${direction === 'up' ? 'top' : 'bottom'}.`);
      return;
    }
    return this.runOperation(`Moved pages ${direction}`, async (bytes) => ({
      bytes: await reorderPages(bytes, move.order),
      selected: move.selected,
    }));
  }

  deleteSelected() {
    if (!this.requireSelection()) return;
    const pages = this.selectedPageNumbers();
    if (pages.length >= this.session.pageCount) {
      this.setStatus('A PDF must keep at least one page. Select fewer pages.', true);
      return;
    }
    const list = pages.length === 1 ? `page ${pages[0]}` : `${pages.length} pages`;
    return this.runOperation(
      `Deleted ${list}`,
      async (bytes, selectedPages) => ({ bytes: await deletePages(bytes, selectedPages), selected: [] }),
      { confirmMessage: `Delete ${list} from the working copy? You can undo this until you close the document.` }
    );
  }

  extractSelected() {
    if (!this.requireSelection()) return;
    const pages = this.selectedPageNumbers();
    const count = this.session.pageCount;
    const keepCount = pages.length;
    return this.runOperation(
      `Kept ${keepCount} selected page${keepCount === 1 ? '' : 's'}`,
      async (bytes, selectedPages) => ({
        bytes: await extractPages(bytes, selectedPages),
        selected: selectedPages.map((_, index) => index),
      }),
      {
        confirmMessage:
          `Keep only the ${keepCount} selected page${keepCount === 1 ? '' : 's'} (of ${count}) in the working copy? ` +
          'Other pages are removed from the working copy only; the original file is not changed. You can undo this.',
      }
    );
  }

  async addPdfs() {
    if (!this.session || !this.pickPdfFiles) return;
    if (this.busy) return this.notBusy();
    let files = [];
    try {
      files = (await this.pickPdfFiles()) || [];
    } catch (error) {
      this.setStatus(`Could not read the selected PDF: ${error.message}`, true);
      return;
    }
    if (files.length === 0) return;
    return this.runOperation(
      `Added ${files.length} PDF${files.length === 1 ? '' : 's'} to the end`,
      async (bytes) => ({
        bytes: await appendPdfs(bytes, files.map((file) => file.bytes)),
        selected: [...this.selected],
      })
    );
  }

  applyMetadata() {
    return this.runOperation('Metadata updated', async (bytes) => ({
      bytes: await writeMetadata(bytes, {
        title: this.ui.metaTitle.value,
        author: this.ui.metaAuthor.value,
        subject: this.ui.metaSubject.value,
        keywords: this.ui.metaKeywords.value,
      }),
      selected: [...this.selected],
    }));
  }

  undo() {
    const session = this.session;
    if (!session || session.history.length === 0) return;
    if (this.busy) return this.notBusy();
    session.bytes = session.history.pop();
    this.selected = new Set();
    this.anchor = null;
    return this.withBusy(() => this.refresh()).then(() => {
      this.setStatus(this.isDirty ? 'Undone.' : 'Back to the saved state — no unsaved changes.');
    });
  }

  discardChanges() {
    const session = this.session;
    if (!session || !this.isDirty) return;
    if (this.busy) return this.notBusy();
    if (!window.confirm('Discard all unsaved page changes and go back to the file as it was opened?')) return;
    session.bytes = session.baseline;
    session.history = [];
    this.selected = new Set();
    this.anchor = null;
    return this.withBusy(() => this.refresh()).then(() => this.setStatus('Unsaved changes discarded.'));
  }

  async splitDocument() {
    const session = this.session;
    if (!session) return;
    if (this.busy) return this.notBusy();
    let groups;
    try {
      groups = parseSplitPlan(this.ui.splitSpec.value, session.pageCount);
      this.ui.splitError.textContent = '';
    } catch (error) {
      this.ui.splitError.textContent = error.message;
      return;
    }

    this.setBusy(true);
    this.setStatus(`Splitting into ${groups.length} file${groups.length === 1 ? '' : 's'}…`);
    try {
      const parts = await splitPdf(session.bytes, groups);
      const base = baseName(session.name);
      const width = String(parts.length).length;
      const files = parts.map((part, index) => ({
        name: `${base}-part-${String(index + 1).padStart(width, '0')}.pdf`,
        bytes: part.bytes,
        pages: part.pageCount,
      }));
      const result = await this.saveFiles(files);
      if (!result.ok && !result.canceled) throw new Error(result.error || 'The files could not be saved.');
      if (result.canceled) {
        this.setStatus('Split cancelled — nothing was saved.');
      } else {
        this.setStatus(
          `Split into ${files.length} file${files.length === 1 ? '' : 's'}${result.directory ? ` in ${result.directory}` : ' (downloaded)'}. The working copy is unchanged.`
        );
      }
    } catch (error) {
      this.setStatus(`Split failed: ${error.message}`, true);
    } finally {
      this.setBusy(false);
    }
  }

  /** Save several files: Electron writes into a chosen folder, the browser downloads each. */
  async saveFiles(files) {
    if (window.cambuzAPI?.savePdfFiles) {
      return window.cambuzAPI.savePdfFiles(
        files.map((file) => ({ name: file.name, bytes: file.bytes })),
        { originalPath: this.getCurrentFilePath() || '' }
      );
    }
    for (let index = 0; index < files.length; index += 1) {
      this.downloadBytes(files[index].bytes, files[index].name);
      if (index < files.length - 1) await sleep(DOWNLOAD_GAP_MS);
    }
    return { ok: true, directory: null };
  }

  /**
   * Save As (working copy) or Duplicate (the file exactly as it was opened).
   * The original file is never changed by this path unless the user confirms
   * overwriting it in the save dialog.
   */
  saveAs() {
    return this.saveDocument({ duplicate: false });
  }

  duplicate() {
    return this.saveDocument({ duplicate: true });
  }

  async saveDocument({ duplicate }) {
    const session = this.ensureSession();
    if (!session) return;
    if (this.busy) return this.notBusy();
    const bytes = duplicate ? session.baseline : session.bytes;
    const base = baseName(session.name);
    const suggested = duplicate ? `${base} (copy).pdf` : `${base}${this.isDirty ? '-edited' : '-copy'}.pdf`;
    const originalPath = this.getCurrentFilePath() || '';

    this.setBusy(true);
    this.setStatus('Saving…');
    try {
      if (window.cambuzAPI?.savePdf) {
        const result = await window.cambuzAPI.savePdf(bytes, { suggestedName: suggested, originalPath });
        if (result.canceled) {
          this.setStatus('Save cancelled — the document is unchanged.');
          return;
        }
        if (!result.ok) throw new Error(result.error || 'The file could not be saved.');
        if (duplicate) {
          this.setStatus(`Copy saved to ${result.path}. The open document is unchanged.`);
          return;
        }
        await this.finishSave({ bytes, name: result.name, path: result.path });
      } else {
        this.downloadBytes(bytes, suggested);
        if (duplicate) {
          this.setStatus(`Copy downloaded as ${suggested}. The open document is unchanged.`);
          return;
        }
        await this.finishSave({ bytes, name: suggested, path: null });
      }
    } catch (error) {
      this.setStatus(`Save failed: ${error.message}`, true);
    } finally {
      this.setBusy(false);
    }
  }

  async finishSave({ bytes, name, path }) {
    this.close(false);
    this.setStatus(`Saved ${name}.`);
    // The viewer switches to the saved file, so later edits start from it.
    await this.onSaved({ bytes, name, path });
  }

  downloadBytes(bytes, name) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}
