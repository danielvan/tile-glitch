# Tile Glitch — WebGL Performance Refactor

**Date:** 2026-04-02
**Status:** Approved

## Problem

The app slows down severely at certain settings:

- **Generate freeze** — `selectWeightedTile()` iterates all tiles once per grid cell (O(n²)). With the large tileset (≈58k tiles) at scale 1x (32k grid cells), that's ~2 billion iterations per generate call.
- **Animation lag** — the animate loop calls `ctx.save()` / `ctx.clip()` / `ctx.restore()` for every tile every frame. At 32k tiles this collapses to single-digit FPS.
- **Slider lag** — no debouncing; every slider move triggers a full synchronous regenerate on the main thread.
- **findIndex O(n)** — neighbor-coherence logic calls `tiles.findIndex()` per cell, compounding the O(n²) problem.

## Solution

Replace the Canvas 2D render layer with WebGL instanced rendering. Fix the algorithmic bottlenecks. Move generation off the main thread. Add a live-preview toggle and FPS overlay.

## Architecture

Three focused layers, replacing the monolithic `App.jsx`:

### 1. Asset Layer — `useTileset` hook

Runs once at upload time (and when exclude-color changes).

- Slices all uploaded tilesets into 8×8 tiles
- Filters out excluded-color tiles (CPU, once, reuses a single OffscreenCanvas)
- Packs all tiles into a single `WebGLTexture` atlas
- Builds a `Float32Array` UV lookup table: for each tile index, stores `[u, v, uSize, vSize, imageIndex]`
- Computes prefix-sum array for O(1) weighted tile selection
- Builds a `Map<string, number>` for O(1) tile lookup by `"x,y,imageIndex"` key

Output: atlas texture, tile UV array, prefix-sum weights, tile map.

### 2. Generation Layer — `usePatternGenerator` hook + Web Worker

Runs when any control value changes (throttled to one frame ~16ms when live-preview is on; fires once on pointer-up when live-preview is off).

- Passes the tile UV array (as a Transferable `SharedArrayBuffer`) + all slider values to `patternWorker.js` via `postMessage` — no copy overhead
- The WebGL atlas texture stays on the main thread (requires a GL context); the worker only receives UV coordinates and tile metadata
- Worker runs the full grid generation loop (neighbor coherence, chaos, normalize, weighted selection, cycle mode) using the O(1) structures
- Returns a `Float32Array` of per-tile instance data: `[x, y, uvX, uvY, uvW, uvH, flip, opacity, maskRadius, phase, speed, direction]`
- No DOM or canvas access in the worker

Output: typed array of instance data, posted back to main thread.

### 3. Render Layer — `useWebGLRenderer` hook

Manages the WebGL context and draw loop.

- Initializes WebGL on mount: compiles shaders, creates VAO, instance buffer
- On new instance data: uploads to GPU via `gl.bufferData` (one upload per generate)
- Animation loop: updates a single `uTime` uniform each frame — no data re-upload
- Vertex shader: positions each tile quad using per-instance `x, y`
- Fragment shader: handles circular mask (discard pixels outside radius), per-tile opacity, horizontal flip — all GPU-side, zero `save/clip/restore`
- FPS overlay: a separate `<div>` overlaid on the canvas, updated once per second, visible only in dev mode (`import.meta.env.DEV`)

Uses **twgl.js** (~20kb) to reduce WebGL boilerplate.

## File Structure

```
src/
  App.jsx                  # state + control UI only, no render logic
  hooks/
    useTileset.js          # atlas packing, UV table, prefix sums, tile map
    usePatternGenerator.js # debounce, worker messaging, instance data
    useWebGLRenderer.js    # WebGL init, draw loop, FPS overlay
  workers/
    patternWorker.js       # pure generation — no DOM
  webgl/
    shaders.js             # GLSL vertex + fragment source strings
```

Unchanged: `src/index.css`, `src/App.css`, `src/main.jsx`, `vite.config.js`, `package.json` (twgl.js added as dependency).

## New UI

- **Live Preview toggle** — checkbox in the controls panel. When on: sliders update canvas in real-time (debounced 16ms). When off: canvas updates on slider mouse-up only. Default: on.
- **FPS overlay** — small counter in the top-right corner of the canvas, dev-only. Shows current animation FPS when `animateMasks` is enabled.

All existing controls remain unchanged in behavior and appearance.

## Performance Targets

| Scenario | Before | Target |
|---|---|---|
| Generate (both tilesets, scale 1x) | Multi-second freeze | < 200ms |
| Animation FPS (scale 1x, 50% circular masks) | ~5 fps | 60 fps |
| Slider live drag | Janky / freezes | Smooth |

## Testing

FPS overlay (dev-only) provides live feedback during manual testing. Assets for stress-testing: `imgs/1629.png` (≈58k tiles) and `imgs/2318.png` (~5.6k tiles).

No automated test runner. FPS is verified visually via the overlay.

## Dependencies Added

- `twgl.js` — thin WebGL helper, ~20kb minified

## Out of Scope

- Visual output changes
- New controls or features
- Mobile/touch support changes
- WebGPU
