#!/usr/bin/env node
// Focused Phase 8 checks for bounded canvas allocation and lazy thumbnail cleanup.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import {
  CanvasLruCache,
  getCanvasRenderSize,
  getThumbnailViewportScale,
  THUMBNAIL_CACHE_MAX_PIXELS,
  THUMBNAIL_CANVAS_MAX_PIXELS,
  VIEWER_CANVAS_MAX_DIMENSION,
  VIEWER_CANVAS_MAX_PIXELS,
} from '../src/canvas-budget.js';
import { SidebarController } from '../src/sidebar.js';
import { PageToolsController } from '../src/pdf-ops-ui.js';
import { SearchController } from '../src/search.js';

function section(title) {
  console.log(`\n## ${title}`);
}

function check(condition, message) {
  assert.ok(condition, message);
  console.log(`  PASS  ${message}`);
}

section('Bounded canvas sizing');
const normal = getCanvasRenderSize(612, 792, 2);
check(normal.width === 1224 && normal.height === 1584, 'normal pages retain the requested high-DPI backing size');
const bounded = getCanvasRenderSize(12_000, 18_000, 2);
check(bounded.width <= VIEWER_CANVAS_MAX_DIMENSION, 'viewer width stays under the dimension cap');
check(bounded.height <= VIEWER_CANVAS_MAX_DIMENSION, 'viewer height stays under the dimension cap');
check(bounded.width * bounded.height <= VIEWER_CANVAS_MAX_PIXELS, 'viewer pixels stay under the allocation cap');
check(bounded.scale <= 2, 'bounded rendering never exceeds the requested scale');
const extreme = getCanvasRenderSize(1e308, 1e308, 1);
check(Number.isFinite(extreme.scale), 'extreme finite PDF dimensions do not overflow sizing math');
check(extreme.width * extreme.height <= VIEWER_CANVAS_MAX_PIXELS, 'extreme dimensions still obey the viewer pixel cap');
for (const args of [[0, 10, 1], [10, -1, 1], [10, 10, 0]]) {
  assert.throws(() => getCanvasRenderSize(...args), /Invalid canvas/);
}
console.log('  PASS  invalid canvas inputs are rejected');
const thumbScale = getThumbnailViewportScale(1e308, 1e308, 148);
const thumbSize = getCanvasRenderSize(1e308 * thumbScale, 1e308 * thumbScale, 2, {
  maxPixels: THUMBNAIL_CANVAS_MAX_PIXELS,
});
check(thumbSize.width * thumbSize.height <= THUMBNAIL_CANVAS_MAX_PIXELS, 'extreme thumbnail dimensions stay within the thumbnail pixel cap');

section('Pixel- and entry-bounded LRU');
const evicted = [];
const cache = new CanvasLruCache({ maxEntries: 2, maxPixels: 100, onEvict: (key) => evicted.push(key) });
cache.touch('a', 25);
cache.touch('b', 25);
cache.touch('a', 25); // a becomes most recently used
cache.touch('c', 50); // b is the least-recently-used entry
check(!cache.entries.has('b') && cache.entries.has('a') && cache.entries.has('c'), 'entry overflow evicts the least-recently-used bitmap');
cache.touch('d', 50); // pixel overflow evicts a
check(cache.pixels <= 100 && !cache.entries.has('a'), 'pixel overflow evicts old bitmaps until the budget is met');
check(!cache.touch('oversized', 101), 'a single oversized bitmap is rejected');
check(!cache.entries.has('oversized') && cache.pixels <= 100, 'rejecting an oversized bitmap leaves the cache consistent');
cache.clear();
check(cache.entries.size === 0 && cache.pixels === 0, 'clearing the LRU releases its full accounting budget');
check(evicted.includes('b') && evicted.includes('a') && evicted.includes('oversized'), 'evictions invoke the bitmap-release callback');

