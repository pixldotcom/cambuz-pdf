// Shared, allocation-oriented limits for viewer and thumbnail canvases.
// Logical PDF page size and CSS layout remain unchanged; only bitmap resolution
// is reduced when the requested backing store would be unusually large.
export const VIEWER_CANVAS_MAX_PIXELS = 16_000_000;
export const VIEWER_CANVAS_MAX_DIMENSION = 8_192;

export const THUMBNAIL_CANVAS_MAX_PIXELS = 250_000;
export const THUMBNAIL_CANVAS_MAX_DIMENSION = 4_096;
export const THUMBNAIL_CACHE_MAX_PIXELS = 4_000_000;
export const THUMBNAIL_CACHE_MAX_ENTRIES = 64;

function maxScaleForPixelBudget(width, height, maxPixels) {
  // Divide successive square roots so even extreme finite PDF dimensions do
  // not overflow when multiplied into a width × height area.
  return Math.sqrt(maxPixels) / Math.sqrt(width) / Math.sqrt(height);
}

/**
 * Return a canvas backing-store size for a logical viewport and requested
 * device scale. The returned scale is the exact transform to use when painting
 * the original logical viewport into that smaller-or-equal bitmap.
 */
export function getCanvasRenderSize(
  width,
  height,
  requestedScale = 1,
  { maxPixels = VIEWER_CANVAS_MAX_PIXELS, maxDimension = VIEWER_CANVAS_MAX_DIMENSION } = {}
) {
  const logicalWidth = Number(width);
  const logicalHeight = Number(height);
  const scaleRequest = Number(requestedScale);
  if (
    !Number.isFinite(logicalWidth) || logicalWidth <= 0 ||
    !Number.isFinite(logicalHeight) || logicalHeight <= 0 ||
    !Number.isFinite(scaleRequest) || scaleRequest <= 0 ||
    !Number.isFinite(maxPixels) || maxPixels < 1 ||
    !Number.isFinite(maxDimension) || maxDimension < 1
  ) {
    throw new Error('Invalid canvas render dimensions or limits.');
  }

  const scale = Math.min(
    scaleRequest,
    maxScaleForPixelBudget(logicalWidth, logicalHeight, maxPixels),
    maxDimension / logicalWidth,
    maxDimension / logicalHeight
  );
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error('Canvas render scale is outside the supported range.');
  }
  const canvasWidth = Math.max(1, Math.floor(logicalWidth * scale));
  const canvasHeight = Math.max(1, Math.floor(logicalHeight * scale));
  return { width: canvasWidth, height: canvasHeight, scale };
}

/** Scale a logical thumbnail viewport to a preferred CSS width and safe limits. */
export function getThumbnailViewportScale(
  width,
  height,
  targetWidth,
  { maxPixels = THUMBNAIL_CANVAS_MAX_PIXELS, maxDimension = THUMBNAIL_CANVAS_MAX_DIMENSION } = {}
) {
  const logicalWidth = Number(width);
  const logicalHeight = Number(height);
  const preferredWidth = Number(targetWidth);
  if (
    !Number.isFinite(logicalWidth) || logicalWidth <= 0 ||
    !Number.isFinite(logicalHeight) || logicalHeight <= 0 ||
    !Number.isFinite(preferredWidth) || preferredWidth <= 0 ||
    !Number.isFinite(maxPixels) || maxPixels < 1 ||
    !Number.isFinite(maxDimension) || maxDimension < 1
  ) {
    throw new Error('Invalid thumbnail dimensions or limits.');
  }
  return Math.min(
    preferredWidth / logicalWidth,
    maxScaleForPixelBudget(logicalWidth, logicalHeight, maxPixels),
    maxDimension / logicalWidth,
    maxDimension / logicalHeight
  );
}

/**
 * LRU budget for retained thumbnail bitmaps. The page buttons/placeholders stay
 * in the DOM; evicting a canvas only drops its backing store and lets the
 * observer repaint it if the user scrolls back to that page.
 */
export class CanvasLruCache {
  constructor({
    maxEntries = THUMBNAIL_CACHE_MAX_ENTRIES,
    maxPixels = THUMBNAIL_CACHE_MAX_PIXELS,
    onEvict = () => {},
  } = {}) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isFinite(maxPixels) || maxPixels < 1) {
      throw new Error('Invalid thumbnail cache limits.');
    }
    this.maxEntries = maxEntries;
    this.maxPixels = maxPixels;
    this.onEvict = onEvict;
    this.entries = new Map();
    this.pixels = 0;
  }

  touch(key, pixels) {
    const size = Math.ceil(Number(pixels));
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid thumbnail bitmap size.');
    this.#remove(key, false);
    if (size > this.maxPixels) {
      this.onEvict(key);
      return false;
    }
    this.entries.set(key, size);
    this.pixels += size;
    while (this.entries.size > this.maxEntries || this.pixels > this.maxPixels) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.#remove(oldestKey, true);
    }
    return this.entries.has(key);
  }

  delete(key, release = false) {
    this.#remove(key, release);
  }

  clear() {
    for (const key of this.entries.keys()) this.onEvict(key);
    this.entries.clear();
    this.pixels = 0;
  }

  #remove(key, release) {
    const size = this.entries.get(key);
    if (size === undefined) return;
    this.entries.delete(key);
    this.pixels -= size;
    if (release) this.onEvict(key);
  }
}
