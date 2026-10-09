// Cambuz PDF Reader — Phase 5 AcroForm support (DOM-free).
//
// Read the interactive form fields of a document with pdf-lib and write the
// values the user typed back into a *new* copy of the file. The source bytes
// are never modified in place and an encrypted document is refused outright:
// pdf-lib cannot read it, and inventing a decrypt-and-save path would silently
// strip the protection the author asked for.
//
// Supported: text (single/multi line), check boxes, radio groups, combo boxes
// (drop-downs) and list boxes. Not supported: push buttons, signature fields,
// XFA forms, JavaScript-driven fields and rich text. Unsupported fields are
// reported, never guessed at.

import { loadEditablePdf, MAX_PAGE_OPS_BYTES } from './pdf-ops.js';

/** Field type identifiers used by the UI and the tests. */
export const FIELD_TYPES = {
  TEXT: 'text',
  CHECKBOX: 'checkbox',
  RADIO: 'radio',
  DROPDOWN: 'dropdown',
  LIST: 'list',
  BUTTON: 'button',
  SIGNATURE: 'signature',
  UNKNOWN: 'unknown',
};

/** Types Cambuz can read *and* write. Everything else is displayed read-only. */
export const EDITABLE_TYPES = new Set([
  FIELD_TYPES.TEXT,
  FIELD_TYPES.CHECKBOX,
  FIELD_TYPES.RADIO,
  FIELD_TYPES.DROPDOWN,
  FIELD_TYPES.LIST,
]);

export const FIELD_TYPE_LABELS = {
  [FIELD_TYPES.TEXT]: 'Text',
  [FIELD_TYPES.CHECKBOX]: 'Check box',
  [FIELD_TYPES.RADIO]: 'Radio buttons',
  [FIELD_TYPES.DROPDOWN]: 'Drop-down',
  [FIELD_TYPES.LIST]: 'List',
  [FIELD_TYPES.BUTTON]: 'Push button',
  [FIELD_TYPES.SIGNATURE]: 'Signature',
  [FIELD_TYPES.UNKNOWN]: 'Unsupported field',
};

export const MAX_FORM_VALUE_LENGTH = 4000;

async function pdfLib() {
  return import('pdf-lib');
}

/** Classify a pdf-lib field without depending on class names surviving a build. */
function classify(field, lib) {
  if (field instanceof lib.PDFTextField) return FIELD_TYPES.TEXT;
  if (field instanceof lib.PDFCheckBox) return FIELD_TYPES.CHECKBOX;
  if (field instanceof lib.PDFRadioGroup) return FIELD_TYPES.RADIO;
  if (field instanceof lib.PDFDropdown) return FIELD_TYPES.DROPDOWN;
  if (field instanceof lib.PDFOptionList) return FIELD_TYPES.LIST;
  if (field instanceof lib.PDFButton) return FIELD_TYPES.BUTTON;
  if (field instanceof lib.PDFSignature) return FIELD_TYPES.SIGNATURE;
  return FIELD_TYPES.UNKNOWN;
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/\r\n?/g, '\n');
}

function safeName(field, index) {
  try {
    const name = field.getName();
    return name && String(name).trim() ? String(name) : `field-${index + 1}`;
  } catch (_) {
    return `field-${index + 1}`;
  }
}

function pageIndexOfWidget(doc, widget) {
  const pages = doc.getPages();
  const parent = widget.P ? widget.P() : null;
  if (parent && typeof parent.objectNumber === 'number') {
    const index = pages.findIndex((page) => page.ref.objectNumber === parent.objectNumber);
    if (index >= 0) return index;
  }
  return 0;
}

function readValue(field, type) {
  try {
    switch (type) {
      case FIELD_TYPES.TEXT:
        return cleanText(field.getText() ?? '');
      case FIELD_TYPES.CHECKBOX:
        return Boolean(field.isChecked());
      case FIELD_TYPES.RADIO:
        return cleanText(field.getSelected() ?? '');
      case FIELD_TYPES.DROPDOWN:
      case FIELD_TYPES.LIST: {
        const selected = field.getSelected() ?? [];
        return cleanText(Array.isArray(selected) ? selected[0] ?? '' : selected);
      }
      default:
        return '';
    }
  } catch (_) {
    return type === FIELD_TYPES.CHECKBOX ? false : '';
  }
}

