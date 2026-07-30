/**
 * Main ES Module Coordinator for Claw Web
 * Imports all modules and exposes necessary functions to window for HTML compatibility
 */

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

// Audio unlock without a press-to-start screen. Browser autoplay policy blocks
// creating/resuming an AudioContext before a user gesture, so instead of gating
// the whole game behind a click, we boot straight to the menu and unlock audio
// on the player's FIRST interaction (tap/click/key). Sound effects and music
// then kick in automatically from that point.
function setupAudioUnlockOnFirstInput() {
  document.body.classList.add('game-started');
  const unlock = function () {
    prewarmAudioContext();
    // Warm the level-music synth (AudioWorklet + 8.4MB soundfont) on this first
    // gesture so it's ready before the first level. Fire-and-forget.
    if (typeof window.warmLevelMidi === 'function') window.warmLevelMidi();
    requestWakeLock();
    document.removeEventListener('pointerdown', unlock, true);
    document.removeEventListener('keydown', unlock, true);
  };
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);
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
    if (window.bootLog) window.bootLog('initGameWhenReady');
    // Offer install before first-run upload (once, when applicable).
    await runInstallOnboarding();

    // Prepare CLAW.REZ (retrieve from IndexedDB, or run the upload UI on first
    // run). No press-to-start gate: as soon as assets are ready we boot the
    // game straight to the menu.
    const success = await prepareAssetStorage();
    if (window.bootLog) window.bootLog('assets prepared');

    if (success) {
      // Boot immediately. Audio unlocks on the player's first interaction.
      setupAudioUnlockOnFirstInput();

      // loadGame() is defined in inline script and handles openclaw.js injection
      if (typeof window.loadGame === 'function') {
        if (window.bootLog) window.bootLog('loadGame() -> inject openclaw.js');
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

