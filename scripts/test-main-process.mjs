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
const appListeners = new Map();
const appQuitCalls = [];
const externalUrls = [];
const createdWindows = [];
const FAKE_START_URL = 'file:///app/src/index.html';
// A value that cannot be confused with the real version: proves About reads app.getVersion().
const APP_VERSION_UNDER_TEST = '9.8.7-about-test';
const messageBoxes = [];

class FakeSession {
  setPermissionRequestHandler(handler) {
    this.requestHandler = handler;
  }
  setPermissionCheckHandler(handler) {
    this.checkHandler = handler;
  }
}
class FakeWebContents {
  constructor() {
    this.session = new FakeSession();
  }
  on(event, listener) {
    webContentsListeners.set(event, listener);
    return this;
  }
  send(channel, ...args) {
    sentToRenderer.push({ channel, args });
  }
  setWindowOpenHandler(handler) {
    this.windowOpenHandler = handler;
  }
  getURL() {
    return FAKE_START_URL;
  }
}
class FakeBrowserWindow {
  constructor(options) {
    this.options = options;
    this.webContents = new FakeWebContents();
    this.focused = false;
    this.minimized = false;
    this.destroyed = false;
    createdWindows.push(this);
  }
  loadFile() {}
  once() {}
  on() {}
  isDestroyed() {
    return this.destroyed;
  }
  isMinimized() {
    return this.minimized;
  }
  restore() {
    this.minimized = false;
  }
  focus() {
    this.focused = true;
  }
  static getAllWindows() {
    return [];
  }
}

