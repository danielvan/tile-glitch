# Feature Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement four features in sequence: JSON preset export/import, docked side panel, canvas zoom, fixed aspect ratio mode, and print-quality PNG export.

**Architecture:** Each phase is self-contained. Phases 1–2 are pure UI additions to App.jsx/App.css. Phase 3 (zoom) adds a CSS transform layer. Phase 4 (aspect ratio) changes how `canvasSize` is derived. Phase 5 (print export) hooks into the WebGL renderer for an offscreen high-res render.

**Tech Stack:** React 19, Vite 7, WebGL via twgl.js, CSS (no new dependencies)

---

## Phase 1 — JSON Preset Export / Import

**Files:**
- Modify: `src/App.jsx`

### Task 1: Store filename on tileset load

**Files:**
- Modify: `src/App.jsx:66-82` (`handleFileUpload`)

- [ ] **Step 1: Add `name` field when loading tilesets**

In `handleFileUpload`, add `name: file.name` to the new tileset object:

```jsx
setTilesets(prev => [...prev, { id: newId, url: event.target.result, img, name: file.name, excludeColors: [] }]);
```

- [ ] **Step 2: Verify manually**

Upload a tileset. Open DevTools → Application → localStorage → `tile-glitch`. The tileset entry should still save correctly (name is stored in state but not yet in localStorage; that's fine for now).

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "feat: store filename on tileset load"
```

---

### Task 2: Add Export JSON button

**Files:**
- Modify: `src/App.jsx` (add `exportPreset` function + button)

- [ ] **Step 1: Add `exportPreset` function**

Add this function just below `exportPattern` in App.jsx:

```jsx
const exportPreset = () => {
  const preset = {
    version: 1,
    chaos, coherence, normalize, scale, excludeTolerance,
    circularMaskChance, disappearChance, backgroundColor,
    animateMasks, animationSpeed, cycleTiles, livePreview,
    seed, locked, tilesetWeights,
    effectChroma, effectScanlines, effectBarrel, effectVignette, effectGrain, effectCRTMask,
    tilesets: tilesets.map(t => ({
      name: t.name ?? 'tileset',
      weight: tilesetWeights[t.id] ?? 50,
      excludeColors: t.excludeColors ?? [],
    })),
    background: bgUrl ? { name: 'background' } : null,
  };
  const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.download = `tile-glitch-preset-${Date.now()}.json`;
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
};
```

- [ ] **Step 2: Add button in the export section**

In the JSX, add this button directly below the `💾 Export PNG` button:

```jsx
<button onClick={exportPreset} disabled={tileCount === 0}>
  📋 Export Preset
</button>
```

- [ ] **Step 3: Verify manually**

Load a tileset, change some sliders, click "Export Preset". Open the downloaded JSON — it should contain all current settings and a `tilesets` array with `name`, `weight`, `excludeColors`. The `background` key should be `null` if no bg is loaded.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat: export preset as JSON with filenames"
```

---

### Task 3: Add Import JSON button

**Files:**
- Modify: `src/App.jsx` (add `importPreset` function + hidden file input + button)

- [ ] **Step 1: Add `importPreset` function**

Add below `exportPreset`:

```jsx
const importPreset = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const p = JSON.parse(ev.target.result);
      if (p.chaos           !== undefined) setChaos(p.chaos);
      if (p.coherence       !== undefined) setCoherence(p.coherence);
      if (p.normalize       !== undefined) setNormalize(p.normalize);
      if (p.scale           !== undefined) setScale(p.scale);
      if (p.excludeTolerance !== undefined) setExcludeTolerance(p.excludeTolerance);
      if (p.circularMaskChance !== undefined) setCircularMaskChance(p.circularMaskChance);
      if (p.disappearChance !== undefined) setDisappearChance(p.disappearChance);
      if (p.backgroundColor !== undefined) setBackgroundColor(p.backgroundColor);
      if (p.animateMasks    !== undefined) setAnimateMasks(p.animateMasks);
      if (p.animationSpeed  !== undefined) setAnimationSpeed(p.animationSpeed);
      if (p.cycleTiles      !== undefined) setCycleTiles(p.cycleTiles);
      if (p.livePreview     !== undefined) setLivePreview(p.livePreview);
      if (p.seed            !== undefined) setSeed(p.seed);
      if (p.locked          !== undefined) setLocked(p.locked);
      if (p.tilesetWeights  !== undefined) setTilesetWeights(p.tilesetWeights);
      if (p.effectChroma    !== undefined) setEffectChroma(p.effectChroma);
      if (p.effectScanlines !== undefined) setEffectScanlines(p.effectScanlines);
      if (p.effectBarrel    !== undefined) setEffectBarrel(p.effectBarrel);
      if (p.effectVignette  !== undefined) setEffectVignette(p.effectVignette);
      if (p.effectGrain     !== undefined) setEffectGrain(p.effectGrain);
      if (p.effectCRTMask   !== undefined) setEffectCRTMask(p.effectCRTMask);
    } catch { /* malformed JSON — ignore */ }
    e.target.value = '';
  };
  reader.readAsText(file);
};
```

- [ ] **Step 2: Add hidden input + button in JSX**

Add this directly below the "Export Preset" button:

```jsx
<label className="btn-secondary" htmlFor="import-preset" style={{ textAlign: 'center', cursor: 'pointer' }}>
  📂 Import Preset
</label>
<input id="import-preset" type="file" accept=".json" onChange={importPreset}
  style={{ display: 'none' }} />
```

- [ ] **Step 3: Verify manually**

Export a preset, change some sliders, then import the preset back. All sliders should snap back to the exported values. Note: tilesets and background images are NOT restored (user must re-upload them). This is expected behaviour — the JSON only stores filenames as a reference.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat: import preset from JSON, restores all settings"
```

---

## Phase 2 — Docked Side Panel

The controls panel moves from a floating overlay to a permanent side column. The canvas resizes to fill the remaining space.

**Files:**
- Modify: `src/App.jsx` (canvas size calculation, docked state)
- Modify: `src/App.css` (layout)

### Task 4: Add docked panel toggle state and CSS

**Files:**
- Modify: `src/App.jsx:31` (add `dockedPanel` state)
- Modify: `src/App.css`

- [ ] **Step 1: Add state**

Add to the state declarations at the top of `App()`:

```jsx
const [dockedPanel, setDockedPanel] = useState(_s.dockedPanel ?? false);
```

- [ ] **Step 2: Include `dockedPanel` in auto-save**

In the `localStorage.setItem` call, add `dockedPanel` to the object and add it to the deps array:

```js
// in the JSON object:
dockedPanel,
```

```js
// in the deps array at the end of the useEffect:
tilesets, bgDataUrl, dockedPanel]);
```

- [ ] **Step 3: Wire canvas size to panel width**

Replace the static `canvasSize` resize handler:

```jsx
const PANEL_WIDTH = 242; // matches CSS

