# Background Image + Mask Painting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, paintable mask layer that reveals a user-uploaded background image through the tile grid, with paint/erase modes, adjustable brush size, and a reset button.

**Architecture:** Extend the per-instance buffer from 16 to 18 floats by appending normalized grid coordinates (col/cols, row/rows) per tile. The tile fragment shader uses these to sample a new R8 mask texture — if mask > 0.5, `discard` makes the tile transparent so the background shows through. A separate, simple WebGL program renders the background image as a full-screen quad before the tile pass, with cover-fit UV scaling computed on the CPU. `useMask` owns the mask array, GPU texture, and all pointer event painting. `useBackgroundImage` owns file-to-image loading. `useWebGLRenderer` gains a background draw pass and reads both new textures.

**Tech Stack:** WebGL 2, GLSL 300 es, React hooks, twgl.js

---

## File Map

| File | Change |
|------|--------|
| `src/webgl/constants.js` | Add `I_GRID_U=16`, `I_GRID_V=17`, `FLOATS_PER_INSTANCE=18` |
| `src/webgl/shaders.js` | Add `aGridPos`/`vMaskCoord` to tile shaders; export `BG_VERTEX_SHADER`, `BG_FRAGMENT_SHADER` |
| `src/workers/patternWorker.js` | Write `I_GRID_U`/`I_GRID_V` per instance in `generate()` |
| `src/hooks/useBackgroundImage.js` | **New.** File input → `HTMLImageElement` state |
| `src/hooks/useMask.js` | **New.** Mask array + R8 GPU texture + pointer event painting |
| `src/hooks/useWebGLRenderer.js` | Background draw pass, mask texture uniforms, `aGridPos` VAO attribute |
| `src/App.jsx` | Wire new hooks; add Background Image + Mask UI sections; brush preview div |
| `src/App.css` | Section dividers, paint/erase toggle styles, brush preview overlay, Inter font |

---

### Task 1: Extend instance buffer layout

**Files:**
- Modify: `src/webgl/constants.js`

- [ ] **Step 1: Update the file**

Replace the entire file with:

```js
// src/webgl/constants.js
export const TILE_SIZE = 8;

// Number of floats per tile instance in the instance buffer
export const FLOATS_PER_INSTANCE = 18;

// Float indices into each instance's data (multiply by 4 for byte offset)
export const I_POS_X      = 0;
export const I_POS_Y      = 1;
export const I_UV_X       = 2;
export const I_UV_Y       = 3;
export const I_UV_W       = 4;
export const I_UV_H       = 5;
export const I_FLIP       = 6;
export const I_OPACITY    = 7;
export const I_CIRCULAR   = 8;
export const I_PHASE      = 9;
export const I_SPEED      = 10;
export const I_DIRECTION  = 11;
export const I_COLOR_R    = 12;
export const I_COLOR_G    = 13;
export const I_COLOR_B    = 14;
export const I_COLOR_A    = 15;
export const I_GRID_U     = 16;  // col / cols  (normalized 0..1)
export const I_GRID_V     = 17;  // row / rows  (normalized 0..1)
```

- [ ] **Step 2: Verify**

Run `npm run dev`. The page should load normally (stride increase takes effect silently — the renderer reads `FLOATS_PER_INSTANCE` from this file). Tile rendering will break until Task 3 writes the new floats, but that's expected — any blank or shifted rendering after this step is OK.

- [ ] **Step 3: Commit**

```bash
git add src/webgl/constants.js
git commit -m "feat: extend instance buffer to 18 floats — add I_GRID_U/I_GRID_V"
```

---

### Task 2: Update shaders — mask support in tile shaders + new BG shaders

**Files:**
- Modify: `src/webgl/shaders.js`

- [ ] **Step 1: Update the file**

Replace the entire file with:

```js
// src/webgl/shaders.js

export const VERTEX_SHADER = `#version 300 es

// Base quad geometry: 6 vertices, positions in [-0.5, 0.5]
in vec2 aQuadPos;

// Per-instance attributes (divisor = 1)
in vec2  aPos;        // top-left corner in canvas pixels
in vec4  aUV;         // uvX, uvY, uvW, uvH in atlas (0-1)
in float aFlip;       // 0 = normal, 1 = horizontal flip
in float aOpacity;    // 0.0 to 1.0 (0 = disappeared tile)
in float aCircular;   // 0 = no mask, 1 = circular mask
in float aPhase;      // random starting phase for animation
in float aSpeed;      // animation speed multiplier (0.5 - 2.5)
in float aDirection;  // 1.0 or -1.0 (oscillation direction)
in vec4  aColor;      // r, g, b, a chaos tint overlay
in vec2  aGridPos;    // normalized grid coords: (col/cols, row/rows)

uniform vec2  uCanvasSize;
uniform float uTileSize;  // TILE_SIZE * scale in pixels

out vec2  vTexCoord;
out float vOpacity;
out float vCircular;
out float vPhase;
out float vSpeed;
out float vDirection;
out vec2  vLocalPos;   // [-0.5, 0.5] used for circular mask distance
out vec4  vColor;
out vec2  vMaskCoord;  // UV into mask texture (centre of tile cell)

