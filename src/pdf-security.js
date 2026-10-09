// Cambuz PDF Reader — Phase 5 security helpers (DOM-free).
//
// Two jobs:
//
// 1. Turn PDF.js's password errors into something the UI can act on, without
//    ever trying to work around them. A protected document is opened only with
//    a password the user types; if the password is wrong the document stays
//    closed.
// 2. Decode the PDF permission flags (PDF 32000-1 table 22) into a small,
//    readable model so the rest of the app can *enforce* them: printing,
//    copying, page editing and form filling are refused when the document
//    does not allow them.

// PDF.js reports a missing password as code 1 and a wrong one as code 2.
// The numbers are read from the library itself so nothing is hard-coded.
export const NEED_PASSWORD = 1;
export const INCORRECT_PASSWORD = 2;

/** Permission bits as defined by the PDF specification (table 22). */
export const PERMISSION_BITS = {
  PRINT: 0x0004,
  MODIFY_CONTENTS: 0x0008,
  COPY: 0x0010,
  MODIFY_ANNOTATIONS: 0x0020,
  FILL_INTERACTIVE_FORMS: 0x0100,
  COPY_FOR_ACCESSIBILITY: 0x0200,
  ASSEMBLE: 0x0400,
  PRINT_HIGH_QUALITY: 0x0800,
};

/** The restrictions Cambuz actually enforces, in the order shown to the user. */
export const PERMISSION_ITEMS = [
  {
    key: 'print',
    bit: PERMISSION_BITS.PRINT,
    label: 'Printing',
    description: 'Print the document.',
    enforced: true,
  },
  {
    key: 'printHighQuality',
    bit: PERMISSION_BITS.PRINT_HIGH_QUALITY,
    label: 'High-quality printing',
    description: 'Print without degradation. Cambuz always prints the original page content.',
    enforced: false,
  },
  {
    key: 'copy',
    bit: PERMISSION_BITS.COPY,
    label: 'Copying text and graphics',
    description: 'Select and copy the text of the document.',
    enforced: true,
  },
  {
    key: 'copyForAccessibility',
    bit: PERMISSION_BITS.COPY_FOR_ACCESSIBILITY,
    label: 'Copying for accessibility',
    description: 'Extract text for screen readers and other assistive tools.',
    enforced: false,
  },
  {
    key: 'modifyContents',
    bit: PERMISSION_BITS.MODIFY_CONTENTS,
    label: 'Changing the document',
    description: 'Rotate, delete, extract, reorder, merge or split pages.',
    enforced: true,
  },
  {
    key: 'modifyAnnotations',
    bit: PERMISSION_BITS.MODIFY_ANNOTATIONS,
    label: 'Adding or editing annotations',
    description: 'Create or change annotations and comments.',
    enforced: false,
  },
  {
    key: 'fillForms',
    bit: PERMISSION_BITS.FILL_INTERACTIVE_FORMS,
    label: 'Filling form fields',
    description: 'Fill in interactive form fields.',
    enforced: true,
  },
  {
    key: 'assemble',
    bit: PERMISSION_BITS.ASSEMBLE,
    label: 'Document assembly',
    description: 'Insert, rotate or delete pages and build new documents from this one.',
    enforced: false,
  },
];

/** A security model for a document that carries no permission flags at all. */
export const NO_SECURITY = Object.freeze({
  encrypted: false,
  mask: null,
  unlockedWithPassword: false,
  items: PERMISSION_ITEMS.map((item) => ({ ...item, allowed: true })),
  blocked: Object.freeze({
    print: false,
    printHighQuality: false,
    copy: false,
    copyForAccessibility: false,
    modifyContents: false,
    modifyAnnotations: false,
    fillForms: false,
    assemble: false,
  }),
});

/**
 * PDF.js resolves `doc.getPermissions()` with `null` for documents that have
 * no /Encrypt dictionary and with an array of granted flags otherwise. An
 * empty array means "encrypted and nothing is allowed".
 */
