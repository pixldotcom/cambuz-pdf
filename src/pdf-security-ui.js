// Cambuz PDF Reader — Phase 5 document security dialog.
//
// A read-only report: which protection the document carries, which permissions
// the author granted, and which of those Cambuz enforces while you read. There
// is no "remove security" action here — Cambuz cannot decrypt or re-publish a
// protected PDF.

import { describeSecurity } from './pdf-security.js';

function element(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Security interface is missing #${id}`);
  return found;
}

export class SecurityController {
  constructor({ getSecurity, getDocumentName, onStatus = () => {} } = {}) {
    this.getSecurity = getSecurity;
    this.getDocumentName = getDocumentName;
    this.onStatus = onStatus;
    this.ui = {
      dialog: element('security-dialog'),
      label: element('security-doc-label'),
      summary: element('security-summary'),
      body: element('security-permissions'),
      notes: element('security-notes'),
      lock: element('status-lock'),
      toolbarButton: element('btn-security'),
      close: element('btn-security-close'),
      closeFooter: element('btn-security-close-2'),
    };
    this.open = false;

    this.ui.toolbarButton.addEventListener('click', () => this.show());
    this.ui.lock.addEventListener('click', () => this.show());
    this.ui.close.addEventListener('click', () => this.hide());
    this.ui.closeFooter.addEventListener('click', () => this.hide());
    this.ui.dialog.addEventListener('click', (event) => {
      if (event.target === this.ui.dialog) this.hide();
    });
  }

  get isOpen() {
    return this.open;
  }

  show() {
    this.render();
    this.open = true;
    this.ui.dialog.style.display = 'flex';
    this.ui.close.focus();
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    this.ui.dialog.style.display = 'none';
    this.ui.toolbarButton.focus();
  }

  toggle() {
    if (this.open) this.hide();
    else this.show();
  }

  /** Enable the toolbar entry point only while a document is open. */
  setDocumentAvailable(available) {
    this.ui.toolbarButton.disabled = !available;
    this.ui.lock.style.display = available && this.getSecurity()?.encrypted ? 'inline-flex' : 'none';
  }

  /** Render the current document's security state (also refreshes the status chip). */
  render() {
    const security = this.getSecurity ? this.getSecurity() : null;
    const name = this.getDocumentName ? this.getDocumentName() : '';
    this.ui.label.textContent = name || 'No document open';

    if (!security || !security.encrypted) {
      this.ui.summary.textContent =
        'This document is not encrypted. It carries no permission restrictions, so every reader ' +
        'action is available.';
      this.ui.body.innerHTML = '';
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 3;
      cell.className = 'secure-empty';
      cell.textContent = 'Not encrypted — no permission flags to show.';
      row.appendChild(cell);
      this.ui.body.appendChild(row);
      this.renderNotes(false);
      this.updateChip(security);
      return;
    }

    const denied = security.items.filter((item) => !item.allowed);
    this.ui.summary.textContent =
      `This document is encrypted${security.unlockedWithPassword ? ' and was opened with the password you entered' : ''}. ` +
      (denied.length === 0
        ? 'Every permission is granted.'
        : `${denied.length} of ${security.items.length} permissions are denied. Cambuz enforces the ones marked below.`);

    this.ui.body.innerHTML = '';
    for (const item of security.items) {
      const row = document.createElement('tr');
      if (!item.allowed) row.className = 'secure-denied';

      const nameCell = document.createElement('th');
      nameCell.scope = 'row';
      nameCell.textContent = item.label;

      const statusCell = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `secure-badge ${item.allowed ? 'secure-badge-ok' : 'secure-badge-no'}`;
      badge.textContent = item.allowed ? 'Allowed' : 'Denied';
      statusCell.appendChild(badge);
      if (item.enforced && !item.allowed) {
        const note = document.createElement('span');
        note.className = 'secure-enforced';
        note.textContent = 'blocked in Cambuz';
        statusCell.appendChild(note);
      }

      const infoCell = document.createElement('td');
      infoCell.textContent = item.description;

      row.appendChild(nameCell);
      row.appendChild(statusCell);
      row.appendChild(infoCell);
      this.ui.body.appendChild(row);
    }

    this.renderNotes(true);
    this.updateChip(security);
  }

  renderNotes(encrypted) {
    this.ui.notes.innerHTML = '';
    const notes = [];
    if (encrypted) {
      notes.push(
        'Cambuz cannot remove encryption or permissions. A protected PDF can be read with its ' +
          'password, but page tools and saving a filled form stay unavailable while it is encrypted.'
      );
      notes.push(
        'Searching works from the text Cambuz has already extracted for the page you are reading; ' +
          'copying to the clipboard stays blocked when the document denies copying.'
      );
    } else {
      notes.push('Cambuz never stores passwords and never removes protection from a PDF.');
    }
    for (const text of notes) {
      const p = document.createElement('p');
      p.className = 'secure-note';
      p.textContent = text;
      this.ui.notes.appendChild(p);
    }
  }

  /** Keep the status-bar chip in step with the open document. */
  updateChip(security) {
    const chip = this.ui.lock;
    if (!security || !security.encrypted) {
      chip.style.display = 'none';
      chip.textContent = '';
      return;
    }
    chip.style.display = 'inline-flex';
    chip.textContent = `🔒 ${describeSecurity(security)}`;
    chip.title = 'Show document security and permissions';
  }
}