section('Search cache invalidation on close');
let currentSearchDoc = {
  numPages: 1,
  getPage: async () => ({
    getTextContent: () => new Promise((resolve) => { releaseStaleText = resolve; }),
    cleanup: () => { stalePageCleaned = true; },
  }),
};
let releaseStaleText;
let stalePageCleaned = false;
const search = new SearchController({
  getDoc: () => currentSearchDoc,
  getCurrentPage: () => 1,
  goToPage: async () => {},
  getTextLayerEl: () => ({ querySelectorAll: () => [] }),
  onStatus: () => {},
  onCount: () => {},
});
const staleSearch = search.setQuery('stale');
await new Promise((resolve) => setImmediate(resolve));
search.clearDocument();
currentSearchDoc = null;
releaseStaleText({ items: [{ str: 'stale document text', hasEOL: false }] });
await staleSearch;
check(search.pageTextCache.entries.size === 0 && search.pageTextCache.bytes === 0, 'a late text extraction cannot refill the cache after close');
check(search.cachedDoc === null && stalePageCleaned, 'document identity clears and the pending PDF page is cleaned up');

section('Lazy sidebar thumbnails and cancellation');
const dom = new JSDOM(`<!doctype html><body>
  <aside id="sidebar" style="display:none"></aside>
  <button id="tab-thumbs"></button><button id="tab-outline"></button>
  <div id="thumbs-panel"></div><div id="outline-panel"></div>
</body>`, { pretendToBeVisual: true, url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;

class TestIntersectionObserver {
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.targets = new Set();
  }
  observe(target) { this.targets.add(target); }
  unobserve(target) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
  intersect(target) {
    this.callback([{ target, isIntersecting: true }], this);
  }
}
globalThis.IntersectionObserver = TestIntersectionObserver;
dom.window.HTMLCanvasElement.prototype.getContext = () => ({ setTransform() {} });

const renderTasks = new Map();
const cleanupCounts = new Map();
const pages = new Map();
for (let number = 1; number <= 4; number += 1) {
  pages.set(number, {
    getViewport: ({ scale, rotation = 0 }) => {
      const rotated = rotation % 180 !== 0;
      return {
        width: (rotated ? 792 : 612) * scale,
        height: (rotated ? 612 : 792) * scale,
      };
    },
    render: () => {
      let resolvePromise;
      let rejectPromise;
      const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
      });
      const task = {
        promise,
        cancelled: false,
        cancel() {
          if (this.cancelled) return;
          this.cancelled = true;
          rejectPromise(Object.assign(new Error('render cancelled'), { name: 'RenderingCancelledException' }));
        },
      };
      renderTasks.set(number, task);
      if (number !== 3) setTimeout(resolvePromise, 0);
      return task;
    },
    cleanup: () => cleanupCounts.set(number, (cleanupCounts.get(number) || 0) + 1),
  });
}
const fakeDoc = {
  numPages: pages.size,
  getPage: async (number) => pages.get(number),
  getOutline: async () => null,
};
const sidebar = new SidebarController({
  sidebarEl: document.getElementById('sidebar'),
  thumbsPanel: document.getElementById('thumbs-panel'),
  outlinePanel: document.getElementById('outline-panel'),
  tabThumbs: document.getElementById('tab-thumbs'),
  tabOutline: document.getElementById('tab-outline'),
  getDoc: () => fakeDoc,
  getRotation: () => 0,
  goToPage: () => {},
  onStatus: () => {},
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));
const opening = sidebar.openDocument(fakeDoc);
const placeholdersAllocationFree = sidebar.thumbItems.every(
  (item) => item.canvas.width === 0 && item.canvas.height === 0
);
await opening;
const first = sidebar.thumbItems[0];
const second = sidebar.thumbItems[1];
check(placeholdersAllocationFree, 'all page placeholders start without backing pixels');
await flush();
check(first.rendered && first.canvas.width > 0, 'the active page thumbnail is rendered eagerly');
check(first.canvas.width * first.canvas.height <= THUMBNAIL_CANVAS_MAX_PIXELS, 'the active thumbnail obeys its pixel cap');
check(!second.rendered, 'off-screen thumbnails remain lazy');
sidebar.observer.intersect(second.el);
await flush();
check(second.rendered && second.canvas.width > 0, 'an intersecting thumbnail is rendered on demand');
check(cleanupCounts.get(1) === 1 && cleanupCounts.get(2) === 1, 'completed thumbnail page resources are cleaned up');
const third = sidebar.thumbItems[2];
sidebar.observer.intersect(third.el);
await flush();
check(renderTasks.get(3)?.cancelled === false, 'the pending thumbnail render was started');
sidebar.closeDocument();
check(renderTasks.get(3)?.cancelled === true, 'closing the document cancels an in-flight thumbnail task');
check(sidebar.thumbItems.length === 0, 'closing the document drops thumbnail DOM state');
await flush();
check(third.canvas.width === 0 && third.canvas.height === 0, 'closing the document releases thumbnail backing pixels');
check(cleanupCounts.get(3) === 1, 'cancelled thumbnail page resources are cleaned up');
dom.window.close();

