# WebGL Performance Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Canvas 2D rendering with WebGL instanced rendering and move pattern generation to a Web Worker, achieving 60fps animation and sub-200ms generate times.

**Architecture:** Three hooks (`useTileset`, `usePatternGenerator`, `useWebGLRenderer`) replace all render logic currently in `App.jsx`. A Web Worker handles pattern generation off the main thread. All 32k tiles are drawn in a single WebGL instanced draw call per frame.

**Tech Stack:** React 19, Vite 7, WebGL 2, twgl.js (program/uniform helper only), Web Worker (Vite `?worker` syntax)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/webgl/constants.js` | Create | Shared constants (TILE_SIZE, FLOATS_PER_INSTANCE, offsets) |
| `src/webgl/shaders.js` | Create | GLSL vertex + fragment shader source strings |
| `src/hooks/useTileset.js` | Create | CPU atlas packing, UV table, tileMap, tilesetMeta |
| `src/workers/patternWorker.js` | Create | Pure generation logic — no DOM, no WebGL |
| `src/hooks/usePatternGenerator.js` | Create | Worker bridge, debounce, instance data state |
| `src/hooks/useWebGLRenderer.js` | Create | WebGL context, VAO, texture upload, draw loop, FPS |
| `src/App.jsx` | Modify | Remove all render logic; wire hooks; add livePreview toggle + FPS overlay |

---

## Task 1: Install twgl.js and create file structure

**Files:**
- Modify: `package.json` (via npm install)
- Create: `src/webgl/` directory
- Create: `src/hooks/` directory
- Create: `src/workers/` directory

- [ ] **Step 1: Install twgl.js**

```bash
cd /Users/danielnieuwenhuizen/Coding/tile-glitch && npm install twgl.js
```

Expected output: `added 1 package` (twgl.js is standalone, no transitive deps)

- [ ] **Step 2: Create directories**

```bash
mkdir -p src/webgl src/hooks src/workers
```

- [ ] **Step 3: Verify**

```bash
ls src/
```

Expected: `App.css  App.jsx  assets  hooks  index.css  main.jsx  webgl  workers`

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install twgl.js"
```

---

## Task 2: Constants and shaders

**Files:**
- Create: `src/webgl/constants.js`
- Create: `src/webgl/shaders.js`

- [ ] **Step 1: Create `src/webgl/constants.js`**

```js
// src/webgl/constants.js
export const TILE_SIZE = 8;

// Number of floats per tile instance in the instance buffer
export const FLOATS_PER_INSTANCE = 16;

// Byte offsets into each instance's data (in float units, multiply by 4 for bytes)
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
```

- [ ] **Step 2: Create `src/webgl/shaders.js`**

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
}`;

export const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

uniform sampler2D uAtlas;
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

out vec4 fragColor;

void main() {
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
```

- [ ] **Step 3: Commit**

```bash
git add src/webgl/
git commit -m "feat: add WebGL constants and GLSL shaders"
```

---

## Task 3: useTileset hook (CPU atlas packing)

**Files:**
- Create: `src/hooks/useTileset.js`

This hook takes the uploaded tilesets and exclude color, slices tiles, packs them into a 2D canvas atlas, and returns the data the renderer and worker need. It does **no WebGL** — just CPU canvas operations.

- [ ] **Step 1: Create `src/hooks/useTileset.js`**

