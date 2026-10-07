// Cambuz PDF Reader — Search Engine (Phase 2)
//
// Unicode-safe text search with per-page match indexing and
// in-page highlight support.
//
// The pure matching helpers (normalizeStr, findAllMatches, ...) intentionally
// avoid all DOM access so they can be unit-tested in Node.js
// (see scripts/test-phase2.mjs). The SearchController class below is the
// DOM-aware driver used by the renderer.

// ---------------------------------------------------------------------------
// Pure helpers (DOM-free, tested in Node)
// ---------------------------------------------------------------------------

/**
 * Canonicalize a string for comparison. NFC keeps Indic vowel signs,
 * anusvara/bindi and other combining marks in their composed form so a
 * query typed by the user matches the text stored in the PDF.
 */
export function normalizeStr(s) {
  return typeof s === 'string' ? s.normalize('NFC') : '';
}

/**
 * Case folding for case-insensitive search. Indic scripts have no case so
 * they pass through unchanged; Latin text folds as expected.
 */
export function foldCase(s) {
  return s.toLowerCase();
}

/**
 * Find all non-overlapping occurrences of `query` inside `text`.
 *
 * Returns an array of { index, length } where index/length refer to offsets
 * in the *original* `text` string whenever that mapping is safe. If Unicode
 * normalization or case folding would change string lengths (extremely rare;
 * e.g. Turkish dotted-I edge cases), the matcher falls back to raw
 * comparison so indices can never point at the wrong characters.
 *
 * @param {string} text
 * @param {string} query
 * @param {boolean} matchCase
 * @returns {{index:number,length:number}[]}
 */
export function findAllMatches(text, query, matchCase = false) {
  const rawText = typeof text === 'string' ? text : '';
  const rawQuery = typeof query === 'string' ? query : '';
  if (!rawQuery) return [];

  const normText = rawText.normalize('NFC');
  const normQuery = rawQuery.normalize('NFC');

  // Use normalized strings only if offsets still map 1:1 onto the originals.
  const normSafe =
    normText.length === rawText.length && normQuery.length === rawQuery.length;
  const baseText = normSafe ? normText : rawText;
  let baseQuery = normSafe ? normQuery : rawQuery;

  let hay = baseText;
  let needle = baseQuery;
  if (!matchCase) {
    const foldedHay = foldCase(baseText);
    const foldedNeedle = foldCase(baseQuery);
    // If folding changes lengths, indices would misalign — fall back to a
    // case-sensitive pass on the unfolded strings instead of corrupting
    // offsets.
    if (foldedHay.length !== baseText.length || foldedNeedle.length !== baseQuery.length) {
      return findAllMatches(rawText, rawQuery, true);
    }
    hay = foldedHay;
    needle = foldedNeedle;
  }

  const matches = [];
  let from = 0;
  while (from <= hay.length) {
    const i = hay.indexOf(needle, from);
    if (i < 0) break;
    matches.push({ index: i, length: needle.length });
    from = i + needle.length;
  }
  return matches;
}

/**
 * Verify that a previously computed match still lines up with the text
 * (used before wrapping DOM nodes so highlighting can never corrupt text).
 */
export function verifyMatch(text, index, length, query, matchCase = false) {
  const raw = typeof text === 'string' ? text : '';
  if (index < 0 || length <= 0 || index + length > raw.length) return false;
  const slice = raw.slice(index, index + length);
  const a = normalizeStr(slice);
  const b = normalizeStr(query);
  if (a.length !== length || b.length !== length) {
    // Lengths shifted under normalization; compare without it.
    if (matchCase) return slice === query;
    return foldCase(slice) === foldCase(query);
  }
  if (matchCase) return a === b;
  return foldCase(a) === foldCase(b);
}

/** Count matches of `query` inside `text`. */
export function countMatches(text, query, matchCase = false) {
  return findAllMatches(text, query, matchCase).length;
}

// ---------------------------------------------------------------------------
// SearchController — drives document search + highlighting in the renderer
// ---------------------------------------------------------------------------