useEffect(() => {
  const onResize = () => setCanvasSize({
    width:  dockedPanel ? window.innerWidth - PANEL_WIDTH : window.innerWidth,
    height: window.innerHeight,
  });
  onResize();
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}, [dockedPanel]);
```

- [ ] **Step 4: Update CSS for docked layout**

Replace `.app`, `.container`, `.controls`, and `.canvas-wrapper` in `App.css`:

```css
.app {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  display: flex;
}

.container {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
}

/* Docked panel sits as a flex column */
.controls.docked {
  position: relative;
  top: unset;
  right: unset;
  width: 242px;
  height: 100vh;
  max-height: 100vh;
  border-radius: 0;
  border-top: none;
  border-bottom: none;
  border-left: none;
  flex-shrink: 0;
  z-index: 10;
}

/* Float panel stays as before */
.controls:not(.docked) {
  position: fixed;
  top: 0.5rem;
  right: 0.5rem;
  width: 230px;
  max-height: calc(100vh - 1rem);
  border-radius: var(--radius);
}

.canvas-wrapper {
  position: relative;
  flex: 1;
  height: 100%;
  overflow: hidden;
}
```

- [ ] **Step 5: Add docked toggle button in JSX**

Add this button inside the controls div, just above the minimize button:

```jsx
<button
  className="btn-small"
  style={{ marginBottom: '0.2rem' }}
  onClick={() => setDockedPanel(d => !d)}
  title={dockedPanel ? 'Float panel' : 'Dock panel'}
>
  {dockedPanel ? '◧ Float' : '◧ Dock'}
</button>
```

And add `docked` class conditionally to the controls div:

```jsx
<div className={`controls ${minimizeUI ? 'minimized' : ''} ${dockedPanel ? 'docked' : ''}`}>
```

- [ ] **Step 6: Verify manually**

Click "Dock" — panel should move to the left edge, canvas should resize to fill remaining space. Click "Float" — panel returns to overlay. Resize window in both modes and verify canvas fills the correct area.

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx src/App.css
git commit -m "feat: docked side panel option — controls beside canvas"
```

---

## Phase 3 — Canvas Zoom

Zoom scales the rendered output visually via CSS transform. The underlying WebGL canvas still renders at native resolution; zoom is purely display-level.

**Files:**
- Modify: `src/App.jsx` (add `zoom` state, wheel handler)
- Modify: `src/App.css` (scrollable canvas container)

### Task 5: Add zoom state and wheel handler

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Add `zoom` state**

