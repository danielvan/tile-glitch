import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import './App.css';
import { useTileset }          from './hooks/useTileset.js';
import { usePatternGenerator } from './hooks/usePatternGenerator.js';
import { useWebGLRenderer }    from './hooks/useWebGLRenderer.js';
import { useBackgroundImage }  from './hooks/useBackgroundImage.js';
import { useMask }             from './hooks/useMask.js';
import { TILE_SIZE }           from './webgl/constants.js';

// ── Icons ──────────────────────────────────────────────────────────────────
const IconX = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
    <line x1="1" y1="1" x2="11" y2="11" />
    <line x1="11" y1="1" x2="1" y2="11" />
  </svg>
);

const IconChevronLeft = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
    <polyline points="8,2 4,6 8,10" />
  </svg>
);

const IconChevronRight = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
    <polyline points="4,2 8,6 4,10" />
  </svg>
);

const IconLock = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="miter">
    <rect x="3" y="7" width="10" height="8" />
    <rect x="5" y="2" width="6" height="5" />
  </svg>
);

const IconRefresh = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="square" strokeLinejoin="miter">
    <path d="M13.5 8A5.5 5.5 0 1 1 10.2 3" />
    <polyline points="14,1 11,4 14,7" />
  </svg>
);

const IconTrash = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter">
    <rect x="2" y="4" width="10" height="9" />
    <line x1="0" y1="3" x2="14" y2="3" />
    <line x1="5" y1="1" x2="9" y2="1" />
  </svg>
);

// ── Sub-components ─────────────────────────────────────────────────────────
function SettingGroup({ label, value, displayValue, min, max, step = 1, onChange, onPointerUp, inv }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="setting-group">
      <div className="setting-heading">
        <span className="setting-name">{label}</span>
        <span className="setting-value">{displayValue ?? value}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={onChange} onPointerUp={onPointerUp}
        className={`slider${inv ? ' slider-inv' : ''}`}
        style={{ '--pct': `${pct}%` }}
      />
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle-row">
      <span className={`toggle-indicator${checked ? ' on' : ''}`}>
        {checked && <IconX />}
      </span>
      <span className="toggle-label">{label}</span>
      <input type="checkbox" checked={checked} onChange={onChange} />
    </label>
  );
}

// ── Saved state ────────────────────────────────────────────────────────────
function loadSaved() {
  try { return JSON.parse(localStorage.getItem('tile-glitch') ?? '{}'); } catch { return {}; }
}
const _s = loadSaved();

