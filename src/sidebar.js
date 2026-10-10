// Cambuz PDF Reader — Sidebar: Thumbnails + Document Outline (Phase 2)

import {
  CanvasLruCache,
  getCanvasRenderSize,
  getThumbnailViewportScale,
  THUMBNAIL_CACHE_MAX_ENTRIES,
  THUMBNAIL_CACHE_MAX_PIXELS,
  THUMBNAIL_CANVAS_MAX_DIMENSION,
  THUMBNAIL_CANVAS_MAX_PIXELS,
} from './canvas-budget.js';

const THUMB_WIDTH = 148; // CSS pixels for thumbnail images

export class SidebarController {
  /**
   * @param {object} deps
   * @param {HTMLElement} deps.sidebarEl
   * @param {HTMLElement} deps.thumbsPanel
   * @param {HTMLElement} deps.outlinePanel
   * @param {HTMLButtonElement} deps.tabThumbs
   * @param {HTMLButtonElement} deps.tabOutline
   * @param {() => object|null} deps.getDoc
   * @param {() => number} deps.getRotation
   * @param {(n:number) => void} deps.goToPage
   * @param {(msg:string) => void} deps.onStatus
   */
  constructor(deps) {
    this.deps = deps;
    this.docToken = 0;
    this.thumbItems = []; // [{ page, el, canvas, rendered, rendering }]
    this.activePage = 1;
    this.observer = null;
    this.fallbackScrollHandler = null;
    this.fallbackRefreshTimer = null;
    this.outlineLoaded = false;
    this.renderGeneration = 0;
    this.thumbnailCache = new CanvasLruCache({
      maxEntries: THUMBNAIL_CACHE_MAX_ENTRIES,
      maxPixels: THUMBNAIL_CACHE_MAX_PIXELS,
      onEvict: (item) => this.releaseThumbnail(item),
    });

    deps.tabThumbs.addEventListener('click', () => this.setTab('thumbs'));
    deps.tabOutline.addEventListener('click', () => this.setTab('outline'));
  }

  get open() {
    return this.deps.sidebarEl.style.display !== 'none';
  }

  setOpen(open) {
    this.deps.sidebarEl.style.display = open ? 'flex' : 'none';
    if (open) {
      // Rendering may have been skipped while hidden; refresh the view.
      this.refreshVisibleThumbs();
    }
  }

  toggle() {
    this.setOpen(!this.open);
  }

  setTab(which) {
    const { tabThumbs, tabOutline, thumbsPanel, outlinePanel } = this.deps;
    const thumbs = which !== 'outline';
    tabThumbs.classList.toggle('active', thumbs);
    tabOutline.classList.toggle('active', !thumbs);
    tabThumbs.setAttribute('aria-selected', thumbs ? 'true' : 'false');
    tabOutline.setAttribute('aria-selected', !thumbs ? 'true' : 'false');
    thumbsPanel.style.display = thumbs ? 'block' : 'none';
    outlinePanel.style.display = thumbs ? 'none' : 'block';
    if (thumbs) this.refreshVisibleThumbs();
  }

  releaseThumbnail(item) {
    if (!item) return;
    item.rendered = false;
    item.pixelCount = 0;
    if (item.canvas) {
      item.canvas.width = 0;
      item.canvas.height = 0;
    }
    if (this.observer && item.el?.isConnected) this.observer.observe(item.el);
    else if (this.fallbackScrollHandler && item.el?.isConnected) this.scheduleFallbackRefresh();
  }

  scheduleFallbackRefresh() {
    if (this.fallbackRefreshTimer !== null) return;
    this.fallbackRefreshTimer = setTimeout(() => {
      this.fallbackRefreshTimer = null;
      this.refreshVisibleThumbs();
    }, 0);
  }

  cancelThumbnailTasks() {
    for (const item of this.thumbItems) {
      try { item.renderTask?.cancel(); } catch (_) { /* already complete */ }
    }
  }

