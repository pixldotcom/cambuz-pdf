// Cambuz PDF Reader — Phase 5 password prompt.
//
// Shown when PDF.js refuses to open a document until the user supplies a
// password. The password is only ever handed to PDF.js for this one document
// and is never written anywhere: Cambuz cannot remove or weaken the
// protection of a PDF, so there is no "unlock and save" path to ask about.

function element(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Password interface is missing #${id}`);
  return found;
}

export class PasswordController {
  constructor({ onStatus = () => {} } = {}) {
    this.onStatus = onStatus;
    this.ui = {
      dialog: element('password-dialog'),
      fileLabel: element('password-file-label'),
      message: element('password-message'),
      input: element('password-input'),
      error: element('password-error'),
      reveal: element('password-reveal'),
      ok: element('btn-password-ok'),
      cancel: element('btn-password-cancel'),
    };
    this.pending = null;
    this.attempt = 0;

    this.ui.ok.addEventListener('click', () => this.submit());
    this.ui.cancel.addEventListener('click', () => this.cancel());
    this.ui.dialog.addEventListener('click', (event) => {
      if (event.target === this.ui.dialog) this.cancel();
    });
    this.ui.input.addEventListener('input', () => {
      this.ui.error.textContent = '';
      this.ui.ok.disabled = false;
    });
    this.ui.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.submit();
      }
    });
    this.ui.reveal.addEventListener('change', () => {
      this.ui.input.type = this.ui.reveal.checked ? 'text' : 'password';
    });
  }

  get isOpen() {
    return this.pending !== null;
  }

  /**
   * Ask for a password. Resolves with the typed password, or with `null` when
   * the user gives up. `null` always means "do not open this document".
   */
  request({ fileName = '', message = '' } = {}) {
    // A second request while the dialog is open can only come from a second
    // load; refuse it instead of stealing the answer for the first document.
    if (this.pending) return Promise.resolve(null);
    this.attempt += 1;
    this.ui.fileLabel.textContent = fileName ? `“${fileName}” is password protected.` : 'This PDF is password protected.';
    this.ui.message.textContent = message || 'Enter the password to open it.';
    this.ui.input.value = '';
    this.ui.input.type = 'password';
    this.ui.reveal.checked = false;
    this.ui.error.textContent = '';
    this.ui.ok.disabled = false;
    this.ui.dialog.style.display = 'flex';
    this.ui.input.focus();

    return new Promise((resolve) => {
      this.pending = resolve;
    });
  }

  submit() {
    if (!this.pending) return;
    const value = this.ui.input.value;
    if (!value) {
      this.ui.error.textContent = 'Enter the password, or choose Cancel.';
      this.ui.input.focus();
      return;
    }
    this.finish(value);
  }

  cancel() {
    if (!this.pending) return;
    this.onStatus('Open cancelled — the document stays locked.');
    this.finish(null);
  }

  finish(value) {
    const resolve = this.pending;
    this.pending = null;
    this.ui.dialog.style.display = 'none';
    this.ui.error.textContent = '';
    if (resolve) resolve(value);
  }

  /** Called when the viewer replaces or closes the document mid-prompt. */
  reset() {
    if (this.pending) this.finish(null);
    this.attempt = 0;
  }
}
