#!/usr/bin/env node
// Cambuz PDF Reader — main-process and preload tests.
//
// main.js and preload.js only run inside Electron, so this test loads them against
// a small stand-in for the `electron` module and exercises what the renderer relies
// on: the bundled-sample channel, the unchanged read-file channel, the preload
// bridge that exposes it, and the page context menu.

import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

let passed = 0;
let failed = 0;
const failures = [];
function assert(condition, name, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// Stand-in for the electron module.

const handlers = new Map();
const webContentsListeners = new Map();
const sentToRenderer = [];
const builtTemplates = [];
const popups = [];
const exposed = {};
const invoked = [];

class FakeWebContents {
  on(event, listener) {
    webContentsListeners.set(event, listener);
    return this;
  }
  send(channel, ...args) {
    sentToRenderer.push({ channel, args });
  }
}
class FakeBrowserWindow {
  constructor(options) {
    this.options = options;
    this.webContents = new FakeWebContents();
  }
  loadFile() {}
  once() {}
  on() {}
  static getAllWindows() {
    return [];
  }
}

const fakeElectron = {
  app: {
    whenReady: () => Promise.resolve(),
    on: () => {},
    quit: () => {},
  },
  BrowserWindow: FakeBrowserWindow,
  ipcMain: {
    handle: (channel, handler) => handlers.set(channel, handler),
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showMessageBox: async () => ({ response: 0 }),
    showMessageBoxSync: () => 1,
  },
  Menu: {
    buildFromTemplate: (template) => {
      builtTemplates.push(template);
      return { popup: (options) => popups.push({ template, options }) };
    },
    setApplicationMenu: () => {},
  },
  contextBridge: {
    exposeInMainWorld: (name, api) => {
      exposed[name] = api;
    },
  },
  ipcRenderer: {
    invoke: (channel, ...args) => {
      invoked.push({ channel, args });
      return Promise.resolve({ ok: true });
    },
    on: () => {},
  },
};

const originalLoad = Module._load;
Module._load = function loadWithElectronStub(request, parent, isMain) {
  if (request === 'electron') return fakeElectron;
  return originalLoad.call(this, request, parent, isMain);
};

// ---------------------------------------------------------------------------

console.log('\n## Main process: bundled-sample channel');
require(path.join(repoRoot, 'main.js'));
await new Promise((resolve) => setImmediate(resolve));

assert(handlers.has('read-sample'), 'main.js registers the read-sample channel');
assert(handlers.has('read-file'), 'the read-file channel is still registered');
const readSample = handlers.get('read-sample');

for (const name of ['cambuz-demo.pdf', 'form-sample.pdf']) {
  const result = await readSample({}, name);
  const expected = fs.readFileSync(path.join(repoRoot, 'samples', name));
  assert(result.ok === true && result.name === name, `read-sample returns ${name}`, JSON.stringify({ ok: result.ok, error: result.error }));
  assert(result.data instanceof Uint8Array && result.data.length === expected.length, `${name} arrives with its full length`);
  assert(Buffer.from(result.data).subarray(0, 5).toString('latin1') === '%PDF-', `${name} arrives as PDF bytes`);
}

for (const [label, value] of [
  ['an unlisted sample', 'phase6-indian-languages.pdf'],
  ['a parent-directory name', '../package.json'],
  ['an absolute path', path.join(repoRoot, 'package.json')],
  ['no name', undefined],
]) {
  const result = await readSample({}, value);
  assert(result.ok === false && !result.data, `read-sample refuses ${label}`, JSON.stringify(result));
}

console.log('\n## Main process: read-file is unchanged');
{
  const welcome = path.join(repoRoot, 'samples', 'welcome.pdf');
  const result = await handlers.get('read-file')({}, welcome);
  assert(result.ok === true && result.name === 'welcome.pdf' && result.size === fs.statSync(welcome).size, 'read-file still reads a chosen file');
  const missing = await handlers.get('read-file')({}, path.join(repoRoot, 'samples', 'missing.pdf'));
  assert(missing.ok === false, 'read-file reports a missing file');
}

console.log('\n## Main process: page context menu');
{
  const onContextMenu = webContentsListeners.get('context-menu');
  assert(typeof onContextMenu === 'function', 'the page has a context-menu listener');
  const before = popups.length;
  onContextMenu({}, { selectionText: 'Cambuz PDF Reader', editFlags: { canCopy: true } });
  assert(popups.length === before + 1, 'a right-click pops up one menu');
  const { template, options } = popups[popups.length - 1];
  assert(template[0].role === 'copy' && template[0].enabled === true, 'with a selection the menu offers an enabled Copy');
  assert(options && options.window instanceof FakeBrowserWindow, 'the menu belongs to the main window');
  template[2].click();
  assert(
    sentToRenderer.some((message) => message.channel === 'menu-select-all'),
    '"Select All Text on Page" asks the renderer for select-all',
  );
  onContextMenu({}, { selectionText: '', editFlags: { canCopy: false } });
  const latest = popups[popups.length - 1].template;
  assert(latest[0].enabled === false, 'with no selection Copy is disabled');
}

console.log('\n## Preload bridge');
require(path.join(repoRoot, 'preload.js'));
{
  const api = exposed.cambuzAPI;
  assert(api && typeof api.readSample === 'function', 'the preload bridge exposes readSample');
  if (api && typeof api.readSample === 'function') {
    await api.readSample('cambuz-demo.pdf');
    const call = invoked[invoked.length - 1];
    assert(call && call.channel === 'read-sample' && call.args[0] === 'cambuz-demo.pdf', 'readSample forwards the name to the read-sample channel');
  }
  assert(typeof api?.readFile === 'function', 'the preload bridge still exposes readFile');
}

console.log('\n==============================');
console.log(`Main process tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
process.exit(0);