```js
// src/hooks/useTileset.js
import { useEffect, useRef, useState } from 'react';
import { TILE_SIZE } from '../webgl/constants.js';

function tileHasExcludedColor(ctx, img, srcX, srcY, excludeHex) {
  if (!excludeHex) return false;
  ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
  ctx.drawImage(img, srcX, srcY, TILE_SIZE, TILE_SIZE, 0, 0, TILE_SIZE, TILE_SIZE);
  const { data } = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
  const r = parseInt(excludeHex.slice(1, 3), 16);
  const g = parseInt(excludeHex.slice(3, 5), 16);
  const b = parseInt(excludeHex.slice(5, 7), 16);
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - r) < 20 && Math.abs(data[i + 1] - g) < 20 && Math.abs(data[i + 2] - b) < 20) {
      return true;
    }
  }
  return false;
}

/**
 * Slices tilesets into 8×8 tiles, filters by exclude color,
 * packs them into a 2D canvas atlas, and returns lookup structures.
 *
 * Returns null if no tilesets are loaded.
 *
 * Return shape:
 * {
 *   atlasCanvas: HTMLCanvasElement,
 *   atlasWidth: number,
 *   atlasHeight: number,
 *   tiles: Array<{ srcX, srcY, imageIndex, tilesetId }>,
 *   uvData: Float32Array,     // [uvX, uvY, uvW, uvH] × tiles.length
 *   tileMap: Map<string, number>,  // "imageIndex,srcX,srcY" → tileIndex
 *   tilesetMeta: Array<{ id, tilesPerRow }>,
 * }
 */
export function useTileset(tilesetList, excludeColor) {
  const [atlasData, setAtlasData] = useState(null);
  const colorCanvasRef = useRef(null);

  useEffect(() => {
    if (tilesetList.length === 0) {
      setAtlasData(null);
      return;
    }

    // Reuse a single small canvas for color checking
    if (!colorCanvasRef.current) {
      const c = document.createElement('canvas');
      c.width = TILE_SIZE;
      c.height = TILE_SIZE;
      colorCanvasRef.current = c;
    }
    const colorCtx = colorCanvasRef.current.getContext('2d', { willReadFrequently: true });

    // Collect all tiles that pass the exclude-color filter
    const tiles = [];
    tilesetList.forEach((tileset, imgIndex) => {
      const img = tileset.img;
      const cols = Math.floor(img.width / TILE_SIZE);
      const rows = Math.floor(img.height / TILE_SIZE);
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const srcX = col * TILE_SIZE;
          const srcY = row * TILE_SIZE;
          if (!tileHasExcludedColor(colorCtx, img, srcX, srcY, excludeColor)) {
            tiles.push({ srcX, srcY, imageIndex: imgIndex, tilesetId: tileset.id });
          }
        }
      }
    });

    if (tiles.length === 0) {
      setAtlasData(null);
      return;
    }

    // Pack tiles into a grid atlas
    // Use ceil(sqrt(n)) columns so the atlas is roughly square
    const atlasColumns = Math.ceil(Math.sqrt(tiles.length));
    const atlasRows    = Math.ceil(tiles.length / atlasColumns);
    const atlasWidth   = atlasColumns * TILE_SIZE;
    const atlasHeight  = atlasRows    * TILE_SIZE;

    const atlasCanvas = document.createElement('canvas');
    atlasCanvas.width  = atlasWidth;
    atlasCanvas.height = atlasHeight;
    const atlasCtx = atlasCanvas.getContext('2d');

    const tileMap = new Map();
    const uvData  = new Float32Array(tiles.length * 4);

    tiles.forEach((tile, i) => {
      const atlasCol = i % atlasColumns;
      const atlasRow = Math.floor(i / atlasColumns);
      const destX    = atlasCol * TILE_SIZE;
      const destY    = atlasRow * TILE_SIZE;

      // Draw tile into atlas
      atlasCtx.drawImage(
        tilesetList[tile.imageIndex].img,
        tile.srcX, tile.srcY, TILE_SIZE, TILE_SIZE,
        destX,     destY,     TILE_SIZE, TILE_SIZE
      );

      // UV (normalized 0–1)
      uvData[i * 4 + 0] = destX / atlasWidth;
      uvData[i * 4 + 1] = destY / atlasHeight;
      uvData[i * 4 + 2] = TILE_SIZE / atlasWidth;
      uvData[i * 4 + 3] = TILE_SIZE / atlasHeight;

      // Map: "imageIndex,srcX,srcY" → atlas tile index (O(1) neighbor lookup)
      tileMap.set(`${tile.imageIndex},${tile.srcX},${tile.srcY}`, i);
    });

    // Per-tileset metadata needed by the worker for neighbor adjacency
    const tilesetMeta = tilesetList.map(ts => ({
      id: ts.id,
      tilesPerRow: Math.floor(ts.img.width / TILE_SIZE),
    }));

    console.log(`Atlas: ${atlasWidth}×${atlasHeight}px, ${tiles.length} tiles`);
    setAtlasData({ atlasCanvas, atlasWidth, atlasHeight, tiles, uvData, tileMap, tilesetMeta });
  }, [tilesetList, excludeColor]);

  return atlasData;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useTileset.js
git commit -m "feat: add useTileset hook for CPU atlas packing"
```

---

## Task 4: Pattern worker (pure generation logic)

**Files:**
- Create: `src/workers/patternWorker.js`