// ── App ────────────────────────────────────────────────────────────────────
function App() {
  const [tilesets, setTilesets]                     = useState([]);
  const [chaos, setChaos]                           = useState(_s.chaos ?? 50);
  const [coherence, setCoherence]                   = useState(_s.coherence ?? 50);
  const [normalize, setNormalize]                   = useState(_s.normalize ?? 50);
  const [scale, setScale]                           = useState(_s.scale ?? 1);
  const [excludeTolerance, setExcludeTolerance]     = useState(_s.excludeTolerance ?? 8);
  const [tilesetWeights, setTilesetWeights]         = useState(_s.tilesetWeights ?? {});
  const [cycleTiles, setCycleTiles]                 = useState(_s.cycleTiles ?? false);
  const [circularMaskChance, setCircularMaskChance] = useState(_s.circularMaskChance ?? 0);
  const [disappearChance, setDisappearChance]       = useState(_s.disappearChance ?? 0);
  const [backgroundColor, setBackgroundColor]       = useState(_s.backgroundColor ?? '#000000');
  const [animateMasks, setAnimateMasks]             = useState(_s.animateMasks ?? false);
  const [animationSpeed, setAnimationSpeed]         = useState(_s.animationSpeed ?? 50);
  const [minimizeUI, setMinimizeUI]                 = useState(false);
  const [livePreview, setLivePreview]               = useState(_s.livePreview ?? true);
  const [seed, setSeed]                             = useState(_s.seed ?? Math.floor(Math.random() * 1e9));
  const [locked, setLocked]                         = useState(_s.locked ?? false);
  const [effectChroma,    setEffectChroma]    = useState(_s.effectChroma    ?? 0);
  const [effectScanlines, setEffectScanlines] = useState(_s.effectScanlines ?? 0);
  const [effectBarrel,    setEffectBarrel]    = useState(_s.effectBarrel    ?? 0);
  const [effectVignette,  setEffectVignette]  = useState(_s.effectVignette  ?? 0);
  const [effectGrain,     setEffectGrain]     = useState(_s.effectGrain     ?? 0);
  const [effectCRTMask,   setEffectCRTMask]   = useState(_s.effectCRTMask   ?? 0);
  const [paintMode, setPaintMode]                   = useState('paint');
  const [brushSize, setBrushSize]                   = useState(1);
  const [zoom, setZoom]                             = useState(1);
  const [aspectRatio, setAspectRatio]               = useState(_s.aspectRatio ?? 'free');
  const [exportScale, setExportScale]               = useState(1);
  const [cropOffset, setCropOffset]                 = useState({ x: 0, y: 0 });

  const ASPECT_RATIOS = useMemo(() => ({
    '1:1': [1,1], '4:3': [4,3], '3:2': [3,2], '16:9': [16,9],
    '9:16': [9,16], '2:3': [2,3], '3:4': [3,4],
  }), []);

  const PANEL_WIDTH = minimizeUI ? 40 : 232;

  const canvasRef  = useRef(null);
  const wrapperRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({
    width: window.innerWidth - PANEL_WIDTH,
    height: window.innerHeight,
  });

  useEffect(() => {
    const update = () => setCanvasSize({ width: window.innerWidth - PANEL_WIDTH, height: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [PANEL_WIDTH]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(z => Math.min(4, Math.max(0.25, +(z - e.deltaY * 0.001).toFixed(3))));
    };
    wrapper.addEventListener('wheel', onWheel, { passive: false });
    return () => wrapper.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const saved = _s.tilesets;
    if (!saved?.length) return;
    Promise.all(saved.map(t => new Promise(resolve => {
      const img = new Image();
      img.onload  = () => resolve({ ...t, img });
      img.onerror = () => resolve(null);
      img.src = t.url;
    }))).then(results => setTilesets(results.filter(Boolean)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    files.forEach((file, index) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const newId = Date.now() + index;
          const name = file.name.replace(/\.[^.]+$/, '');
          setTilesets(prev => [...prev, { id: newId, url: event.target.result, img, name, excludeColors: [] }]);
          setTilesetWeights(prev => ({ ...prev, [newId]: 50 }));
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });
  };

  const removeTileset      = (id) => {
    setTilesets(prev => prev.filter(t => t.id !== id));
    setTilesetWeights(prev => { const n = { ...prev }; delete n[id]; return n; });
  };
  const addExcludeColor    = (id) => setTilesets(prev => prev.map(t => t.id === id ? { ...t, excludeColors: [...t.excludeColors, '#00ff00'] } : t));
  const removeExcludeColor = (id, i) => setTilesets(prev => prev.map(t => t.id === id ? { ...t, excludeColors: t.excludeColors.filter((_, j) => j !== i) } : t));
  const updateExcludeColor = (id, i, hex) => setTilesets(prev => prev.map(t => t.id === id ? { ...t, excludeColors: t.excludeColors.map((c, j) => j === i ? hex : c) } : t));

  useEffect(() => { setCropOffset({ x: 0, y: 0 }); }, [aspectRatio]);

  const cropRect = useMemo(() => {
    if (aspectRatio === 'free') return null;
    const [wr, hr] = ASPECT_RATIOS[aspectRatio];
    const s   = Math.min(canvasSize.width / wr, canvasSize.height / hr);
    const w   = Math.round(wr * s);
    const h   = Math.round(hr * s);
    const maxX = Math.floor((canvasSize.width  - w) / 2);
    const maxY = Math.floor((canvasSize.height - h) / 2);
    const cx  = Math.max(-maxX, Math.min(maxX, cropOffset.x));
    const cy  = Math.max(-maxY, Math.min(maxY, cropOffset.y));
    return { x: maxX + cx, y: maxY + cy, width: w, height: h, maxX, maxY };
  }, [aspectRatio, canvasSize, cropOffset, ASPECT_RATIOS]);

  const startCropDrag = useCallback((e) => {
    e.preventDefault();
    let lastX = e.clientX, lastY = e.clientY;
    const onMove = (ev) => {
      const dx = ev.clientX - lastX, dy = ev.clientY - lastY;
      lastX = ev.clientX; lastY = ev.clientY;
      setCropOffset(o => {
        const ratio = ASPECT_RATIOS[aspectRatio];
        if (!ratio) return o;
        const s    = Math.min(canvasSize.width / ratio[0], canvasSize.height / ratio[1]);
        const maxX = Math.floor((canvasSize.width  - Math.round(ratio[0] * s)) / 2);
        const maxY = Math.floor((canvasSize.height - Math.round(ratio[1] * s)) / 2);
        return { x: Math.max(-maxX, Math.min(maxX, o.x + dx)), y: Math.max(-maxY, Math.min(maxY, o.y + dy)) };
      });
    };
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [aspectRatio, canvasSize, ASPECT_RATIOS]);

  const atlasData      = useTileset(tilesets, excludeTolerance);
  const cols           = Math.floor(canvasSize.width  / (TILE_SIZE * scale));
  const rows           = Math.floor(canvasSize.height / (TILE_SIZE * scale));
  const scaledTileSize = TILE_SIZE * scale;

  const settings = useMemo(() => ({
    cols, rows, scaledTileSize,
    chaos, coherence, normalize,
    circularMaskChance, disappearChance,
    cycleTiles, tilesetWeights, seed,
  }), [cols, rows, scaledTileSize, chaos, coherence, normalize,
       circularMaskChance, disappearChance, cycleTiles, tilesetWeights, seed]);

  const { instanceData, generate } = usePatternGenerator(atlasData, settings, livePreview, locked);
  const { bgImage, bgUrl, bgDataUrl, handleBgUpload, clearBackground } = useBackgroundImage(_s.bgDataUrl ?? null);
  const { maskTextureRef, maskVersion, resetMask, brushPreview, undo, redo, canUndo, canRedo } =
    useMask(canvasRef, cols, rows, scaledTileSize, paintMode, brushSize);

  const { fps, captureFrame } = useWebGLRenderer(canvasRef, atlasData, instanceData, {
    backgroundColor, scale, canvasSize, animateMasks, animationSpeed,
    bgImage, maskTextureRef, maskVersion,
    effects: {
      chroma:    effectChroma,
      scanlines: effectScanlines,
      barrel:    effectBarrel,
      vignette:  effectVignette,
      grain:     effectGrain,
      crtMask:   effectCRTMask,
    },
  });

  useEffect(() => {
    try {
      localStorage.setItem('tile-glitch', JSON.stringify({
        chaos, coherence, normalize, scale, excludeTolerance,
        circularMaskChance, disappearChance, backgroundColor,
        animateMasks, animationSpeed, cycleTiles, livePreview,
        seed, locked, tilesetWeights,
        effectChroma, effectScanlines, effectBarrel, effectVignette, effectGrain, effectCRTMask,
        tilesets: tilesets.map(t => ({ id: t.id, url: t.url, name: t.name, excludeColors: t.excludeColors ?? [] })),
        bgDataUrl: bgDataUrl ?? null,
        aspectRatio,
      }));
    } catch { /* localStorage full */ }
  }, [chaos, coherence, normalize, scale, excludeTolerance,
      circularMaskChance, disappearChance, backgroundColor,
      animateMasks, animationSpeed, cycleTiles, livePreview,
      seed, locked, tilesetWeights,
      effectChroma, effectScanlines, effectBarrel, effectVignette, effectGrain, effectCRTMask,
      tilesets, bgDataUrl, aspectRatio]);

  const handleChange    = (setter) => (e) => setter(Number(e.target.value));
  const handlePointerUp = useCallback(() => { if (!livePreview && !locked) generate(); }, [livePreview, locked, generate]);

  const handleNewSeed = useCallback(() => {
    const newSeed = Math.floor(Math.random() * 1e9);
    setSeed(newSeed);
    generate({ seed: newSeed });
  }, [generate]);

  const exportPattern = () => {
    const frame = captureFrame();
    if (!frame) return;
    const { pixels, width: cw, height: ch } = frame;
    const full  = document.createElement('canvas');
    full.width  = cw; full.height = ch;
    const fctx  = full.getContext('2d');
    const imgData = fctx.createImageData(cw, ch);
    for (let row = 0; row < ch; row++) {
      imgData.data.set(pixels.subarray((ch - 1 - row) * cw * 4, (ch - row) * cw * 4), row * cw * 4);
    }
    fctx.putImageData(imgData, 0, 0);
    const sx = cropRect ? cropRect.x      : 0;
    const sy = cropRect ? cropRect.y      : 0;
    const sw = cropRect ? cropRect.width  : cw;
    const sh = cropRect ? cropRect.height : ch;
    const out = document.createElement('canvas');
    out.width  = sw * exportScale;
    out.height = sh * exportScale;
    const ctx  = out.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(full, sx, sy, sw, sh, 0, 0, out.width, out.height);
    const link = document.createElement('a');
    link.download = `tile-glitch-${Date.now()}${exportScale > 1 ? `-${exportScale}x` : ''}.png`;
    link.href = out.toDataURL();
    link.click();
  };

  const exportPreset = () => {
    const preset = {
      version: 1,
      chaos, coherence, normalize, scale, excludeTolerance,
      circularMaskChance, disappearChance, backgroundColor,
      animateMasks, animationSpeed, cycleTiles, livePreview,
      seed, locked, tilesetWeights,
      effectChroma, effectScanlines, effectBarrel, effectVignette, effectGrain, effectCRTMask,
      tilesets: tilesets.map(t => ({ name: t.name ?? 'tileset', weight: tilesetWeights[t.id] ?? 50, excludeColors: t.excludeColors ?? [] })),
      background: bgUrl ? { name: 'background' } : null,
    };
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.download = `tile-glitch-preset-${Date.now()}.json`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const importPreset = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const p = JSON.parse(ev.target.result);
        if (p.chaos              !== undefined) setChaos(p.chaos);
        if (p.coherence          !== undefined) setCoherence(p.coherence);
        if (p.normalize          !== undefined) setNormalize(p.normalize);
        if (p.scale              !== undefined) setScale(p.scale);
        if (p.excludeTolerance   !== undefined) setExcludeTolerance(p.excludeTolerance);
        if (p.circularMaskChance !== undefined) setCircularMaskChance(p.circularMaskChance);
        if (p.disappearChance    !== undefined) setDisappearChance(p.disappearChance);
        if (p.backgroundColor    !== undefined) setBackgroundColor(p.backgroundColor);
        if (p.animateMasks       !== undefined) setAnimateMasks(p.animateMasks);
        if (p.animationSpeed     !== undefined) setAnimationSpeed(p.animationSpeed);
        if (p.cycleTiles         !== undefined) setCycleTiles(p.cycleTiles);
        if (p.livePreview        !== undefined) setLivePreview(p.livePreview);
        if (p.seed               !== undefined) setSeed(p.seed);
        if (p.locked             !== undefined) setLocked(p.locked);
        if (p.tilesetWeights     !== undefined) setTilesetWeights(p.tilesetWeights);
        if (p.effectChroma       !== undefined) setEffectChroma(p.effectChroma);
        if (p.effectScanlines    !== undefined) setEffectScanlines(p.effectScanlines);
        if (p.effectBarrel       !== undefined) setEffectBarrel(p.effectBarrel);
        if (p.effectVignette     !== undefined) setEffectVignette(p.effectVignette);
        if (p.effectGrain        !== undefined) setEffectGrain(p.effectGrain);
        if (p.effectCRTMask      !== undefined) setEffectCRTMask(p.effectCRTMask);
      } catch { /* malformed JSON */ }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  const tileCount = atlasData?.tiles.length ?? 0;

  return (
    <div className="app">
      <div className="container">

        {/* ── Side panel ──────────────────────────────────────────────── */}
        <div className={`panel${minimizeUI ? ' collapsed' : ''}`}>
          <button className="panel-toggle" onClick={() => setMinimizeUI(u => !u)} title={minimizeUI ? 'Expand' : 'Collapse'}>
            {minimizeUI ? <IconChevronLeft /> : <IconChevronRight />}
          </button>

          <div className="panel-body">

            {/* GENERATION */}
            <div className="section">
              <span className="section-label">Generation</span>
              <div className="gen-row">
                <span className="seed-value">{seed}</span>
                <button className={`icon-btn${locked ? ' locked' : ''}`} onClick={() => setLocked(l => !l)} title={locked ? 'Unlock' : 'Lock'}>
                  <IconLock />
                </button>
                <button className="icon-btn" onClick={handleNewSeed} title="New seed">
                  <IconRefresh />
                </button>
              </div>
            </div>

            {/* TILESETS */}
            <div className="section">
              <span className="section-label">Tilesets</span>

              {tilesets.map((tileset, index) => (
                <div key={tileset.id} className="tileset-card">
                  <div className="tileset-header">
                    <span className="tileset-name">{tileset.name ?? `Tileset ${index + 1}`}</span>
                    <button className="tileset-remove" onClick={() => removeTileset(tileset.id)} title="Remove">
                      <IconTrash />
                    </button>
                  </div>
                  <SettingGroup
                    label="Weight" value={tilesetWeights[tileset.id] ?? 50}
                    displayValue={`${tilesetWeights[tileset.id] ?? 50}%`}
                    min={0} max={100}
                    onChange={e => setTilesetWeights(prev => ({ ...prev, [tileset.id]: Number(e.target.value) }))}
                    onPointerUp={handlePointerUp} inv
                  />
                  {(tileset.excludeColors ?? []).length > 0 && (
                    <div className="exclude-colors">
                      {tileset.excludeColors.map((hex, i) => (
                        <div key={i} className="exclude-swatch">
                          <input type="color" value={hex} onChange={e => updateExcludeColor(tileset.id, i, e.target.value)} />
                          <button className="swatch-remove" onClick={() => removeExcludeColor(tileset.id, i)}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button className="btn btn-on-dark" onClick={() => addExcludeColor(tileset.id)}>
                    Exclude Color
                  </button>
                </div>
              ))}

              <label className="btn btn-primary" htmlFor="tileset-upload">Add Tileset</label>
              <input id="tileset-upload" type="file" accept="image/*" multiple onChange={handleFileUpload} style={{ display: 'none' }} />

              {tileCount > 0 && <span className="tile-info">{tileCount} tiles loaded</span>}
            </div>

            {/* PARAMETERS */}
            <div className="section">
              <span className="section-label">Parameters</span>
              <SettingGroup label="Chaos"         value={chaos}              displayValue={`${chaos}%`}              min={0} max={100} onChange={handleChange(setChaos)}              onPointerUp={handlePointerUp} />
              <SettingGroup label="Connection"    value={coherence}          displayValue={`${coherence}%`}          min={0} max={100} onChange={handleChange(setCoherence)}          onPointerUp={handlePointerUp} />
              <SettingGroup label="Scale"         value={scale}              displayValue={`${scale}×`}              min={1} max={4} step={1} onChange={handleChange(setScale)}       onPointerUp={handlePointerUp} />
              <SettingGroup label="Normalize"     value={normalize}          displayValue={`${normalize}%`}          min={0} max={100} onChange={handleChange(setNormalize)}          onPointerUp={handlePointerUp} />
              <SettingGroup label="Circular Mask" value={circularMaskChance} displayValue={`${circularMaskChance}%`} min={0} max={100} onChange={handleChange(setCircularMaskChance)} onPointerUp={handlePointerUp} />
              <SettingGroup label="Disappear"     value={disappearChance}    displayValue={`${disappearChance}%`}    min={0} max={100} onChange={handleChange(setDisappearChance)}    onPointerUp={handlePointerUp} />
              <Toggle checked={animateMasks} onChange={e => setAnimateMasks(e.target.checked)} label="Animate Masks" />
              {animateMasks && (
                <SettingGroup label="Anim Speed" value={animationSpeed} displayValue={`${animationSpeed}%`} min={1} max={100} onChange={handleChange(setAnimationSpeed)} onPointerUp={handlePointerUp} />
              )}
              <Toggle checked={cycleTiles} onChange={e => setCycleTiles(e.target.checked)} label="Cycle All Tiles" />
            </div>

            {/* EFFECTS */}
            <div className="section">
              <span className="section-label">Effects</span>
              <SettingGroup label="Chroma"    value={effectChroma}    displayValue={`${effectChroma}%`}    min={0} max={100} onChange={handleChange(setEffectChroma)} />
              <SettingGroup label="Scanlines" value={effectScanlines} displayValue={`${effectScanlines}%`} min={0} max={100} onChange={handleChange(setEffectScanlines)} />
              <SettingGroup label="Barrel"    value={effectBarrel}    displayValue={`${effectBarrel}%`}    min={0} max={100} onChange={handleChange(setEffectBarrel)} />
              <SettingGroup label="Vignette"  value={effectVignette}  displayValue={`${effectVignette}%`}  min={0} max={100} onChange={handleChange(setEffectVignette)} />
              <SettingGroup label="Film Grain" value={effectGrain}    displayValue={`${effectGrain}%`}     min={0} max={100} onChange={handleChange(setEffectGrain)} />
              <SettingGroup label="CRT Mask"  value={effectCRTMask}   displayValue={`${effectCRTMask}%`}   min={0} max={100} onChange={handleChange(setEffectCRTMask)} />
            </div>

            {/* COLORS */}
            <div className="section">
              <span className="section-label">Colors</span>
              <div className="setting-group">
                <div className="setting-heading">
                  <span className="setting-name">Background</span>
                </div>
                <input type="color" value={backgroundColor} onChange={e => setBackgroundColor(e.target.value)} className="color-input" />
              </div>
              <SettingGroup label="Excl. Tolerance" value={excludeTolerance} min={0} max={32} onChange={handleChange(setExcludeTolerance)} onPointerUp={handlePointerUp} />
            </div>

            {/* BACKGROUND */}
            <div className="section">
              <span className="section-label">Background</span>
              <div className="bg-row">
                <label className="btn btn-secondary" htmlFor="bg-upload">Upload</label>
                <input id="bg-upload" type="file" accept="image/*" onChange={handleBgUpload} style={{ display: 'none' }} />
                {bgUrl && <>
                  <img src={bgUrl} alt="bg" className="bg-thumbnail" />
                  <button className="btn btn-secondary" style={{ width: 'auto', padding: '0 10px' }} onClick={clearBackground}>Clear</button>
                </>}
              </div>
            </div>

            {/* MASK */}
            <div className="section">
              <span className="section-label">Mask</span>
              <div className="btn-group">
                <button className={`btn-toggle${paintMode === 'paint' ? ' active' : ''}`} onClick={() => setPaintMode('paint')}>Paint</button>
                <button className={`btn-toggle${paintMode === 'erase' ? ' active' : ''}`} onClick={() => setPaintMode('erase')}>Erase</button>
              </div>
              <SettingGroup label="Brush Size" value={brushSize} min={1} max={10} onChange={handleChange(setBrushSize)} />
              <div className="undo-row">
                <button className="btn btn-secondary" onClick={undo} disabled={!canUndo}>Undo</button>
                <button className="btn btn-secondary" onClick={redo} disabled={!canRedo}>Redo</button>
              </div>
              <button className="btn btn-secondary" onClick={resetMask}>Reset Mask</button>
            </div>

            {/* CANVAS */}
            <div className="section">
              <span className="section-label">Canvas</span>
              <div className="aspect-grid">
                {['free', '1:1', '4:3', '3:2', '16:9', '9:16', '2:3', '3:4'].map(r => (
                  <button key={r} className={`btn-toggle${aspectRatio === r ? ' active' : ''}`} onClick={() => setAspectRatio(r)}>
                    {r === 'free' ? 'Free' : r}
                  </button>
                ))}
              </div>
            </div>

            {/* EXPORT */}
            <div className="section">
              <span className="section-label">Export</span>
              <Toggle checked={livePreview} onChange={e => setLivePreview(e.target.checked)} label="Live Preview" />
              <button className="btn btn-secondary" onClick={() => generate()} disabled={tileCount === 0 || locked}>
                Regenerate
              </button>
              <div className="setting-group">
                <div className="setting-heading">
                  <span className="setting-name">Scale</span>
                </div>
                <div className="scale-row">
                  {[1, 2, 4, 8].map(s => (
                    <button key={s} className={`btn-toggle${exportScale === s ? ' active' : ''}`} onClick={() => setExportScale(s)}>
                      {s}×
                    </button>
                  ))}
                </div>
              </div>
              <button className="btn btn-primary" onClick={exportPattern} disabled={tileCount === 0}>
                Export PNG
              </button>
              <button className="btn btn-secondary" onClick={exportPreset}>
                Export Preset
              </button>
              <label className="btn btn-secondary" htmlFor="import-preset">
                Import Preset
              </label>
              <input id="import-preset" type="file" accept=".json" onChange={importPreset} style={{ display: 'none' }} />
            </div>

          </div>
        </div>

        {/* ── Canvas area ─────────────────────────────────────────────── */}
        <div className="canvas-wrapper" ref={wrapperRef}>
          <div style={{ transformOrigin: '0 0', transform: `scale(${zoom})`, display: 'inline-block', lineHeight: 0 }}>
            <canvas ref={canvasRef} width={canvasSize.width} height={canvasSize.height} />
            {brushPreview && tileCount > 0 && (
              <div className="brush-preview" style={{
                left:   `${(brushPreview.col - brushPreview.size) * scaledTileSize}px`,
                top:    `${(brushPreview.row - brushPreview.size) * scaledTileSize}px`,
                width:  `${(brushPreview.size * 2 + 1) * scaledTileSize}px`,
                height: `${(brushPreview.size * 2 + 1) * scaledTileSize}px`,
              }} />
            )}
            {cropRect && (<>
              <div className="crop-overlay" style={{ left: cropRect.x, top: cropRect.y, width: cropRect.width, height: cropRect.height }} />
              <div className="crop-drag-strip" style={{ left: 0, top: 0, width: canvasSize.width, height: cropRect.y }} onPointerDown={startCropDrag} />
              <div className="crop-drag-strip" style={{ left: 0, top: cropRect.y + cropRect.height, width: canvasSize.width, height: canvasSize.height - cropRect.y - cropRect.height }} onPointerDown={startCropDrag} />
              <div className="crop-drag-strip" style={{ left: 0, top: cropRect.y, width: cropRect.x, height: cropRect.height }} onPointerDown={startCropDrag} />
              <div className="crop-drag-strip" style={{ left: cropRect.x + cropRect.width, top: cropRect.y, width: canvasSize.width - cropRect.x - cropRect.width, height: cropRect.height }} onPointerDown={startCropDrag} />
            </>)}
          </div>
          {import.meta.env.DEV && animateMasks && fps !== null && (
            <div className="fps-overlay">{fps} fps</div>
          )}
          {zoom !== 1 && (
            <button className="zoom-reset" onClick={() => setZoom(1)}>
              {Math.round(zoom * 100)}% ↺
            </button>
          )}
        </div>

      </div>
    </div>
  );
}

export default App;
