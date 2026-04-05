# Tile Glitch — Project Instructions

## About This Project

A React + Vite canvas-based tile glitch generator. Upload NES-style tilesets (8×8 px tiles), fill the screen with randomized/patterned tiles, tweak with sliders. Aimed at generative art / visual design use.

**Stack:** React 19, Vite 7, WebGL (twgl.js) — Canvas 2D refactor is complete

## What's Shipped (as of 2026-04-05)

The WebGL refactor is done and on `main`. Current features:
- WebGL instanced rendering via twgl.js (O(1) tile selection, prefix sums)
- Pattern generation in a Web Worker
- CRT post-processing effects (chroma, scanlines, barrel, vignette, grain, CRT mask)
- Background image layer
- Paint/erase mask with undo/redo
- Tile exclusion by colour (per-tileset)
- Live preview toggle + seed lock
- Auto-save all settings + tilesets + background to localStorage
- PNG export of current canvas

Git tags: `v1` (WebGL MVP), `v2`, `v3-undo-redo`, `v4-exclude-colors`, `v5-crt-effects`, `v6-feature-roadmap`

## Next Up — Feature Roadmap

Plan at `docs/superpowers/plans/2026-04-05-feature-roadmap.md`.

Phases in order:
1. **JSON preset export/import** — download/upload all settings as `.json` (filenames only, not base64 images)
2. **Docked side panel** — controls beside canvas instead of floating overlay; canvas resizes to compensate
3. **Canvas zoom** — Cmd+scroll to zoom display (CSS transform, no re-render)
4. **Aspect ratio / poster mode** — lock canvas to 1:1, 4:3, 16:9, 9:16, etc.
5. **Print-quality export** — 1×/2×/4×/8× nearest-neighbor upscaling on export

## File Structure (post-refactor)

```
src/
  App.jsx                  # state + UI only
  hooks/
    useTileset.js          # atlas packing, UV table, prefix sums
    usePatternGenerator.js # debounce, worker messaging
    useWebGLRenderer.js    # WebGL draw loop, FPS overlay
  workers/
    patternWorker.js       # pure generation logic, no DOM
  webgl/
    shaders.js             # GLSL vertex + fragment shaders
```

## Test Assets

Located at `imgs/1629.png` (≈58k tiles) and `imgs/2318.png` (~5.6k tiles). Use both for stress testing. Scale 1x with both loaded is worst-case.

## Performance Targets

| Scenario | Target |
|---|---|
| Generate (both tilesets, scale 1x) | < 200ms |
| Animation FPS (scale 1x, 50% circular masks) | 60 fps |
| Slider live drag | Smooth |

## Conventions

- No new dependencies without discussion — keep the bundle lean
- Don't add comments unless logic is non-obvious
- Don't add error handling for impossible cases
- Prefer editing existing files over creating new ones
- Visual output must stay identical after refactor — it's the product

## Editor

Zed (`zed .` from terminal)
