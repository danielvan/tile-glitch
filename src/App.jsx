import { useState, useRef, useEffect } from 'react';
import './App.css';

function App() {
  const [tilesets, setTilesets] = useState([]);
  const [tiles, setTiles] = useState([]);
  const [canvasSize, setCanvasSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [chaos, setChaos] = useState(50);
  const [coherence, setCoherence] = useState(50);
  const [normalize, setNormalize] = useState(50);
  const [scale, setScale] = useState(1);
  const [excludeColor, setExcludeColor] = useState('');
  const [tilesetWeights, setTilesetWeights] = useState({});
  const [cycleTiles, setCycleTiles] = useState(false);
  const canvasRef = useRef(null);
  const tilesetImagesRef = useRef([]);

  const TILE_SIZE = 8;

  // Update canvas size on window resize
  useEffect(() => {
    const handleResize = () => {
      setCanvasSize({ width: window.innerWidth, height: window.innerHeight });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle tileset upload (supports multiple files)
  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    files.forEach((file, index) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          // Add to tilesets array
          const newId = Date.now() + index;
          setTilesets(prev => [...prev, { id: newId, url: event.target.result, img }]);
          setTilesetWeights(prev => ({ ...prev, [newId]: 50 })); // Default weight 50%
          tilesetImagesRef.current.push(img);
          sliceTilesets([...tilesetImagesRef.current]);
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });
  };

  // Remove a tileset
  const removeTileset = (id) => {
    setTilesets(prev => {
      const filtered = prev.filter(t => t.id !== id);
      tilesetImagesRef.current = filtered.map(t => t.img);
      sliceTilesets(tilesetImagesRef.current);
      return filtered;
    });
  };

  // Reusable canvas for color checking (optimization)
  const colorCheckCanvas = useRef(null);
  const colorCheckCtx = useRef(null);

  // Check if a tile contains excluded color (optimized)
  const tileHasExcludedColor = (img, x, y, excludeColorHex) => {
    if (!excludeColorHex) return false;

    // Reuse canvas instead of creating new ones
    if (!colorCheckCanvas.current) {
      colorCheckCanvas.current = document.createElement('canvas');
      colorCheckCanvas.current.width = TILE_SIZE;
      colorCheckCanvas.current.height = TILE_SIZE;
      colorCheckCtx.current = colorCheckCanvas.current.getContext('2d', { willReadFrequently: true });
    }

    const ctx = colorCheckCtx.current;
    ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
    ctx.drawImage(img, x, y, TILE_SIZE, TILE_SIZE, 0, 0, TILE_SIZE, TILE_SIZE);
    const imageData = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
    const pixels = imageData.data;

    // Convert hex to RGB once
    const r = parseInt(excludeColorHex.slice(1, 3), 16);
    const g = parseInt(excludeColorHex.slice(3, 5), 16);
    const b = parseInt(excludeColorHex.slice(5, 7), 16);

    // Check if any pixel matches (with small tolerance)
    for (let i = 0; i < pixels.length; i += 4) {
      const dr = Math.abs(pixels[i] - r);
      const dg = Math.abs(pixels[i + 1] - g);
      const db = Math.abs(pixels[i + 2] - b);

      if (dr < 20 && dg < 20 && db < 20) {
        return true;
      }
    }

    return false;
  };

  // Slice all tilesets into individual 8x8 tiles
  const sliceTilesets = (images) => {
    if (images.length === 0) {
      setTiles([]);
      return;
    }

    const allTiles = [];

    images.forEach((img, imgIndex) => {
      const cols = Math.floor(img.width / TILE_SIZE);
      const rows = Math.floor(img.height / TILE_SIZE);

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const tile = {
            x: x * TILE_SIZE,
            y: y * TILE_SIZE,
            imageIndex: imgIndex
          };

          // Skip tiles with excluded color
          if (!tileHasExcludedColor(img, tile.x, tile.y, excludeColor)) {
            allTiles.push(tile);
          }
        }
      }
    });

    setTiles(allTiles);
    console.log(`Sliced ${allTiles.length} tiles from ${images.length} tileset(s)`);
  };

  // Select weighted random tile based on tileset weights (optimized)
  const selectWeightedTile = () => {
    // If no weights or all equal, just pick random
    if (Object.keys(tilesetWeights).length === 0 || tiles.length === 0) {
      return tiles[Math.floor(Math.random() * tiles.length)];
    }

    // Use probability-based selection instead of creating large arrays
    let totalWeight = 0;
    const tileWeights = tiles.map(tile => {
      const tilesetId = tilesets[tile.imageIndex]?.id;
      const weight = tilesetWeights[tilesetId] || 50;
      totalWeight += weight;
      return weight;
    });

    let random = Math.random() * totalWeight;
    for (let i = 0; i < tiles.length; i++) {
      random -= tileWeights[i];
      if (random <= 0) {
        return tiles[i];
      }
    }

    return tiles[tiles.length - 1];
  };

  // Generate pattern with intelligent tile connections
  const generatePattern = () => {
    if (tilesetImagesRef.current.length === 0 || tiles.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const scaledTileSize = TILE_SIZE * scale;
    const cols = Math.floor(canvasSize.width / scaledTileSize);
    const rows = Math.floor(canvasSize.height / scaledTileSize);

    // Create a grid to store placed tiles
    const grid = Array(rows).fill(null).map(() => Array(cols).fill(null));

    // Tile pool for cycling mode
    let tilePool = [];
    if (cycleTiles) {
      tilePool = [...tiles];
      // Shuffle the pool
      for (let i = tilePool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tilePool[i], tilePool[j]] = [tilePool[j], tilePool[i]];
      }
    }
    let poolIndex = 0;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let selectedTile;

        // Collect all neighbors (up to 4)
        const neighbors = [];
        if (x > 0 && grid[y][x - 1]) neighbors.push({ tile: grid[y][x - 1], weight: 1 });
        if (y > 0 && grid[y - 1][x]) neighbors.push({ tile: grid[y - 1][x], weight: 1 });
        if (x > 1 && grid[y][x - 2]) neighbors.push({ tile: grid[y][x - 2], weight: 0.5 }); // further neighbors have less influence
        if (y > 1 && grid[y - 2][x]) neighbors.push({ tile: grid[y - 2][x], weight: 0.5 });

        // Connection chance increases with normalize
        const connectionChance = coherence + (normalize * 0.3); // normalize boosts connection strength

        if (neighbors.length > 0 && Math.random() * 100 < connectionChance) {
          // Pick a neighbor weighted by proximity
          const totalWeight = neighbors.reduce((sum, n) => sum + n.weight, 0);
          let random = Math.random() * totalWeight;
          let neighborTile = neighbors[0].tile;

          for (const n of neighbors) {
            random -= n.weight;
            if (random <= 0) {
              neighborTile = n.tile;
              break;
            }
          }

          // Try to find adjacent tiles in the tileset
          const neighborImg = tilesetImagesRef.current[neighborTile.imageIndex];
          const tilesPerRow = Math.floor(neighborImg.width / TILE_SIZE);
          const neighborIndex = tiles.findIndex(t => t.x === neighborTile.x && t.y === neighborTile.y && t.imageIndex === neighborTile.imageIndex);

          if (neighborIndex !== -1) {
            // Higher normalize = more repetition of same/nearby tiles
            const sameChance = normalize; // 0-100%

            if (Math.random() * 100 < sameChance) {
              // Use same tile or immediate neighbor
              const adjacentOffsets = [0, 0, 0, -1, 1, -tilesPerRow, tilesPerRow]; // heavily favor same tile
              const offset = adjacentOffsets[Math.floor(Math.random() * adjacentOffsets.length)];
              const adjacentIndex = neighborIndex + offset;

              if (adjacentIndex >= 0 && adjacentIndex < tiles.length && tiles[adjacentIndex].imageIndex === neighborTile.imageIndex) {
                selectedTile = tiles[adjacentIndex];
              } else {
                selectedTile = neighborTile; // fallback to same tile
              }
            } else {
              // Pick from nearby area (creates variation within regions)
              const radius = Math.floor((100 - normalize) / 25) + 1;
              const offsets = [];
              for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                  offsets.push(dy * tilesPerRow + dx);
                }
              }
              const offset = offsets[Math.floor(Math.random() * offsets.length)];
              const adjacentIndex = neighborIndex + offset;

              if (adjacentIndex >= 0 && adjacentIndex < tiles.length && tiles[adjacentIndex].imageIndex === neighborTile.imageIndex) {
                selectedTile = tiles[adjacentIndex];
              } else {
                selectedTile = neighborTile;
              }
            }
          } else {
            selectedTile = neighborTile;
          }
        } else {
          // No neighbors or random choice
          if (cycleTiles) {
            // Use tile from pool, reshuffle when exhausted
            selectedTile = tilePool[poolIndex];
            poolIndex++;
            if (poolIndex >= tilePool.length) {
              poolIndex = 0;
              // Reshuffle for next cycle
              for (let i = tilePool.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [tilePool[i], tilePool[j]] = [tilePool[j], tilePool[i]];
              }
            }
          } else {
            // Weighted selection
            selectedTile = selectWeightedTile();
          }
        }

        // Store in grid for neighbor checking
        grid[y][x] = selectedTile;

        // Draw tile from the correct tileset image
        const sourceImage = tilesetImagesRef.current[selectedTile.imageIndex];
        ctx.drawImage(
          sourceImage,
          selectedTile.x, selectedTile.y,
          TILE_SIZE, TILE_SIZE,
          x * scaledTileSize, y * scaledTileSize,
          scaledTileSize, scaledTileSize
        );

        // Apply glitch effects based on chaos
        if (Math.random() * 100 < chaos / 2) {
          const effect = Math.floor(Math.random() * 3);

          if (effect === 0) {
            // Horizontal flip
            ctx.save();
            ctx.scale(-1, 1);
            ctx.drawImage(
              sourceImage,
              selectedTile.x, selectedTile.y,
              TILE_SIZE, TILE_SIZE,
              -(x * scaledTileSize + scaledTileSize), y * scaledTileSize,
              scaledTileSize, scaledTileSize
            );
            ctx.restore();
          } else if (effect === 1) {
            // Add color overlay
            ctx.fillStyle = `rgba(${Math.random() * 255}, ${Math.random() * 255}, ${Math.random() * 255}, 0.3)`;
            ctx.fillRect(x * scaledTileSize, y * scaledTileSize, scaledTileSize, scaledTileSize);
          }
        }
      }
    }
  };

  // Export canvas as PNG
  const exportPattern = () => {
    const canvas = canvasRef.current;
    const link = document.createElement('a');
    link.download = `tile-glitch-${Date.now()}.png`;
    link.href = canvas.toDataURL();
    link.click();
  };

  // Re-slice tiles when excluded color changes
  useEffect(() => {
    if (tilesetImagesRef.current.length > 0) {
      sliceTilesets(tilesetImagesRef.current);
    }
  }, [excludeColor]);

  // Auto-generate only when tiles or canvas size changes (not on every parameter change)
  useEffect(() => {
    if (tiles.length > 0) {
      generatePattern();
    }
  }, [tiles, scale, canvasSize]);

  return (
    <div className="app">
      <header>
        <h1>🎨 Tile Glitch Generator</h1>
        <p>Upload an NES tileset and create glitchy patterns</p>
      </header>

      <div className="container">
        <div className="controls">
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
                    <button onClick={() => removeTileset(tileset.id)} className="remove-btn">
                      ✕
                    </button>
                  </div>
                  <div className="tileset-weight">
                    <label>Weight: {tilesetWeights[tileset.id] || 50}%</label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={tilesetWeights[tileset.id] || 50}
                      onChange={(e) => setTilesetWeights(prev => ({
                        ...prev,
                        [tileset.id]: Number(e.target.value)
                      }))}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="control-group">
            <label>Chaos: {chaos}%</label>
            <input
              type="range"
              min="0"
              max="100"
              value={chaos}
              onChange={(e) => setChaos(Number(e.target.value))}
            />
          </div>

          <div className="control-group">
            <label>Connection: {coherence}%</label>
            <input
              type="range"
              min="0"
              max="100"
              value={coherence}
              onChange={(e) => setCoherence(Number(e.target.value))}
            />
          </div>

          <div className="control-group">
            <label>Scale: {scale}x</label>
            <input
              type="range"
              min="1"
              max="4"
              step="1"
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
            />
          </div>

          <div className="control-group">
            <label>Normalize: {normalize}%</label>
            <input
              type="range"
              min="0"
              max="100"
              value={normalize}
              onChange={(e) => setNormalize(Number(e.target.value))}
            />
          </div>

          <div className="control-group">
            <label>Exclude Color</label>
            <input
              type="color"
              value={excludeColor || '#00ff00'}
              onChange={(e) => setExcludeColor(e.target.value)}
            />
            {excludeColor && (
              <button onClick={() => setExcludeColor('')} style={{ fontSize: '0.85rem', padding: '0.25rem 0.5rem' }}>
                Clear
              </button>
            )}
          </div>

          <div className="control-group checkbox">
            <label>
              <input
                type="checkbox"
                checked={cycleTiles}
                onChange={(e) => setCycleTiles(e.target.checked)}
              />
              Cycle All Tiles
            </label>
          </div>

          <button onClick={generatePattern} disabled={tiles.length === 0}>
            🎲 Regenerate
          </button>

          <button onClick={exportPattern} disabled={tiles.length === 0}>
            💾 Export PNG
          </button>

          {tiles.length > 0 && (
            <div className="info">
              📊 {tiles.length} tiles loaded
            </div>
          )}
        </div>

        <div className="canvas-wrapper">
          <canvas
            ref={canvasRef}
            width={canvasSize.width}
            height={canvasSize.height}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
