// PWA shell cache — includes all app bootstrap assets
// Vite will serve these with consistent, deterministic paths

// Self-scope the cache name to this SW's own directory so multiple
// deployments sharing one origin (e.g. production at /claw-web/ and
// staging at /claw-web/staging/) get DISTINCT caches. Without this they
// share the origin's Cache Storage, and a version bump in one environment
// would run activate -> caches.keys() -> delete the OTHER environment's cache.
// registration.scope is the source of truth; fall back to the SW's own path.
const CACHE_VERSION = "v13";
const SCOPE_PATH = (function () {
  try {
    return new URL(self.registration.scope).pathname;
  } catch (e) {
    return self.location.pathname.replace(/[^/]*$/, ""); // strip "sw.js"
  }
})();
const CACHE_PREFIX = "claw-web::" + SCOPE_PATH + "::";
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

// Essential assets needed to boot the game
// These are served by Vite and have stable, hashed filenames in production
//
// NOTE: openclaw.wasm / openclaw.data are deliberately NOT cached here.
// Safari refuses to compile a Service-Worker-served response with
// WebAssembly.instantiateStreaming ("wasm streaming compile failed: Load
// failed") and then blocks the ArrayBuffer fallback fetch as an access-control
// violation. Those binaries are cached in IndexedDB and fed to Emscripten
// directly via Module.wasmBinary / Module.getPreloadedPackage instead (see
// asset-loader.js). They stay in HANDS_OFF below so the SW never touches them.
//
// Music assets (JS + soundfont) ARE safe to cache here — the Safari limitation
// is specific to WASM streaming compilation, not ordinary script/binary fetches.
const SHELL_ASSETS = [
  "./claw-web.html",
  "./game-init.js",
  "./asset-storage.js",
  "./asset-loader.js",
  "./resource-loader.js",
  "./graphics-bridge.js",
  "./texture-bridge.js",
  "./save-storage.js",
  "./gamepad-bridge.js",
  "./keyboard-capture.js",
  "./sw-register.js",
  "./env-marker.js",
  "./site.webmanifest",
  "./android-chrome-192x192.png",
  "./android-chrome-512x512.png",
  "./apple-touch-icon.png",
  "./favicon.ico",
  "./favicon-16x16.png",
  "./favicon-32x32.png",
  "./preview.png",
  "./music/midi-player.js",
  "./music/spessasynth_processor.min.js",
  "./music/soundfont.sf3",
];

// On install: cache the app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        // Use addAll to fail fast if any asset is missing
        return cache.addAll(SHELL_ASSETS);
      })
      .then(() => {
        // Force waiting service worker to become active immediately
        return self.skipWaiting();
      })
  );
});

// On activate: prune only THIS scope's stale caches. We must never delete a
// sibling deployment's cache, so we only touch keys under our own CACHE_PREFIX
// (plus the legacy pre-scoping "claw-web-*" names). Legacy caches are only
// reclaimed by non-staging scopes: production created them before scoping
// existed, and staging never ran the old scheme, so staging must leave them
// for production to clean up.
var IS_STAGING = /\/staging\//.test(SCOPE_PATH);
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => {
              if (k === CACHE_NAME) return false; // keep current
              var ours = k.indexOf(CACHE_PREFIX) === 0;
              var legacy = /^claw-web-/.test(k) && !IS_STAGING;
              return ours || legacy;
            })
            .map((k) => {
              console.log("[SW] Deleting old cache:", k);
              return caches.delete(k);
            })
        )
      )
      .then(() => {
        // Claim all clients immediately (no need to reload page)
        return self.clients.claim();
      })
  );
});

// Fetch strategy: cache-first for the small shell, hands-off for everything
// else. Anything the SW does not explicitly handle is left to the browser by
// NOT calling event.respondWith — critical for large/streamed assets.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only ever touch same-origin GET requests.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // Never intercept range requests (WASM/data/media stream with these; a SW
  // returning a 200 for a Range request breaks playback and wasm streaming).
  if (req.headers.has("range")) return;

  // Large binaries are loaded/streamed directly and must never be intercepted:
  // - .wasm/.data: cached in IndexedDB and fed to Emscripten directly (Safari
  //   cannot instantiateStreaming a SW-served WASM response — see SHELL_ASSETS).
  // - .zip/.mp4: streamed with Range requests, which a SW 200 would break.
  const HANDS_OFF = [".wasm", ".data", ".zip", ".mp4"];
  const path = url.pathname.toLowerCase();
  if (HANDS_OFF.some((ext) => path.endsWith(ext)) || path.includes("assets.zip")) {
    return; // browser handles it natively
  }

  // Cache-first for the shell; fall back to network and cache the result.
  // If the network fails, return any cached copy rather than throwing.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return response;
        })
        .catch(() => caches.match(req));
    })
  );
});