The worker has no DOM access and no WebGL. It receives two message types:
- `{ type: 'init', tiles, uvData, tileMap, tilesetMeta }` — sent once per tileset change
- `{ type: 'generate', ... }` — sent per generate call with all slider values

It posts back `{ instanceData: Float32Array }` (transferred, not copied).

- [ ] **Step 1: Create `src/workers/patternWorker.js`**

```js
// src/workers/patternWorker.js
import {
  TILE_SIZE,
  FLOATS_PER_INSTANCE,
  I_POS_X, I_POS_Y,
  I_UV_X, I_UV_Y, I_UV_W, I_UV_H,
  I_FLIP, I_OPACITY, I_CIRCULAR,
  I_PHASE, I_SPEED, I_DIRECTION,
  I_COLOR_R, I_COLOR_G, I_COLOR_B, I_COLOR_A,
} from '../webgl/constants.js';

// Cached static data (set once per tileset change)
let tiles     = [];
let uvData    = null;  // Float32Array, [uvX, uvY, uvW, uvH] × tiles.length
let tileMap   = null;  // Map<"imgIdx,srcX,srcY", tileIndex>
let tilesetMeta = [];  // [{ id, tilesPerRow }]

// O(1) weighted tile selection using prefix sums
// Returns a tile index (0 to tiles.length - 1)
function selectWeighted(prefixSums, totalWeight) {
  let r = Math.random() * totalWeight;
  let lo = 0;
  let hi = prefixSums.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (prefixSums[mid + 1] <= r) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Build prefix sums from tiles + tilesetWeights
// Returns [prefixSums: Float32Array, totalWeight: number]
function buildPrefixSums(tilesetWeights) {
  const sums = new Float32Array(tiles.length + 1);
  sums[0] = 0;
  for (let i = 0; i < tiles.length; i++) {
    const id     = tiles[i].tilesetId;
    const weight = tilesetWeights[id] ?? 50;
    sums[i + 1]  = sums[i] + weight;
  }
  return [sums, sums[tiles.length]];
}

// O(1) tile lookup: find tile index adjacent to tileIndex by (colDelta, rowDelta) in source tileset
// Returns -1 if not found (filtered out or out of bounds)
function getAdjacentTileIndex(tileIndex, colDelta, rowDelta) {
  const tile   = tiles[tileIndex];
  const adjSrcX = tile.srcX + colDelta * TILE_SIZE;
  const adjSrcY = tile.srcY + rowDelta * TILE_SIZE;
  const key    = `${tile.imageIndex},${adjSrcX},${adjSrcY}`;
  const idx    = tileMap.get(key);
  return idx !== undefined ? idx : -1;
}

function generate({
  cols, rows, scaledTileSize,
  chaos, coherence, normalize,
  circularMaskChance, disappearChance,
  cycleTiles, tilesetWeights,
}) {
  if (tiles.length === 0) return;

  const [prefixSums, totalWeight] = buildPrefixSums(tilesetWeights);
  const instanceData = new Float32Array(cols * rows * FLOATS_PER_INSTANCE);

  // Grid stores tile indices for neighbor lookups
  const grid = new Int32Array(cols * rows).fill(-1);

  // Tile pool for cycle mode
  let tilePool = null;
  let poolIndex = 0;
  if (cycleTiles) {
    tilePool = Array.from({ length: tiles.length }, (_, i) => i);
    for (let i = tilePool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tilePool[i], tilePool[j]] = [tilePool[j], tilePool[i]];
    }
  }

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cellIdx = row * cols + col;
      let selectedTileIdx = -1;

      // Collect up to 4 neighbors (left, up, 2-left, 2-up)
      const neighbors = [];
      if (col > 0 && grid[cellIdx - 1] !== -1)             neighbors.push({ idx: grid[cellIdx - 1],        weight: 1   });
      if (row > 0 && grid[cellIdx - cols] !== -1)           neighbors.push({ idx: grid[cellIdx - cols],     weight: 1   });
      if (col > 1 && grid[cellIdx - 2] !== -1)              neighbors.push({ idx: grid[cellIdx - 2],        weight: 0.5 });
      if (row > 1 && grid[cellIdx - cols * 2] !== -1)       neighbors.push({ idx: grid[cellIdx - cols * 2], weight: 0.5 });

      const connectionChance = coherence + normalize * 0.3;

      if (neighbors.length > 0 && Math.random() * 100 < connectionChance) {
        // Pick a neighbor weighted by proximity
        const totalNeighborWeight = neighbors.reduce((s, n) => s + n.weight, 0);
        let r = Math.random() * totalNeighborWeight;
        let neighborIdx = neighbors[0].idx;
        for (const n of neighbors) {
          r -= n.weight;
          if (r <= 0) { neighborIdx = n.idx; break; }
        }

        const sameChance = normalize;
        if (Math.random() * 100 < sameChance) {
          // Use same tile or immediate neighbor in source tileset
          const adjacentCandidates = [
            [0, 0], [0, 0], [0, 0],  // heavily favor same tile
            [-1, 0], [1, 0], [0, -1], [0, 1],
          ];
          const [dc, dr] = adjacentCandidates[Math.floor(Math.random() * adjacentCandidates.length)];
          if (dc === 0 && dr === 0) {
            selectedTileIdx = neighborIdx;
          } else {
            const adj = getAdjacentTileIndex(neighborIdx, dc, dr);
            selectedTileIdx = adj !== -1 ? adj : neighborIdx;
          }
        } else {
          // Pick from a radius around the neighbor in source tileset space
          const radius = Math.floor((100 - normalize) / 25) + 1;
          const offsets = [];
          for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
              offsets.push([dx, dy]);
            }
          }
          const [dc, dr] = offsets[Math.floor(Math.random() * offsets.length)];
          const adj = getAdjacentTileIndex(neighborIdx, dc, dr);
          selectedTileIdx = adj !== -1 ? adj : neighborIdx;
        }
      } else {
        // No coherence: random or cycle
        if (cycleTiles) {
          selectedTileIdx = tilePool[poolIndex];
          poolIndex++;
          if (poolIndex >= tilePool.length) {
            poolIndex = 0;
            for (let i = tilePool.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [tilePool[i], tilePool[j]] = [tilePool[j], tilePool[i]];
            }
          }
        } else {
          selectedTileIdx = totalWeight > 0
            ? selectWeighted(prefixSums, totalWeight)
            : Math.floor(Math.random() * tiles.length);
        }
      }

      grid[cellIdx] = selectedTileIdx;

      const offset = cellIdx * FLOATS_PER_INSTANCE;

      // Position
      instanceData[offset + I_POS_X] = col * scaledTileSize;
      instanceData[offset + I_POS_Y] = row * scaledTileSize;

      // UV from atlas
      instanceData[offset + I_UV_X] = uvData[selectedTileIdx * 4 + 0];
      instanceData[offset + I_UV_Y] = uvData[selectedTileIdx * 4 + 1];
      instanceData[offset + I_UV_W] = uvData[selectedTileIdx * 4 + 2];
      instanceData[offset + I_UV_H] = uvData[selectedTileIdx * 4 + 3];

      // Disappeared: opacity 0
      const disappeared = Math.random() * 100 < disappearChance;
      instanceData[offset + I_OPACITY] = disappeared ? 0 : 1;

      // Circular mask
      instanceData[offset + I_CIRCULAR] = Math.random() * 100 < circularMaskChance ? 1 : 0;

      // Animation
      instanceData[offset + I_PHASE]     = Math.random() * Math.PI * 2;
      instanceData[offset + I_SPEED]     = 0.5 + Math.random() * 2;
      instanceData[offset + I_DIRECTION] = Math.random() > 0.5 ? 1 : -1;

      // Chaos effects
      instanceData[offset + I_FLIP]    = 0;
      instanceData[offset + I_COLOR_R] = 0;
      instanceData[offset + I_COLOR_G] = 0;
      instanceData[offset + I_COLOR_B] = 0;
      instanceData[offset + I_COLOR_A] = 0;

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
    }
  }

  return instanceData;
}

self.onmessage = (e) => {
  const { type } = e.data;

  if (type === 'init') {
    tiles       = e.data.tiles;
    uvData      = e.data.uvData;
    tileMap     = e.data.tileMap;
    tilesetMeta = e.data.tilesetMeta;
    return;
  }

  if (type === 'generate') {
    const instanceData = generate(e.data);
    if (instanceData) {
      // Transfer the buffer to avoid copying
      self.postMessage({ instanceData }, [instanceData.buffer]);
    }
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add src/workers/patternWorker.js
git commit -m "feat: add pattern generation Web Worker"
```

