#!/usr/bin/env node
// Cambuz PDF Reader — packaged-app smoke test.
//
// Starts an executable with Chromium's remote-debugging port and drives the real
// renderer over the DevTools protocol. No test hooks are added to the app:
//   1. the window opens, the title is right and the preload bridge is exposed;
//   2. a bundled PDF is opened through the same drop path a user uses;
//   3. PDF.js reports the expected page count, paints the page canvas and builds
//      a text layer;
//   4. the welcome-screen "Try Sample PDF" button is exercised and its outcome
//      is recorded (informational only).
// A screenshot, the app's log, console/log errors and a JSON report are written
// to --out so they can be uploaded as CI evidence. Exits non-zero on any
// gating check failure.
//
// Usage:
//   node scripts/smoke-test-packaged.mjs --app <executable> [--pdf <file>]
//        [--out <dir>] [--port <n>] [--timeout <seconds>] [--arg <switch>]...

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const options = { args: [] };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!flag || !flag.startsWith('--') || value === undefined) {
      throw new Error(`Expected --name value pairs; problem near "${flag ?? ''}"`);
    }
    const name = flag.slice(2);
    if (name === 'arg') options.args.push(value);
    else options[name] = value;
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.app) throw new Error('--app <executable> is required');
  const appPath = path.resolve(options.app);
  if (!fs.existsSync(appPath)) throw new Error(`App not found: ${appPath}`);

  const pdfPath = path.resolve(options.pdf ?? path.join(repoRoot, 'samples', 'cambuz-demo.pdf'));
  const outDir = path.resolve(options.out ?? 'smoke-test-output');
  const port = Number(options.port ?? 9333);
  const timeoutMs = Number(options.timeout ?? 120) * 1000;
  fs.mkdirSync(outDir, { recursive: true });

  const pdfBytes = fs.readFileSync(pdfPath);
  const pdfName = path.basename(pdfPath);
  const expectedPages = (await PDFDocument.load(pdfBytes, { ignoreEncryption: true })).getPageCount();

  const report = {
    app: path.basename(appPath),
    platform: `${process.platform}-${process.arch}`,
    startedAt: new Date().toISOString(),
    pdf: pdfName,
    expectedPages,
    checks: [],
    informational: {},
    consoleErrors: [],
    consoleWarnings: [],
    uncaughtExceptions: [],
  };
  // Inside GitHub Actions each result is also published as an annotation, so it is
  // visible in the run's check results without opening the uploaded evidence.
  const inCi = process.env.GITHUB_ACTIONS === 'true';
  const annotate = (level, title, message) => {
    if (!inCi) return;
    const escaped = String(message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.log(`::${level} title=${title}::${escaped}`);
  };
  const record = (name, pass, detail = '') => {
    report.checks.push({ name, pass: Boolean(pass), detail: String(detail) });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
    annotate(pass ? 'notice' : 'error', 'Smoke check', `${pass ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
    return Boolean(pass);
  };
  const note = (name, detail) => {
    report.informational[name] = String(detail);
    console.log(`INFO  ${name}: ${detail}`);
    annotate('warning', 'Informational', `${name}: ${detail}`);
  };
  const capped = (list, text) => {
    if (list.length < 50) list.push(String(text).slice(0, 500));
  };

  const logStream = fs.createWriteStream(path.join(outDir, 'app-output.log'));
  const child = spawn(appPath, [`--remote-debugging-port=${port}`, '--enable-logging=stderr', ...options.args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group on POSIX so the whole tree can be stopped; taskkill /T on Windows.
    detached: process.platform !== 'win32',
  });
  child.stdout.on('data', (chunk) => logStream.write(chunk));
  child.stderr.on('data', (chunk) => logStream.write(chunk));
  let exited = null;
  child.on('exit', (code, signal) => {
    exited = { code, signal };
  });
  const stopApp = () => {
    if (exited) return;
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
      } else {
        process.kill(-child.pid, 'SIGKILL');
      }
    } catch {
      // The process tree is already gone.
    }
  };
  const exitDescription = () => (exited ? `exit code ${exited.code ?? exited.signal}` : 'still running');

  let ws = null;
  let send = null;
  let evaluate = null;
  let waitFor = null;
  try {
    // 1. Find the window's DevTools target.
    const findPage = async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      return targets.find((target) => target.type === 'page' && target.url.includes('index.html'));
    };
    const startedWaiting = Date.now();
    let page = null;
    while (!page) {
      if (exited) throw new Error(`The app exited before its window appeared (${exitDescription()}).`);
      if (Date.now() - startedWaiting > timeoutMs) throw new Error('Timed out waiting for the window (no index.html page target).');
      try {
        page = await findPage();
      } catch {
        // DevTools endpoint not listening yet.
      }
      if (!page) await sleep(500);
    }

    // 2. Attach over the DevTools protocol.
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error('Could not open the DevTools WebSocket.'));
    });
    let nextId = 0;
    const pending = new Map();
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== undefined) {
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result);
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        capped(report.uncaughtExceptions, details.exception?.description ?? details.text ?? 'exception');
      } else if (message.method === 'Runtime.consoleAPICalled') {
        const text = message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ');
        if (message.params.type === 'error') capped(report.consoleErrors, text);
        else if (message.params.type === 'warning') capped(report.consoleWarnings, text);
      } else if (message.method === 'Log.entryAdded') {
        const entry = message.params.entry;
        if (entry.level === 'error') capped(report.consoleErrors, `[${entry.source}] ${entry.text}`);
      }
    };
    send = (method, params = {}, limitMs = 30000) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`DevTools call ${method} timed out`));
        }, limitMs);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) {
        const details = result.exceptionDetails;
        throw new Error(String(details.exception?.description ?? details.text).split('\n')[0]);
      }
      return result.result.value;
    };
    waitFor = async (label, probe, limitMs = timeoutMs) => {
      const end = Date.now() + limitMs;
      let last;
      while (Date.now() < end) {
        if (exited) throw new Error(`The app exited while waiting for ${label} (${exitDescription()}).`);
        try {
          last = await probe();
          if (last) return last;
        } catch (error) {
          last = `error: ${error.message}`;
        }
        await sleep(250);
      }
      const errors = report.consoleErrors.slice(0, 3).join(' | ') || 'none';
      throw new Error(`Timed out waiting for ${label} (last value: ${JSON.stringify(last)}; console errors: ${errors}).`);
    };

    await send('Runtime.enable');
    await send('Log.enable');
    await send('Page.enable');

    // 3. Renderer ready: the renderer module must have run and attached its drop handler.
    //    (Static HTML alone is not enough: a blocked module leaves the page looking loaded.)
    await waitFor(
      'the renderer script to start (its drop handler attached to #main-content)',
      async () => {
        const target = await send('Runtime.evaluate', { expression: "document.getElementById('main-content')" });
        if (!target.result?.objectId) return false;
        const { listeners } = await send('DOMDebugger.getEventListeners', { objectId: target.result.objectId });
        return listeners.some((listener) => listener.type === 'drop');
      },
      60000,
    );
    const shell = await evaluate(`({
      title: document.title,
      protocol: location.protocol,
      bridge: ['openFile', 'readFile', 'printPdf', 'savePdf'].every((name) => typeof window.cambuzAPI?.[name] === 'function'),
      welcomeVisible: getComputedStyle(document.getElementById('welcome-screen')).display !== 'none',
    })`);
    record('window title is "Cambuz PDF Reader"', shell.title === 'Cambuz PDF Reader', shell.title);
    record('preload bridge (window.cambuzAPI) is exposed', shell.bridge);
    record('renderer page is loaded from the packaged app', shell.protocol === 'file:' || shell.protocol === 'http:', shell.protocol);

    // 4. Informational: the welcome-screen sample button.
    if (shell.welcomeVisible) {
      await evaluate(`document.getElementById('btn-sample').click(); true`);
      try {
        await waitFor('the sample PDF to open', () => evaluate(`Number(document.getElementById('page-total').textContent) > 0`), 15000);
        note('welcome "Try Sample PDF" button', 'opened the sample document');
      } catch (error) {
        const status = await evaluate(`document.getElementById('status-text').textContent`).catch(() => '(unknown)');
        note('welcome "Try Sample PDF" button', `did not open the sample (status "${status}"): ${error.message}`);
      }
    }

    // 5. Open the bundled PDF through the drop path.
    const b64 = pdfBytes.toString('base64');
    await evaluate(`(() => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], ${JSON.stringify(pdfName)}, { type: 'application/pdf' }));
      document.getElementById('main-content').dispatchEvent(
        new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true })
      );
      return true;
    })()`);
    await waitFor(`${pdfName} to open`, () =>
      evaluate(`document.getElementById('status-file').textContent.startsWith(${JSON.stringify(pdfName)})`),
    );
    const pageCount = await evaluate(`Number(document.getElementById('page-total').textContent)`);
    record('dropped PDF opens in the renderer', pageCount > 0, `${pageCount} page(s) reported`);
    record(`page count matches the file (${expectedPages})`, pageCount === expectedPages, `${pageCount} reported`);

    // 6. Page 1 rendered: canvas painted and text layer built.
    await waitFor('page 1 to finish rendering', () =>
      evaluate(`/^Page 1 of \\d+/.test(document.getElementById('status-text').textContent)`),
    );
    const canvas = await evaluate(`(() => {
      const el = document.getElementById('pdf-canvas');
      if (!el || !el.width || !el.height) return { width: 0, height: 0, dark: 0, samples: 0 };
      const { data } = el.getContext('2d').getImageData(0, 0, el.width, el.height);
      let dark = 0;
      let samples = 0;
      for (let i = 0; i < data.length; i += 4 * 61) {
        samples += 1;
        if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) dark += 1;
      }
      return { width: el.width, height: el.height, dark, samples };
    })()`);
    const darkShare = canvas.samples ? canvas.dark / canvas.samples : 0;
    record(
      'page 1 canvas is painted (not blank)',
      canvas.width > 0 && darkShare > 0.001,
      `${canvas.width}x${canvas.height}, ${(darkShare * 100).toFixed(2)}% dark samples`,
    );
    const textLength = await waitFor('the PDF.js text layer', () =>
      evaluate(`Array.from(document.querySelectorAll('.textLayer span')).map((span) => span.textContent).join('').length`),
    );
    record('PDF.js text layer produced selectable text', textLength > 0, `${textLength} characters`);

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, 'rendered-page.png'), Buffer.from(shot.data, 'base64'));
    record('screenshot captured', true, 'rendered-page.png');
    record('no uncaught renderer exceptions', report.uncaughtExceptions.length === 0, `${report.uncaughtExceptions.length} seen`);
  } catch (error) {
    report.error = error.message;
    record('smoke test completed without error', false, error.message);
    try {
      if (send) {
        const shot = await send('Page.captureScreenshot', { format: 'png' }, 10000);
        fs.writeFileSync(path.join(outDir, 'failure.png'), Buffer.from(shot.data, 'base64'));
      }
    } catch {
      // Screenshot is best-effort on failure.
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    report.passed = report.checks.length > 0 && report.checks.every((check) => check.pass);
    fs.writeFileSync(path.join(outDir, 'smoke-test-result.json'), `${JSON.stringify(report, null, 2)}\n`);
    try {
      ws?.close();
    } catch {
      // Already closed.
    }
    stopApp();
    await new Promise((resolve) => logStream.end(resolve));
  }

  const failed = report.checks.filter((check) => !check.pass).length;
  console.log(report.passed ? `Smoke test passed (${report.checks.length} checks).` : `Smoke test FAILED (${failed} failing check(s)).`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const escapeCell = (text) => String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const lines = [
      `### Smoke test: ${report.app} (${report.platform})`,
      '',
      `Result: **${report.passed ? 'PASS' : 'FAIL'}** — PDF \`${report.pdf}\` (${report.expectedPages} pages)`,
      '',
      '| Check | Result | Detail |',
      '| --- | --- | --- |',
      ...report.checks.map((check) => `| ${escapeCell(check.name)} | ${check.pass ? 'PASS' : 'FAIL'} | ${escapeCell(check.detail)} |`),
      '',
      ...Object.entries(report.informational).map(([name, detail]) => `- **${escapeCell(name)}:** ${escapeCell(detail)}`),
      '',
    ];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  }
  process.exit(report.passed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