```jsx
const [zoom, setZoom] = useState(1);
```

- [ ] **Step 2: Add wheel handler on the canvas wrapper**

Add a `onWheel` handler to the canvas-wrapper div:

```jsx
const handleWheel = useCallback((e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  setZoom(z => Math.min(4, Math.max(0.25, z - e.deltaY * 0.001)));
}, []);
```

Add `onWheel={handleWheel}` to the canvas-wrapper div.

- [ ] **Step 3: Apply CSS transform to canvas**

Add `style` to the canvas element:

```jsx
<canvas
  ref={canvasRef}
  width={canvasSize.width}
  height={canvasSize.height}
  style={{ transformOrigin: '0 0', transform: `scale(${zoom})` }}
/>
```

- [ ] **Step 4: Update canvas-wrapper CSS to allow scrolling when zoomed**

Add to `.canvas-wrapper` in App.css:

```css
.canvas-wrapper {
  overflow: auto;
}
```

- [ ] **Step 5: Add a zoom reset button (optional)**

Add a small zoom indicator/reset near the canvas bottom:

```jsx
{zoom !== 1 && (
  <button
    className="btn-small"
    style={{ position: 'absolute', bottom: 8, right: 8, zIndex: 10 }}
    onClick={() => setZoom(1)}
  >
    {Math.round(zoom * 100)}% ↺
  </button>
)}
```

- [ ] **Step 6: Verify manually**

Hold Cmd (Mac) or Ctrl and scroll on the canvas. It should zoom in/out. Release to stop. Zooming in past 1x should show scrollbars (canvas overflows wrapper). The `↺` button should reset to 100%.

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx src/App.css
git commit -m "feat: canvas zoom via Cmd+scroll, reset button"
```

---

## Phase 4 — Fixed Aspect Ratio / Poster Mode

When an aspect ratio is locked, the canvas renders at exact pixel dimensions that fit the viewport at that ratio. This enables intentional composition for specific output formats.

**Files:**
- Modify: `src/App.jsx` (aspect ratio state, size derivation)
- Modify: `src/App.css` (centered canvas when letterboxed)

### Task 6: Aspect ratio state and size calculation

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Add aspect ratio state**

```jsx
const [aspectRatio, setAspectRatio] = useState(_s.aspectRatio ?? 'free');
```

Include `aspectRatio` in the auto-save object and deps array.

- [ ] **Step 2: Replace the resize handler with an aspect-aware version**

Replace the existing resize `useEffect` (the one that sets canvasSize) with:

```jsx
const ASPECT_RATIOS = {
  free:   null,
  '1:1':  [1, 1],
  '4:3':  [4, 3],
  '3:2':  [3, 2],
  '16:9': [16, 9],
  '9:16': [9, 16],
  '2:3':  [2, 3],
};

useEffect(() => {
  const computeSize = () => {
    const vw = dockedPanel ? window.innerWidth - PANEL_WIDTH : window.innerWidth;
    const vh = window.innerHeight;
    const ratio = ASPECT_RATIOS[aspectRatio];
    if (!ratio) return { width: vw, height: vh };
    const s = Math.min(vw / ratio[0], vh / ratio[1]);
    return { width: Math.floor(ratio[0] * s), height: Math.floor(ratio[1] * s) };
  };
  const onResize = () => setCanvasSize(computeSize());
  onResize();
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}, [dockedPanel, aspectRatio]);
```

- [ ] **Step 3: Add aspect ratio selector in JSX**

Add a new section in the controls panel, just before the export buttons section:

```jsx
<div className="section-header">Canvas</div>

<div className="control-group">
  <label>Aspect Ratio</label>
  <select
    value={aspectRatio}
    onChange={(e) => setAspectRatio(e.target.value)}
    style={{ width: '100%', background: 'var(--bg-panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.3rem', fontSize: '11px', fontFamily: 'inherit' }}
  >
    <option value="free">Free (full window)</option>
    <option value="1:1">1:1 Square</option>
    <option value="4:3">4:3</option>
    <option value="3:2">3:2</option>
    <option value="16:9">16:9 Widescreen</option>
    <option value="9:16">9:16 Portrait</option>
    <option value="2:3">2:3 Portrait</option>
  </select>
</div>
```

- [ ] **Step 4: Center the canvas when letterboxed**

Add to `.canvas-wrapper` in App.css:

```css
.canvas-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
}
```

And remove `position: absolute; top: 0; left: 0;` from `.canvas-wrapper` (already done in Phase 2).

- [ ] **Step 5: Verify manually**

Select "16:9" — the canvas should shrink to a 16:9 rectangle, centered in the available space. The tile grid should fill exactly the 16:9 area. Switch back to "Free" — canvas should return to full viewport.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx src/App.css
git commit -m "feat: fixed aspect ratio mode — 1:1, 4:3, 16:9, portrait"
```