const fakeElectron = {
  app: {
    whenReady: () => Promise.resolve(),
    on: (event, listener) => appListeners.set(event, listener),
    quit: () => appQuitCalls.push(Date.now()),
    getVersion: () => APP_VERSION_UNDER_TEST,
    requestSingleInstanceLock: () => true,
  },
  BrowserWindow: FakeBrowserWindow,
  ipcMain: {
    handle: (channel, handler) => handlers.set(channel, handler),
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showMessageBox: async (...args) => {
      messageBoxes.push(args);
      return { response: 0 };
    },
    showMessageBoxSync: () => 1,
  },
  Menu: {
    buildFromTemplate: (template) => {
      builtTemplates.push(template);
      return { popup: (options) => popups.push({ template, options }) };
    },
    setApplicationMenu: () => {},
  },
  shell: {
    openExternal: async (url) => {
      externalUrls.push(url);
    },
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
    on: (channel, listener) => invoked.push({ channel, onListener: listener }),
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

console.log('\n## Main process: window security guards');
{
  const window = createdWindows[0];
  assert(window instanceof FakeBrowserWindow, 'the main window was created');
  assert(window?.options?.webPreferences?.contextIsolation === true, 'context isolation stays enabled');
  assert(window?.options?.webPreferences?.nodeIntegration === false, 'Node integration stays disabled');
  assert(window?.options?.webPreferences?.webSecurity !== false, 'webSecurity is never disabled');
  assert(window?.options?.webPreferences?.sandbox === true, 'the main window renderer runs in the Chromium sandbox');

  const openHandler = window?.webContents?.windowOpenHandler;
  assert(typeof openHandler === 'function', 'a window-open handler is registered');
  const https = openHandler({ url: 'https://example.com/doc#page=2' });
  assert(https?.action === 'deny', 'remote links never open inside the app');
  assert(externalUrls.includes('https://example.com/doc#page=2'), 'https links open in the system browser');
  const before = externalUrls.length;
  assert(openHandler({ url: 'file:///etc/passwd' })?.action === 'deny', 'file URLs are denied');
  assert(openHandler({ url: 'javascript:alert(1)' })?.action === 'deny', 'javascript URLs are denied');
  assert(externalUrls.length === before, 'only http(s) URLs reach the system browser');

  let prevented = 0;
  const willNavigate = webContentsListeners.get('will-navigate');
  // Before the first load finishes, nothing is blocked: startup can never
  // block itself.
  willNavigate({ preventDefault: () => { prevented += 1; } }, 'file:///other/page.html');
  assert(prevented === 0, 'navigation is not blocked before the first load');
  webContentsListeners.get('did-finish-load')();
  willNavigate({ preventDefault: () => { prevented += 1; } }, FAKE_START_URL);
  assert(prevented === 0, 'the viewer page itself is allowed');
  willNavigate({ preventDefault: () => { prevented += 1; } }, 'https://example.com/');
  willNavigate({ preventDefault: () => { prevented += 1; } }, 'file:///etc/passwd');
  assert(prevented === 2, 'navigation away from the viewer is blocked');

  const session = window?.webContents?.session;
  assert(typeof session?.requestHandler === 'function', 'a permission request handler is registered');
  assert(typeof session?.checkHandler === 'function', 'a permission check handler is registered');
  let granted = null;
  session.requestHandler({}, 'camera', (value) => { granted = value; });
  assert(granted === false, 'device permission requests are denied');
  session.requestHandler({}, 'fullscreen', (value) => { granted = value; });
  assert(granted === true, 'the reader keeps its Fullscreen API');
  assert(session.checkHandler({}, 'microphone') === false, 'device permission checks are denied');
  assert(session.checkHandler({}, 'fullscreen') === true, 'fullscreen permission checks pass');
}

console.log('\n## Main process: opening PDFs from the OS');
{
  const { isPdfPath, pdfPathFromArgv } = require(path.join(repoRoot, 'src', 'file-open.cjs'));
  assert(isPdfPath('/tmp/Report.PDF') === true, 'PDF detection ignores extension case');
  assert(isPdfPath('C:\\My Docs\\fichier-été.pdf') === true, 'paths with spaces and non-ASCII count as PDFs');
  assert(isPdfPath('--remote-debugging-port=9331') === false, 'flags are not PDFs');
  assert(isPdfPath('/tmp/notes.txt') === false, 'non-PDF files are not PDFs');
  assert(isPdfPath('') === false && isPdfPath(null) === false, 'empty values are not PDFs');
  assert(
    pdfPathFromArgv(['/app/cambuz', '--remote-debugging-port=9331', '--no-sandbox', '/tmp/a.pdf', '/tmp/b.pdf']) === '/tmp/a.pdf',
    'argv scan skips the executable and switches, takes the first PDF',
  );
  assert(pdfPathFromArgv(['/app/cambuz', '--', 'notes.pdf']) === 'notes.pdf', 'a bare -- separator is skipped');
  assert(pdfPathFromArgv(['/app/cambuz']) === null, 'no PDF argument returns null');
  assert(pdfPathFromArgv(null) === null, 'a missing argv returns null');

  assert(appQuitCalls.length === 0, 'the first instance does not quit itself');
  assert(typeof appListeners.get('second-instance') === 'function', 'second-instance is handled');
  assert(typeof appListeners.get('open-file') === 'function', 'macOS open-file is handled');
  assert(handlers.has('renderer-ready'), 'the renderer-ready handshake channel is registered');

  const handshake = handlers.get('renderer-ready');
  const secondInstance = appListeners.get('second-instance');
  const openFile = appListeners.get('open-file');
  const window = createdWindows[0];

  // A file arriving before the renderer exists waits for the handshake.
  let defaultPrevented = false;
  const osPath = 'C:\\My Docs\\fichier-été.pdf';
  openFile({ preventDefault: () => { defaultPrevented = true; } }, osPath);
  assert(defaultPrevented, 'open-file takes over the event');
  const collected = await handshake({});
  assert(collected && collected.file === osPath, 'renderer-ready collects the pending OS file');
  const collectedAgain = await handshake({});
  assert(collectedAgain && collectedAgain.file === null, 'the pending file is consumed only once');

  // Later arrivals are pushed straight to the renderer; the window is focused.
  window.focused = false;
  secondInstance({}, ['/app/cambuz', '--remote-debugging-port=9331', '/tmp/second doc.pdf']);
  assert(window.focused === true, 'a second instance focuses the window');
  const pushed = sentToRenderer.filter((message) => message.channel === 'open-file-path');
  assert(pushed.length === 1 && pushed[0].args[0] === '/tmp/second doc.pdf', 'a second-instance PDF is pushed untouched');
  secondInstance({}, ['/app/cambuz']);
  assert(
    sentToRenderer.filter((message) => message.channel === 'open-file-path').length === 1,
    'a second instance without a PDF pushes nothing',
  );
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
  assert(typeof api?.rendererReady === 'function', 'the preload bridge exposes rendererReady');
  if (api && typeof api.rendererReady === 'function') {
    await api.rendererReady();
    const call = invoked[invoked.length - 1];
    assert(call && call.channel === 'renderer-ready', 'rendererReady invokes the renderer-ready channel');
  }
  assert(typeof api?.onOpenFilePath === 'function', 'the preload bridge exposes onOpenFilePath');
  if (api && typeof api.onOpenFilePath === 'function') {
    const before = invoked.length;
    api.onOpenFilePath(() => {});
    const call = invoked[invoked.length - 1];
    assert(invoked.length === before + 1 && call && call.channel === 'open-file-path', 'onOpenFilePath listens on open-file-path');
  }
}

// Phase 10: the About dialog reports the running app version, not a literal.
{
  const helpMenu = builtTemplates.flat().find((item) => item && item.label === 'Help');
  const about = helpMenu && helpMenu.submenu.find((item) => item.label === 'About Cambuz PDF Reader');
  assert(typeof about?.click === 'function', 'the Help menu has an About item');
  if (about && typeof about.click === 'function') {
    about.click();
    const box = messageBoxes[messageBoxes.length - 1];
    const message = box && box[1] && box[1].message;
    assert(message === `Cambuz PDF Reader v${APP_VERSION_UNDER_TEST}`, 'About shows the app version from app.getVersion()', message);
  }
  const pkgVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
  assert(APP_VERSION_UNDER_TEST !== pkgVersion, 'About version is not a hard-coded package version');
}

// Phase 10: macOS menu roles. Windows/Linux templates must be unchanged; the
// macOS template must add an application menu with Quit and Edit copy/paste roles.
{
  const { applyMacMenuRoles } = require(path.join(repoRoot, 'src', 'mac-menu.cjs'));
  const sample = [
    { label: 'File', submenu: [{ label: 'Exit', accelerator: 'CmdOrCtrl+Q', click: () => {} }] },
    { label: 'Edit', submenu: [{ label: 'Find in Document...', accelerator: 'CmdOrCtrl+F' }] },
  ];
  const same = applyMacMenuRoles(sample, 'win32', 'Cambuz PDF Reader');
  assert(same === sample, 'non-macOS menu template is returned unchanged');
  assert(applyMacMenuRoles(sample, 'linux', 'Cambuz PDF Reader') === sample, 'Linux menu template is returned unchanged');
  const mac = applyMacMenuRoles(sample, 'darwin', 'Cambuz PDF Reader');
  assert(mac[0].label === 'Cambuz PDF Reader', 'macOS gets an application menu named after the product');
  assert(mac[0].submenu.some((item) => item.role === 'quit'), 'macOS application menu has a Quit item');
  assert(mac[0].submenu.some((item) => item.role === 'hide'), 'macOS application menu has a Hide item');
  const macFile = mac.find((item) => item.label === 'File');
  const exit = macFile.submenu.find((item) => item.label === 'Exit');
  assert(exit && exit.accelerator === undefined, 'macOS File > Exit does not duplicate the Cmd+Q accelerator');
  const macEdit = mac.find((item) => item.label === 'Edit');
  const roles = macEdit.submenu.map((item) => item.role).filter(Boolean);
  for (const role of ['cut', 'copy', 'paste']) {
    assert(roles.includes(role), `macOS Edit menu has the ${role} role`);
  }
  assert(macEdit.submenu.some((item) => item.label === 'Find in Document...'), 'macOS Edit menu keeps the custom Find item');
  assert(sample[0].submenu[0].accelerator === 'CmdOrCtrl+Q', 'the source template is not mutated');
}

console.log('\n==============================');
console.log(`Main process tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
process.exit(0);
