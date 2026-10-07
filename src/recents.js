// Cambuz PDF Reader — Recent Files (Phase 2)
//
// Remembers recently opened documents (name, location, page count, last
// page, timestamp) in localStorage. In web mode the file bytes of small
// recent documents are additionally cached in IndexedDB so "reopen last
// document" and the recent list actually work without a file path. In
// Electron mode the native file path is stored instead and no bytes are
// cached.
//
// All storage access is wrapped defensively: private-browsing mode,
// disabled storage or quota errors must never break the reader.

const LS_KEY = 'cambuz.recents.v1';
const LS_REOPEN_KEY = 'cambuz.reopenLast';
const MAX_RECENTS = 10;
const MAX_BLOBS = 5;
const MAX_BLOB_BYTES = 60 * 1024 * 1024; // 60 MiB per cached file

const DB_NAME = 'cambuz-pdf';
const DB_STORE = 'recent-files';
const DB_VERSION = 1;

// ---------------------------------------------------------------------------
// Pure helpers (DOM-free)
// ---------------------------------------------------------------------------

/** Stable id for a file entry from name + size + modification time. */
export function makeId(name, size, mtime) {
  const s = `${name}|${size || 0}|${mtime || 0}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 + s.charCodeAt(i), 2246822519);
  }
  return `r${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

/** Human-readable relative time, e.g. "2 hours ago". */
export function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  const date = new Date(ts);
  return date.toLocaleDateString();
}

/** Human-readable byte size, e.g. "1.2 MB". */
export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v >= 100 || u === 0 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

// ---------------------------------------------------------------------------
// Recent metadata (localStorage)
// ---------------------------------------------------------------------------

export function getRecents() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((e) => e && typeof e.name === 'string');
  } catch (_) {
    return [];
  }
}

function saveRecents(list) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, MAX_RECENTS)));
  } catch (_) {
    // Storage unavailable — the reader keeps working without recents.
  }
}

/**
 * Add (or refresh) a recent entry. Returns the stored entry.
 * @param {{name:string, path?:string|null, size?:number, pages?:number, mtime?:number}} info
 */
export function addRecent(info) {
  const list = getRecents();
  const id = makeId(info.name, info.size || 0, info.mtime || 0);
  const entry = {
    id,
    name: info.name,
    path: info.path || null,
    size: info.size || 0,
    pages: info.pages || 0,
    lastPage: 1,
    openedAt: Date.now(),
  };
  const existing = list.find((e) => e.id === id);
  if (existing && existing.lastPage) entry.lastPage = existing.lastPage;
  const rest = list.filter((e) => e.id !== id);
  rest.unshift(entry);
  saveRecents(rest);
  return entry;
}

export function updateRecentPage(id, page) {
  if (!id) return;
  const list = getRecents();
  const entry = list.find((e) => e.id === id);
  if (entry) {
    entry.lastPage = page;
    saveRecents(list);
  }
}

export function updateRecentPages(id, pages) {
  if (!id) return;
  const list = getRecents();
  const entry = list.find((e) => e.id === id);
  if (entry) {
    entry.pages = pages;
    saveRecents(list);
  }
}

export function removeRecent(id) {
  saveRecents(getRecents().filter((e) => e.id !== id));
  deleteBlob(id).catch(() => {});
}

export function clearRecents() {
  saveRecents([]);
  clearBlobs().catch(() => {});
}

// ---------------------------------------------------------------------------
// "Reopen last document" setting
// ---------------------------------------------------------------------------

export function getReopenLast() {
  try {
    const v = localStorage.getItem(LS_REOPEN_KEY);
    return v === null ? true : v === '1';
  } catch (_) {
    return false;
  }
}

export function setReopenLast(enabled) {
  try {
    localStorage.setItem(LS_REOPEN_KEY, enabled ? '1' : '0');
  } catch (_) {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Blob cache (IndexedDB) — lets web mode reopen recent files
// ---------------------------------------------------------------------------

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  dbPromise.catch(() => {
    dbPromise = null; // allow retry on next call
  });
  return dbPromise;
}

/** Cache file bytes for later reopen. Skips oversized files. */
export async function storeBlob(id, arrayBuffer) {
  if (!id || !arrayBuffer || arrayBuffer.byteLength > MAX_BLOB_BYTES) return false;
  if (arrayBuffer.byteLength === 0) return false;
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put({
      id,
      blob: arrayBuffer,
      storedAt: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('store failed'));
  });
  pruneBlobs().catch(() => {});
  return true;
}

/** Retrieve cached file bytes, or null if absent. */
export async function getBlob(id) {
  if (!id) return null;
  const db = await openDb();
  const rec = await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const rq = tx.objectStore(DB_STORE).get(id);
    rq.onsuccess = () => resolve(rq.result || null);
    rq.onerror = () => reject(rq.error || new Error('get failed'));
  });
  if (!rec || !rec.blob) return null;
  if (rec.blob instanceof ArrayBuffer) return rec.blob;
  if (rec.blob instanceof Blob) return rec.blob.arrayBuffer();
  return null;
}

export async function deleteBlob(id) {
  if (!id) return;
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('delete failed'));
    });
  } catch (_) {
    // ignore
  }
}

async function pruneBlobs() {
  const db = await openDb();
  const all = await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const rq = tx.objectStore(DB_STORE).getAll();
    rq.onsuccess = () => resolve(rq.result || []);
    rq.onerror = () => reject(rq.error || new Error('getAll failed'));
  });
  if (all.length <= MAX_BLOBS) return;
  all.sort((a, b) => (b.storedAt || 0) - (a.storedAt || 0));
  const doomed = all.slice(MAX_BLOBS);
  await new Promise((resolve) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    for (const rec of doomed) store.delete(rec.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function clearBlobs() {
  const db = await openDb();
  await new Promise((resolve) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