---

## Task 5: usePatternGenerator hook

**Files:**
- Create: `src/hooks/usePatternGenerator.js`

Manages the worker lifecycle, sends init/generate messages, and exposes `instanceData` state + imperative `generate()` function.

- [ ] **Step 1: Create `src/hooks/usePatternGenerator.js`**

```js
// src/hooks/usePatternGenerator.js
import { useEffect, useRef, useState, useCallback } from 'react';
import PatternWorker from '../workers/patternWorker.js?worker';

/**
 * Bridges App state to the pattern worker.
 *
 * @param atlasData  - output of useTileset (null if no tilesets loaded)
 * @param settings   - stable object: { cols, rows, scaledTileSize, chaos, coherence,
 *                     normalize, circularMaskChance, disappearChance, cycleTiles,
 *                     tilesetWeights }
 * @param livePreview - if true, auto-generates when settings change (rAF-throttled)
 *
 * Returns { instanceData: Float32Array | null, generate: () => void }
 */
export function usePatternGenerator(atlasData, settings, livePreview) {
  const [instanceData, setInstanceData] = useState(null);
  const workerRef   = useRef(null);
  const rafRef      = useRef(null);

  // Create worker once
  useEffect(() => {
    workerRef.current = new PatternWorker();
    workerRef.current.onmessage = (e) => setInstanceData(e.data.instanceData);
    return () => {
      workerRef.current?.terminate();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Send init message when atlas data changes
  useEffect(() => {
    if (!atlasData || !workerRef.current) return;
    workerRef.current.postMessage({
      type:        'init',
      tiles:       atlasData.tiles,
      uvData:      atlasData.uvData,
      tileMap:     atlasData.tileMap,
      tilesetMeta: atlasData.tilesetMeta,
    });
  }, [atlasData]);

  // Imperative generate: sends current settings to worker
  const generate = useCallback(() => {
    if (!atlasData || !workerRef.current) return;
    workerRef.current.postMessage({ type: 'generate', ...settings });
  }, [atlasData, settings]);

  // Auto-generate when atlas or settings change
  useEffect(() => {
    if (!atlasData) return;

    if (livePreview) {
      // Throttle to one frame: cancel pending rAF and schedule a new one
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        generate();
        rafRef.current = null;
      });
    }
    // If !livePreview, generate() is called manually from App (on pointer-up or button)
  }, [atlasData, settings, livePreview]);

  return { instanceData, generate };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/usePatternGenerator.js
git commit -m "feat: add usePatternGenerator hook"
```

