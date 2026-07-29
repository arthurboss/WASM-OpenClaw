/**
 * Bridge between IndexedDB and Emscripten's virtual file system
 * Handles lazy loading of CLAW.REZ from browser storage
 */

import { AssetStorage } from './asset-storage.js';

let assetStorage = null;
let uploadResolve = null;

/**
 * Show offline (no cache) message
 */
function showOfflineNeedCache() {
  const offlineDiv = document.getElementById('offlineNeedCache');
  if (offlineDiv) {
    offlineDiv.classList.add('visible');
  }
}

/**
 * Show asset upload UI
 */
function showAssetUpload() {
  const uploadDiv = document.getElementById('assetUpload');
  if (uploadDiv) {
    uploadDiv.style.display = 'flex';
  }
}

/**
 * Hide asset upload UI
 */
function hideAssetUpload() {
  const uploadDiv = document.getElementById('assetUpload');
  if (uploadDiv) {
    uploadDiv.style.display = 'none';
  }
}

/**
 * Validate CLAW.REZ file selection and enable/disable upload button
 */
// CLAW.REZ is a Monolith resource archive. Known-valid releases carry one of
// two header signatures near the start (confirmed against original discs):
//   - "RezMgr Version 1"  (118,033,115 bytes)
//   - "WinRez 2.4"         (119,321,886 bytes)
// A commonly mis-uploaded file carries "WinRez LT 3.0" and is only ~168 bytes,
// so the size gate rejects it — but we also reject the "LT" signature outright.
const REZ_VALID_SIGNATURES = ['RezMgr Version 1', 'WinRez 2.4'];
const REZ_MIN_SIZE = 100 * 1024 * 1024; // ~100MB; real files are ~113MB
const REZ_MAX_SIZE = 130 * 1024 * 1024; // generous upper bound

function showUploadError(message) {
  const el = document.getElementById('uploadError');
  if (el) { el.textContent = message; el.style.display = 'block'; }
}

function clearUploadError() {
  const el = document.getElementById('uploadError');
  if (el) { el.textContent = ''; el.style.display = 'none'; }
}

function rejectRezFile(message) {
  const fileInput = document.getElementById('clawRezFile');
  const uploadBtn = document.getElementById('uploadBtn');
  const drop = document.getElementById('fileDrop');
  const name = document.getElementById('fileDropName');
  if (fileInput) fileInput.value = '';
  if (uploadBtn) uploadBtn.disabled = true;
  if (drop) drop.classList.remove('has-file');
  if (name) name.textContent = '';
  showUploadError(message);
}

function acceptRezFile(file) {
  clearUploadError();
  const uploadBtn = document.getElementById('uploadBtn');
  const drop = document.getElementById('fileDrop');
  const name = document.getElementById('fileDropName');
  if (uploadBtn) uploadBtn.disabled = false;
  if (drop) drop.classList.add('has-file');
  if (name) name.textContent = file.name + ' ✓';
}

// Read the header and confirm it carries one of the known-valid signatures.
async function hasRezSignature(file) {
  try {
    const head = await file.slice(0, 64).arrayBuffer();
    const text = new TextDecoder('latin1').decode(new Uint8Array(head));
    return REZ_VALID_SIGNATURES.some(function (sig) { return text.indexOf(sig) !== -1; });
  } catch (e) {
    console.error('Failed to read CLAW.REZ header:', e);
    return false;
  }
}

// Validate the selected file. Hard-rejects anything that is not a real
// CLAW.REZ (wrong name, empty, wildly wrong size, or missing the RezMgr
// signature) — no "continue anyway" escape hatch. Async: enables the upload
// button only after the header check passes.
async function validateClawRezFile() {
  const fileInput = document.getElementById('clawRezFile');
  const uploadBtn = document.getElementById('uploadBtn');
  const file = fileInput.files[0];

  if (uploadBtn) uploadBtn.disabled = true;
  if (!file) return false;

  if (!file.name.match(/^CLAW\.REZ$/i)) {
    rejectRezFile('That file is not CLAW.REZ.\n\nThe file must be named CLAW.REZ (from the original Captain Claw game).\n\nYou selected: ' + file.name);
    return false;
  }

  if (file.size === 0) {
    rejectRezFile('That file is empty.\n\nPlease select the real CLAW.REZ from the original Captain Claw (1997) game.');
    return false;
  }

  const sizeMB = (file.size / 1024 / 1024).toFixed(1);
  if (file.size < REZ_MIN_SIZE || file.size > REZ_MAX_SIZE) {
    rejectRezFile('That does not look like CLAW.REZ.\n\nIts size is ' + sizeMB + 'MB but CLAW.REZ is about 113MB. Please select the correct file from the original Captain Claw (1997) game.');
    return false;
  }

  if (!(await hasRezSignature(file))) {
    rejectRezFile('That file is not a valid CLAW.REZ.\n\nIt is missing the expected archive header. Please select the correct CLAW.REZ from the original Captain Claw (1997) game.');
    return false;
  }

  acceptRezFile(file);
  return true;
}

