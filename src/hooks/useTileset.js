import { useEffect, useState } from 'react';
import { TILE_SIZE } from '../webgl/constants.js';

function buildExcludeFilter(img, excludeColors, tolerance) {
  if (!excludeColors || excludeColors.length === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width  = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, img.width, img.height);

  const targets = excludeColors.map(hex => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]);

  return (srcX, srcY) => {
    for (let ty = srcY; ty < srcY + TILE_SIZE; ty++) {
      for (let tx = srcX; tx < srcX + TILE_SIZE; tx++) {
        const i = (ty * img.width + tx) * 4;
        for (const [er, eg, eb] of targets) {
          if (
            Math.abs(data[i]     - er) <= tolerance &&
            Math.abs(data[i + 1] - eg) <= tolerance &&
            Math.abs(data[i + 2] - eb) <= tolerance
          ) return true;
        }
      }
    }
    return false;
  };
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
export function useTileset(tilesetList, excludeTolerance) {
  const [atlasData, setAtlasData] = useState(null);

  useEffect(() => {
    if (tilesetList.length === 0) {
      setAtlasData(null);
      return;
    }

    // Collect all tiles that pass the exclude-color filter
    const tiles = [];
    tilesetList.forEach((tileset, imgIndex) => {
      const img = tileset.img;
      const cols = Math.floor(img.width / TILE_SIZE);
      const rows = Math.floor(img.height / TILE_SIZE);
      const shouldExclude = buildExcludeFilter(img, tileset.excludeColors ?? [], excludeTolerance);

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const srcX = col * TILE_SIZE;
          const srcY = row * TILE_SIZE;
          if (!shouldExclude || !shouldExclude(srcX, srcY)) {
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

    if (import.meta.env.DEV) console.log(`Atlas: ${atlasWidth}×${atlasHeight}px, ${tiles.length} tiles`);
    setAtlasData({ atlasCanvas, atlasWidth, atlasHeight, tiles, uvData, tileMap, tilesetMeta });
  }, [tilesetList, excludeTolerance]);

  return atlasData;
}