/**
 * Open a document for form work. Encrypted documents are refused here — the
 * message explains that reading is possible but saving a filled copy is not.
 */
export async function loadFormDocument(input) {
  const doc = await loadEditablePdf(input);
  const lib = await pdfLib();
  if (typeof doc.getForm !== 'function') {
    throw new Error('This document has no form support.');
  }
  let form;
  try {
    form = doc.getForm();
  } catch (error) {
    throw new Error(`This document's form could not be read: ${error.message}`);
  }
  if (typeof form.hasXFA === 'function' && form.hasXFA()) {
    throw new Error('This PDF uses an XFA (dynamic) form, which Cambuz cannot fill. Flatten it in the authoring tool first.');
  }
  return { doc, form, lib };
}

/**
 * Describe every field of a form. Widget rectangles are returned in PDF user
 * space (origin bottom-left) — the UI converts them with the PDF.js viewport.
 */
export function describeForm({ doc, form, lib }) {
  const fields = [];
  const raw = form.getFields();
  for (let index = 0; index < raw.length; index += 1) {
    const field = raw[index];
    const type = classify(field, lib);
    let name = safeName(field, index);
    let readOnly = false;
    let required = false;
    let multiline = false;
    let maxLength = null;
    let options = [];
    try {
      readOnly = Boolean(field.isReadOnly && field.isReadOnly());
      required = Boolean(field.isRequired && field.isRequired());
    } catch (_) {
      /* flags are optional */
    }
    if (type === FIELD_TYPES.TEXT) {
      try {
        multiline = Boolean(field.isMultiline());
        maxLength = typeof field.getMaxLength() === 'number' ? field.getMaxLength() : null;
      } catch (_) {
        /* ignore */
      }
    }
    if (type === FIELD_TYPES.RADIO || type === FIELD_TYPES.DROPDOWN || type === FIELD_TYPES.LIST) {
      try {
        options = (field.getOptions() || []).map((option) => String(option));
      } catch (_) {
        options = [];
      }
    }

    const widgets = [];
    try {
      const rawWidgets = field.acroField.getWidgets();
      for (let widgetIndex = 0; widgetIndex < rawWidgets.length; widgetIndex += 1) {
        const widget = rawWidgets[widgetIndex];
        let rect = null;
        try {
          rect = widget.getRectangle();
        } catch (_) {
          rect = null;
        }
        widgets.push({
          pageIndex: pageIndexOfWidget(doc, widget),
          x: rect ? rect.x : 0,
          y: rect ? rect.y : 0,
          width: rect ? rect.width : 0,
          height: rect ? rect.height : 0,
          // For radio groups the nth widget is the nth option (pdf-lib keeps
          // widgets, on-values and export values index-aligned).
          option: type === FIELD_TYPES.RADIO ? options[widgetIndex] ?? '' : '',
        });
      }
    } catch (_) {
      /* a field without widgets cannot be shown; it is still listed */
    }

    fields.push({
      name,
      type,
      typeLabel: FIELD_TYPE_LABELS[type] || FIELD_TYPE_LABELS[FIELD_TYPES.UNKNOWN],
      pageIndex: widgets.length ? widgets[0].pageIndex : 0,
      widgets,
      options,
      value: readValue(field, type),
      readOnly,
      required,
      multiline,
      maxLength,
      editable: EDITABLE_TYPES.has(type) && !readOnly,
    });
  }
  return { fields, pageCount: doc.getPageCount() };
}

/** Convenience helper: load a document and describe its form in one call. */
export async function readFormFields(input) {
  const loaded = await loadFormDocument(input);
  return describeForm(loaded);
}

/**
 * Write values into the form.
 *
 * `values` maps field name → value using the shapes produced by
 * `describeForm` (string for text/radio/dropdown/list, boolean for check
 * boxes). Unknown names, read-only fields and unsupported types are skipped
 * and reported. Returns NEW bytes; `doc` is consumed by the write.
 */