const fallbackDom = new JSDOM(`<!doctype html><body>
  <aside id="sidebar" style="display:flex"></aside>
  <button id="tab-thumbs"></button><button id="tab-outline"></button>
  <div id="thumbs-panel"></div><div id="outline-panel"></div>
</body>`, { pretendToBeVisual: true, url: 'http://localhost/' });
globalThis.window = fallbackDom.window;
globalThis.document = fallbackDom.window.document;
globalThis.IntersectionObserver = undefined;
fallbackDom.window.HTMLCanvasElement.prototype.getContext = () => ({ setTransform() {} });
const fallbackPanel = document.getElementById('thumbs-panel');
let scrollTop = 0;
fallbackPanel.getBoundingClientRect = () => ({
  top: scrollTop,
  bottom: scrollTop + 100,
  left: 0,
  right: 200,
  width: 200,
  height: 100,
});
fallbackDom.window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
  if (this.classList?.contains('thumb-item')) {
    const top = (Number(this.dataset.page) - 1) * 100;
    return { top, bottom: top + 80, left: 0, right: 180, width: 180, height: 80 };
  }
  return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
};
const fallbackTasks = new Map();
const fallbackDoc = {
  numPages: 10,
  getOutline: async () => null,
  getPage: async (number) => ({
    getViewport: ({ scale, rotation = 0 }) => {
      const rotated = rotation % 180 !== 0;
      return { width: (rotated ? 792 : 612) * scale, height: (rotated ? 612 : 792) * scale };
    },
    render: () => {
      let resolvePromise;
      const promise = new Promise((resolve) => { resolvePromise = resolve; });
      const task = { promise, cancel() {} };
      fallbackTasks.set(number, task);
      setTimeout(resolvePromise, 0);
      return task;
    },
    cleanup() {},
  }),
};
const fallback = new SidebarController({
  sidebarEl: document.getElementById('sidebar'),
  thumbsPanel: fallbackPanel,
  outlinePanel: document.getElementById('outline-panel'),
  tabThumbs: document.getElementById('tab-thumbs'),
  tabOutline: document.getElementById('tab-outline'),
  getDoc: () => fallbackDoc,
  getRotation: () => 0,
  goToPage: () => {},
  onStatus: () => {},
});
const fallbackOpen = fallback.openDocument(fallbackDoc);
await fallbackOpen;
await flush();
check(fallback.thumbItems.slice(0, 4).some((item) => item.rendered), 'scroll fallback paints thumbnails near the visible viewport');
check(!fallback.thumbItems[7].rendered, 'scroll fallback leaves distant pages lazy');
scrollTop = 500;
fallbackPanel.dispatchEvent(new fallbackDom.window.Event('scroll'));
await flush();
check(fallback.thumbItems[5].rendered, 'scroll fallback paints newly visible pages after scrolling');
fallback.closeDocument();
fallbackDom.window.close();

