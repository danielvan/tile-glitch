# Tile Glitch — Project Instructions

## About This Project

A React + Vite canvas-based tile glitch generator. Upload NES-style tilesets (8×8 px tiles), fill the screen with randomized/patterned tiles, tweak with sliders. Aimed at generative art / visual design use.

**Stack:** React 19, Vite 7, Canvas (being refactored to WebGL via twgl.js)

## Current Work

A WebGL performance refactor is in progress. Spec at:
`docs/superpowers/specs/2026-04-02-webgl-refactor-design.md`

Key goals:
- Replace Canvas 2D render loop with WebGL instanced rendering (twgl.js)
- Fix O(n²) tile selection → O(1) via prefix sums
- Fix O(n) `findIndex` → O(1) via Map lookup
- Move pattern generation to a Web Worker
- Add live-preview toggle (real-time vs mouse-up) and dev-only FPS overlay

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