export async function fillFormDocument({ doc, form, lib }, values = {}) {
  const applied = [];
  const skipped = [];
  const names = new Set();
  for (const field of form.getFields()) {
    try {
      names.add(field.getName());
    } catch (_) {
      /* ignore */
    }
  }

  for (const [name, rawValue] of Object.entries(values || {})) {
    if (!names.has(name)) {
      skipped.push({ name, reason: 'no such field in this document' });
      continue;
    }
    let field;
    try {
      field = form.getField(name);
    } catch (error) {
      skipped.push({ name, reason: error.message || 'the field could not be read' });
      continue;
    }
    const type = classify(field, lib);
    let readOnly = false;
    try {
      readOnly = Boolean(field.isReadOnly && field.isReadOnly());
    } catch (_) {
      /* ignore */
    }
    if (!EDITABLE_TYPES.has(type)) {
      skipped.push({
        name,
        reason: `${FIELD_TYPE_LABELS[type] || 'field'} is not a fillable type in Cambuz`,
      });
      continue;
    }
    if (readOnly) {
      skipped.push({ name, reason: 'the field is marked read-only' });
      continue;
    }
    try {
      switch (type) {
        case FIELD_TYPES.CHECKBOX: {
          if (rawValue) field.check();
          else field.uncheck();
          break;
        }
        case FIELD_TYPES.RADIO: {
          const value = cleanText(rawValue);
          if (!value) field.clear();
          else field.select(value);
          break;
        }
        case FIELD_TYPES.DROPDOWN:
        case FIELD_TYPES.LIST: {
          const value = cleanText(rawValue);
          if (!value) field.clear();
          else field.select(value);
          break;
        }
        default: {
          const value = cleanText(rawValue);
          const maxLength = typeof field.getMaxLength === 'function' ? field.getMaxLength() : null;
          if (typeof maxLength === 'number' && value.length > maxLength) {
            throw new Error(`the field allows only ${maxLength} characters`);
          }
          if (value.length > MAX_FORM_VALUE_LENGTH) {
            throw new Error(`the value is longer than ${MAX_FORM_VALUE_LENGTH} characters`);
          }
          field.setText(value);
          break;
        }
      }
      applied.push({ name, value: rawValue });
    } catch (error) {
      skipped.push({ name, reason: error.message || 'the value could not be written' });
    }
  }

  // Rebuild the appearance stream of each field we changed so the new value is
  // visible in viewers that only draw appearances. Fields we did not touch keep
  // whatever the author gave them. Non-WinAnsi text (Devanagari, for example)
  // cannot be drawn with the standard appearance fonts: the value is still
  // stored, and the limitation is reported instead of failing the whole save.
  const warnings = [];
  const appearanceFailures = [];
  try {
    const font = await doc.embedFont(lib.StandardFonts.Helvetica);
    for (const { name } of applied) {
      try {
        const field = form.getField(name);
        if (!field || typeof field.updateAppearances !== 'function') continue;
        // Buttons carry their own appearance provider; only text-like fields
        // need a font to draw their value with.
        if (classify(field, lib) === FIELD_TYPES.CHECKBOX || classify(field, lib) === FIELD_TYPES.RADIO) {
          field.updateAppearances();
        } else {
          field.updateAppearances(font);
        }
      } catch (error) {
        appearanceFailures.push(name);
      }
    }
  } catch (error) {
    appearanceFailures.push(...applied.map((entry) => entry.name));
  }
  if (appearanceFailures.length > 0) {
    warnings.push(
      `Saved every value, but the drawn appearance of ${appearanceFailures.length} field(s) ` +
        `could not be rebuilt (${appearanceFailures.join(', ')}). Some viewers only show the ` +
        'new value once that field is focused.'
    );
  }
  const appearancesUpdated = appearanceFailures.length === 0;

  const bytes = await doc.save({ updateFieldAppearances: false });
  if (bytes.byteLength > MAX_PAGE_OPS_BYTES) {
    throw new Error('The filled PDF would exceed the 250 MiB limit.');
  }
  return { bytes, applied, skipped, warnings, appearancesUpdated };
}

/** True when at least one value differs from the value already in the document. */
export function dirtyFieldNames(fields, values) {
  const changed = [];
  for (const field of fields) {
    if (!field.editable) continue;
    if (!(field.name in (values || {}))) continue;
    const current = values[field.name];
    const original = field.value;
    if (typeof original === 'boolean') {
      if (Boolean(current) !== original) changed.push(field.name);
    } else if (String(current ?? '') !== String(original ?? '')) {
      changed.push(field.name);
    }
  }
  return changed;
}