/**
 * Handle CLAW.REZ file upload (stored uncompressed)
 */
async function uploadClawRez() {
  const fileInput = document.getElementById('clawRezFile');
  const file = fileInput.files[0];

  if (!file) {
    showUploadError('Please select a file first');
    return;
  }

  // Revalidate before upload (in case button was enabled programmatically)
  if (!file.name.match(/^CLAW\.REZ$/i)) {
    showUploadError('Error: File must be named CLAW.REZ');
    return;
  }

  // Upload button click is a user gesture — pre-warm AudioContext now.
  if (typeof window.prewarmAudioContext === 'function') {
    window.prewarmAudioContext();
  }

  // Request durable storage on first upload. On iOS PWA the system may show
  // a permission prompt on the very first write; calling persist() here
  // (inside a user gesture) ensures the grant happens before we start writing
  // so the write doesn't silently fail.
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  clearUploadError();

  // Show progress UI
  document.getElementById('uploadArea').style.display = 'none';
  const progressDiv = document.getElementById('uploadProgress');
  progressDiv.style.display = 'block';

  try {
    console.log(`Original file size: ${(file.size / 1024 / 1024).toFixed(2)}MB`);

    // Store CLAW.REZ uncompressed. Compressing it (gzip, ~45% smaller) saved
    // ~50MB of IndexedDB once but cost ~1.8s of decompression on EVERY launch.
    // Storage is cheap; the repeated startup wait is not. Raw = no per-launch
    // decompress.
    await assetStorage.storeFile('CLAW.REZ', file, (loaded, total) => {
      const percent = (loaded / total) * 100;
      document.getElementById('uploadProgressBar').value = percent;
      document.getElementById('uploadStatus').textContent =
        `Storing assets: ${percent.toFixed(1)}%`;
    });

    // Update status
    document.getElementById('uploadStatus').textContent = 'Upload complete! Starting game...';

    // Hide upload UI
    setTimeout(() => {
      hideAssetUpload();
      if (uploadResolve) {
        uploadResolve();
        uploadResolve = null;
      }
    }, 1000);

  } catch (error) {
    console.error('Upload failed:', error);

    // IndexedDB is disabled or quota-limited in some browsers' private/
    // incognito modes, which is the most common cause of storage failures.
    var failMsg = `Upload failed: ${error.message}`;
    var errName = (error && error.name) || '';
    if (/Quota|Security|InvalidState|Unknown/i.test(errName) ||
        /quota|storage|indexeddb|database/i.test((error && error.message) || '')) {
      failMsg += '\n\nTip: private / incognito browsing often blocks local '
               + 'storage. Try again in a normal browser window.';
    }
    showUploadError(failMsg);

    // Reset UI
    progressDiv.style.display = 'none';
    document.getElementById('uploadArea').style.display = 'block';
  }
}

/**
 * Allow user to re-upload CLAW.REZ (for troubleshooting)
 */
async function reuploadClawRez() {
  if (!assetStorage) return;

  const confirm = window.confirm(
    'This will delete your current CLAW.REZ and require re-upload.\n\n' +
    'Continue?'
  );

  if (confirm) {
    try {
      await assetStorage.deleteFile('CLAW.REZ');
      window.location.reload();
    } catch (error) {
      console.error('Failed to delete CLAW.REZ:', error);
      showUploadError(`Failed to delete file: ${error.message}`);
    }
  }
}

/**
 * Wait for user to complete upload
 */
function waitForUpload() {
  return new Promise((resolve) => {
    uploadResolve = resolve;
  });
}

// Global to store CLAW.REZ data until Emscripten FS is ready
let clawRezData = null;

/**
 * Prepare CLAW.REZ from IndexedDB (but don't write to FS yet)
 */
// Emscripten binaries needed for OFFLINE boots. Online, the runtime streams
// these straight from the network (fast, low memory, exactly like a normal
// Emscripten load). We only intercept when we must serve them from IndexedDB
// because there is no network — because Safari cannot instantiateStreaming a
// Service-Worker-served WASM response, so the SW leaves them hands-off and we
// own their offline availability here.
const GAME_BINARIES = [
  { name: 'openclaw.wasm' },
  { name: 'openclaw.data' },
];

