// Cambuz PDF Reader — text-selection status (DOM-free).
//
// Selection can be refused for two reasons, and the status bar says which one
// applies to the page on screen, so nothing is refused silently:
//   - the document's permissions deny copying (Phase 5 enforcement), or
//   - the page has no text layer, which usually means a scanned image.

/**
 * Status-bar text for a page that has just been rendered. A page that can be
 * selected and copied keeps the plain "Page N of M" message.
 */
export function pageStatusMessage({ pageNumber, totalPages, hasText, copyBlocked }) {
  const parts = [`Page ${pageNumber} of ${totalPages}`];
  if (copyBlocked) parts.push('copying not allowed by this document');
  if (!hasText) parts.push('no selectable text on this page (scanned image?)');
  return parts.join(' • ');
}
