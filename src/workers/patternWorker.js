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

// Mulberry32 — fast, seedable PRNG
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Cached static data (set once per tileset change)
let tiles     = [];
let uvData    = null;  // Float32Array, [uvX, uvY, uvW, uvH] × tiles.length
let tileMap   = null;  // Map<"imgIdx,srcX,srcY", tileIndex>

// O(log n) weighted tile selection using prefix sums
// Returns a tile index (0 to tiles.length - 1)
function selectWeighted(prefixSums, totalWeight, rng) {
  let r = rng() * totalWeight;
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
  cycleTiles, tilesetWeights, seed,
}) {
  if (tiles.length === 0 || !uvData || !tileMap) return;

  const rng = mulberry32(seed ?? Date.now());
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
      const j = Math.floor(rng() * (i + 1));
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

      if (neighbors.length > 0 && rng() * 100 < connectionChance) {
        // Pick a neighbor weighted by proximity
        const totalNeighborWeight = neighbors.reduce((s, n) => s + n.weight, 0);
        let r = rng() * totalNeighborWeight;
        let neighborIdx = neighbors[0].idx;
        for (const n of neighbors) {
          r -= n.weight;
          if (r <= 0) { neighborIdx = n.idx; break; }
        }

        const sameChance = normalize;
        if (rng() * 100 < sameChance) {
          // Use same tile or immediate neighbor in source tileset
          const adjacentCandidates = [
            [0, 0], [0, 0], [0, 0],  // heavily favor same tile
            [-1, 0], [1, 0], [0, -1], [0, 1],
          ];
          const [dc, dr] = adjacentCandidates[Math.floor(rng() * adjacentCandidates.length)];
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
          const [dc, dr] = offsets[Math.floor(rng() * offsets.length)];
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
              const j = Math.floor(rng() * (i + 1));
              [tilePool[i], tilePool[j]] = [tilePool[j], tilePool[i]];
            }
          }
        } else {
          selectedTileIdx = totalWeight > 0
            ? selectWeighted(prefixSums, totalWeight, rng)
            : Math.floor(rng() * tiles.length);
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
      const disappeared = rng() * 100 < disappearChance;
      instanceData[offset + I_OPACITY] = disappeared ? 0 : 1;

      // Circular mask
      instanceData[offset + I_CIRCULAR] = rng() * 100 < circularMaskChance ? 1 : 0;

      // Animation
      instanceData[offset + I_PHASE]     = rng() * Math.PI * 2;
      instanceData[offset + I_SPEED]     = 0.5 + rng() * 2;
      instanceData[offset + I_DIRECTION] = rng() > 0.5 ? 1 : -1;

      // Chaos effects
      instanceData[offset + I_FLIP]    = 0;
      instanceData[offset + I_COLOR_R] = 0;
      instanceData[offset + I_COLOR_G] = 0;
      instanceData[offset + I_COLOR_B] = 0;
      instanceData[offset + I_COLOR_A] = 0;

      if (!disappeared && rng() * 100 < chaos / 2) {
        const effect = Math.floor(rng() * 3);
        if (effect === 0) {
          instanceData[offset + I_FLIP] = 1;
        } else if (effect === 1) {
          instanceData[offset + I_COLOR_R] = rng();
          instanceData[offset + I_COLOR_G] = rng();
          instanceData[offset + I_COLOR_B] = rng();
          instanceData[offset + I_COLOR_A] = 0.3;
        }
        // effect 2: no visual (matches original)
      }

      // Normalized grid position for mask texture sampling
      instanceData[offset + I_GRID_U] = (col + 0.5) / cols;
      instanceData[offset + I_GRID_V] = (row + 0.5) / rows;
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
