// Cambuz PDF Reader — Phase 5 form filling.
//
// AcroForm fields are drawn as real HTML controls positioned over the page, so
// filling a form looks and behaves like filling it on paper. Values live in
// memory until the user chooses "Save Filled Form…", which writes a NEW copy of
// the document — the open file is never touched.
//
// Two safety rules are enforced here and in src/pdf-forms.js:
//   * an encrypted document is never opened for form editing (there is no way
//     to save it without stripping its protection, so Cambuz does not pretend);
//   * a document whose permissions deny filling in forms is refused outright.

import {
  FIELD_TYPES,
  dirtyFieldNames,
  describeForm,
  fillFormDocument,
  loadFormDocument,
} from './pdf-forms.js';
import { isBlocked, refusalMessage } from './pdf-security.js';

function element(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Form interface is missing #${id}`);
  return found;
}

function baseName(name) {
  return String(name || 'document').replace(/\.pdf$/i, '') || 'document';
}

/** Convert a PDF-user-space rectangle into CSS pixels over the rendered page. */
export function widgetRectToCss(widget, viewport) {
  const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([
    widget.x,
    widget.y,
    widget.x + widget.width,
    widget.y + widget.height,
  ]);
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

export class FormController {
  constructor({
    getSourceBytes,
    getDocumentGeneration,
    getDocumentName,
    getCurrentPage,
    getCurrentViewport,
    getSecurity,
    saveBytes,
    onSaved = async () => {},
    onStatus = () => {},
    onStateChange = () => {},
  }) {
    this.getSourceBytes = getSourceBytes;
    this.getDocumentGeneration = getDocumentGeneration;
    this.getDocumentName = getDocumentName;
    this.getCurrentPage = getCurrentPage;
    this.getCurrentViewport = getCurrentViewport;
    this.getSecurity = getSecurity;
    this.saveBytes = saveBytes;
    this.onSaved = onSaved;
    this.onStatus = onStatus;
    this.onStateChange = onStateChange;

    this.ui = {
      toolbarButton: element('btn-forms'),
      bar: element('form-bar'),
      summary: element('form-bar-summary'),
      save: element('btn-form-save'),
      resetButton: element('btn-form-reset'),
      done: element('btn-form-done'),
      layer: element('form-layer'),
    };

    this.enabled = false;
    this.busy = false;
    this.session = null;
    this.controls = [];
    this.fieldsOnPage = 0;

    this.ui.toolbarButton.addEventListener('click', () => this.toggle());
    this.ui.done.addEventListener('click', () => this.disable());
    this.ui.resetButton.addEventListener('click', () => this.resetValues());
    this.ui.save.addEventListener('click', () => this.save());
  }

  // --- Lifecycle -----------------------------------------------------------

  get isEnabled() {
    return this.enabled;
  }

  get fieldCount() {
    return this.session ? this.session.fields.length : 0;
  }

  get editableCount() {
    return this.session ? this.session.fields.filter((field) => field.editable).length : 0;
  }

  get filledCount() {
    if (!this.session) return 0;
    let count = 0;
    for (const field of this.session.fields) {
      if (!field.editable) continue;
      const value = this.session.values.get(field.name);
      if (typeof value === 'boolean') {
        if (value) count += 1;
      } else if (String(value ?? '').length > 0) {
        count += 1;
      }
    }
    return count;
  }

  get isDirty() {
    if (!this.session) return false;
    return dirtyFieldNames(this.session.fields, Object.fromEntries(this.session.values)).length > 0;
  }

  /** Enable the toolbar entry point only while a document is open and fillable. */
  setDocumentAvailable(available) {
    const security = this.getSecurity ? this.getSecurity() : null;
    const blocked =
      !available || Boolean(security && (security.encrypted || isBlocked(security, 'fillForms')));
    this.ui.toolbarButton.disabled = blocked;
    if (blocked && security && security.encrypted) {
      this.ui.toolbarButton.title =
        'Form filling is not available: filled forms cannot be saved while a document is encrypted.';
    } else if (blocked && security) {
      this.ui.toolbarButton.title = refusalMessage(security, 'fillForms');
    } else {
      this.ui.toolbarButton.title = 'Fill in PDF form fields (Ctrl+Shift+F)';
    }
  }

  /** Turn form filling on (or off). */
  async toggle() {
    if (this.enabled) {
      this.disable();
      return false;
    }
    return this.enable();
  }

  async enable() {
    if (this.busy) return false;
    if (!this.getSourceBytes()) {
      this.onStatus('Open a PDF before filling in a form.');
      return false;
    }
    const security = this.getSecurity ? this.getSecurity() : null;
    if (security && isBlocked(security, 'fillForms')) {
      this.onStatus(refusalMessage(security, 'fillForms'), true);
      return false;
    }
    if (security && security.encrypted) {
      this.onStatus(
        'This document is encrypted. Cambuz can display it, but a filled form can only be saved ' +
          'for documents that are not encrypted — saving would otherwise remove the protection.',
        true
      );
      return false;
    }

    this.setBusy(true);
    try {
      const session = await this.ensureSession();
      if (!session) return false;
      if (session.fields.length === 0) {
        this.onStatus('This PDF has no fillable form fields.', true);
        return false;
      }
      this.enabled = true;
      this.ui.bar.style.display = 'flex';
      this.ui.toolbarButton.setAttribute('aria-pressed', 'true');
      this.ui.toolbarButton.classList.add('is-active');
      this.renderCurrentPage();
      this.onStatus(
        `Filling ${this.editableCount} field${this.editableCount === 1 ? '' : 's'} of ` +
          `${this.fieldCount}. Values are saved only when you choose Save Filled Form…`
      );
      this.onStateChange();
      return true;
    } finally {
      this.busy = false;
      this.updateBar();
    }
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.ui.bar.style.display = 'none';
    this.ui.toolbarButton.setAttribute('aria-pressed', 'false');
    this.ui.toolbarButton.classList.remove('is-active');
    this.clearOverlay();
    this.onStateChange();
  }

  /** Called when the viewer swaps or closes the document. */
  async onDocumentChanged() {
    const wasEnabled = this.enabled;
    this.enabled = false;
    this.session = null;
    this.busy = false;
    this.clearOverlay();
    this.ui.bar.style.display = 'none';
    this.ui.toolbarButton.setAttribute('aria-pressed', 'false');
    this.ui.toolbarButton.classList.remove('is-active');
    if (wasEnabled) this.onStateChange();
  }

  /** Load (or reuse) the field model for the open document. */
  async ensureSession() {
    const source = this.getSourceBytes();
    if (!source) return null;
    const generation = this.getDocumentGeneration();
    if (this.session && this.session.generation === generation) return this.session;
    try {
      const loaded = await loadFormDocument(source);
      const described = describeForm(loaded);
      const values = new Map();
      for (const field of described.fields) values.set(field.name, field.value);
      this.session = {
        generation,
        fields: described.fields,
        values,
        pageCount: described.pageCount,
      };
      return this.session;
    } catch (error) {
      this.session = null;
      this.onStatus(error.message, true);
      return null;
    }
  }

  // --- Overlay -------------------------------------------------------------

  renderCurrentPage() {
    if (!this.enabled || !this.session) return;
    const viewport = this.getCurrentViewport ? this.getCurrentViewport() : null;
    if (viewport && viewport.pageNumber === this.getCurrentPage()) {
      this.renderOverlay(viewport.pageNumber, viewport.viewport);
    } else {
      this.clearOverlay();
    }
  }

  /** Draw the controls for one page. `viewport` must be the one used to render it. */
  renderOverlay(pageNumber, viewport) {
    this.clearOverlay();
    if (!this.enabled || !this.session || !viewport) return;
    const pageIndex = pageNumber - 1;
    const layer = this.ui.layer;
    let onPage = 0;

    for (const field of this.session.fields) {
      for (const widget of field.widgets) {
        if (widget.pageIndex !== pageIndex) continue;
        const rect = widgetRectToCss(widget, viewport);
        if (rect.width <= 0 || rect.height <= 0) continue;
        const control = this.createControl(field, widget, rect);
        if (!control) continue;
        layer.appendChild(control);
        this.controls.push(control);
        onPage += 1;
      }
    }
    this.fieldsOnPage = onPage;
    this.updateBar();
  }

  clearOverlay() {
    this.ui.layer.innerHTML = '';
    this.controls = [];
    this.fieldsOnPage = 0;
  }

  createControl(field, widget, rect) {
    const value = this.session.values.get(field.name);
    let control;

    if (field.type === FIELD_TYPES.TEXT) {
      if (field.multiline) {
        control = document.createElement('textarea');
        control.className = 'form-widget form-widget-textarea';
        control.value = typeof value === 'string' ? value : '';
        control.addEventListener('input', () => this.setValue(field, control.value));
      } else {
        control = document.createElement('input');
        control.type = 'text';
        control.className = 'form-widget form-widget-text';
        control.value = typeof value === 'string' ? value : '';
        if (typeof field.maxLength === 'number' && field.maxLength > 0) {
          control.maxLength = field.maxLength;
        }
        control.addEventListener('input', () => this.setValue(field, control.value));
      }
      control.style.fontSize = `${Math.max(7, Math.min(24, rect.height * 0.62)).toFixed(1)}px`;
    } else if (field.type === FIELD_TYPES.CHECKBOX) {
      control = document.createElement('input');
      control.type = 'checkbox';
      control.className = 'form-widget form-widget-checkbox';
      control.checked = value === true;
      control.style.fontSize = `${Math.max(8, rect.height * 0.8).toFixed(1)}px`;
      control.addEventListener('change', () => this.setValue(field, control.checked));
    } else if (field.type === FIELD_TYPES.RADIO) {
      control = document.createElement('input');
      control.type = 'radio';
      control.className = 'form-widget form-widget-radio';
      control.name = `cambuz-form-${field.name}`;
      control.dataset.option = widget.option;
      control.checked = typeof value === 'string' && value === widget.option && value !== '';
      control.addEventListener('change', () => {
        if (control.checked) this.setValue(field, widget.option);
      });
    } else if (field.type === FIELD_TYPES.DROPDOWN || field.type === FIELD_TYPES.LIST) {
      control = document.createElement('select');
      control.className = `form-widget form-widget-${field.type === FIELD_TYPES.LIST ? 'list' : 'dropdown'}`;
      if (field.type === FIELD_TYPES.LIST) {
        control.size = Math.max(2, Math.floor(rect.height / 18));
      }
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '—';
      control.appendChild(blank);
      for (const option of field.options) {
        const node = document.createElement('option');
        node.value = option;
        node.textContent = option;
        control.appendChild(node);
      }
      control.value = typeof value === 'string' ? value : '';
      control.style.fontSize = `${Math.max(8, Math.min(20, rect.height * 0.6)).toFixed(1)}px`;
      control.addEventListener('change', () => this.setValue(field, control.value));
    } else {
      // Push buttons, signature fields and anything we do not recognise: show
      // where it is, but never pretend Cambuz can act on it.
      control = document.createElement('div');
      control.className = 'form-widget form-widget-static';
      control.textContent = field.typeLabel;
      control.style.fontSize = `${Math.max(7, Math.min(14, rect.height * 0.4)).toFixed(1)}px`;
    }

    control.style.left = `${rect.left}px`;
    control.style.top = `${rect.top}px`;
    control.style.width = `${rect.width}px`;
    control.style.height = `${rect.height}px`;
    control.dataset.field = field.name;
    control.dataset.type = field.type;
    control.title = `${field.name} — ${field.typeLabel}${field.readOnly ? ' (read-only)' : ''}${
      field.required ? ' (required)' : ''
    }`;
    if (control.tagName !== 'DIV') {
      control.disabled = !field.editable;
      if (field.required) control.setAttribute('aria-required', 'true');
    }
    return control;
  }

  setValue(field, value) {
    if (!this.session) return;
    this.session.values.set(field.name, value);
    this.updateBar();
    this.onStateChange();
  }

  resetValues() {
    if (!this.session) return;
    for (const field of this.session.fields) {
      this.session.values.set(field.name, field.value);
    }
    this.renderCurrentPage();
    this.onStatus('Form reset to the values stored in the document.');
    this.onStateChange();
  }

  // --- Bar -----------------------------------------------------------------

  updateBar() {
    if (!this.session) {
      this.ui.summary.textContent = '';
      this.ui.save.disabled = true;
      this.ui.resetButton.disabled = true;
      return;
    }
    const onPage = this.fieldsOnPage || 0;
    const pageBits = onPage === 1 ? '1 field on this page' : `${onPage} fields on this page`;
    const filled = this.filledCount;
    this.ui.summary.textContent = `Fill form · ${pageBits} · ${filled} of ${this.editableCount} filled`;
    this.ui.save.disabled = this.busy || !this.isDirty;
    this.ui.resetButton.disabled = this.busy || !this.isDirty;
  }

  setBusy(busy) {
    this.busy = busy;
    this.ui.save.disabled = busy || !this.isDirty;
    this.ui.resetButton.disabled = busy || !this.isDirty;
  }

  // --- Saving --------------------------------------------------------------

  async save() {
    const session = this.session;
    if (!session) return;
    if (this.busy) return;
    const values = Object.fromEntries(session.values);
    const changed = dirtyFieldNames(session.fields, values);
    if (changed.length === 0) {
      this.onStatus('Nothing to save yet — fill in a field first.', true);
      return;
    }

    this.setBusy(true);
    this.onStatus(`Saving ${changed.length} field${changed.length === 1 ? '' : 's'}…`);
    try {
      const source = this.getSourceBytes();
      const loaded = await loadFormDocument(source);
      const result = await fillFormDocument(loaded, values);
      const suggested = `${baseName(this.getDocumentName())}-filled.pdf`;
      const saved = await this.saveBytes(result.bytes, suggested);
      if (saved && saved.canceled) {
        this.onStatus('Save cancelled — the document is unchanged.');
        return;
      }
      if (!saved || !saved.ok) {
        throw new Error((saved && saved.error) || 'The filled form could not be saved.');
      }
      const notes = [];
      if (result.skipped.length > 0) {
        const list = result.skipped
          .slice(0, 3)
          .map((entry) => `${entry.name} (${entry.reason})`)
          .join('; ');
        notes.push(
          `${result.skipped.length} field${result.skipped.length === 1 ? '' : 's'} skipped: ${list}`
        );
      }
      for (const warning of result.warnings) notes.push(warning);
      this.onStatus(
        `Saved ${result.applied.length} field${result.applied.length === 1 ? '' : 's'} to ${saved.name}.${
          notes.length ? ` ${notes.join(' ')}` : ''
        }`,
        false
      );
      this.disable();
      await this.onSaved({ bytes: result.bytes, name: saved.name, path: saved.path || null });
    } catch (error) {
      this.onStatus(`Saving the filled form failed: ${error.message}`, true);
    } finally {
      this.setBusy(false);
      this.updateBar();
    }
  }
}
