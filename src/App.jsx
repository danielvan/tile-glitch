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
  const [paintMode, setPaintMode]                   = useState('paint');
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

  const { maskTextureRef, maskVersion, resetMask, brushPreview, undo, redo, canUndo, canRedo } =
    useMask(canvasRef, cols, rows, scaledTileSize, paintMode, brushSize);

  const fps = useWebGLRenderer(canvasRef, atlasData, instanceData, {
    backgroundColor, scale, canvasSize, animateMasks, animationSpeed,
    bgImage, maskTextureRef, maskVersion,
  });

  const handleChange    = (setter) => (e) => setter(Number(e.target.value));
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

              <div className="undo-redo-row">
                <button className="btn-secondary" onClick={undo} disabled={!canUndo}>↩ Undo</button>
                <button className="btn-secondary" onClick={redo} disabled={!canRedo}>↪ Redo</button>
              </div>

              <button className="btn-secondary" onClick={resetMask}>Reset Mask</button>

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