void main() {
  // Position this vertex in canvas pixel space
  vec2 pixelPos = aPos + (aQuadPos + 0.5) * uTileSize;

  // Convert to WebGL clip space [-1, 1], flip Y axis
  vec2 clip = (pixelPos / uCanvasSize) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);

  // UV: flip horizontally by mirroring the x offset around center
  float ux = aFlip > 0.5
    ? aUV.x + (0.5 - aQuadPos.x) * aUV.z
    : aUV.x + (aQuadPos.x + 0.5) * aUV.z;
  float uy = aUV.y + (aQuadPos.y + 0.5) * aUV.w;
  vTexCoord  = vec2(ux, uy);

  vOpacity   = aOpacity;
  vCircular  = aCircular;
  vPhase     = aPhase;
  vSpeed     = aSpeed;
  vDirection = aDirection;
  vLocalPos  = aQuadPos;
  vColor     = aColor;
  vMaskCoord = aGridPos;
}`;

export const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

uniform sampler2D uAtlas;
uniform sampler2D uMask;
uniform bool      uHasMask;
uniform float     uTime;       // rAF timestamp in ms
uniform float     uBaseSpeed;  // (animationSpeed / 1000) * 0.1
uniform bool      uAnimate;    // animateMasks toggle

in vec2  vTexCoord;
in float vOpacity;
in float vCircular;
in float vPhase;
in float vSpeed;
in float vDirection;
in vec2  vLocalPos;
in vec4  vColor;
in vec2  vMaskCoord;

out vec4 fragColor;

void main() {
  // Mask: tile is transparent so background shows through
  if (uHasMask && texture(uMask, vMaskCoord).r > 0.5) discard;

  // Skip fully transparent tiles (disappeared)
  if (vOpacity < 0.01) discard;

  vec4 color = texture(uAtlas, vTexCoord);

  // Apply chaos tint overlay
  if (vColor.a > 0.01) {
    color.rgb = mix(color.rgb, vColor.rgb, vColor.a);
  }

  float alpha = vOpacity;

  if (uAnimate) {
    // Replicates original: time = (timestamp * baseSpeed * speed + phase) * direction
    float t = (uTime * uBaseSpeed * vSpeed + vPhase) * vDirection;

    if (vCircular > 0.5) {
      // Circular mask: radius oscillates 0 → 0.5 (half tile width)
      float scale01 = (sin(t) + 1.0) / 2.0;
      float radius  = scale01 * 0.5;
      if (length(vLocalPos) > radius) discard;
    } else {
      // Opacity oscillates 0 → 1
      alpha *= (sin(t) + 1.0) / 2.0;
    }
  } else if (vCircular > 0.5) {
    // Static circular mask: hard clip at 0.5 radius
    if (length(vLocalPos) > 0.5) discard;
  }

  fragColor = vec4(color.rgb, color.a * alpha);
}`;

// Background image shaders — simple full-screen quad with cover-fit UV
export const BG_VERTEX_SHADER = `#version 300 es

in vec2 aPos;  // clip-space quad: [-1, 1]

uniform vec2 uBgUVScale;   // cover-fit scale
uniform vec2 uBgUVOffset;  // cover-fit offset

out vec2 vUV;

void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
  // aPos.y=1 is top in clip space → UV.y=0 (top of image)
  vec2 uv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  vUV = uv * uBgUVScale + uBgUVOffset;
}`;

export const BG_FRAGMENT_SHADER = `#version 300 es
precision mediump float;

uniform sampler2D uBgImage;

in vec2 vUV;
out vec4 fragColor;

void main() {
  fragColor = texture(uBgImage, vUV);
}`;
```

- [ ] **Step 2: Verify**

`npm run dev`. Tiles should render (though possibly broken due to stride mismatch until Task 3). No shader compile errors in console — check the browser's dev tools console for WebGL errors.

- [ ] **Step 3: Commit**

```bash
git add src/webgl/shaders.js
git commit -m "feat: add mask + bg shaders — aGridPos, vMaskCoord, uHasMask, uMask, BG program"
```

---

### Task 3: Write grid UVs in the pattern worker

**Files:**
- Modify: `src/workers/patternWorker.js`

- [ ] **Step 1: Add I_GRID_U / I_GRID_V imports and writes**

In `patternWorker.js`, update the import line at the top:

```js
import {
  TILE_SIZE,
  FLOATS_PER_INSTANCE,
  I_POS_X, I_POS_Y,
  I_UV_X, I_UV_Y, I_UV_W, I_UV_H,
  I_FLIP, I_OPACITY, I_CIRCULAR,
  I_PHASE, I_SPEED, I_DIRECTION,
  I_COLOR_R, I_COLOR_G, I_COLOR_B, I_COLOR_A,
  I_GRID_U, I_GRID_V,
} from '../webgl/constants.js';
```

Then, inside the `generate` function, immediately after the `I_COLOR_A` block (after the chaos effects, before the closing of the `for col` loop), add:

```js
      // Normalized grid position for mask texture sampling
      instanceData[offset + I_GRID_U] = (col + 0.5) / cols;
      instanceData[offset + I_GRID_V] = (row + 0.5) / rows;
```

The exact location is just before the closing `}` of the inner `for (let col = 0; col < cols; col++)` loop. The final block of the loop body should look like:

```js
      if (!disappeared && Math.random() * 100 < chaos / 2) {
        const effect = Math.floor(Math.random() * 3);
        if (effect === 0) {
          instanceData[offset + I_FLIP] = 1;
        } else if (effect === 1) {
          instanceData[offset + I_COLOR_R] = Math.random();
          instanceData[offset + I_COLOR_G] = Math.random();
          instanceData[offset + I_COLOR_B] = Math.random();
          instanceData[offset + I_COLOR_A] = 0.3;
        }
        // effect 2: no visual (matches original)
      }

      // Normalized grid position for mask texture sampling
      instanceData[offset + I_GRID_U] = (col + 0.5) / cols;
      instanceData[offset + I_GRID_V] = (row + 0.5) / rows;
    }
  }
```

- [ ] **Step 2: Verify**

`npm run dev`. Tiles should render correctly again (stride is now consistent between worker output and VAO). Visually, the output should look identical to before — the grid UVs are written but the mask is not yet active.

- [ ] **Step 3: Commit**

```bash
git add src/workers/patternWorker.js
git commit -m "feat: write I_GRID_U/I_GRID_V per instance in pattern worker"
```

---

### Task 4: Create useBackgroundImage hook

**Files:**
- Create: `src/hooks/useBackgroundImage.js`

- [ ] **Step 1: Write the file**

```js
// src/hooks/useBackgroundImage.js
import { useState, useCallback } from 'react';