export function permissionMaskFromList(list) {
  if (list === null || list === undefined) return null;
  if (!Array.isArray(list)) return null;
  let mask = 0;
  for (const value of list) {
    const number = Number(value);
    if (Number.isFinite(number)) mask |= number;
  }
  return mask;
}

/** Build the full security model used by the UI. */
export function buildSecurity(mask, { unlockedWithPassword = false } = {}) {
  if (mask === null || mask === undefined) {
    return unlockedWithPassword ? { ...NO_SECURITY, unlockedWithPassword } : NO_SECURITY;
  }
  const items = PERMISSION_ITEMS.map((item) => ({
    ...item,
    allowed: Boolean(mask & item.bit),
  }));
  const blocked = {};
  for (const item of items) blocked[item.key] = !item.allowed;
  return {
    encrypted: true,
    mask,
    unlockedWithPassword,
    items,
    blocked,
  };
}

/** Read the security model straight from an open PDF.js document proxy. */
export async function readDocumentSecurity(pdfDoc, { unlockedWithPassword = false } = {}) {
  if (!pdfDoc || typeof pdfDoc.getPermissions !== 'function') return NO_SECURITY;
  let mask = null;
  try {
    mask = permissionMaskFromList(await pdfDoc.getPermissions());
  } catch (_) {
    mask = null;
  }
  return buildSecurity(mask, { unlockedWithPassword });
}

/** True when the document allows the given capability (`security.blocked[key]`). */
export function isAllowed(security, key) {
  if (!security || !security.encrypted) return true;
  return security.blocked ? !security.blocked[key] : true;
}

/** Read the blocked map directly. */
export function isBlocked(security, key) {
  return !isAllowed(security, key);
}

/** Short label for the status bar, e.g. "Encrypted · printing denied". */
export function describeSecurity(security) {
  if (!security || !security.encrypted) return '';
  const denied = security.items.filter((item) => item.enforced && !item.allowed);
  if (denied.length === 0) return 'Encrypted · all permissions granted';
  if (denied.length === security.items.filter((item) => item.enforced).length) {
    return 'Encrypted · most actions restricted';
  }
  const names = denied.slice(0, 2).map((item) => item.label.toLowerCase());
  return `Encrypted · ${names.join(', ')} denied`;
}

/**
 * Classify a PDF.js error: 'need' when the document is waiting for a password,
 * 'incorrect' when the one that was supplied did not decrypt it, otherwise
 * null (some other failure — never treated as a password problem).
 */
export function classifyPasswordError(error) {
  if (!error) return null;
  if (error.name !== 'PasswordException') return null;
  const code = Number(error.code);
  if (code === NEED_PASSWORD) return 'need';
  if (code === INCORRECT_PASSWORD) return 'incorrect';
  return null;
}

/** Message shown in the password dialog after a failed attempt. */
export function passwordErrorMessage(kind, fileName) {
  const name = fileName ? `“${fileName}”` : 'This PDF';
  if (kind === 'incorrect') {
    return `That password did not open ${name}. Check Caps Lock and try again.`;
  }
  return `${name} is protected with a password. Enter the password to open it.`;
}

/** Reason text used when an action is refused because of a permission. */
export function refusalMessage(security, key) {
  const item = PERMISSION_ITEMS.find((entry) => entry.key === key);
  const label = item ? item.label.toLowerCase() : key;
  const prefix = security?.encrypted ? 'This document does not allow' : 'Not allowed:';
  if (key === 'print') return `${prefix} printing. The document's permissions deny it.`;
  if (key === 'copy') return `${prefix} copying text. The document's permissions deny it.`;
  if (key === 'modifyContents') {
    return security?.encrypted
      ? 'This document does not allow changes to its pages.'
      : `Not allowed: ${label}.`;
  }
  if (key === 'fillForms') return `${prefix} filling in form fields.`;
  return `Not allowed: ${label}.`;
}