section('Page-tools thumbnail fallback and cleanup');
const pageOpsHtml = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
const pageOpsDom = new JSDOM(pageOpsHtml, { pretendToBeVisual: true, url: 'http://localhost/' });
globalThis.window = pageOpsDom.window;
globalThis.document = pageOpsDom.window.document;
globalThis.IntersectionObserver = undefined;
pageOpsDom.window.HTMLCanvasElement.prototype.getContext = () => ({ setTransform() {} });
let pageOpsScrollTop = 0;
const pageOpsScroll = document.getElementById('pageops-grid-scroll');
pageOpsScroll.getBoundingClientRect = () => ({
  top: pageOpsScrollTop,
  bottom: pageOpsScrollTop + 100,
  left: 0,
  right: 300,
  width: 300,
  height: 100,
});
pageOpsDom.window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
  if (this.classList?.contains('po-cell')) {
    const top = Number(this.dataset.position) * 100;
    return { top, bottom: top + 80, left: 0, right: 180, width: 180, height: 80 };
  }
  return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
};
const pageOpsTasks = new Map();
const pageOpsCleanups = new Map();
const pageOpsDoc = {
  numPages: 10,
  getPage: async (number) => ({
    getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }),
    render: () => {
      let resolvePromise;
      let rejectPromise;
      const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
      });
      const task = {
        promise,
        cancelled: false,
        cancel() {
          if (this.cancelled) return;
          this.cancelled = true;
          rejectPromise(Object.assign(new Error('render cancelled'), { name: 'RenderingCancelledException' }));
        },
      };
      pageOpsTasks.set(number, task);
      if (number !== 9) setTimeout(resolvePromise, 0);
      return task;
    },
    cleanup: () => pageOpsCleanups.set(number, (pageOpsCleanups.get(number) || 0) + 1),
  }),
  destroy: async () => {},
};
const sourcePdf = new Uint8Array(await readFile(new URL('../samples/cambuz-demo.pdf', import.meta.url)));
const pageTools = new PageToolsController({
  pdfjsLib: { getDocument: () => ({ promise: Promise.resolve(pageOpsDoc) }) },
  standardFontDataUrl: '',
  getSourceBytes: () => sourcePdf,
  getDocumentName: () => 'cambuz-demo.pdf',
  getDocumentGeneration: () => 1,
  getCurrentFilePath: () => null,
});
await pageTools.open();
await flush();
check(pageTools.cells.slice(0, 4).some((entry) => entry.rendered), 'page-tools fallback paints thumbnails near the visible viewport');
check(!pageTools.cells[8].rendered, 'page-tools fallback leaves distant pages lazy');
pageOpsScrollTop = 500;
pageOpsScroll.dispatchEvent(new pageOpsDom.window.Event('scroll'));
await flush();
check(pageTools.cells[5].rendered, 'page-tools fallback paints newly visible pages after scrolling');
pageOpsScrollTop = 800;
pageOpsScroll.dispatchEvent(new pageOpsDom.window.Event('scroll'));
await flush();
const pendingPageOpsEntry = pageTools.cells[8];
check(pageOpsTasks.get(9)?.cancelled === false, 'page-tools starts an on-screen thumbnail task');
pageTools.close(false);
check(pageOpsTasks.get(9)?.cancelled === true, 'closing page tools cancels its pending thumbnail task');
check(pendingPageOpsEntry.canvas.width === 0 && pendingPageOpsEntry.canvas.height === 0, 'closing page tools releases thumbnail backing pixels');
await flush();
check(pageOpsCleanups.get(9) === 1, 'cancelled page-tools thumbnail resources are cleaned up');
pageOpsDom.window.close();

