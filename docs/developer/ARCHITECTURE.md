# Claw Web Architecture

## Overview

Claw Web uses a lazy-loading architecture optimized for browser environments. Assets are loaded on-demand rather than all at startup, significantly reducing initial load time and memory usage.

## Asset Loading Strategy

### Startup (Fast)

At application initialization, only critical assets are loaded:

- Menu and UI graphics (`/STATES/MENU/*`)
- Font files (`/GAME/FONTS/*`)
- Menu images (`/GAME/IMAGES/MENU/*`)

**Result:** Fast startup (~2-3 seconds) regardless of game size

### Level Load (On-Demand)

When entering a level, assets load dynamically:

- Level-specific graphics (backgrounds, tiles, sprites)
- Level-specific sounds and music
- Level metadata XML (enemy configurations, spawn points, etc.)

**Result:** Only visited levels consume memory

### Caching

- Resource cache stores frequently accessed assets (default: 150 items)
- Cache eviction removes old/unused assets when memory is tight
- Level metadata caches after first load (no re-parsing on revisit)

## Resource Management

### CLAW.REZ Archive

The game uses a single archive file (CLAW.REZ) similar to a ZIP file:

- **Not extracted entirely at startup**
- Resources extracted on-demand when requested
- Path-based organization (`/LEVEL1/*`, `/LEVEL2/*`, etc.)
- Stored in browser's IndexedDB (one-time upload)

### CLAW.REZ Storage in IndexedDB

CLAW.REZ is stored **uncompressed** in IndexedDB (one-time upload, ~113MB).

Earlier versions gzip-compressed it (~62MB, 45% smaller), but that traded a
one-time ~50MB storage saving for a ~1.8s gzip **decompression cost on every
launch** (measured under CPU throttle). Storage is cheap; the repeated startup
wait is what users feel. So we store the raw file: no compression on upload, no
decompression on load.

**Implementation:**

- `asset-loader.js` - stores the uploaded file as-is; loads it directly from IndexedDB
- `asset-storage.js` - stores the blob + metadata (name, size, type, timestamp, optional version tag)

**Trade-off:** ~113MB of IndexedDB per install instead of ~62MB. Well within
browser storage quotas on desktop and mobile.

### Custom Assets

ASSETS.ZIP contains custom content and overrides:

- Menu configurations
- Custom graphics/sounds
- Modified game data
- Loaded at startup (small file)

## Lazy-Loading Components

### 1. Level Assets (Game Content)

**Implementation:** Built into resource manager

- Textures, sprites, backgrounds
- Sound effects, music tracks
- Animation data

**When loaded:** First time level is entered
**Cache behavior:** Kept until memory pressure

### 2. Level Metadata (Configuration)

**Implementation:** `BaseGameApp::LoadSingleLevelMetadata()`

- Enemy type mappings (e.g., "Soldier" → Level1_Soldier)
- Checkpoint spawn positions
- Ladder fixture offsets
- Death effect configurations

**When loaded:** First time level is entered
**Cache behavior:** Permanent (small XML files, ~10KB each)

### 3. Actor Prototypes (Game Logic)

**Implementation:** Loaded at startup (required for all levels)

- Actor definitions and behaviors
- Shared across all levels
- ~200 prototypes total

**When loaded:** Application startup
**Cache behavior:** Permanent

## Performance Benefits

### Startup Time

- **Before lazy loading:** Parse 13 metadata XMLs + load all common assets (~500ms)
- **After lazy loading:** Load only menu assets (~150ms)
- **Improvement:** ~350ms faster startup on WASM

### Memory Usage

- **Before:** All 13 levels' metadata in memory (~130KB)
- **After:** Only visited levels' metadata (~10KB per level)
- **Typical session:** Visit 1-3 levels (30KB vs 130KB)

### Network Transfer

- **Initial download:** 48MB (WASM + ASSETS.ZIP)
- **CLAW.REZ:** 112MB one-time upload, stored in IndexedDB
- **Subsequent visits:** Instant load from browser cache

## Code Flow

### Application Startup

```
BaseGameApp::Initialize()
├─ Load menu/UI assets (VPreload)
├─ Initialize graphics/audio/input
└─ Ready to show menu (no level data loaded)
```

### Entering Level 1 (First Time)

```
LoadLevel(1)
├─ Load level assets from CLAW.REZ
│   ├─ Textures: /LEVEL1/IMAGES/*
│   ├─ Sounds: /LEVEL1/SOUNDS/*
│   └─ Data: /LEVEL1/*.WW
├─ GetLevelMetadata(1)
│   ├─ Cache miss
│   ├─ LoadSingleLevelMetadata(1)
│   │   └─ Parse /LEVEL_METADATA/LEVEL1.XML
│   └─ Store in m_LevelMetadataMap
└─ Start gameplay
```

### Entering Level 1 (Second Time)

```
LoadLevel(1)
├─ Load level assets (may be cached)
├─ GetLevelMetadata(1)
│   ├─ Cache hit
│   └─ Return instantly
└─ Start gameplay
```

## File Organization

### Build Output (Build_Release/)

