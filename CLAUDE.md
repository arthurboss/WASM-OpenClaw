# CLAUDE.md

Guidance for Claude Code when working in this repository.

> **Repository:** all pushes, branches, PRs, and deploys go to `arthurboss/claw-web`. When using `gh`, pass `--repo arthurboss/claw-web`.

## Overview

Captain Claw WASM is a browser-based fork of Captain Claw (1997), focused on optimizing the WebAssembly build. The original archive (`CLAW.REZ`, ~113MB) is **not** bundled: the user uploads it once and it's stored uncompressed in IndexedDB. Startup is fast (~48MB download, 2-3s) because level assets lazy-load on demand.

## Prerequisites

- **`CLAW.REZ`** — original game archive (~113MB, uploaded at runtime, not in repo).
- **`ASSETS.ZIP`** — custom assets, auto-generated from `Build_Release/ASSETS/`.
- Emscripten SDK (`emsdk/`, gitignored), CMake 4.3.2+, Node.js 18+ (Vite).
- Browsers: Chrome 105+ / Firefox 121+ / Safari 16.4+ / Edge 105+.

## Build

```bash
source ./emsdk/emsdk_env.sh
./build_wasm.sh          # regenerate ASSETS.ZIP, configure, compile, patch SDL2 shaders, relink
cd build && make -j$(nproc)   # C++-only incremental build
rm -rf build && ./build_wasm.sh   # clean build
```

> **SDL2 shader patch** (`patch_sdl2_shaders.sh`, run by `build_wasm.sh`) is required for WebGL: it disables `GL_OES_EGL_image_external` and swaps `samplerExternalOES` for `sampler2D`. A hand-rolled `cmake`/`make` build must run it after the first `make`, then clear `emsdk/upstream/emscripten/cache/build/sdl2` and rebuild.

## Running Locally

```bash
yarn dev                 # Vite at http://localhost:5173/
```

Vite gives hot reload and rewrites `/` → `/claw-web.html``. Serve over `localhost` (a **secure context**), which Keyboard Lock and Web Audio / AudioWorklet require; a plain-HTTP LAN IP breaks those APIs.

## Deployment (GitHub Pages)

Deploys are manual via `scripts/`. Both environments share the `gh-pages` branch: **production at root**, **staging under `/staging/`**. Neither script can clobber the other (prod excludes `staging/` from `--delete`; staging writes only `/staging/`). Both verify the WASM artifacts are fresh (guards the `ASM_CONSTS` crash from a stale loader+wasm pair) and self-clean their temp worktree.

- **Production:** <https://arthurboss.github.io/claw-web/> — `./scripts/deploy-prod.sh ["msg"]`
- **Staging:** <https://arthurboss.github.io/claw-web/staging/> — `./scripts/deploy-staging.sh ["msg"]`

**Default workflow:** deploy every new branch to **staging first** (safe — never touches prod), test on a real device, then merge and run `deploy-prod.sh` to promote. Skip only for deploy-only/non-visual changes.

> **SW cache version rule:** any PR that modifies a file listed in `SHELL_ASSETS` in `sw.js` (i.e. `claw-web.html`, `game-init.js`, any `.js` bridge, `site.webmanifest`, icons, or `preview.png`) **must** bump `CACHE_VERSION` in `sw.js` (e.g. `v5` -> `v6`). Without a bump, returning users with a cached SW will not receive the updated files. Also ensure any new `Build_Release/` file served to the browser is added to `SHELL_ASSETS`.

**Env isolation** (prod + staging share one origin, so storage is scoped deliberately):

- **SW cache** named per scope (`openclaw::<scope>::<version>`) — a version bump in one env can't delete the other's cache; kill-switch teardown is scoped too.
- **`localStorage`** namespaced by scope: prod keeps bare keys (preserves existing saves), `/staging/` gets a `staging:` prefix. A `Storage.prototype` shim inlined in `<head>` does this — it **must** stay inline (runs before the save glue baked into the WASM runtime), unlike the external `sw-register.js` / `env-marker.js`.
- **`IndexedDB`** (`CLAW.REZ` + assets) is intentionally **shared** — staging needs no re-upload.
- Gold **STAGING** badge marks non-production builds.

## Architecture

### Layout

```text
OpenClaw/Engine/       # Core C++ engine
  Actor/ Audio/ Events/ GameApp/ Physics/ Resource/ Scene/ UserInterface/ Process/ Logger/ Util/
  Graphics/WASM/       # WebGL renderer (Graphics/Generic/ = platform-agnostic abstraction)
