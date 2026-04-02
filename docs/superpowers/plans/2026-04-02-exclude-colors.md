# Per-Tileset Multiple Exclude Colors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single global exclude color with per-tileset lists of exclude colors, plus a global tolerance slider.

**Architecture:** Each tileset object gains an `excludeColors: string[]` field. A global `excludeTolerance: number` (0–32, default 8) is passed to `useTileset` instead of the old single hex string. `buildExcludeFilter` is updated to accept an array of colors and a tolerance value. The global "Exclude Color" control in the Colors section is removed; per-tileset color lists appear inside each tileset item.

**Tech Stack:** React hooks, Canvas 2D (existing atlas packing in useTileset)

---

## File Map

| File | Change |
|------|--------|
| `src/hooks/useTileset.js` | `buildExcludeFilter` accepts `(img, excludeColors[], tolerance)`, signature `useTileset(tilesets, excludeTolerance)` |
| `src/App.jsx` | Remove `excludeColor` state, add `excludeTolerance`, add per-tileset color handlers, update UI |
| `src/App.css` | Add exclude swatch styles |

---

### Task 1: Update useTileset.js

**Files:**
- Modify: `src/hooks/useTileset.js`

- [ ] **Step 1: Read the current file**

Read `src/hooks/useTileset.js` in full.

- [ ] **Step 2: Replace buildExcludeFilter**

Find the entire `buildExcludeFilter` function (lines 4–29) and replace it with:

```js
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
```

- [ ] **Step 3: Update useTileset signature and call site**

Find:

```js
export function useTileset(tilesetList, excludeColor) {
```

Replace with:

```js
export function useTileset(tilesetList, excludeTolerance) {
```

Find the call inside the `useEffect`:

```js
      const shouldExclude = buildExcludeFilter(img, excludeColor); // one read per tileset
```

Replace with:

```js
      const shouldExclude = buildExcludeFilter(img, tileset.excludeColors ?? [], excludeTolerance);
```

Find the `useEffect` dependency array:

```js
  }, [tilesetList, excludeColor]);
```

Replace with:

```js
  }, [tilesetList, excludeTolerance]);
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useTileset.js
git commit -m "feat: per-tileset exclude colors — buildExcludeFilter accepts array + tolerance"
```

---

### Task 2: Update App.jsx

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Read the current file**

Read `src/App.jsx` in full.

- [ ] **Step 2: Replace excludeColor state with excludeTolerance**

Find:

```js
  const [excludeColor, setExcludeColor]             = useState('');
```

Replace with:

```js
  const [excludeTolerance, setExcludeTolerance]     = useState(8);
```

- [ ] **Step 3: Add excludeColors to tileset objects on upload**

Find the `img.onload` callback inside `handleFileUpload`:

```js
        img.onload = () => {
          const newId = Date.now() + index;
          setTilesets(prev => [...prev, { id: newId, url: event.target.result, img }]);
          setTilesetWeights(prev => ({ ...prev, [newId]: 50 }));
        };
```

Replace with:

```js
        img.onload = () => {
          const newId = Date.now() + index;
          setTilesets(prev => [...prev, { id: newId, url: event.target.result, img, excludeColors: [] }]);
          setTilesetWeights(prev => ({ ...prev, [newId]: 50 }));
        };
```

- [ ] **Step 4: Add exclude color handlers**

Add these three handlers after `removeTileset`:

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

- [ ] **Step 5: Update useTileset call**

Find:

```js
  const atlasData = useTileset(tilesets, excludeColor);
```

Replace with:

```js
  const atlasData = useTileset(tilesets, excludeTolerance);
```

- [ ] **Step 6: Update tileset item JSX — add exclude color controls**

Find the tileset weight block inside the `tilesets.map`:

```jsx
                      <div className="tileset-weight">
                        <label>Weight: {tilesetWeights[tileset.id] || 50}%</label>
                        <input
                          type="range" min="0" max="100"
                          value={tilesetWeights[tileset.id] || 50}
                          onChange={(e) => setTilesetWeights(prev => ({ ...prev, [tileset.id]: Number(e.target.value) }))}
                          onPointerUp={handlePointerUp}
                        />
                      </div>
```

Replace with:

```jsx
                      <div className="tileset-weight">
                        <label>Weight: {tilesetWeights[tileset.id] || 50}%</label>
                        <input
                          type="range" min="0" max="100"
                          value={tilesetWeights[tileset.id] || 50}
                          onChange={(e) => setTilesetWeights(prev => ({ ...prev, [tileset.id]: Number(e.target.value) }))}
                          onPointerUp={handlePointerUp}
                        />
                      </div>
                      {(tileset.excludeColors ?? []).length > 0 && (
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

- [ ] **Step 7: Replace global Exclude Color control with Tolerance slider**

Find and remove the entire exclude color control group in the Colors section:

```jsx
              <div className="control-group">
                <label>Exclude Color</label>
                <input type="color" value={excludeColor || '#00ff00'}
                  onChange={(e) => setExcludeColor(e.target.value)} />
                {excludeColor && (
                  <button className="btn-small" onClick={() => setExcludeColor('')}>Clear</button>
                )}
              </div>
```

Replace with:

```jsx
              <div className="control-group">
                <label>Exclude Tolerance: {excludeTolerance}</label>
                <input type="range" min="0" max="32" value={excludeTolerance}
                  onChange={handleChange(setExcludeTolerance)} onPointerUp={handlePointerUp} />
              </div>
```

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx
git commit -m "feat: per-tileset exclude colors UI — add/remove colors, tolerance slider"
```

---

### Task 3: Add CSS

**Files:**
- Modify: `src/App.css`

- [ ] **Step 1: Add exclude swatch styles**

Append to the end of `src/App.css`:

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
  font-family: inherit;
  cursor: pointer;
}
```

- [ ] **Step 2: Verify**

Run `npm run dev`. Load two tilesets.

- Each tileset item shows a `+ Exclude` button
- Clicking `+ Exclude` adds a green swatch; changing its color updates the tileset filter live
- Multiple exclude colors can be added per tileset
- `×` removes a swatch
- The global Exclude Color picker is gone; Exclude Tolerance slider appears in its place
- Changing the tolerance slider updates filtering across all tilesets

- [ ] **Step 3: Commit and tag**

```bash
git add src/App.css
git commit -m "feat: add exclude swatch styles"
git tag v4-exclude-colors
git push origin main --tags
```

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests | 0 | — | — |

**VERDICT:** NO REVIEWS YET