---

## Task 6: useWebGLRenderer hook

**Files:**
- Create: `src/hooks/useWebGLRenderer.js`

This is the most complex hook. It owns the WebGL context, compiles shaders, manages the atlas texture and instance buffer, runs the draw loop, and returns the current FPS.

- [ ] **Step 1: Create `src/hooks/useWebGLRenderer.js`**

```js
// src/hooks/useWebGLRenderer.js
import { useEffect, useRef, useState } from 'react';
import * as twgl from 'twgl.js';
import { VERTEX_SHADER, FRAGMENT_SHADER } from '../webgl/shaders.js';
import { FLOATS_PER_INSTANCE } from '../webgl/constants.js';

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Manages the WebGL 2 render loop.
 *
 * @param canvasRef       - ref to the <canvas> element
 * @param atlasData       - from useTileset (provides atlasCanvas)
 * @param instanceData    - Float32Array from usePatternGenerator
 * @param renderSettings  - { backgroundColor, scale, canvasSize, animateMasks, animationSpeed }
 *
 * Returns fps: number | null (null when animation is off)
 */
export function useWebGLRenderer(canvasRef, atlasData, instanceData, renderSettings) {
  const { backgroundColor, scale, canvasSize, animateMasks, animationSpeed } = renderSettings;

  const glRef           = useRef(null);
  const programInfoRef  = useRef(null);
  const vaoRef          = useRef(null);
  const instanceBufRef  = useRef(null);
  const atlasTexRef     = useRef(null);
  const instanceCountRef = useRef(0);
  const rafRef          = useRef(null);
  const [fps, setFps]   = useState(null);

  // --- Initialize WebGL once ---
  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      preserveDrawingBuffer: true,  // needed for export PNG
    });
    if (!gl) { console.error('WebGL 2 not supported'); return; }
    glRef.current = gl;

    // Compile shaders via twgl
    const programInfo = twgl.createProgramInfo(gl, [VERTEX_SHADER, FRAGMENT_SHADER]);
    programInfoRef.current = programInfo;
    const prog = programInfo.program;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Quad geometry: 6 vertices (2 triangles), positions in [-0.5, 0.5]
    const quadVerts = new Float32Array([
      -0.5, -0.5,  0.5, -0.5, -0.5,  0.5,
      -0.5,  0.5,  0.5, -0.5,  0.5,  0.5,
    ]);
    const quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

    // Instance buffer (filled later)
    const instBuf = gl.createBuffer();
    instanceBufRef.current = instBuf;

    // VAO
    const vao = gl.createVertexArray();
    vaoRef.current = vao;
    gl.bindVertexArray(vao);

    // --- Quad position attribute (per-vertex, divisor 0) ---
    const quadPosLoc = gl.getAttribLocation(prog, 'aQuadPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(quadPosLoc);
    gl.vertexAttribPointer(quadPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(quadPosLoc, 0);

    // --- Per-instance attributes (divisor 1) ---
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    const stride = FLOATS_PER_INSTANCE * 4;

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

    gl.bindVertexArray(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Upload atlas texture when atlasData changes ---
  useEffect(() => {
    const gl = glRef.current;
    if (!gl || !atlasData) return;

    // Delete previous texture if any
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

      if (!atlasTexRef.current || instanceCountRef.current === 0) return;

      gl.useProgram(programInfoRef.current.program);

      twgl.setUniforms(programInfoRef.current, {
        uCanvasSize: [canvasSize.width, canvasSize.height],
        uTileSize:   8 * scale,
        uAtlas:      atlasTexRef.current,
        uTime:       timestamp ?? 0,
        uBaseSpeed:  (animationSpeed / 1000) * 0.1,
        uAnimate:    animateMasks,
      });

      gl.bindVertexArray(vaoRef.current);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instanceCountRef.current);
      gl.bindVertexArray(null);
    };

    if (!animateMasks) {
      // Single static draw
      draw(0);
      setFps(null);
      return;
    }

    // Animation loop with FPS counter
    let frameCount   = 0;
    let lastFpsTime  = performance.now();

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
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [animateMasks, animationSpeed, backgroundColor, canvasSize, scale, instanceData]);

  return fps;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useWebGLRenderer.js
git commit -m "feat: add useWebGLRenderer hook with WebGL 2 instanced rendering"
```