// Feed cached binary bytes to Emscripten so it never hits the network. Used
// whenever the binaries are already in IndexedDB, online OR offline: on a slow
// connection an IndexedDB read is far faster than re-downloading ~20MB every
// launch. Setting Module.wasmBinary forces a non-streaming compile, but that
// cost is small next to a repeated multi-MB network fetch.
async function feedBinariesFromCache() {
  const wasmBlob = await assetStorage.getFile('openclaw.wasm');
  const dataBlob = await assetStorage.getFile('openclaw.data');
  if (!wasmBlob || !dataBlob) return false;

  const M = window.Module;
  if (!M) return false;

  M.wasmBinary = new Uint8Array(await wasmBlob.arrayBuffer());
  const dataBuffer = await dataBlob.arrayBuffer();
  M.getPreloadedPackage = function (name) {
    // Emscripten asks for the .data package by its remote name; return our
    // cached ArrayBuffer for it and let anything else fall through to fetch.
    if (name && name.includes('openclaw.data')) return dataBuffer;
    return null;
  };
  console.log('[binaries] Serving openclaw.wasm/.data from IndexedDB.');
  return true;
}

// Decide how the game binaries are provided for THIS boot.
// - Cached (online or offline) -> feed from IndexedDB. Avoids re-downloading
//   ~20MB on every online launch, which dominates load time on slow networks.
//   A newer deploy is picked up by the background version check (see
//   cacheGameBinariesInBackground), refreshing the cache for the next launch.
// - Not cached, online -> let Emscripten stream from the network (first run);
//   cached in the background afterwards for subsequent launches.
// - Not cached, offline -> cannot boot; caller shows the offline screen.
// Returns true if the game can proceed to boot.
async function prepareGameBinaries() {
  if (!assetStorage) return false;

  const hasWasm = await assetStorage.hasFile('openclaw.wasm');
  const hasData = await assetStorage.hasFile('openclaw.data');
  if (hasWasm && hasData) {
    const ok = await feedBinariesFromCache();
    if (ok) return true;
    // Fall through to network if the cached read failed for any reason.
  }

  if (navigator.onLine) {
    console.log('[binaries] Not cached; streaming from network this run.');
    return true;
  }

  console.warn('[binaries] Offline and openclaw.wasm/.data not cached.');
  return false;
}

// Version tag for a game binary as served right now. Uses the ETag (falling
// back to Last-Modified) from a cheap HEAD request. A new deploy changes these,
// which is how we detect that a cached binary is stale. Returns null if the
// server sends neither header (then we cannot tell, and keep what we have).
async function fetchBinaryVersion(name) {
  const resp = await fetch(name, { method: 'HEAD', credentials: 'same-origin' });
  if (!resp.ok) return null;
  return resp.headers.get('etag') || resp.headers.get('last-modified') || null;
}

// Fetch openclaw.wasm/.data and store them in IndexedDB WITHOUT blocking boot.
// Runs after the game is already rendering (postRun), so the ~52MB of writes
// never delay the first launch. Only runs online.
//
// Re-fetches (and overwrites) a binary when the server's version tag differs
// from the cached one, so a new deploy invalidates the old cached copy. The
// IndexedDB store is keyed by filename, so the overwrite releases the previous
// bytes - we never accumulate multiple versions. A binary cached before this
// versioning existed has no stored tag, so it always mismatches and is refreshed
// on the next online launch (no manual cache clearing needed).
async function cacheGameBinariesInBackground() {
  try {
    if (!assetStorage || !navigator.onLine) return;
    for (const bin of GAME_BINARIES) {
      const has = await assetStorage.hasFile(bin.name);

      // What version is live on the server right now?
      let serverVersion = null;
      try {
        serverVersion = await fetchBinaryVersion(bin.name);
      } catch (e) {
        // HEAD failed (offline mid-run, etc.). If we already have a copy, keep
        // it; otherwise fall through and try a normal GET below.
        if (has) { continue; }
      }

      if (has) {
        const meta = await assetStorage.getFileMetadata(bin.name);
        const cachedVersion = meta && meta.version;
        // Up to date (or server won't tell us) -> keep the cached copy.
        if (serverVersion === null || cachedVersion === serverVersion) continue;
        console.log(`[binaries] ${bin.name} is stale (cached=${cachedVersion}, server=${serverVersion}); refreshing.`);
      }

      const resp = await fetch(bin.name, { credentials: 'same-origin' });
      if (!resp.ok) { console.warn(`[binaries] bg fetch ${bin.name} failed: ${resp.status}`); continue; }
      const blob = await resp.blob();
      // Prefer the version from the GET response; fall back to the HEAD value.
      const version = resp.headers.get('etag') || resp.headers.get('last-modified') || serverVersion || null;
      await assetStorage.storeFile(bin.name, blob, null, { version: version });
      console.log(`[binaries] Cached ${bin.name} for offline (${(blob.size / 1024 / 1024).toFixed(2)}MB, v=${version}).`);
    }
  } catch (e) {
    console.warn('[binaries] Background caching skipped:', e);
  }
}