  /** Build sidebar content for a newly opened document. */
  async openDocument(pdfDoc) {
    this.docToken += 1;
    this.renderGeneration += 1;
    const token = this.docToken;
    this.disconnectObserver();
    this.cancelThumbnailTasks();
    this.thumbnailCache.clear();
    for (const item of this.thumbItems) this.releaseThumbnail(item);
    this.thumbItems = [];
    this.activePage = 1;
    this.outlineLoaded = false;
    this.deps.thumbsPanel.innerHTML = '';
    this.deps.outlinePanel.innerHTML =
      '<p class="sidebar-empty">Loading bookmarks…</p>';

    const n = pdfDoc.numPages;

    // Thumbnails: create placeholders immediately, render lazily.
    const frag = document.createDocumentFragment();
    for (let p = 1; p <= n; p++) {
      const item = document.createElement('button');
      item.className = 'thumb-item';
      item.dataset.page = String(p);
      item.title = `Go to page ${p}`;
      item.setAttribute('aria-label', `Go to page ${p}`);
      const canvas = document.createElement('canvas');
      canvas.className = 'thumb-canvas';
      // Browsers allocate a 300 × 150 backing bitmap by default. Keep each
      // unrendered placeholder allocation-free, including in 100+ page PDFs.
      canvas.width = 0;
      canvas.height = 0;
      canvas.style.width = `${THUMB_WIDTH}px`;
      canvas.style.height = '40px';
      const label = document.createElement('span');
      label.className = 'thumb-label';
      label.textContent = String(p);
      item.appendChild(canvas);
      item.appendChild(label);
      item.addEventListener('click', () => this.deps.goToPage(p));
      frag.appendChild(item);
      this.thumbItems.push({
        page: p,
        el: item,
        canvas,
        rendered: false,
        rendering: false,
        renderTask: null,
        pixelCount: 0,
      });
    }
    this.deps.thumbsPanel.appendChild(frag);
    if (token !== this.docToken) return;
    this.setActivePage(1);
    this.observeThumbs();

    // Outline (bookmarks) — best effort; many PDFs have none.
    try {
      const outline = await pdfDoc.getOutline();
      if (token !== this.docToken) return;
      this.renderOutline(outline);
    } catch (err) {
      console.warn('Outline load failed:', err);
      if (token !== this.docToken) return;
      this.renderOutline(null);
    }
  }

  closeDocument() {
    this.docToken += 1;
    this.renderGeneration += 1;
    this.disconnectObserver();
    this.cancelThumbnailTasks();
    this.thumbnailCache.clear();
    for (const item of this.thumbItems) this.releaseThumbnail(item);
    this.thumbItems = [];
    this.deps.thumbsPanel.innerHTML = '';
    this.deps.outlinePanel.innerHTML =
      '<p class="sidebar-empty">Open a document to see bookmarks.</p>';
  }

  setActivePage(pageNum) {
    const previous = this.thumbItems[this.activePage - 1];
    const active = this.thumbItems[pageNum - 1];
    if (previous !== active) previous?.el.classList.remove('active');
    this.activePage = pageNum;
    active?.el.classList.add('active');
    if (active?.rendered) {
      this.thumbnailCache.touch(active, active.pixelCount);
    } else if (active && !active.rendering) {
      // Render the active thumbnail eagerly so it is never blank.
      this.renderThumb(active, this.docToken);
    }
  }

  scrollActiveIntoView() {
    const active = this.thumbItems[this.activePage - 1];
    if (active && typeof active.el.scrollIntoView === 'function') {
      active.el.scrollIntoView({ block: 'nearest' });
    }
  }

  /** Re-render thumbnails (e.g. after rotation changes). */
  async refreshAll() {
    const token = this.docToken;
    const generation = ++this.renderGeneration;
    this.disconnectObserver();
    this.cancelThumbnailTasks();
    const inFlight = this.thumbItems.map((item) => item.renderPromise).filter(Boolean);
    await Promise.allSettled(inFlight);
    if (token !== this.docToken || generation !== this.renderGeneration) return;
    this.thumbnailCache.clear();
    for (const item of this.thumbItems) this.releaseThumbnail(item);
    this.observeThumbs();
    const active = this.thumbItems[this.activePage - 1];
    if (active) await this.renderThumb(active, token);
    this.refreshVisibleThumbs();
  }

