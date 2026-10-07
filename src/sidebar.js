// Cambuz PDF Reader — Sidebar: Thumbnails + Document Outline (Phase 2)

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
    this.outlineLoaded = false;

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

  /** Build sidebar content for a newly opened document. */
  async openDocument(pdfDoc) {
    this.docToken += 1;
    const token = this.docToken;
    this.disconnectObserver();
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
      const label = document.createElement('span');
      label.className = 'thumb-label';
      label.textContent = String(p);
      item.appendChild(canvas);
      item.appendChild(label);
      item.addEventListener('click', () => this.deps.goToPage(p));
      frag.appendChild(item);
      this.thumbItems.push({ page: p, el: item, canvas, rendered: false, rendering: false });
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
    this.disconnectObserver();
    this.thumbItems = [];
    this.deps.thumbsPanel.innerHTML = '';
    this.deps.outlinePanel.innerHTML =
      '<p class="sidebar-empty">Open a document to see bookmarks.</p>';
  }

  setActivePage(pageNum) {
    this.activePage = pageNum;
    for (const t of this.thumbItems) {
      t.el.classList.toggle('active', t.page === pageNum);
    }
    // Render the active thumbnail eagerly so it is never blank.
    const active = this.thumbItems[pageNum - 1];
    if (active && !active.rendered && !active.rendering) {
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
    for (const t of this.thumbItems) {
      t.rendered = false;
    }
    this.observeThumbs();
    const active = this.thumbItems[this.activePage - 1];
    if (active) await this.renderThumb(active, token);
    this.refreshVisibleThumbs();
  }

  // --- Thumbnails ---------------------------------------------------------

  observeThumbs() {
    this.disconnectObserver();
    if (typeof IntersectionObserver === 'undefined') {
      // Fallback: render sequentially (old engines).
      const token = this.docToken;
      const queue = [...this.thumbItems];
      const step = async () => {
        if (token !== this.docToken) return;
        const next = queue.shift();
        if (!next) return;
        await this.renderThumb(next, token);
        setTimeout(step, 0);
      };
      step();
      return;
    }
    const token = this.docToken;
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const page = Number(e.target.dataset.page);
          const item = this.thumbItems[page - 1];
          if (item && !item.rendered && !item.rendering) {
            this.renderThumb(item, token);
          }
          this.observer.unobserve(e.target);
        }
      },
      { root: this.deps.thumbsPanel, rootMargin: '200px 0px' }
    );
    for (const t of this.thumbItems) this.observer.observe(t.el);
  }

  disconnectObserver() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  refreshVisibleThumbs() {
    if (!this.observer) return;
    // Re-check items currently in view (e.g. sidebar was just opened).
    const token = this.docToken;
    const panel = this.deps.thumbsPanel;
    const rect = panel.getBoundingClientRect();
    for (const t of this.thumbItems) {
      if (t.rendered || t.rendering) continue;
      const r = t.el.getBoundingClientRect();
      if (r.bottom >= rect.top - 200 && r.top <= rect.bottom + 200) {
        this.renderThumb(t, token);
        this.observer.unobserve(t.el);
      }
    }
  }

  async renderThumb(item, token) {
    const doc = this.deps.getDoc();
    if (!doc) return;
    item.rendering = true;
    try {
      const page = await doc.getPage(item.page);
      if (token !== this.docToken) return;
      const rotation = this.deps.getRotation();
      const base = page.getViewport({ scale: 1, rotation });
      const scale = THUMB_WIDTH / base.width;
      const viewport = page.getViewport({ scale, rotation });
      const canvas = item.canvas;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      if (token !== this.docToken) return;
      item.rendered = true;
      try {
        page.cleanup();
      } catch (_) {
        // ignore
      }
    } catch (err) {
      if (token === this.docToken) {
        console.warn(`Thumbnail render failed (page ${item.page}):`, err);
        item.el.classList.add('thumb-error');
      }
    } finally {
      item.rendering = false;
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
