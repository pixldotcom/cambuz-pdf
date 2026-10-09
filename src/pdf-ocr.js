// Cambuz PDF Reader — Phase 7 optional OCR helpers.
//
// OCR is deliberately separate from PDF.js text extraction. This module only
// rasterizes a page after the user requests it; it never mutates the PDF or
// appends recognized text to the native PDF text layer/search index.

export const OCR_LANGUAGES = Object.freeze([
  { code: 'eng', name: 'English' },
  { code: 'hin', name: 'Hindi' },
  { code: 'pan', name: 'Punjabi' },
  { code: 'urd', name: 'Urdu' },
  { code: 'ben', name: 'Bengali' },
  { code: 'guj', name: 'Gujarati' },
  { code: 'mar', name: 'Marathi' },
  { code: 'tam', name: 'Tamil' },
  { code: 'tel', name: 'Telugu' },
  { code: 'kan', name: 'Kannada' },
  { code: 'mal', name: 'Malayalam' },
  { code: 'ori', name: 'Odia' },
  { code: 'asm', name: 'Assamese' },
]);

export const OCR_RENDER_DPI = 300;
export const OCR_MAX_RENDERED_PIXELS = 16_000_000;
export const OCR_MAX_RENDERED_DIMENSION = 8_000;

/**
 * Render a PDF.js page to a bounded, white-backed PNG for the optional OCR
 * process. A 300-dpi target gives Tesseract a useful input; unusually large
 * pages are reduced to keep canvas memory bounded. `canvasFactory` is injectable
 * so the same production path can be tested with a Node canvas implementation.
 *
 * Returns { bytes: Uint8Array, width, height }. Does not alter the PDF page or
 * the visible viewer canvas.
 */
export async function renderPdfPageToPng(
  page,
  {
    rotation = 0,
    canvasFactory = (width, height) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
    maxPixels = OCR_MAX_RENDERED_PIXELS,
    maxDimension = OCR_MAX_RENDERED_DIMENSION,
  } = {}
) {
  if (!page || typeof page.getViewport !== 'function' || typeof page.render !== 'function') {
    throw new Error('A valid PDF page is required for OCR.');
  }
  if (!Number.isFinite(rotation) || ![0, 90, 180, 270].includes(((rotation % 360) + 360) % 360)) {
    throw new Error('Page rotation must be 0, 90, 180, or 270 degrees.');
  }
  if (!Number.isFinite(maxPixels) || maxPixels < 1 || !Number.isFinite(maxDimension) || maxDimension < 1) {
    throw new Error('Invalid OCR raster limits.');
  }

  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const unitViewport = page.getViewport({ scale: 1, rotation: normalizedRotation });
  const unitWidth = Number(unitViewport.width);
  const unitHeight = Number(unitViewport.height);
  if (!Number.isFinite(unitWidth) || !Number.isFinite(unitHeight) || unitWidth <= 0 || unitHeight <= 0) {
    throw new Error('The PDF page has invalid dimensions and cannot be rasterized for OCR.');
  }

  const dpiScale = OCR_RENDER_DPI / 72;
  const pixelScale = Math.sqrt(maxPixels / (unitWidth * unitHeight));
  let scale = Math.min(
    dpiScale,
    maxDimension / unitWidth,
    maxDimension / unitHeight,
    pixelScale
  );
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error('The PDF page is too large to prepare for OCR.');
  }

  let viewport;
  let width;
  let height;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    viewport = page.getViewport({ scale, rotation: normalizedRotation });
    width = Math.ceil(viewport.width);
    height = Math.ceil(viewport.height);
    if (width >= 1 && height >= 1 && width <= maxDimension && height <= maxDimension && width * height <= maxPixels) {
      break;
    }
    const adjustment = Math.min(
      maxDimension / Math.max(width, 1),
      maxDimension / Math.max(height, 1),
      Math.sqrt(maxPixels / Math.max(width * height, 1))
    );
    if (!Number.isFinite(adjustment) || adjustment <= 0 || adjustment >= 1) break;
    scale *= adjustment * 0.999;
  }
  if (
    !viewport ||
    width < 1 ||
    height < 1 ||
    width > maxDimension ||
    height > maxDimension ||
    width * height > maxPixels
  ) {
    throw new Error('The PDF page is too large to prepare for OCR.');
  }

  const canvas = canvasFactory(width, height);
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new Error('Could not create an OCR canvas.');
  }
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Could not create an OCR drawing context.');

  try {
    context.save?.();
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.restore?.();

    await page.render({ canvasContext: context, viewport, background: '#ffffff' }).promise;

    let bytes;
    if (typeof canvas.toBuffer === 'function') {
      bytes = new Uint8Array(canvas.toBuffer('image/png'));
    } else if (typeof canvas.toBlob === 'function') {
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((value) => {
          if (value) resolve(value);
          else reject(new Error('The OCR page image could not be encoded.'));
        }, 'image/png');
      });
      bytes = new Uint8Array(await blob.arrayBuffer());
    } else {
      throw new Error('This canvas cannot export a PNG image.');
    }

    return { bytes, width, height };
  } finally {
    // Drop the temporary backing store promptly; large-page OCR can otherwise
    // keep another full-size canvas alive until a later garbage collection.
    canvas.width = 0;
    canvas.height = 0;
  }
}
