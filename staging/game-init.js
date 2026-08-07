/**
 * Main ES Module Coordinator for Claw Web
 * Imports all modules and exposes necessary functions to window for HTML compatibility
 */

import { AssetStorage } from './asset-storage.js';
import {
  validateClawRezFile,
  uploadClawRez,
  reuploadClawRez,
  getStorageStats,
  prepareAssetStorage,
  mountClawRezToFS,
  cacheGameBinariesInBackground
} from './asset-loader.js';
import { initResourceLoader, getLoadingState, updateLoadingUI } from './resource-loader.js';
import { WebGLBridge } from './graphics-bridge.js';
import { TextureBridge } from './texture-bridge.js';

// Expose functions needed by HTML event handlers
window.prewarmAudioContext = prewarmAudioContext;
window.validateClawRezFile = validateClawRezFile;
window.uploadClawRez = uploadClawRez;
window.reuploadClawRez = reuploadClawRez;
window.getStorageStats = getStorageStats;

// Expose functions needed by inline scripts
window.prepareAssetStorage = prepareAssetStorage;
window.mountClawRezToFS = mountClawRezToFS;
window.cacheGameBinariesInBackground = cacheGameBinariesInBackground;
window.getLoadingState = getLoadingState;
window.updateLoadingUI = updateLoadingUI;

// Initialize resource loader when Module is ready
// This is called from inline script after Module is defined
window.initResourceLoader = function(Module) {
  initResourceLoader(Module);
};

function prewarmAudioContext() {
  if (!window.audioContext) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) window.audioContext = new AC();
  }
  if (window.audioContext && window.audioContext.state === 'suspended') {
    window.audioContext.resume();
  }
}

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    window._wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { /* not supported or denied — silent */ }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestWakeLock();
});

function waitForStartClick() {
  // Reveals the in-game controls (.bottom-controls, touch install button),
  // which stay hidden until the start overlay is gone so their clicks can't
  // fall through to the overlay and start the game prematurely.
  const markStarted = () => document.body.classList.add('game-started');
  return new Promise((resolve) => {
    if (window.audioContext && window.audioContext.state === 'running') {
      markStarted(); resolve(); return;
    }
    const overlay = document.getElementById('startOverlay');
    if (!overlay) { markStarted(); resolve(); return; }
    overlay.style.display = 'flex';
    window._startOverlayClick = function() {
      prewarmAudioContext();
      // Warm the level-music synth now (AudioWorklet + 8.4MB soundfont) so it's
      // ready before the first level, instead of loading lazily after a level
      // starts. Fire-and-forget: never block the game start on it.
      if (typeof window.warmLevelMidi === 'function') window.warmLevelMidi();
      overlay.style.display = 'none';
      markStarted();
      window._startOverlayClick = null;
      requestWakeLock();
      resolve();
    };
  });
}

async function checkClawRezCached() {
  try {
    const storage = new AssetStorage();
    await storage.init();
    return await storage.hasFile('CLAW.REZ');
  } catch {
    return false;
  }
}

// Show the install onboarding screen once, before first-run upload. Resolves
// when the user chooses Install or Not now (or immediately if not applicable).
function runInstallOnboarding() {
  return new Promise((resolve) => {
    var api = window.ClawWebInstall;
    var screen = document.getElementById('installScreen');
    var SEEN_KEY = 'pwa_install_onboarded';

    // Skip if: no API, already installed, or the user already saw this screen.
    if (!api || api.isInstalled || !screen || localStorage.getItem(SEEN_KEY)) {
      resolve(); return;
    }

    var badge = document.getElementById('installBadge');
    var reason = document.getElementById('installReason');
    var yesBtn = document.getElementById('installYesBtn');
    var skipBtn = document.getElementById('installSkipBtn');
    var rec = api.recommendation || { level: 'optional', reason: '' };

    if (badge) {
      badge.textContent = rec.level === 'recommended' ? 'Recommended' : 'Optional';
      badge.classList.add(rec.level === 'recommended' ? 'recommended' : 'optional');
    }
    if (reason) reason.textContent = rec.reason;

    function finish() {
      localStorage.setItem(SEEN_KEY, '1');
      screen.classList.remove('visible');
      resolve();
    }

    if (yesBtn) yesBtn.addEventListener('click', function () {
      Promise.resolve(api.trigger()).then(finish);
    });
    if (skipBtn) skipBtn.addEventListener('click', finish);

    screen.classList.add('visible');
  });
}

// Initialize game (called from inline script)
window.initGameWhenReady = async function() {

  try {
    // Offer install before first-run upload (once, when applicable).
    await runInstallOnboarding();

    const hasCached = await checkClawRezCached();

    let success;
    if (hasCached) {
      // CLAW.REZ already in storage — load it and show play button in parallel.
      [success] = await Promise.all([prepareAssetStorage(), waitForStartClick()]);
    } else {
      // First run — upload must complete before showing the play button.
      success = await prepareAssetStorage();
      if (success) await waitForStartClick();
    }

    if (success) {
      // Small delay to ensure all async operations are complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // loadGame() is defined in inline script and handles openclaw.js injection
      if (typeof window.loadGame === 'function') {
        window.loadGame();
      } else {
        console.error('[Game Init] loadGame() function not found');
      }
    } else {
      console.error('[Game Init] Failed to prepare assets');
    }
  } catch (error) {
    console.error('[Game Init] Initialization error:', error);
    alert(`Game initialization failed: ${error.message}`);
  }
};