libwap/ Box2D/ ThirdParty/     # WAP parser, physics, deps (TinyXML, FastDelegate, sigc++)
Build_Release/         # Output: openclaw.{wasm,js,data,html}, config.xml, *-bridge.js, ASSETS/, ASSETS.ZIP
scripts/ docs/ emsdk/(gitignored)
```

### Lazy-loading

Startup loads only menu/UI assets (~150ms). Level assets and level metadata (XML) load on first entry to each level; a resource cache (default 150 items, in `config.xml`) holds hot assets. Only visited levels consume memory.

### Assets & resources

- First run: no `CLAW.REZ` in IndexedDB → upload UI → store uncompressed (~113MB). Every load: retrieve → mount to FS (no decompression). Stored raw because gzip cost ~1.8s of decompression on every launch to save ~50MB once.
- `ASSETS.ZIP` is preloaded with the WASM (<1MB) and **overrides** `CLAW.REZ` files with matching paths.
- Resource paths are **case-sensitive, forward-slash**: `/STATES/MENU/*`, `/GAME/IMAGES/MENU/*`, `/GAME/FONTS/*`, `/LEVEL1..14/*`.
- Level metadata XMLs are gzip-compressed inside `ASSETS.ZIP`; `XmlLoader.cpp` decompresses transparently. Edit via `scripts/decompress_metadata.sh` → edit → `scripts/compress_metadata.sh`.

### C++/JS bridge

C++ calls JS via `EM_ASM` / `EM_ASM_INT` (strings via `UTF8ToString($0)`). Bridge files in `Build_Release/` are ES6 modules copied at build time, imported by `openclaw.html`: `asset-loader.js` / `asset-storage.js` (IndexedDB asset storage), `resource-loader.js` (loading coordination), `graphics-bridge.js` / `texture-bridge.js` (WebGL + textures).

## Development Workflow

**When to rebuild:**

- **Full rebuild** (C++ source, `CMakeLists.txt`, deps, flags): `cd build && make -j$(nproc)`.
- **JS / HTML / CSS / root `config.xml`**: no rebuild, hard-refresh the browser.
- **XML or assets under `Build_Release/ASSETS/`**: rebuild `ASSETS.ZIP` **and force a relink** — the #1 silent gotcha. `ASSETS.ZIP` is embedded into `openclaw.data` only during the Emscripten link step, which CMake skips if nothing else changed:

  ```bash
  ./scripts/decompress_metadata.sh          # if editing metadata XMLs
  # ...edit XMLs under Build_Release/ASSETS/ ...
  ./scripts/compress_metadata.sh
  cd Build_Release && rm -f ASSETS.ZIP && (cd ASSETS && zip -q -r ../ASSETS.ZIP .) && cd ..
  touch Build_Release/ASSETS.ZIP            # forces CMake to relink
  cd build && cmake .. && make -j$(nproc)
  ```

**Never commit build artifacts:** `build/`, `Build_Release/openclaw.{wasm,js,data}`, `Build_Release/ASSETS.ZIP`, `emsdk/`.

**Testing:** no automated tests. Build → `yarn dev` → check browser console for JS errors and C++ `LOG` output → play affected levels. In-game console (`~`): `reload levelmetadata`.

## Key Files

- **Lazy loading:** `BaseGameApp.cpp` — startup skips eager metadata (:173), `VPreload` startup assets (:186-196), `LoadSingleLevelMetadata()` (:1356), `GetLevelMetadata()` lazy (:1545).
- **Assets:** `Resource/ResourceMgr.cpp`, `Resource/ResourceCache.cpp`.
- **Graphics:** `Graphics/WASM/PureWebGLRenderer.cpp`, `Graphics/WASM/TextureManager.cpp`.
- **Audio:** `Audio/WebAudioAPI.cpp`, `Audio/WASM/AudioWorkletSystem.cpp`, `Resource/Loaders/WavLoader.cpp` (memory-safe buffer copies); `HumanView.cpp` sound (:641), MIDI disabled for Emscripten (:562).
- **Metadata:** `Resource/Loaders/XmlLoader.cpp`.

## Build Configuration

```bash
emcmake cmake -DEmscripten=1 ..                     # WASM mode
emcmake cmake -DEmscripten=1 -DExtern_Config=0 ..   # embed config.xml in WASM
```

Emscripten flags live in `CMakeLists.txt` (SDL2 + image/ttf/gfx/mixer, `ASYNCIFY`, 256MB memory with growth, WebGL2, `USE_ZLIB`, `FETCH`). Preloaded: `ASSETS.ZIP`, `console02.tga`, `clacon.ttf`. `CLAW.REZ` is explicitly **not** preloaded.

## Known Limitations

- MIDI audio not supported on WASM (WAV/OGG fine).
- Firefox: ALT opens the window menu (browser bug); use fullscreen.
- Death/teleport fade effects can have rendering quirks.

**iOS / Apple:**

- The browser Fullscreen API is unsupported on iOS (iPhone/iPad, and iPadOS Safari that reports as `MacIntel` with touch). Toggling it crashes the game, so the fullscreen menu controls are hidden on iOS (`UserInterface.cpp` `FullscreenOn`/`FullscreenOff`). True fullscreen on iOS is only available by installing the PWA to the home screen (standalone display mode) — hence the install prompt is `recommended` on iOS Safari.
- On desktop Safari (macOS), pressing Ctrl+Arrow while fullscreen can switch Spaces and leave the game stuck in fullscreen; recovery is via the OS, not the game.
- iOS Safari reports stale viewport dimensions during an orientation change, so layout must re-measure after a short delay on `orientationchange` (handled in `openclaw.html`).
- Web Audio / AudioWorklet and Keyboard Lock require a secure context on iOS too, so local IP testing over plain HTTP will not have audio or key capture.

## Docs & References

- `docs/` — player (`GAMEPAD.md`, `TROUBLESHOOTING.md`), developer (`BUILDING.md`, `ARCHITECTURE.md`, `SAVE_SYSTEM.md`, `HAPTIC_FEEDBACK.md`, `SCREEN_RENDERING.md`, `GENERIC_GRAPHICS.md`).
- Emscripten: <https://emscripten.org/docs/> · SDL2: <https://wiki.libsdl.org/>