  // --- Thumbnails ---------------------------------------------------------

  observeThumbs() {
    this.disconnectObserver();
    if (typeof IntersectionObserver === 'undefined') {
      // Older engines use scroll geometry instead of painting every page up
      // front. This keeps fallback memory and CPU proportional to what is seen.
      this.fallbackScrollHandler = () => this.scheduleFallbackRefresh();
      this.deps.thumbsPanel.addEventListener('scroll', this.fallbackScrollHandler, { passive: true });
      this.refreshVisibleThumbs();
      return;
    }
    const token = this.docToken;
    const observer = new IntersectionObserver(
      (entries) => {
        if (token !== this.docToken || observer !== this.observer) return;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const page = Number(e.target.dataset.page);
          const item = this.thumbItems[page - 1];
          if (item && !item.rendered && !item.rendering) {
            this.renderThumb(item, token);
          }
          observer.unobserve(e.target);
        }
      },
      { root: this.deps.thumbsPanel, rootMargin: '200px 0px' }
    );
    this.observer = observer;
    for (const t of this.thumbItems) observer.observe(t.el);
  }

  disconnectObserver() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.fallbackScrollHandler) {
      this.deps.thumbsPanel.removeEventListener('scroll', this.fallbackScrollHandler);
      this.fallbackScrollHandler = null;
    }
    if (this.fallbackRefreshTimer !== null) {
      clearTimeout(this.fallbackRefreshTimer);
      this.fallbackRefreshTimer = null;
    }
  }

  refreshVisibleThumbs() {
    if (!this.observer && !this.fallbackScrollHandler) return;
    if (!this.open) return;
    // Re-check items currently in view (e.g. sidebar was just opened).
    const token = this.docToken;
    const panel = this.deps.thumbsPanel;
    const rect = panel.getBoundingClientRect();
    if (!this.observer && rect.width <= 0 && rect.height <= 0) return;
    for (const t of this.thumbItems) {
      if (t.rendered || t.rendering) continue;
      const r = t.el.getBoundingClientRect();
      if (r.bottom >= rect.top - 200 && r.top <= rect.bottom + 200) {
        this.renderThumb(t, token);
        this.observer?.unobserve(t.el);
      }
    }
  }

  renderThumb(item, token) {
    const doc = this.deps.getDoc();
    if (!doc || token !== this.docToken || item.rendered || item.rendering) {
      return Promise.resolve();
    }
    item.rendering = true;
    const generation = this.renderGeneration;
    const operation = this.performThumbnailRender(item, doc, token, generation);
    item.renderPromise = operation;
    operation.finally(() => {
      if (item.renderPromise === operation) item.renderPromise = null;
    });
    return operation;
  }

  async performThumbnailRender(item, doc, token, generation) {
    let page = null;
    let task = null;
    try {
      page = await doc.getPage(item.page);
      if (
        token !== this.docToken ||
        generation !== this.renderGeneration ||
        doc !== this.deps.getDoc()
      ) return;

      const rotation = this.deps.getRotation();
      const base = page.getViewport({ scale: 1, rotation });
      const scale = getThumbnailViewportScale(base.width, base.height, THUMB_WIDTH, {
        maxPixels: THUMBNAIL_CANVAS_MAX_PIXELS,
        maxDimension: THUMBNAIL_CANVAS_MAX_DIMENSION,
      });
      const viewport = page.getViewport({ scale, rotation });
      const size = getCanvasRenderSize(viewport.width, viewport.height, 1, {
        maxPixels: THUMBNAIL_CANVAS_MAX_PIXELS,
        maxDimension: THUMBNAIL_CANVAS_MAX_DIMENSION,
      });
      const canvas = item.canvas;
      canvas.width = size.width;
      canvas.height = size.height;
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas is unavailable for this thumbnail.');
      ctx.setTransform(size.scale, 0, 0, size.scale, 0, 0);
      task = page.render({ canvasContext: ctx, viewport });
      item.renderTask = task;
      await task.promise;
      if (
        token !== this.docToken ||
        generation !== this.renderGeneration ||
        doc !== this.deps.getDoc()
      ) return;

      item.rendered = true;
      item.pixelCount = canvas.width * canvas.height;
      this.thumbnailCache.touch(item, item.pixelCount);
      this.observer?.unobserve(item.el);
    } catch (err) {
      if (
        token === this.docToken &&
        generation === this.renderGeneration &&
        err?.name !== 'RenderingCancelledException'
      ) {
        console.warn(`Thumbnail render failed (page ${item.page}):`, err);
        item.el.classList.add('thumb-error');
        item.canvas.width = 0;
        item.canvas.height = 0;
      }
    } finally {
      if (item.renderTask === task) item.renderTask = null;
      item.rendering = false;
      try {
        page?.cleanup();
      } catch (_) {
        // ignore
      }
    }
  }

  // --- Outline / bookmarks --------------------------------------------------

  renderOutline(outline) {
    const panel = this.deps.outlinePanel;
    panel.innerHTML = '';
    if (!outline || outline.length === 0) {
      panel.innerHTML =
        '<p class="sidebar-empty">This document has no bookmarks.</p>';
      return;
    }
    const tree = this.buildOutlineList(outline);
    panel.appendChild(tree);
    this.outlineLoaded = true;
  }

  buildOutlineList(items) {
    const ul = document.createElement('ul');
    ul.className = 'outline-list';
    for (const item of items) {
      const li = document.createElement('li');
      li.className = 'outline-item';
      const row = document.createElement('div');
      row.className = 'outline-row';

      if (item.items && item.items.length > 0) {
        const expander = document.createElement('button');
        expander.className = 'outline-expander';
        expander.textContent = '▾';
        expander.setAttribute('aria-label', 'Collapse section');
        expander.addEventListener('click', (e) => {
          e.stopPropagation();
          const collapsed = li.classList.toggle('collapsed');
          expander.textContent = collapsed ? '▸' : '▾';
          expander.setAttribute(
            'aria-label',
            collapsed ? 'Expand section' : 'Collapse section'
          );
        });
        row.appendChild(expander);
      } else {
        const spacer = document.createElement('span');
        spacer.className = 'outline-spacer';
        row.appendChild(spacer);
      }

      const link = document.createElement('button');
      link.className = 'outline-link';
      link.textContent = item.title || '(untitled)';
      link.title = item.title || '';
      if (item.bold) link.style.fontWeight = '700';
      if (item.italic) link.style.fontStyle = 'italic';
      link.addEventListener('click', () => this.followOutline(item));
      row.appendChild(link);
      li.appendChild(row);

      if (item.items && item.items.length > 0) {
        li.appendChild(this.buildOutlineList(item.items));
      }
      ul.appendChild(li);
    }
    return ul;
  }

  async followOutline(item) {
    try {
      if (item.url) {
        window.open(item.url, '_blank', 'noopener');
        return;
      }
      const dest = item.dest;
      if (!dest) {
        this.deps.onStatus('Bookmark has no destination');
        return;
      }
      const doc = this.deps.getDoc();
      if (!doc) return;
      let explicit = dest;
      if (typeof dest === 'string') {
        explicit = await doc.getDestination(dest);
      }
      if (Array.isArray(explicit) && explicit.length > 0) {
        const pageIndex = await doc.getPageIndex(explicit[0]);
        this.deps.goToPage(pageIndex + 1);
      } else {
        this.deps.onStatus('Could not resolve bookmark destination');
      }
    } catch (err) {
      console.warn('Bookmark navigation failed:', err);
      this.deps.onStatus('Could not open bookmark destination');
    }
  }
}
