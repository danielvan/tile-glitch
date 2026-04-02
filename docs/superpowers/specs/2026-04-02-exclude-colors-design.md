# Per-Tileset Multiple Exclude Colors — Design Spec

**Date:** 2026-04-02
**Status:** Approved

## Goal

Replace the single global exclude color with per-tileset exclude color lists, and expose a global tolerance slider for how closely a pixel must match to be excluded.

## Features

### Per-tileset exclude colors
- Each tileset has its own `excludeColors: string[]` (array of hex strings, default `[]`)
- Any number of colors can be added per tileset (no hard cap, practically 1–5)
- A tile is excluded if **any** pixel in the 8×8 tile matches **any** of the tileset's exclude colors within tolerance

### Global tolerance
- Single `excludeTolerance: number` in App state (0–32, default 8)
- Applied per channel: `Math.abs(pixel[c] - exclude[c]) <= tolerance` for R, G, B
- Replaces the hardcoded `< 20` in `buildExcludeFilter`
- Lives in the Generation section as `Exclude Tolerance: N` slider

### UI — inside each tileset item
```
Tileset 1  [×]
Weight: 50%  ────●────
Exclude:  [■ ×]  [■ ×]  [+]
```
- Each swatch is a small `<input type="color">` showing the excluded hex
- `×` removes that color from the list
- `[+]` appends a new color (default `#00ff00`) to the tileset's `excludeColors`
- Swatches render inline in a wrapping row

### Removed
- Global "Exclude Color" control from the Colors section (replaced by per-tileset)

## Architecture

### Modified: `src/App.jsx`

Remove:
```js
const [excludeColor, setExcludeColor] = useState('');
```

Add:
```js
const [excludeTolerance, setExcludeTolerance] = useState(8);
```

When uploading a tileset, initialise with empty excludeColors:
```js
setTilesets(prev => [...prev, { id: newId, url: event.target.result, img, excludeColors: [] }]);
```

New handlers:
```js
const addExcludeColor = (id) => {
  setTilesets(prev => prev.map(t =>
    t.id === id ? { ...t, excludeColors: [...t.excludeColors, '#00ff00'] } : t
  ));
};

const removeExcludeColor = (id, index) => {
  setTilesets(prev => prev.map(t =>
    t.id === id ? { ...t, excludeColors: t.excludeColors.filter((_, i) => i !== index) } : t
  ));
};

const updateExcludeColor = (id, index, hex) => {
  setTilesets(prev => prev.map(t =>
    t.id === id
      ? { ...t, excludeColors: t.excludeColors.map((c, i) => i === index ? hex : c) }
      : t
  ));
};
```

`useTileset` call changes from:
```js
const atlasData = useTileset(tilesets, excludeColor);
```
to:
```js
const atlasData = useTileset(tilesets, excludeTolerance);
```

Tileset item JSX gains an exclude color row:
```jsx
{tileset.excludeColors.length > 0 && (
  <div className="exclude-colors-row">
    {tileset.excludeColors.map((hex, i) => (
      <div key={i} className="exclude-swatch">
        <input type="color" value={hex}
          onChange={(e) => updateExcludeColor(tileset.id, i, e.target.value)} />
        <button className="swatch-remove" onClick={() => removeExcludeColor(tileset.id, i)}>×</button>
      </div>
    ))}
  </div>
)}
<button className="btn-small" onClick={() => addExcludeColor(tileset.id)}>+ Exclude</button>
```

Tolerance slider in Generation section:
```jsx
<div className="control-group">
  <label>Exclude Tolerance: {excludeTolerance}</label>
  <input type="range" min="0" max="32" value={excludeTolerance}
    onChange={handleChange(setExcludeTolerance)} onPointerUp={handlePointerUp} />
</div>
```

### Modified: `src/hooks/useTileset.js`

Signature changes from `(tilesetList, excludeColor)` to `(tilesetList, excludeTolerance)`.

`buildExcludeFilter` signature changes from `(img, excludeHex)` to `(img, excludeColors, tolerance)`:

```js
function buildExcludeFilter(img, excludeColors, tolerance) {
  if (!excludeColors || excludeColors.length === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width  = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, img.width, img.height);

  // Parse all exclude colors once
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
```

Call site inside `useEffect`:
```js
const shouldExclude = buildExcludeFilter(img, tileset.excludeColors, excludeTolerance);
```

`useEffect` dependency array changes from `[tilesetList, excludeColor]` to `[tilesetList, excludeTolerance]`.

### Modified: `src/App.css`

```css
.exclude-colors-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.15rem;
}

.exclude-swatch {
  display: flex;
  align-items: center;
  gap: 0.1rem;
}

.exclude-swatch input[type="color"] {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 3px;
  cursor: pointer;
}

.swatch-remove {
  padding: 0 0.25rem;
  font-size: 10px;
  background: var(--danger);
  color: var(--danger-text);
  border: 1px solid rgba(255, 50, 50, 0.4);
  border-radius: 3px;
  line-height: 1.4;
  min-width: 0;
}
```

## Out of Scope
- Per-color tolerance (one global tolerance is sufficient)
- Alpha channel exclusion
- Saving exclude colors to a preset