```
Build_Release/
├─ openclaw.wasm        # Compiled game code (~48MB)
├─ openclaw.js          # Emscripten runtime loader (~413KB)
├─ openclaw.data        # Preloaded assets
├─ claw-web.html        # Game entry point
├─ *.js                 # Bridge modules (graphics, textures, asset loading)
└─ config.xml           # Game configuration
```

### Asset Archives

**openclaw.data Structure:**

Emscripten's virtual filesystem package created at link time. Contains files preloaded via `--preload-file`:

- ASSETS.ZIP (~466KB) - Menu configs, custom game assets
- console02.tga - Console background texture
- clacon.ttf - Console font

**Important:** When ASSETS.ZIP changes (e.g., editing MENU.xml), you must:

1. Rebuild ASSETS.ZIP from `Build_Release/ASSETS/`
2. Force relink to regenerate openclaw.data (see CLAUDE.md)
3. Hard refresh browser to clear cached .data file

```
CLAW.REZ (User-provided, 112MB)
├─ STATES/MENU/*        # Loaded at startup
├─ GAME/FONTS/*         # Loaded at startup
├─ GAME/IMAGES/MENU/*   # Loaded at startup
├─ LEVEL1/*             # Loaded when entering Level 1
├─ LEVEL2/*             # Loaded when entering Level 2
└─ ... (13 levels)

ASSETS.ZIP (Bundled in openclaw.data, ~466KB)
├─ MENU.xml             # Menu configuration
├─ ACTOR_PROTOTYPES/    # Actor definitions per level
└─ Custom content       # Overrides/additions to CLAW.REZ
```

### Metadata Files

```
LEVEL_METADATA/ (Embedded in WASM)
├─ LEVEL1.XML           # Level 1 config (~10KB)
├─ LEVEL2.XML           # Level 2 config (~10KB)
└─ ... (13 files)
```

## Browser Console Verification

### Startup Logs

```
INFO: Loading critical assets (menu/UI)...
INFO: Critical assets loaded. Level assets will load on-demand.
INFO: Actor prototypes loaded successfully.
```

**Note:** No level metadata or level asset messages

### First Level Entry

```
INFO: Loading assets for LEVEL2...
INFO: Level assets loaded for LEVEL2
INFO: Requesting metadata for level 2
INFO: Lazy-loaded metadata for level 2
```

### Second Level Entry (Same Level)

```
INFO: Loading assets for LEVEL2...
INFO: Level assets loaded for LEVEL2
```

**Note:** No metadata messages (uses cache)

## Key Files

### Lazy Loading Implementation

- `OpenClaw/Engine/GameApp/BaseGameApp.cpp:173` - Startup (skips eager metadata load)
- `OpenClaw/Engine/GameApp/BaseGameApp.cpp:1356` - `LoadSingleLevelMetadata()`
- `OpenClaw/Engine/GameApp/BaseGameApp.cpp:1545` - `GetLevelMetadata()` (with lazy load)

### Resource Cache System

- `OpenClaw/Engine/GameApp/BaseGameApp.cpp:186-196` - VPreload calls (startup assets)
- Resource cache system (default 150 items, configurable in config.xml)

### Asset Loading Implementation

- `Build_Release/asset-loader.js` - IndexedDB bridge for CLAW.REZ
- `Build_Release/resource-loader.js` - Resource loading coordination

## Configuration

### config.xml Settings

```xml
<Display>
  <ResourceCacheSize>150</ResourceCacheSize>  <!-- Asset cache size -->
</Display>
```

Increase cache size for machines with more RAM to reduce asset reloading.

## Development Notes

### Testing Lazy Loading

1. Open browser console (F12)
2. Watch for startup logs (should see no level metadata)
3. Enter a level and verify lazy-load messages appear
4. Re-enter same level and verify no duplicate loads

### Reload Command

Console command `reload levelmetadata` reloads ALL metadata files (development feature):

```
> reload levelmetadata
```

Uses `ReadLevelMetadata()` to reload entire map.

### Adding New Levels

1. Create `LEVEL_METADATA/LEVEL{N}.XML` with required elements
2. Add level assets to CLAW.REZ under `/LEVEL{N}/*`
3. Lazy loading handles new level automatically

## Future Optimizations

Potential improvements for even better performance:

- [x] Compress metadata XMLs with gzip (✓ Implemented - 79% size reduction; this is the C++/`ASSETS.ZIP` metadata, unrelated to CLAW.REZ storage)
- [x] Store CLAW.REZ uncompressed (✓ removes the ~1.8s per-launch gzip decompression; biggest measured startup win)
- [ ] Preload next level's metadata while playing current level
- [ ] Implement progressive asset loading (low-res → high-res)
- [x] Add service worker for offline play (✓ Implemented - `sw.js` caches shell assets; bump `CACHE_VERSION` in `sw.js` whenever a file in `SHELL_ASSETS` changes)
- [ ] Tier the `CUSTOM_RESOURCE` wildcard preload (startup vs level-load vs on-demand) — ~400ms at startup

## References

- Emscripten Documentation: <https://emscripten.org/docs/>
- IndexedDB API: <https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API>