async function prepareAssetStorage() {
  try {
    // Initialize IndexedDB storage
    assetStorage = new AssetStorage();
    await assetStorage.init();

    // Check if CLAW.REZ exists in IndexedDB
    let hasClawRez = await assetStorage.hasFile('CLAW.REZ');

    // Purge a legacy gzip-compressed CLAW.REZ. Older versions stored it
    // compressed (blob type "application/gzip" etc.); this build has no
    // decompressor, so such a copy is unusable. Delete it so the user isn't
    // stuck with orphaned storage they can't clear, and treat it as absent
    // (they'll be prompted to re-upload).
    if (hasClawRez) {
      const meta = await assetStorage.getFileMetadata('CLAW.REZ');
      if (meta && /^application\/(gzip|x-gzip|zstd|br)$/i.test(meta.type || '')) {
        console.warn('Removing legacy compressed CLAW.REZ (' + meta.type + '); re-upload required.');
        await assetStorage.deleteFile('CLAW.REZ');
        hasClawRez = false;
      }
    }

    if (!hasClawRez) {
      console.log('CLAW.REZ not found in storage.');

      // Check if device is offline
      if (!navigator.onLine) {
        console.log('Device is offline and CLAW.REZ not cached. Showing offline message...');
        showOfflineNeedCache();
        return false;
      }

      console.log('Showing upload UI...');
      showAssetUpload();
      await waitForUpload();
    } else {
      console.log('CLAW.REZ found in storage. Loading...');
      const metadata = await assetStorage.getFileMetadata('CLAW.REZ');
      console.log(`Stored size: ${(metadata.size / 1024 / 1024).toFixed(2)}MB`);
    }

    // Retrieve CLAW.REZ from IndexedDB. It is stored uncompressed, so it can be
    // used directly with no decompression step.
    console.log('Retrieving CLAW.REZ from IndexedDB...');
    const clawRezBlob = await assetStorage.getFile('CLAW.REZ');
    if (!clawRezBlob) {
      throw new Error('Failed to retrieve CLAW.REZ from storage');
    }

    // CRITICAL: Convert Blob to ArrayBuffer and store BEFORE returning
    // This ensures clawRezData is populated before loadGame() is called
    console.log('Loading CLAW.REZ into memory...');
    const arrayBuffer = await clawRezBlob.arrayBuffer();
    clawRezData = new Uint8Array(arrayBuffer);
    console.log(`CLAW.REZ ready to mount (${(clawRezData.length / 1024 / 1024).toFixed(2)}MB)`);

    // Cache/provide the WASM + data binaries so the game boots offline without
    // the SW intercepting them (required for Safari). If this fails offline
    // before they were ever cached, surface the offline screen.
    const binariesReady = await prepareGameBinaries();
    if (!binariesReady) {
      if (!navigator.onLine) showOfflineNeedCache();
      return false;
    }

    return true;

  } catch (error) {
    console.error('Failed to prepare asset storage:', error);
    return false;
  }
}

/**
 * Mount CLAW.REZ to Emscripten FS (called from Module.preRun)
 */
function mountClawRezToFS() {
  if (!clawRezData) {
    console.error('CLAW.REZ data not prepared!');
    return false;
  }

  try {
    console.log('Writing CLAW.REZ to virtual file system...');
    FS.writeFile('/CLAW.REZ', clawRezData);
    console.log('CLAW.REZ mounted successfully');

    // Clear the data from memory
    clawRezData = null;

    return true;
  } catch (error) {
    console.error('Failed to mount CLAW.REZ to FS:', error);
    return false;
  }
}

/**
 * Get storage statistics (for debugging)
 */
async function getStorageStats() {
  if (!assetStorage) return null;

  try {
    const files = await assetStorage.listFiles();
    const totalSize = await assetStorage.getStorageSize();

    return {
      files: files,
      totalSize: totalSize,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2)
    };
  } catch (error) {
    console.error('Failed to get storage stats:', error);
    return null;
  }
}

// Export functions for ES modules
export {
  validateClawRezFile,
  uploadClawRez,
  reuploadClawRez,
  getStorageStats,
  prepareAssetStorage,
  mountClawRezToFS,
  cacheGameBinariesInBackground
};

// Keep window globals for HTML event handlers (permanent)
window.validateClawRezFile = validateClawRezFile;
window.uploadClawRez = uploadClawRez;
window.reuploadClawRez = reuploadClawRez;
window.getStorageStats = getStorageStats;
