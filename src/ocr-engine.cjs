'use strict';

// Optional local Tesseract adapter for Electron's main process. No OCR engine,
// traineddata, shell command, or network service is bundled with Cambuz.
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const OCR_LANGUAGE_CODES = new Set([
  'eng', 'hin', 'pan', 'urd', 'ben', 'guj', 'mar', 'tam', 'tel', 'kan', 'mal', 'ori', 'asm',
]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 8_000;
const MAX_IMAGE_PIXELS = 16_000_000;
const MAX_OCR_OUTPUT_BYTES = 4 * 1024 * 1024;
const ENGINE_CHECK_TIMEOUT_MS = 8_000;
const OCR_TIMEOUT_MS = 120_000;

function executeTesseract(args, { timeout, maxBuffer } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      'tesseract',
      args,
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout,
        maxBuffer,
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
      }
    );
  });
}

function versionTuple(output) {
  const match = String(output || '').match(/\b(?:tesseract\s+)?v?(\d+)\.(\d+)(?:\.(\d+))?/i);
  return match ? match.slice(1).map((part) => Number(part || 0)) : null;
}

function formatEngineFailure(error) {
  if (error && error.code === 'ENOENT') {
    return 'Optional OCR is not installed. Install Tesseract OCR 4 or newer, add it to PATH, then restart Cambuz.';
  }
  if (error && (error.code === 'ETIMEDOUT' || error.killed)) {
    return 'Tesseract did not respond in time. Check the installation and try again.';
  }
  const detail = String((error && (error.stderr || error.message)) || '').trim();
  return detail
    ? `Tesseract could not be started: ${detail.slice(0, 400)}`
    : 'Tesseract could not be started. Check the optional OCR installation.';
}

/** Check the optional executable and report only language packs Cambuz offers. */
async function getOcrStatus() {
  let versionResult;
  try {
    versionResult = await executeTesseract(['--version'], {
      timeout: ENGINE_CHECK_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
    });
  } catch (error) {
    return {
      available: false,
      version: '',
      languages: [],
      error: formatEngineFailure(error),
    };
  }

  const tuple = versionTuple(versionResult.stdout);
  const version = tuple
    ? tuple.join('.')
    : String(versionResult.stdout).trim().split(/\r?\n/, 1)[0].slice(0, 80);
  if (!tuple || tuple[0] < 4) {
    return {
      available: false,
      version,
      languages: [],
      error: 'Cambuz requires Tesseract 4 or newer for the supported language models.',
    };
  }

  try {
    const result = await executeTesseract(['--list-langs'], {
      timeout: ENGINE_CHECK_TIMEOUT_MS,
      maxBuffer: 256 * 1024,
    });
    const languages = [...new Set(
      result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => OCR_LANGUAGE_CODES.has(line))
    )];
    return {
      available: true,
      version,
      languages,
      error: languages.length
        ? ''
        : 'Tesseract is installed, but none of Cambuz’s supported language data is installed.',
    };
  } catch (error) {
    return {
      available: false,
      version,
      languages: [],
      error: formatEngineFailure(error),
    };
  }
}

/** Convert supported IPC binary forms to a bounded PNG buffer. */
function asPngBuffer(input) {
  let buffer;
  if (Buffer.isBuffer(input)) {
    buffer = input;
  } else if (input instanceof ArrayBuffer) {
    buffer = Buffer.from(input);
  } else if (ArrayBuffer.isView(input)) {
    buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  } else {
    throw new Error('The OCR image is invalid. Render the page again and retry.');
  }

  if (buffer.byteLength < 33 || buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('The page image is empty or exceeds the 20 MiB OCR limit.');
  }
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('OCR accepts only a PNG image generated from the open PDF page.');
  }
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('The OCR image has an invalid PNG header.');
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new Error('The OCR image dimensions exceed the safe 8,000-pixel / 16-megapixel limit.');
  }
  return buffer;
}

/** Normalize an explicit one-to-three language selection to Tesseract syntax. */
function normalizeLanguages(input) {
  if (typeof input !== 'string' || input.length > 16) {
    throw new Error('Select one to three installed OCR languages.');
  }
  const selected = input.split('+').map((code) => code.trim()).filter(Boolean);
  if (selected.length < 1 || selected.length > 3 || new Set(selected).size !== selected.length) {
    throw new Error('Select one to three different OCR languages.');
  }
  if (selected.some((code) => !OCR_LANGUAGE_CODES.has(code))) {
    throw new Error('One or more selected OCR languages are not supported.');
  }
  return selected;
}

/**
 * Run explicitly requested OCR in a short-lived private temp directory. This
 * does not load the PDF path, store recognized text, or send data over a
 * network. Tesseract receives a generated page PNG and a validated language
 * string; execFile never invokes a shell.
 */
async function recognizePng(imageInput, languageInput) {
  const image = asPngBuffer(imageInput);
  const languages = normalizeLanguages(languageInput);
  const status = await getOcrStatus();
  if (!status.available) throw new Error(status.error || 'Tesseract OCR is not available.');

  const missing = languages.filter((code) => !status.languages.includes(code));
  if (missing.length) {
    throw new Error(
      `Install Tesseract language data for ${missing.join(', ')} and check OCR again.`
    );
  }

  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'cambuz-ocr-'));
  const imagePath = path.join(temporaryDirectory, 'page.png');
  try {
    await fs.writeFile(imagePath, image, { flag: 'wx' });
    const result = await executeTesseract(
      [imagePath, 'stdout', '-l', languages.join('+'), '--psm', '3', '-c', 'user_defined_dpi=300'],
      {
        timeout: OCR_TIMEOUT_MS,
        maxBuffer: MAX_OCR_OUTPUT_BYTES,
      }
    );
    return {
      text: result.stdout.replace(/\r/g, '').trim(),
      languages,
      version: status.version,
    };
  } catch (error) {
    if (error && (error.code === 'ETIMEDOUT' || error.killed)) {
      throw new Error('OCR took longer than two minutes and was stopped. Try a smaller or clearer page.');
    }
    const detail = String((error && (error.stderr || error.message)) || '').trim();
    throw new Error(
      detail
        ? `Tesseract could not recognize this page: ${detail.slice(0, 400)}`
        : 'Tesseract could not recognize this page. Check the image and language installation.'
    );
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  OCR_LANGUAGE_CODES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  asPngBuffer,
  getOcrStatus,
  normalizeLanguages,
  recognizePng,
  versionTuple,
};