---

## Task 7: Refactor App.jsx

**Files:**
- Modify: `src/App.jsx`

Replace all render logic with the three hooks. Add live-preview toggle and FPS overlay. All existing controls remain — just wired differently.

- [ ] **Step 1: Replace `src/App.jsx` entirely**

```jsx
// src/App.jsx
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import './App.css';
import { useTileset }           from './hooks/useTileset.js';
import { usePatternGenerator }  from './hooks/usePatternGenerator.js';
import { useWebGLRenderer }     from './hooks/useWebGLRenderer.js';
import { TILE_SIZE }            from './webgl/constants.js';

function App() {
  const [tilesets, setTilesets]                   = useState([]);
  const [canvasSize, setCanvasSize]               = useState({ width: window.innerWidth, height: window.innerHeight });
  const [chaos, setChaos]                         = useState(50);
  const [coherence, setCoherence]                 = useState(50);
  const [normalize, setNormalize]                 = useState(50);
  const [scale, setScale]                         = useState(1);
  const [excludeColor, setExcludeColor]           = useState('');
  const [tilesetWeights, setTilesetWeights]       = useState({});
  const [cycleTiles, setCycleTiles]               = useState(false);
  const [circularMaskChance, setCircularMaskChance] = useState(0);
  const [disappearChance, setDisappearChance]     = useState(0);
  const [backgroundColor, setBackgroundColor]     = useState('#000000');
  const [animateMasks, setAnimateMasks]           = useState(false);
  const [animationSpeed, setAnimationSpeed]       = useState(50);
  const [minimizeUI, setMinimizeUI]               = useState(false);
  const [livePreview, setLivePreview]             = useState(true);

  const canvasRef = useRef(null);

  // Window resize
  useEffect(() => {
    const onResize = () => setCanvasSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Handle tileset upload
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
    setTilesetWeights(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  // --- Hooks ---
  const atlasData = useTileset(tilesets, excludeColor);

  const cols = Math.floor(canvasSize.width  / (TILE_SIZE * scale));
  const rows = Math.floor(canvasSize.height / (TILE_SIZE * scale));

  const settings = useMemo(() => ({
    cols, rows,
    scaledTileSize: TILE_SIZE * scale,
    chaos, coherence, normalize,
    circularMaskChance, disappearChance,
    cycleTiles, tilesetWeights,
  }), [cols, rows, scale, chaos, coherence, normalize, circularMaskChance, disappearChance, cycleTiles, tilesetWeights]);

  const { instanceData, generate } = usePatternGenerator(atlasData, settings, livePreview);

  const fps = useWebGLRenderer(canvasRef, atlasData, instanceData, {
    backgroundColor, scale, canvasSize, animateMasks, animationSpeed,
  });

  // Slider helpers
  const handleChange = (setter) => (e) => setter(Number(e.target.value));
  const handlePointerUp = useCallback(() => {
    if (!livePreview) generate();
  }, [livePreview, generate]);

  // Export PNG (works with WebGL canvas + preserveDrawingBuffer)
  const exportPattern = () => {
    const link = document.createElement('a');
    link.download = `tile-glitch-${Date.now()}.png`;
    link.href = canvasRef.current.toDataURL();
    link.click();
  };

  const tileCount = atlasData?.tiles.length ?? 0;

  return (
    <div className="app">
      <header>
        <h1>🎨 Tile Glitch Generator</h1>
        <p>Upload an NES tileset and create glitchy patterns</p>
      </header>

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
              <div className="control-group">
                <label>Upload Tileset(s)</label>
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
                  <button onClick={() => setExcludeColor('')} style={{ fontSize: '0.85rem', padding: '0.25rem 0.5rem' }}>
                    Clear
                  </button>
                )}
              </div>

              <div className="control-group checkbox">
                <label>
                  <input type="checkbox" checked={cycleTiles}
                    onChange={(e) => setCycleTiles(e.target.checked)} />
                  Cycle All Tiles
                </label>
              </div>

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

        <div className="canvas-wrapper" style={{ position: 'relative' }}>
          <canvas
            ref={canvasRef}
            width={canvasSize.width}
            height={canvasSize.height}
          />
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

- [ ] **Step 2: Start dev server and verify no console errors**

```bash
npm run dev
```

Open `http://localhost:5173`. Expected: app loads, canvas renders background color, no red console errors.

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "feat: refactor App.jsx to use WebGL hooks"
```

---

## Task 8: Smoke test and final commit

**Files:** None — verification only

- [ ] **Step 1: Load both tilesets and verify rendering**

In the browser at `http://localhost:5173`:
1. Upload `imgs/1629.png` and `imgs/2318.png`
2. Expected: tiles fill the canvas immediately, console logs `Atlas: NNNxNNN px, NNNNN tiles`
3. Drag the Chaos slider — canvas should update in real-time
4. Set Circular Mask to 50%, enable Animate Masks
5. Expected: tiles animate smoothly, FPS overlay shows in top-right corner
6. Expected FPS: ≥ 30fps at scale 1x, ≥ 60fps at scale 2x+

