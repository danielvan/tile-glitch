# Background Image + Mask Painting — Design Spec

**Date:** 2026-04-02
**Status:** Approved

## Goal

Add a persistent, paintable mask layer that reveals a user-uploaded background image through the tile grid. The mask survives regeneration and can be painted, erased, and reset interactively.

## Features

### 1. Background Image
- User uploads any image via a file input in the controls panel
- Image is displayed as a full-screen layer behind the tiles (letterboxed / cover-fit)
- A "Clear" button removes the background image
- Small thumbnail shown in the controls panel once loaded
- Works independently of the mask — if no mask is painted, background is hidden by tiles

### 2. Mask Layer
- A `Uint8Array` of `cols × rows` bytes — one byte per tile cell
  - `0` = tile visible (default)
  - `1` = tile masked (background shows through)
- Persists across regeneration — regenerating the tile pattern does not clear the mask
- Uploaded to the GPU as a 2D `R8` texture (`width=cols, height=rows`)
- Tile fragment shader samples the mask texture; if `mask > 0.5`, calls `discard` so the tile is transparent and the background image shows through
- When canvas size or scale changes (cols/rows change), the mask array is resized — existing mask data is preserved where possible by scaling the old mask to the new grid dimensions

### 3. Paint Interaction (`useMask` hook)
- Pointer events on the canvas (`pointerdown`, `pointermove`, `pointerup`)
- On drag: all tile cells within a square of radius `brushSize` tiles centred on the cursor are painted (in paint mode) or erased (in erase mode)
- Brush size: 1–10 tiles (radius), default 1
- Paint mode: sets cells to 1 (mask tile, reveal background)
- Erase mode: sets cells to 0 (unmask tile, restore tile)
- Mouse cursor changes to `crosshair` while hovering the canvas
- Brush preview: a faint white/grey square outline follows the cursor showing the brush footprint (rendered as a CSS overlay `<div>`, not WebGL)

### 4. Mask Reset
- "Reset Mask" button clears the entire `Uint8Array` to zeros
- No confirmation required

## Architecture

### New file: `src/hooks/useMask.js`
Owns:
- `maskArray: Uint8Array` (ref, not state — avoids re-renders on every stroke)
- `maskTexture: WebGLTexture` (ref)
- Pointer event handlers attached to the canvas element
- `resetMask()` function
- Returns: `{ maskTexture, resetMask, brushPreview }` where `brushPreview` is `{ col, row, size } | null`

### Modified: `src/hooks/useWebGLRenderer.js`
- Accepts `bgTexture` (background image WebGL texture, or null) and `maskTexture` as new params
- **Background pass:** when `bgTexture` is set, draw a full-screen quad with the background image before the tile pass (cover-fit via UV scaling in vertex shader)
- **Tile pass:** tile fragment shader now samples `uMask` texture; if mask value > 0.5, `discard`

### Modified: `src/webgl/shaders.js`
- Fragment shader gains `uniform sampler2D uMask` and `uniform bool uHasMask`
- Before any other fragment logic: `if (uHasMask && texture(uMask, vMaskCoord).r > 0.5) discard;`
- `vMaskCoord` is computed in the vertex shader as `vec2((col + 0.5) / cols, (row + 0.5) / rows)` — the normalised centre of the tile's grid cell, passed as a new per-instance attribute `aGridPos` (col/cols, row/rows)

### New file: `src/hooks/useBackgroundImage.js`
Owns:
- File input → `Image` → `WebGLTexture` upload
- Returns: `{ bgTexture, bgUrl, clearBackground }`

### Modified: `src/App.jsx`
- Wires `useMask`, `useBackgroundImage`
- Passes `bgTexture`, `maskTexture` to `useWebGLRenderer`
- Adds new controls: background upload, mask section (paint/erase toggle, brush size, reset)
- Light UI modernization: Inter/system-ui font, grouped sections, consistent spacing

### Modified: `src/App.css`
- CSS custom properties for colors, spacing
- Section grouping styles
- Paint/erase toggle button styles
- Brush preview overlay style

## UI Controls Layout

```
▲ [minimize]

── Tilesets ──────────────────
  [Upload Tileset(s)]
  Tileset 1  [x]   Weight: 50%
  Tileset 2  [x]   Weight: 50%

── Generation ────────────────
  Chaos        ●──── 50%
  Connection   ──●── 50%
  Scale        ●──── 1x
  Normalize    ──●── 50%
  Circular Mask ●─── 0%
  [ ] Animate Masks
  Disappear    ●──── 0%
  [ ] Cycle All Tiles

── Colors ────────────────────
  Background Color  [■]
  Exclude Color     [■] [Clear]

── Background Image ──────────
  [Upload Image]  [thumbnail]  [Clear]

── Mask ──────────────────────
  [ Paint ]  [ Erase ]
  Brush Size  ●──── 1
  [Reset Mask]

─────────────────────────────
  [ ] Live Preview
  [🎲 Regenerate]
  [💾 Export PNG]
  📊 N tiles loaded
```

## Brush Preview Overlay

A `<div>` absolutely positioned over the canvas, `pointer-events: none`. When hovering:
- Position: `left = col * scaledTileSize`, `top = row * scaledTileSize`
- Size: `(brushSize * 2 + 1) * scaledTileSize` square
- Style: `1px solid rgba(255,255,255,0.5)`, `background: transparent`
- Hidden when not hovering canvas or when no tilesets loaded

## Mask Texture Upload

On every stroke end (`pointerup`) and on `resetMask`:
- `gl.bindTexture(gl.TEXTURE_2D, maskTexture)`
- `gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, cols, rows, 0, gl.RED, gl.UNSIGNED_BYTE, maskArray)`

On stroke during drag (`pointermove`), upload only the dirty region (bounding box of current brush) for performance:
- `gl.texSubImage2D(...)` with the brush bounding box

## Background Image Draw Pass

Before the tile draw call:
1. `gl.useProgram(bgProgramInfo.program)`
2. Draw a full-screen quad (-1 to 1 clip space)
3. Fragment shader samples `uBgImage` and outputs the color
4. UV scaling: `cover` fit — scale UVs so the image fills the canvas without distortion

The background program uses its own simple pair of shaders (separate from the tile shaders).

## Resize Behaviour

When `cols` or `rows` changes (scale change or window resize):
- Create new `Uint8Array(newCols * newRows)` filled with zeros
- Copy old mask data scaled to new grid: for each new cell `(c, r)`, sample the old mask at `(c/newCols * oldCols, r/newRows * oldRows)` — nearest-neighbour
- Upload new texture

## Out of Scope

- Soft/feathered brush edges
- Freehand (sub-tile) painting
- Saving/loading the mask
- Undo/redo
- Deep UI redesign (noted for a later pass)