export class SearchController {
  /**
   * @param {object} deps
   * @param {() => object|null} deps.getDoc - current PDFDocumentProxy or null
   * @param {() => number} deps.getCurrentPage
   * @param {(n:number) => Promise<void>} deps.goToPage
   * @param {() => HTMLElement|null} deps.getTextLayerEl
   * @param {(msg:string) => void} deps.onStatus - status line updates
   * @param {(msg:string) => void} deps.onCount - "x of y" label updates
   */
  constructor(deps) {
    this.deps = deps;
    this.query = '';
    this.matchCase = false;
    this.pageMatches = null; // 1-based: pageMatches[p] = { count }
    this.total = 0;
    this.numPages = 0;
    this.current = null; // { page, index } — index within page
    this.searchToken = 0;
    this.searching = false;
  }

  /** Start (or restart) a document search for `query`. */
  async setQuery(rawQuery) {
    const q = normalizeStr(rawQuery);
    if (q === this.query) return;
    this.searchToken += 1;
    const token = this.searchToken;
    this.query = q;
    this.pageMatches = null;
    this.total = 0;
    this.current = null;

    this.clearMarks();
    if (!q) {
      this.deps.onCount('');
      return;
    }

    const doc = this.deps.getDoc();
    if (!doc) return;
    this.searching = true;
    const n = doc.numPages;
    this.numPages = n;
    const pageMatches = new Array(n + 1).fill(null);
    let total = 0;

    for (let p = 1; p <= n; p++) {
      if (token !== this.searchToken) return; // superseded / cancelled
      try {
        const count = await this.#countPageMatches(doc, p, q);
        pageMatches[p] = { count };
        total += count;
      } catch (err) {
        console.warn(`Search: failed to index page ${p}:`, err);
        pageMatches[p] = { count: 0 };
      }
      if (p === n || p % 5 === 0) {
        this.deps.onStatus(`Searching… page ${p} of ${n}`);
      }
    }

    if (token !== this.searchToken) return;
    this.pageMatches = pageMatches;
    this.total = total;
    this.searching = false;

    if (total === 0) {
      this.deps.onCount('No matches');
      this.deps.onStatus(`No matches for “${truncate(q, 40)}”`);
      return;
    }

    // Jump to the first match on or after the current page (wrapping).
    const startPage = this.deps.getCurrentPage();
    let target = startPage;
    for (let i = 0; i < n; i++) {
      const p = ((startPage - 1 + i) % n) + 1;
      if (pageMatches[p].count > 0) {
        target = p;
        break;
      }
    }
    this.current = { page: target, index: 0 };
    if (target !== startPage) {
      await this.deps.goToPage(target); // renders, then calls applyHighlights
    } else {
      this.applyHighlights();
    }
    this.updateCount();
    this.deps.onStatus(
      `${total} match${total === 1 ? '' : 'es'} for “${truncate(q, 40)}”`
    );
  }