section('Viewer render queue, zoom bounds and close cleanup');
const appDom = new JSDOM(pageOpsHtml, {
  url: 'http://localhost:3000/src/index.html',
  pretendToBeVisual: true,
});
globalThis.window = appDom.window;
globalThis.document = appDom.window.document;
globalThis.localStorage = appDom.window.localStorage;
globalThis.IntersectionObserver = undefined;
const demoPdfBytes = await readFile(new URL('../samples/cambuz-demo.pdf', import.meta.url));
let demoFetches = 0;
let releaseStaleDemoFetch;
const asFetchResponse = (buffer) => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
});
globalThis.fetch = async (resource) => {
  const url = String(resource);
  if (url.startsWith('file://') && url.endsWith('/samples/cambuz-demo.pdf')) {
    demoFetches += 1;
    if (demoFetches === 1) {
      return new Promise((resolve) => { releaseStaleDemoFetch = () => resolve(asFetchResponse(demoPdfBytes)); });
    }
    return asFetchResponse(demoPdfBytes);
  }
  const target = url.startsWith('file://')
    ? new URL(url)
    : new URL(`../${url.replace(/^https?:\/\/localhost:3000\//, '').replace(/^\/+/, '')}`, import.meta.url);
  return asFetchResponse(await readFile(target));
};
appDom.window.HTMLCanvasElement.prototype.getContext = function getContext() {
  const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const state = {
    canvas: this,
    getTransform: () => identity,
    getImageData: (x, y, width = 1, height = 1) => ({ data: new Uint8ClampedArray(Math.max(1, width * height * 4)), width, height }),
    createImageData: (width = 1, height = 1) => ({ data: new Uint8ClampedArray(Math.max(1, width * height * 4)), width, height }),
    measureText: () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }),
    isPointInPath: () => false,
  };
  return new Proxy(state, {
    get: (target, property) => (property in target ? target[property] : () => {}),
    set: (target, property, value) => { target[property] = value; return true; },
  });
};
appDom.window.Path2D = class Path2D {
  addPath() {} moveTo() {} lineTo() {} bezierCurveTo() {} quadraticCurveTo() {}
  closePath() {} rect() {} arc() {} ellipse() {} transform() {}
};
globalThis.Path2D = appDom.window.Path2D;
appDom.window.confirm = () => true;
const renderer = await import('../src/renderer.js?phase8-render-queue');
await renderer.initApp();
const appElement = (id) => appDom.window.document.getElementById(id);
const appFlush = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));
appElement('btn-sample').dispatchEvent(new appDom.window.MouseEvent('click', { bubbles: true }));
for (let attempt = 0; attempt < 80 && !releaseStaleDemoFetch; attempt += 1) await appFlush(10);
check(typeof releaseStaleDemoFetch === 'function', 'the first sample load reaches its deferred fetch');
appElement('btn-sample-form').dispatchEvent(new appDom.window.MouseEvent('click', { bubbles: true }));
for (let attempt = 0; attempt < 80 && appElement('doc-title').textContent !== 'form-sample.pdf'; attempt += 1) await appFlush(50);
check(appElement('doc-title').textContent === 'form-sample.pdf', 'a second document can load while an earlier fetch is pending');
releaseStaleDemoFetch?.();
await appFlush(200);
check(appElement('doc-title').textContent === 'form-sample.pdf', 'a stale fetch cannot replace the newer committed document');
appElement('btn-sample').dispatchEvent(new appDom.window.MouseEvent('click', { bubbles: true }));
for (let attempt = 0; attempt < 80 && appElement('doc-title').textContent !== 'cambuz-demo.pdf'; attempt += 1) await appFlush(50);
check(appElement('doc-title').textContent === 'cambuz-demo.pdf', 'renderer opens a real ten-page PDF');
const viewerCanvas = appElement('pdf-canvas');
check(viewerCanvas.width > 0 && viewerCanvas.height > 0, 'initial viewer render allocates a page canvas');
const pageInput = appElement('page-input');
for (const pageNumber of [4, 9, 2, 10]) {
  pageInput.value = String(pageNumber);
  pageInput.dispatchEvent(new appDom.window.KeyboardEvent('keydown', {
    key: 'Enter', bubbles: true, cancelable: true,
  }));
}
await appFlush(1000);
check(pageInput.value === '10' && /Page 10 \/ 10/.test(appElement('status-meta').textContent), 'coalesced rapid navigation ends on the latest requested page');
for (let zoom = 0; zoom < 4; zoom += 1) {
  appElement('btn-zoom-in').dispatchEvent(new appDom.window.MouseEvent('click', { bubbles: true }));
}
await appFlush(1000);
check(viewerCanvas.width * viewerCanvas.height <= VIEWER_CANVAS_MAX_PIXELS, 'repeated zoom stays within the viewer pixel budget');
check(viewerCanvas.width <= VIEWER_CANVAS_MAX_DIMENSION && viewerCanvas.height <= VIEWER_CANVAS_MAX_DIMENSION, 'repeated zoom stays within the viewer dimension budget');
appElement('btn-close').dispatchEvent(new appDom.window.MouseEvent('click', { bubbles: true }));
check(viewerCanvas.width === 0 && viewerCanvas.height === 0, 'closing the PDF immediately releases the main canvas backing store');
await appFlush(200);
check(viewerCanvas.width === 0 && viewerCanvas.height === 0, 'cancelled render work cannot restore pixels after document close');
appDom.window.close();

globalThis.window = undefined;
globalThis.document = undefined;
globalThis.IntersectionObserver = undefined;
console.log('\nPhase 8 focused tests: passed');