---

## Phase 5 — Print-Quality Export

Export at up to 8× the display resolution using nearest-neighbor upscaling (no blurring of pixel art).

**Files:**
- Modify: `src/App.jsx` (exportPattern, add scale UI)
- Modify: `src/hooks/useWebGLRenderer.js` (expose a high-res render function)

### Task 7: Expose high-res render in useWebGLRenderer

**Files:**
- Modify: `src/hooks/useWebGLRenderer.js`

- [ ] **Step 1: Read the current hook signature**

```bash
# just read the file to see what it returns
```

Read `src/hooks/useWebGLRenderer.js` to confirm what it currently returns (currently just `fps`).

- [ ] **Step 2: Add a `renderToCanvas` export**

At the end of the hook, before the `return fps`, expose a function that takes an `exportScale` and renders the current frame to an offscreen canvas:

```js
const renderToCanvas = useCallback((exportScale) => {
  const src = canvasRef.current;
  if (!src) return null;
  const w = src.width  * exportScale;
  const h = src.height * exportScale;
  const out = document.createElement('canvas');
  out.width  = w;
  out.height = h;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, w, h);
  return out;
}, [canvasRef]);

return { fps, renderToCanvas };
```

Update the hook's return type in `App.jsx` destructuring:

```jsx
const { fps, renderToCanvas } = useWebGLRenderer(...);
```

- [ ] **Step 3: Verify manually**

No visible change yet. In DevTools console, call `window._renderToCanvas = renderToCanvas` (temporarily expose it) and verify it returns a canvas element when called with scale 2.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useWebGLRenderer.js src/App.jsx
git commit -m "refactor: expose renderToCanvas from useWebGLRenderer"
```

---

### Task 8: Add export scale UI and high-res export

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Add `exportScale` state**

```jsx
const [exportScale, setExportScale] = useState(1);
```

- [ ] **Step 2: Add scale selector in the controls panel**

Add directly below the "Canvas" section (Phase 4) or in a new "Export" section:

```jsx
<div className="section-header">Export</div>

<div className="control-group">
  <label>Export Scale</label>
  <select
    value={exportScale}
    onChange={(e) => setExportScale(Number(e.target.value))}
    style={{ width: '100%', background: 'var(--bg-panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.3rem', fontSize: '11px', fontFamily: 'inherit' }}
  >
    <option value={1}>1× (screen)</option>
    <option value={2}>2× (2× resolution)</option>
    <option value={4}>4× (print)</option>
    <option value={8}>8× (large print)</option>
  </select>
</div>
```

- [ ] **Step 3: Update `exportPattern` to use the scale**

Replace the existing `exportPattern` function:

```jsx
const exportPattern = () => {
  const out = exportScale === 1 ? canvasRef.current : renderToCanvas(exportScale);
  if (!out) return;
  const link = document.createElement('a');
  link.download = `tile-glitch-${Date.now()}${exportScale > 1 ? `-${exportScale}x` : ''}.png`;
  link.href = out.toDataURL();
  link.click();
};
```

- [ ] **Step 4: Verify manually**

Set export scale to 4×, click "Export PNG". Open the downloaded file in Preview/Finder — confirm the resolution is 4× the canvas dimensions. Pixel edges should be sharp, not blurred. The filename should include `-4x`.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat: print-quality export at 1x/2x/4x/8x with nearest-neighbor scaling"
```

---

## Self-Review

**Spec coverage:**
- ✅ Phase 1: JSON export (filenames, all settings, exclusions)
- ✅ Phase 1: JSON import (restores settings, not images — documented behaviour)
- ✅ Phase 2: Docked side panel (canvas resizes to compensate)
- ✅ Phase 3: Canvas zoom via Cmd+scroll
- ✅ Phase 4: Aspect ratio lock (free, 1:1, 4:3, 3:2, 16:9, portrait)
- ✅ Phase 5: Print export at 1×/2×/4×/8× with nearest-neighbor

**Placeholder scan:** No TBDs or vague steps present.

**Type consistency:** `renderToCanvas` defined in Task 7 step 2, used in Task 8 step 3. `PANEL_WIDTH = 242` defined in Task 4 step 3, reused in Task 6 step 2. `ASPECT_RATIOS` defined and used within Task 6.

**Noted limitation:** Phase 5 copies the already-rendered WebGL canvas to a 2D canvas and scales it. This works well but does not re-render at higher native WebGL resolution — pixel art will be upscaled, which is correct behaviour (nearest-neighbor = no blur). A true high-res WebGL re-render would require significant renderer refactoring and is out of scope.
