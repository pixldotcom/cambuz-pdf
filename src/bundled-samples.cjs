// Cambuz PDF Reader — bundled sample documents (shared by the main process,
// the packaging scripts and the tests).
//
// The welcome screen's "Try Sample PDF" buttons open these files. They are the
// only documents the renderer may request by name over IPC, so reading an
// arbitrary path through that channel is impossible. Every name listed here
// must also be staged into the packaged app (scripts/stage-app.mjs).

const path = require('path');

const BUNDLED_SAMPLES = Object.freeze(['cambuz-demo.pdf', 'form-sample.pdf']);

/**
 * Absolute path of a bundled sample inside the app directory, or null when the
 * name is not on the list. Only exact list entries resolve, so no path
 * separators or relative segments can reach the file system.
 */
function bundledSamplePath(appDirectory, name) {
  if (typeof name !== 'string' || !BUNDLED_SAMPLES.includes(name)) return null;
  return path.join(appDirectory, 'samples', name);
}

module.exports = { BUNDLED_SAMPLES, bundledSamplePath };