- [ ] **Step 2: Verify export**

Click "💾 Export PNG". Expected: downloads a valid PNG of the current canvas.

- [ ] **Step 3: Verify Live Preview toggle**

Uncheck "Live Preview". Drag a slider — canvas should NOT update while dragging. Release — canvas updates.

- [ ] **Step 4: Verify regenerate button**

Click "🎲 Regenerate" — new random pattern appears.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete WebGL performance refactor"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Atlas packing ✓, UV table ✓, prefix sums ✓, tileMap ✓, Web Worker ✓, instanced WebGL ✓, live-preview toggle ✓, FPS overlay (dev-only) ✓, export PNG ✓, all existing controls ✓
- [x] **No placeholders:** All steps have complete code
- [x] **Type consistency:** `FLOATS_PER_INSTANCE=16` used consistently in worker (I_* offsets) and renderer (stride, instAttr offsets). `atlasData.tiles`, `atlasData.uvData`, `atlasData.tileMap`, `atlasData.tilesetMeta` referenced consistently across hooks
- [x] **Worker tileMap key:** `"imageIndex,srcX,srcY"` used in both useTileset (build) and patternWorker (lookup)
- [x] **preserveDrawingBuffer:** Set in WebGL context creation for export to work
- [x] **Animation formula:** Worker stores `phase`, `speed`, `direction` per tile; shader replicates `(uTime * uBaseSpeed * vSpeed + vPhase) * vDirection` from original