/**
 * Manages a user-uploaded background image.
 *
 * Returns:
 *   bgImage:          HTMLImageElement | null
 *   bgUrl:            string | null  (object URL, for thumbnail <img>)
 *   handleBgUpload:   (e: InputEvent) => void
 *   clearBackground:  () => void
 */
export function useBackgroundImage() {
  const [bgImage, setBgImage] = useState(null);
  const [bgUrl,   setBgUrl]   = useState(null);

  const handleBgUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setBgImage(img);
      setBgUrl(url);
    };
    img.src = url;
  }, []);

  const clearBackground = useCallback(() => {
    setBgImage(null);
    setBgUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  return { bgImage, bgUrl, handleBgUpload, clearBackground };
}
```

- [ ] **Step 2: Verify**

No visual change yet — this hook isn't wired into anything until Task 7. Just confirm `npm run dev` still compiles without errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useBackgroundImage.js
git commit -m "feat: add useBackgroundImage hook — file upload to HTMLImageElement"
```

---

### Task 5: Create useMask hook

**Files:**
- Create: `src/hooks/useMask.js`

- [ ] **Step 1: Write the file**

```js
// src/hooks/useMask.js
import { useRef, useState, useCallback, useEffect } from 'react';

/**
 * Owns the paintable tile mask.
 *
 * @param canvasRef      - ref to the WebGL <canvas>
 * @param cols           - number of tile columns
 * @param rows           - number of tile rows
 * @param scaledTileSize - tile size in CSS pixels (TILE_SIZE * scale)
 * @param paintMode      - 'paint' | 'erase'
 * @param brushSize      - radius in tiles (1–10)
 *
 * Returns:
 *   maskTextureRef  - React ref holding WebGLTexture | null
 *   maskVersion     - increments after every GPU upload (use as render trigger)
 *   resetMask       - () => void
 *   brushPreview    - { col, row, size } | null  (cursor tile + radius)
 */
export function useMask(canvasRef, cols, rows, scaledTileSize, paintMode, brushSize) {
  const maskArrayRef   = useRef(null);   // Uint8Array, cols × rows
  const maskTextureRef = useRef(null);   // WebGLTexture
  const oldDimsRef     = useRef(null);   // { cols, rows } from previous allocation
  const isPaintingRef  = useRef(false);

  const [maskVersion,   setMaskVersion]   = useState(0);
  const [brushPreview,  setBrushPreview]  = useState(null);

  // Upload the full mask array to the GPU
  const uploadMask = useCallback(() => {
    const gl = canvasRef.current?.getContext('webgl2');
    if (!gl || !maskArrayRef.current || !maskTextureRef.current) return;
    const { cols: c, rows: r } = oldDimsRef.current;
    gl.bindTexture(gl.TEXTURE_2D, maskTextureRef.current);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, c, r, 0, gl.RED, gl.UNSIGNED_BYTE, maskArrayRef.current);
    setMaskVersion(v => v + 1);
  }, [canvasRef]);

  // Allocate / resize mask array and create/update GPU texture
  useEffect(() => {
    if (!cols || !rows) return;
    const gl = canvasRef.current?.getContext('webgl2');
    if (!gl) return;

    const newMask = new Uint8Array(cols * rows);

    // Nearest-neighbour scale of old mask data into new grid
    if (maskArrayRef.current && oldDimsRef.current) {
      const { cols: oc, rows: or } = oldDimsRef.current;
      const old = maskArrayRef.current;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const sc = Math.min(Math.round(c / cols * oc), oc - 1);
          const sr = Math.min(Math.round(r / rows * or), or - 1);
          newMask[r * cols + c] = old[sr * oc + sc];
        }
      }
    }

    maskArrayRef.current = newMask;
    oldDimsRef.current   = { cols, rows };

    // Create texture on first call, reuse thereafter
    if (!maskTextureRef.current) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      maskTextureRef.current = tex;
    }

    gl.bindTexture(gl.TEXTURE_2D, maskTextureRef.current);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, cols, rows, 0, gl.RED, gl.UNSIGNED_BYTE, newMask);
    setMaskVersion(v => v + 1);
  }, [canvasRef, cols, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Paint cells at (clientX, clientY) according to current mode and brush
  const paintAt = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas || !maskArrayRef.current || !oldDimsRef.current) return;

    const rect  = canvas.getBoundingClientRect();
    const x     = clientX - rect.left;
    const y     = clientY - rect.top;
    const tileCol = Math.floor(x / scaledTileSize);
    const tileRow = Math.floor(y / scaledTileSize);
    const { cols: c, rows: r } = oldDimsRef.current;
    const value = paintMode === 'paint' ? 1 : 0;

    let changed = false;
    for (let dr = -brushSize; dr <= brushSize; dr++) {
      for (let dc = -brushSize; dc <= brushSize; dc++) {
        const cc = tileCol + dc;
        const rr = tileRow + dr;
        if (cc >= 0 && cc < c && rr >= 0 && rr < r) {
          maskArrayRef.current[rr * c + cc] = value;
          changed = true;
        }
      }
    }
    if (changed) uploadMask();
  }, [canvasRef, scaledTileSize, paintMode, brushSize, uploadMask]);

  // Pointer events: paint on drag, update brush preview
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onPointerDown = (e) => {
      isPaintingRef.current = true;
      canvas.setPointerCapture(e.pointerId);
      paintAt(e.clientX, e.clientY);
    };

    const onPointerMove = (e) => {
      const rect    = canvas.getBoundingClientRect();
      const col     = Math.floor((e.clientX - rect.left) / scaledTileSize);
      const row     = Math.floor((e.clientY - rect.top)  / scaledTileSize);
      setBrushPreview({ col, row, size: brushSize });

      if (isPaintingRef.current) paintAt(e.clientX, e.clientY);
    };

    const onPointerUp = () => {
      isPaintingRef.current = false;
    };

    const onPointerLeave = () => {
      setBrushPreview(null);
      isPaintingRef.current = false;
    };

    canvas.addEventListener('pointerdown',  onPointerDown);
    canvas.addEventListener('pointermove',  onPointerMove);
    canvas.addEventListener('pointerup',    onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);

    return () => {
      canvas.removeEventListener('pointerdown',  onPointerDown);
      canvas.removeEventListener('pointermove',  onPointerMove);
      canvas.removeEventListener('pointerup',    onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [canvasRef, scaledTileSize, paintMode, brushSize, paintAt]);

  const resetMask = useCallback(() => {
    if (!maskArrayRef.current) return;
    maskArrayRef.current.fill(0);
    uploadMask();
  }, [uploadMask]);

  return { maskTextureRef, maskVersion, resetMask, brushPreview };
}
```

- [ ] **Step 2: Verify**

`npm run dev`. No visual change yet. Check the browser console — no import errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useMask.js
git commit -m "feat: add useMask hook — R8 GPU texture, pointer painting, brush preview"
```

---

### Task 6: Update useWebGLRenderer — background pass + mask + aGridPos

**Files:**
- Modify: `src/hooks/useWebGLRenderer.js`

- [ ] **Step 1: Write the updated file**

This is a full replacement of the file. Key changes:
- Import `BG_VERTEX_SHADER`, `BG_FRAGMENT_SHADER` from shaders
- Add refs: `bgProgramInfoRef`, `bgVaoRef`, `bgTexRef`, `dummyMaskTexRef`
- Second initialization effect (runs once) sets up BG program + VAO
- New effect uploads `bgImage` → WebGL texture when bgImage changes
- Draw loop: runs bg pass first (if bgTex exists), then tile pass with mask uniforms
- Add `aGridPos` instance attribute to tile VAO
- Add `maskVersion` and `bgImage` to draw effect dependencies

```js
import { useEffect, useRef, useState } from 'react';
import * as twgl from 'twgl.js';
import { VERTEX_SHADER, FRAGMENT_SHADER, BG_VERTEX_SHADER, BG_FRAGMENT_SHADER } from '../webgl/shaders.js';
import { FLOATS_PER_INSTANCE, TILE_SIZE } from '../webgl/constants.js';

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Compute UV scale + offset for cover-fit of an image in a canvas
function computeCoverUVs(canvasW, canvasH, imgW, imgH) {
  const ca = canvasW / canvasH;
  const ia = imgW   / imgH;
  let scaleU, scaleV, offsetU, offsetV;
  if (ca > ia) {
    // canvas wider → scale image to fill width, crop height
    scaleU = 1.0;       scaleV  = ia / ca;
    offsetU = 0.0;      offsetV = (1.0 - scaleV)  / 2.0;
  } else {
    // canvas taller (or equal) → scale image to fill height, crop width
    scaleU = ca / ia;   scaleV  = 1.0;
    offsetU = (1.0 - scaleU) / 2.0;  offsetV = 0.0;
  }
  return [scaleU, scaleV, offsetU, offsetV];
}

/**
 * Manages the WebGL 2 render loop.
 *
 * @param canvasRef       - ref to the <canvas> element
 * @param atlasData       - from useTileset (provides atlasCanvas)
 * @param instanceData    - Float32Array from usePatternGenerator
 * @param renderSettings  - {
 *   backgroundColor, scale, canvasSize, animateMasks, animationSpeed,
 *   bgImage,         // HTMLImageElement | null
 *   maskTextureRef,  // React ref holding WebGLTexture | null
 *   maskVersion,     // number — increments when mask GPU data changes
 * }
 *
 * Returns fps: number | null (null when animation is off)
 */
export function useWebGLRenderer(canvasRef, atlasData, instanceData, renderSettings) {
  const {
    backgroundColor, scale, canvasSize, animateMasks, animationSpeed,
    bgImage, maskTextureRef, maskVersion,
  } = renderSettings;

  const glRef              = useRef(null);
  const programInfoRef     = useRef(null);
  const vaoRef             = useRef(null);
  const instanceBufRef     = useRef(null);
  const atlasTexRef        = useRef(null);
  const dummyMaskTexRef    = useRef(null);  // 1×1 R8 black, used when no mask
  const bgProgramInfoRef   = useRef(null);
  const bgVaoRef           = useRef(null);
  const bgTexRef           = useRef(null);
  const instanceCountRef   = useRef(0);
  const rafRef             = useRef(null);
  const [fps, setFps]      = useState(null);

  // --- Initialize tile WebGL program + VAO once ---
  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) { console.error('WebGL 2 not supported'); return; }
    glRef.current = gl;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // --- Tile program ---
    const programInfo = twgl.createProgramInfo(gl, [VERTEX_SHADER, FRAGMENT_SHADER]);
    programInfoRef.current = programInfo;
    const prog = programInfo.program;

    // Quad geometry
    const quadVerts = new Float32Array([
      -0.5, -0.5,  0.5, -0.5, -0.5,  0.5,
      -0.5,  0.5,  0.5, -0.5,  0.5,  0.5,
    ]);
    const quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

    // Instance buffer
    const instBuf = gl.createBuffer();
    instanceBufRef.current = instBuf;

    // Tile VAO
    const vao = gl.createVertexArray();
    vaoRef.current = vao;
    gl.bindVertexArray(vao);

    const quadPosLoc = gl.getAttribLocation(prog, 'aQuadPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(quadPosLoc);
    gl.vertexAttribPointer(quadPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(quadPosLoc, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    const stride = FLOATS_PER_INSTANCE * 4;  // 72 bytes

    const instAttr = (name, size, floatOffset) => {
      const loc = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, floatOffset * 4);
      gl.vertexAttribDivisor(loc, 1);
    };

    instAttr('aPos',       2,  0);
    instAttr('aUV',        4,  2);
    instAttr('aFlip',      1,  6);
    instAttr('aOpacity',   1,  7);
    instAttr('aCircular',  1,  8);
    instAttr('aPhase',     1,  9);
    instAttr('aSpeed',     1, 10);
    instAttr('aDirection', 1, 11);
    instAttr('aColor',     4, 12);
    instAttr('aGridPos',   2, 16);

    gl.bindVertexArray(null);

    // Dummy 1×1 R8 mask texture (used when uHasMask=false)
    const dummyTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, dummyTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    dummyMaskTexRef.current = dummyTex;

    // --- BG program ---
    const bgProgramInfo = twgl.createProgramInfo(gl, [BG_VERTEX_SHADER, BG_FRAGMENT_SHADER]);
    bgProgramInfoRef.current = bgProgramInfo;

    const bgQuadVerts = new Float32Array([
      -1, -1,  1, -1, -1,  1,
      -1,  1,  1, -1,  1,  1,
    ]);
    const bgQuadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bgQuadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, bgQuadVerts, gl.STATIC_DRAW);

    const bgVao = gl.createVertexArray();
    bgVaoRef.current = bgVao;
    gl.bindVertexArray(bgVao);

    const bgPosLoc = gl.getAttribLocation(bgProgramInfo.program, 'aPos');
    gl.enableVertexAttribArray(bgPosLoc);
    gl.vertexAttribPointer(bgPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(bgPosLoc, 0);

    gl.bindVertexArray(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Upload atlas texture when atlasData changes ---
  useEffect(() => {
    const gl = glRef.current;
    if (!gl || !atlasData) return;
    if (atlasTexRef.current) gl.deleteTexture(atlasTexRef.current);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasData.atlasCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    atlasTexRef.current = tex;
  }, [atlasData]);

  // --- Upload background image texture when bgImage changes ---
  useEffect(() => {
    const gl = glRef.current;
    if (bgTexRef.current) { gl?.deleteTexture(bgTexRef.current); bgTexRef.current = null; }
    if (!gl || !bgImage) return;

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bgImage);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    bgTexRef.current = tex;
  }, [bgImage]);

  // --- Upload instance data when it changes ---
  useEffect(() => {
    const gl = glRef.current;
    if (!gl || !instanceData) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBufRef.current);
    gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.DYNAMIC_DRAW);
    instanceCountRef.current = instanceData.length / FLOATS_PER_INSTANCE;
  }, [instanceData]);

  // --- Draw loop ---
  useEffect(() => {
    const gl = glRef.current;
    if (!gl || !programInfoRef.current) return;

    const draw = (timestamp) => {
      const [r, g, b] = hexToRgb(backgroundColor);
      gl.clearColor(r / 255, g / 255, b / 255, 1);
      gl.viewport(0, 0, canvasSize.width, canvasSize.height);
      gl.clear(gl.COLOR_BUFFER_BIT);

      // --- Background pass ---
      if (bgTexRef.current && bgProgramInfoRef.current && bgImage) {
        gl.useProgram(bgProgramInfoRef.current.program);
        const [su, sv, ou, ov] = computeCoverUVs(
          canvasSize.width, canvasSize.height,
          bgImage.width, bgImage.height
        );
        twgl.setUniforms(bgProgramInfoRef.current, {
          uBgImage:    bgTexRef.current,
          uBgUVScale:  [su, sv],
          uBgUVOffset: [ou, ov],
        });
        gl.bindVertexArray(bgVaoRef.current);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindVertexArray(null);
      }

      if (!atlasTexRef.current || instanceCountRef.current === 0) return;

      // --- Tile pass ---
      const activeMaskTex = maskTextureRef?.current ?? dummyMaskTexRef.current;
      const hasMask       = !!(maskTextureRef?.current);

      gl.useProgram(programInfoRef.current.program);
      twgl.setUniforms(programInfoRef.current, {
        uCanvasSize: [canvasSize.width, canvasSize.height],
        uTileSize:   TILE_SIZE * scale,
        uAtlas:      atlasTexRef.current,
        uMask:       activeMaskTex,
        uHasMask:    hasMask,
        uTime:       timestamp ?? 0,
        uBaseSpeed:  (animationSpeed / 1000) * 0.1,
        uAnimate:    animateMasks,
      });

      gl.bindVertexArray(vaoRef.current);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instanceCountRef.current);
      gl.bindVertexArray(null);
    };

    if (!animateMasks) {
      draw(0);
      setFps(null);
      return;
    }

    let frameCount  = 0;
    let lastFpsTime = performance.now();

    const loop = (timestamp) => {
      draw(timestamp);
      frameCount++;
      const now = performance.now();
      if (now - lastFpsTime >= 1000) {
        setFps(frameCount);
        frameCount  = 0;
        lastFpsTime = now;
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [animateMasks, animationSpeed, backgroundColor, canvasSize, scale,
      instanceData, bgImage, maskVersion, maskTextureRef]);
      // maskVersion triggers a static redraw when mask changes (painting)

  return fps;
}
```

- [ ] **Step 2: Verify**

`npm run dev`. Load a tileset — tiles should render exactly as before. No console errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useWebGLRenderer.js
git commit -m "feat: useWebGLRenderer — bg draw pass, mask texture uniforms, aGridPos VAO attr"
```

---

### Task 7: Wire everything in App.jsx + App.css

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/App.css`

- [ ] **Step 1: Update App.jsx**

Replace the entire file with:

```jsx
// src/App.jsx
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import './App.css';
import { useTileset }           from './hooks/useTileset.js';
import { usePatternGenerator }  from './hooks/usePatternGenerator.js';
import { useWebGLRenderer }     from './hooks/useWebGLRenderer.js';
import { useBackgroundImage }   from './hooks/useBackgroundImage.js';
import { useMask }              from './hooks/useMask.js';
import { TILE_SIZE }            from './webgl/constants.js';

function App() {
  const [tilesets, setTilesets]                     = useState([]);
  const [canvasSize, setCanvasSize]                 = useState({ width: window.innerWidth, height: window.innerHeight });
  const [chaos, setChaos]                           = useState(50);
  const [coherence, setCoherence]                   = useState(50);
  const [normalize, setNormalize]                   = useState(50);
  const [scale, setScale]                           = useState(1);
  const [excludeColor, setExcludeColor]             = useState('');
  const [tilesetWeights, setTilesetWeights]         = useState({});
  const [cycleTiles, setCycleTiles]                 = useState(false);
  const [circularMaskChance, setCircularMaskChance] = useState(0);
  const [disappearChance, setDisappearChance]       = useState(0);
  const [backgroundColor, setBackgroundColor]       = useState('#000000');
  const [animateMasks, setAnimateMasks]             = useState(false);
  const [animationSpeed, setAnimationSpeed]         = useState(50);
  const [minimizeUI, setMinimizeUI]                 = useState(false);
  const [livePreview, setLivePreview]               = useState(true);
  const [paintMode, setPaintMode]                   = useState('paint');   // 'paint' | 'erase'
  const [brushSize, setBrushSize]                   = useState(1);

  const canvasRef = useRef(null);

  useEffect(() => {
    const onResize = () => setCanvasSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    files.forEach((file, index) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const newId = Date.now() + index;
          setTilesets(prev => [...prev, { id: newId, url: event.target.result, img }]);
          setTilesetWeights(prev => ({ ...prev, [newId]: 50 }));
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });
  };

  const removeTileset = (id) => {
    setTilesets(prev => prev.filter(t => t.id !== id));
    setTilesetWeights(prev => { const n = { ...prev }; delete n[id]; return n; });
  };

  // --- Core hooks ---
  const atlasData = useTileset(tilesets, excludeColor);

  const cols           = Math.floor(canvasSize.width  / (TILE_SIZE * scale));
  const rows           = Math.floor(canvasSize.height / (TILE_SIZE * scale));
  const scaledTileSize = TILE_SIZE * scale;

  const settings = useMemo(() => ({
    cols, rows,
    scaledTileSize,
    chaos, coherence, normalize,
    circularMaskChance, disappearChance,
    cycleTiles, tilesetWeights,
  }), [cols, rows, scaledTileSize, chaos, coherence, normalize,
       circularMaskChance, disappearChance, cycleTiles, tilesetWeights]);

  const { instanceData, generate } = usePatternGenerator(atlasData, settings, livePreview);

  const { bgImage, bgUrl, handleBgUpload, clearBackground } = useBackgroundImage();

  const { maskTextureRef, maskVersion, resetMask, brushPreview } =
    useMask(canvasRef, cols, rows, scaledTileSize, paintMode, brushSize);

  const fps = useWebGLRenderer(canvasRef, atlasData, instanceData, {
    backgroundColor, scale, canvasSize, animateMasks, animationSpeed,
    bgImage, maskTextureRef, maskVersion,
  });

  const handleChange   = (setter) => (e) => setter(Number(e.target.value));
  const handlePointerUp = useCallback(() => {
    if (!livePreview) generate();
  }, [livePreview, generate]);

  const exportPattern = () => {
    const link = document.createElement('a');
    link.download = `tile-glitch-${Date.now()}.png`;
    link.href = canvasRef.current.toDataURL();
    link.click();
  };

  const tileCount = atlasData?.tiles.length ?? 0;

  return (
    <div className="app">
      <div className="container">
        <div className={`controls ${minimizeUI ? 'minimized' : ''}`}>
          <button
            className="minimize-btn"
            onClick={() => setMinimizeUI(!minimizeUI)}
            title={minimizeUI ? 'Show controls' : 'Hide controls'}
          >
            {minimizeUI ? '▼' : '▲'}
          </button>

          {!minimizeUI && (
            <>
              {/* ── Tilesets ── */}
              <div className="section-header">Tilesets</div>

              <div className="control-group">
                <input type="file" accept="image/*" multiple onChange={handleFileUpload} />
              </div>

              {tilesets.length > 0 && (
                <div className="tilesets-list">
                  {tilesets.map((tileset, index) => (
                    <div key={tileset.id} className="tileset-item">
                      <div className="tileset-header">
                        <span>Tileset {index + 1}</span>
                        <button onClick={() => removeTileset(tileset.id)} className="remove-btn">✕</button>
                      </div>
                      <div className="tileset-weight">
                        <label>Weight: {tilesetWeights[tileset.id] || 50}%</label>
                        <input
                          type="range" min="0" max="100"
                          value={tilesetWeights[tileset.id] || 50}
                          onChange={(e) => setTilesetWeights(prev => ({ ...prev, [tileset.id]: Number(e.target.value) }))}
                          onPointerUp={handlePointerUp}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Generation ── */}
              <div className="section-header">Generation</div>

              <div className="control-group">
                <label>Chaos: {chaos}%</label>
                <input type="range" min="0" max="100" value={chaos}
                  onChange={handleChange(setChaos)} onPointerUp={handlePointerUp} />
              </div>

              <div className="control-group">
                <label>Connection: {coherence}%</label>
                <input type="range" min="0" max="100" value={coherence}
                  onChange={handleChange(setCoherence)} onPointerUp={handlePointerUp} />
              </div>

              <div className="control-group">
                <label>Scale: {scale}x</label>
                <input type="range" min="1" max="4" step="1" value={scale}
                  onChange={handleChange(setScale)} onPointerUp={handlePointerUp} />
              </div>

              <div className="control-group">
                <label>Normalize: {normalize}%</label>
                <input type="range" min="0" max="100" value={normalize}
                  onChange={handleChange(setNormalize)} onPointerUp={handlePointerUp} />
              </div>

              <div className="control-group">
                <label>Circular Mask: {circularMaskChance}%</label>
                <input type="range" min="0" max="100" value={circularMaskChance}
                  onChange={handleChange(setCircularMaskChance)} onPointerUp={handlePointerUp} />
              </div>

              <div className="control-group checkbox">
                <label>
                  <input type="checkbox" checked={animateMasks}
                    onChange={(e) => setAnimateMasks(e.target.checked)} />
                  Animate Masks
                </label>
              </div>

              {animateMasks && (
                <div className="control-group">
                  <label>Animation Speed: {animationSpeed}%</label>
                  <input type="range" min="1" max="100" value={animationSpeed}
                    onChange={handleChange(setAnimationSpeed)} onPointerUp={handlePointerUp} />
                </div>
              )}

              <div className="control-group">
                <label>Disappear: {disappearChance}%</label>
                <input type="range" min="0" max="100" value={disappearChance}
                  onChange={handleChange(setDisappearChance)} onPointerUp={handlePointerUp} />
              </div>

              <div className="control-group checkbox">
                <label>
                  <input type="checkbox" checked={cycleTiles}
                    onChange={(e) => setCycleTiles(e.target.checked)} />
                  Cycle All Tiles
                </label>
              </div>

              {/* ── Colors ── */}
              <div className="section-header">Colors</div>

              <div className="control-group">
                <label>Background Color</label>
                <input type="color" value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)} />
              </div>

              <div className="control-group">
                <label>Exclude Color</label>
                <input type="color" value={excludeColor || '#00ff00'}
                  onChange={(e) => setExcludeColor(e.target.value)} />
                {excludeColor && (
                  <button className="btn-small" onClick={() => setExcludeColor('')}>Clear</button>
                )}
              </div>

              {/* ── Background Image ── */}
              <div className="section-header">Background Image</div>

              <div className="control-group bg-upload-row">
                <label className="btn-secondary" htmlFor="bg-upload">Upload Image</label>
                <input id="bg-upload" type="file" accept="image/*" onChange={handleBgUpload}
                  style={{ display: 'none' }} />
                {bgUrl && (
                  <>
                    <img src={bgUrl} alt="bg thumbnail" className="bg-thumbnail" />
                    <button className="btn-small" onClick={clearBackground}>Clear</button>
                  </>
                )}
              </div>

              {/* ── Mask ── */}
              <div className="section-header">Mask</div>

              <div className="paint-toggle">
                <button
                  className={`toggle-btn ${paintMode === 'paint' ? 'active' : ''}`}
                  onClick={() => setPaintMode('paint')}
                >Paint</button>
                <button
                  className={`toggle-btn ${paintMode === 'erase' ? 'active' : ''}`}
                  onClick={() => setPaintMode('erase')}
                >Erase</button>
              </div>

              <div className="control-group">
                <label>Brush Size: {brushSize}</label>
                <input type="range" min="1" max="10" value={brushSize}
                  onChange={handleChange(setBrushSize)} />
              </div>

              <button className="btn-secondary" onClick={resetMask}>Reset Mask</button>

              {/* ── Footer ── */}
              <div className="section-divider" />

              <div className="control-group checkbox">
                <label>
                  <input type="checkbox" checked={livePreview}
                    onChange={(e) => setLivePreview(e.target.checked)} />
                  Live Preview
                </label>
              </div>

              <button onClick={generate} disabled={tileCount === 0}>
                🎲 Regenerate
              </button>

              <button onClick={exportPattern} disabled={tileCount === 0}>
                💾 Export PNG
              </button>

              {tileCount > 0 && (
                <div className="info">📊 {tileCount} tiles loaded</div>
              )}
            </>
          )}
        </div>

        <div className="canvas-wrapper">
          <canvas
            ref={canvasRef}
            width={canvasSize.width}
            height={canvasSize.height}
          />
          {brushPreview && tileCount > 0 && (
            <div
              className="brush-preview"
              style={{
                left:   `${(brushPreview.col - brushPreview.size) * scaledTileSize}px`,
                top:    `${(brushPreview.row - brushPreview.size) * scaledTileSize}px`,
                width:  `${(brushPreview.size * 2 + 1) * scaledTileSize}px`,
                height: `${(brushPreview.size * 2 + 1) * scaledTileSize}px`,
              }}
            />
          )}
          {import.meta.env.DEV && animateMasks && fps !== null && (
            <div style={{
              position: 'absolute', top: 8, right: 8,
              background: 'rgba(0,0,0,0.6)', color: '#0f0',
              fontFamily: 'monospace', fontSize: '12px',
              padding: '2px 6px', borderRadius: '3px',
              pointerEvents: 'none',
            }}>
              {fps} fps
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
```

- [ ] **Step 2: Update App.css**

Replace the entire file with:

```css
:root {
  --bg-panel:    rgba(20, 20, 22, 0.96);
  --border:      rgba(255, 255, 255, 0.08);
  --accent:      #667eea;
  --accent-dim:  rgba(102, 126, 234, 0.2);
  --accent-mid:  rgba(102, 126, 234, 0.35);
  --text:        #e0e0e0;
  --text-muted:  #888;
  --danger:      rgba(255, 50, 50, 0.2);
  --danger-text: #ff6b6b;
  --radius:      6px;
  --gap:         0.5rem;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: system-ui, -apple-system, 'Inter', sans-serif;
  background: #000;
  color: var(--text);
}

.app {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

.container {
  position: relative;
  width: 100%;
  height: 100%;
}

/* ── Controls panel ───────────────────────── */

.controls {
  position: fixed;
  top: 0.5rem;
  right: 0.5rem;
  width: 230px;
  max-height: calc(100vh - 1rem);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--gap);
  background: var(--bg-panel);
  backdrop-filter: blur(12px);
  padding: 0.6rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  z-index: 100;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  font-size: 11px;
  line-height: 1.4;
  scrollbar-width: thin;
  scrollbar-color: var(--accent-mid) transparent;
  transition: all 0.25s ease;
}

.controls.minimized {
  width: 44px;
  height: 44px;
  overflow: hidden;
  padding: 0.4rem;
}

.minimize-btn {
  width: 100%;
  padding: 0.3rem;
  background: var(--accent-dim);
  border: 1px solid var(--accent-mid);
  color: var(--accent);
  font-size: 10px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.minimize-btn:hover { background: var(--accent-mid); }

/* ── Section headers ─────────────────────── */

.section-header {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  padding: 0.15rem 0;
  border-bottom: 1px solid var(--border);
  margin-top: 0.25rem;
}

.section-divider {
  border-top: 1px solid var(--border);
  margin: 0.15rem 0;
}

/* ── Control group ───────────────────────── */

.control-group {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.control-group label {
  font-size: 11px;
  color: var(--text-muted);
}

.control-group input[type="range"] {
  width: 100%;
  accent-color: var(--accent);
  height: 12px;
}

.control-group input[type="color"] {
  width: 100%;
  height: 28px;
  cursor: pointer;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: none;
}

.control-group.checkbox {
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
}

.control-group.checkbox input[type="checkbox"] {
  width: 13px;
  height: 13px;
  cursor: pointer;
  accent-color: var(--accent);
}

.control-group.checkbox label {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

/* ── Tilesets ────────────────────────────── */

.tilesets-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.tileset-item {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.4rem;
  background: var(--accent-dim);
  border: 1px solid var(--accent-mid);
  border-radius: 4px;
  font-size: 11px;
}

.tileset-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.tileset-weight {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.tileset-weight label {
  font-size: 10px;
  color: var(--text-muted);
}

.tileset-weight input[type="range"] {
  width: 100%;
  accent-color: var(--accent);
  height: 12px;
}

/* ── Buttons ─────────────────────────────── */

button {
  padding: 0.45rem 0.7rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  border: none;
  border-radius: 4px;
  font-weight: 600;
  font-size: 11px;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.15s;
  font-family: inherit;
}

button:hover:not(:disabled) {
  opacity: 0.9;
  transform: translateY(-1px);
}

button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-small {
  padding: 0.2rem 0.45rem;
  font-size: 10px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--border);
  color: var(--text-muted);
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 11px;
  padding: 0.4rem 0.7rem;
}

.btn-secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
  transform: none;
}

.remove-btn {
  padding: 0.15rem 0.3rem;
  background: var(--danger);
  color: var(--danger-text);
  border: 1px solid rgba(255, 50, 50, 0.4);
  font-size: 10px;
  min-width: 0;
  font-family: inherit;
}

.remove-btn:hover { background: rgba(255, 50, 50, 0.3); }

/* ── Background upload row ───────────────── */

.bg-upload-row {
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.bg-thumbnail {
  width: 28px;
  height: 28px;
  object-fit: cover;
  border-radius: 3px;
  border: 1px solid var(--border);
}

/* ── Paint / Erase toggle ────────────────── */

.paint-toggle {
  display: flex;
  gap: 0.3rem;
}

.toggle-btn {
  flex: 1;
  padding: 0.35rem 0;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 11px;
  border-radius: 4px;
}

.toggle-btn.active {
  background: var(--accent-dim);
  border-color: var(--accent);
  color: var(--accent);
}

.toggle-btn:hover:not(.active) {
  background: rgba(255, 255, 255, 0.1);
  transform: none;
}

/* ── Info ────────────────────────────────── */

.info {
  padding: 0.4rem;
  background: var(--accent-dim);
  border: 1px solid var(--accent-mid);
  border-radius: 4px;
  text-align: center;
  font-size: 10px;
  color: var(--text-muted);
}

/* ── Canvas + overlays ───────────────────── */

.canvas-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

canvas {
  width: 100%;
  height: 100%;
  display: block;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  cursor: crosshair;
}

/* Brush preview overlay */
.brush-preview {
  position: absolute;
  border: 1px solid rgba(255, 255, 255, 0.5);
  pointer-events: none;
  box-sizing: border-box;
}

/* File input */
input[type="file"] {
  font-size: 10px;
  color: var(--text-muted);
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.3rem;
  width: 100%;
  cursor: pointer;
  font-family: inherit;
}
```

- [ ] **Step 3: Visual verification checklist**

With `npm run dev`:

1. **Tile rendering unchanged** — load a tileset, tiles appear as before
2. **Background image** — click "Upload Image", pick any photo → thumbnail appears in panel, image fills canvas behind tiles
3. **Paint mode** — click/drag on canvas → tiles disappear revealing background
4. **Erase mode** — switch to Erase, drag over painted area → tiles reappear
5. **Brush size** — change slider 1→5 → brush preview square grows; painted area grows accordingly
6. **Reset Mask** — painted areas all restore to tiles
7. **Mask survives Regenerate** — paint some tiles, click Regenerate → painted areas stay clear
8. **Clear background** — "Clear" button removes background image; masked tiles become transparent (show background color)
9. **Brush preview** — hovering canvas shows faint white square outline following cursor

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx src/App.css
git commit -m "feat: wire background image + mask UI — upload, paint/erase, brush preview, reset"
```

---

## Done

After all 7 tasks pass visual verification, run:

```bash
git log --oneline -7
```

Expected output (7 commits since task 1):
```
feat: wire background image + mask UI — upload, paint/erase, brush preview, reset
feat: useWebGLRenderer — bg draw pass, mask texture uniforms, aGridPos VAO attr
feat: add useMask hook — R8 GPU texture, pointer painting, brush preview
feat: add useBackgroundImage hook — file upload to HTMLImageElement
feat: write I_GRID_U/I_GRID_V per instance in pattern worker
feat: add mask + bg shaders — aGridPos, vMaskCoord, uHasMask, uMask, BG program
feat: extend instance buffer to 18 floats — add I_GRID_U/I_GRID_V
```

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | — |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |

**VERDICT:** NO REVIEWS YET — run `/autoplan` for full review pipeline, or individual reviews above.
