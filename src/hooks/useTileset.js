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
    if (Math.abs(data[i] - r) < 20 && Math.abs(data[i+1] - g) < 20 && Math.abs(data[i+2] - b) < 20) {
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