  async #countPageMatches(doc, pageNum, query) {
    const page = await doc.getPage(pageNum);
    const tc = await page.getTextContent();
    let count = 0;
    for (const item of tc.items) {
      if (typeof item.str !== 'string' || !item.str) continue;
      count += countMatches(item.str, query, this.matchCase);
    }
    try {
      page.cleanup();
    } catch (_) {
      // ignore — cleanup is best-effort
    }
    return count;
  }

  /** Move to the next match (wrapping around the document). */
  async next() {
    if (!this.total || !this.pageMatches) return;
    const token = this.searchToken;
    let { page, index } = this.current;
    index += 1;
    if (index >= this.pageMatches[page].count) {
      page = this.#findPageWithMatches(page, 1);
      index = 0;
    }
    this.current = { page, index };
    if (token !== this.searchToken) return;
    if (page !== this.deps.getCurrentPage()) {
      await this.deps.goToPage(page);
    } else {
      this.applyHighlights();
    }
    this.updateCount();
  }

  /** Move to the previous match (wrapping around the document). */
  async prev() {
    if (!this.total || !this.pageMatches) return;
    const token = this.searchToken;
    let { page, index } = this.current;
    index -= 1;
    if (index < 0) {
      page = this.#findPageWithMatches(page, -1);
      index = this.pageMatches[page].count - 1;
    }
    this.current = { page, index };
    if (token !== this.searchToken) return;
    if (page !== this.deps.getCurrentPage()) {
      await this.deps.goToPage(page);
    } else {
      this.applyHighlights();
    }
    this.updateCount();
  }

  #findPageWithMatches(fromPage, dir) {
    const n = this.numPages;
    for (let i = 1; i <= n; i++) {
      const p = ((fromPage - 1 + dir * i + n * i) % n) + 1;
      if (this.pageMatches[p] && this.pageMatches[p].count > 0) return p;
    }
    return fromPage;
  }

  /**
   * Highlight all matches on the currently rendered page and mark the
   * current one. Called after every text-layer render while a query is
   * active. Safe to call when there is no query (clears marks).
   */
  applyHighlights() {
    const tl = this.deps.getTextLayerEl();
    if (!tl) return;
    this.clearMarks();
    if (!this.query || !this.total || !this.pageMatches) return;

    const page = this.deps.getCurrentPage();
    const pm = this.pageMatches[page];
    if (!pm || pm.count === 0) return;

    const currentIndex =
      this.current && this.current.page === page ? this.current.index : -1;
    let ordinal = 0; // match ordinal within this page

    // PDF.js v4 TextLayer emits one <span> per text item (+ <br> for EOL).
    const spans = tl.querySelectorAll('span');
    for (const span of spans) {
      // Skip nested spans created by marked-content wrappers; only leaf
      // spans that directly hold text are highlighted.
      if (span.querySelector('span')) continue;
      const text = span.textContent;
      if (!text) continue;
      const matches = findAllMatches(text, this.query, this.matchCase);
      if (matches.length === 0) continue;

      const frag = document.createDocumentFragment();
      let cursor = 0;
      for (const m of matches) {
        if (!verifyMatch(text, m.index, m.length, this.query, this.matchCase)) {
          continue; // never wrap a misaligned range
        }
        if (m.index > cursor) {
          frag.appendChild(document.createTextNode(text.slice(cursor, m.index)));
        }
        const mark = document.createElement('mark');
        mark.className = 'search-highlight';
        mark.textContent = text.slice(m.index, m.index + m.length);
        if (ordinal === currentIndex) mark.classList.add('current');
        ordinal += 1;
        frag.appendChild(mark);
        cursor = m.index + m.length;
      }
      if (cursor < text.length) {
        frag.appendChild(document.createTextNode(text.slice(cursor)));
      }
      span.textContent = '';
      span.appendChild(frag);
    }

    const current = tl.querySelector('mark.search-highlight.current');
    if (current && typeof current.scrollIntoView === 'function') {
      current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  /** Remove all highlight marks from the current text layer. */
  clearMarks() {
    const tl = this.deps.getTextLayerEl();
    if (!tl) return;
    const marks = tl.querySelectorAll('mark.search-highlight');
    for (const mark of marks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    }
  }

  /**
   * Called by the renderer after a manual page change: if the new page
   * holds matches, make its first match current so next/prev continue
   * intuitively from where the user navigated.
   */
  syncCurrentToPage(page) {
    if (!this.total || !this.pageMatches) return;
    if (this.current && this.current.page === page) return;
    const pm = this.pageMatches[page];
    if (pm && pm.count > 0) {
      this.current = { page, index: 0 };
      this.updateCount();
    }
  }

  /** 1-based ordinal of the current match across the whole document. */
  currentOrdinal() {
    if (!this.total || !this.current) return 0;
    let ord = 0;
    for (let p = 1; p < this.current.page; p++) {
      ord += this.pageMatches[p] ? this.pageMatches[p].count : 0;
    }
    return ord + this.current.index + 1;
  }

  updateCount() {
    if (!this.query) {
      this.deps.onCount('');
      return;
    }
    if (!this.total) {
      this.deps.onCount('No matches');
      return;
    }
    this.deps.onCount(`${this.currentOrdinal()} of ${this.total}`);
  }

  hasMatches(page) {
    return !!(
      this.pageMatches &&
      this.pageMatches[page] &&
      this.pageMatches[page].count > 0
    );
  }

  /** Clear the query, state and highlights (keeps the search UI as-is). */
  clear() {
    this.searchToken += 1;
    this.query = '';
    this.pageMatches = null;
    this.total = 0;
    this.current = null;
    this.searching = false;
    this.clearMarks();
    this.deps.onCount('');
  }

  /** Cancel an in-flight search without touching the UI. */
  cancel() {
    this.searchToken += 1;
    this.searching = false;
  }
}

function truncate(s, maxLen) {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + '…';
}
