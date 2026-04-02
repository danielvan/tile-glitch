# Undo/Redo for Mask — Design Spec

**Date:** 2026-04-02
**Status:** Approved

## Goal

Add undo/redo to the paintable mask so users can step back through strokes and reset operations without losing prior work.

## Features

### History Model
- Max 20 steps of history
- Each entry is a full `Uint8Array` snapshot of the mask (same size as `maskArray`: `cols × rows` bytes)
- At scale 1x on a 1920×1080 canvas: 240 × 135 = ~32KB per snapshot, 640KB for 20 steps — trivial
- History is a linear array with a current index pointer (classic undo/redo stack)

### When a Snapshot Is Saved
- `pointerup` — after each completed paint or erase stroke
- `resetMask` — before clearing (so the reset itself is undoable)
- Painting after an undo discards all redo history beyond the current index

### Undo / Redo Behaviour
- **Undo:** decrement index, copy `history[index]` into `maskArrayRef`, upload to GPU
- **Redo:** increment index, copy `history[index]` into `maskArrayRef`, upload to GPU
- Both are no-ops when at the start/end of history (`canUndo` / `canRedo` guards)
- Mask resize (cols/rows change): history is cleared — saved strokes no longer map to the new grid

### Keyboard Shortcuts
- `Cmd+Z` / `Ctrl+Z` — undo
- `Cmd+Shift+Z` / `Ctrl+Shift+Z` — redo
- Attached to `window` inside `useMask`, cleaned up on unmount

### UI
- Two buttons in the Mask section: `↩ Undo` and `↪ Redo`
- Disabled (`button:disabled`) when `canUndo` / `canRedo` is false

## Architecture

### Modified: `src/hooks/useMask.js`
New internal state (all refs — no re-renders on history changes):
- `historyRef: useRef([])` — array of `Uint8Array` snapshots
- `historyIndexRef: useRef(-1)` — current position (-1 = empty)

New helper `saveSnapshot()`:
```js
function saveSnapshot() {
  // Discard any redo history beyond current index
  historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
  // Push a copy of the current mask
  historyRef.current.push(maskArrayRef.current.slice());
  // Trim to MAX_HISTORY
  if (historyRef.current.length > MAX_HISTORY) {
    historyRef.current.shift();
  }
  historyIndexRef.current = historyRef.current.length - 1;
}
```

`saveSnapshot()` is called:
- In `onPointerUp` handler
- At the start of `resetMask` (before `fill(0)`)

New `undo()` / `redo()` functions:
```js
function undo() {
  if (historyIndexRef.current <= 0) return;
  historyIndexRef.current--;
  maskArrayRef.current.set(historyRef.current[historyIndexRef.current]);
  uploadMask();
}

function redo() {
  if (historyIndexRef.current >= historyRef.current.length - 1) return;
  historyIndexRef.current++;
  maskArrayRef.current.set(historyRef.current[historyIndexRef.current]);
  uploadMask();
}
```

`canUndo` / `canRedo` are derived from `historyIndexRef` — but since they need to trigger re-renders for button disabled state, they are tracked as a lightweight `useState` counter that increments whenever history changes (same pattern as `maskVersion`).

New return values: `{ ..., undo, redo, canUndo, canRedo }`

On mask resize (cols/rows change): `historyRef.current = []`, `historyIndexRef.current = -1`, reset `canUndo`/`canRedo`.

### Modified: `src/App.jsx`
- Destructure `undo, redo, canUndo, canRedo` from `useMask`
- Add two buttons in the Mask section:
```jsx
<div className="undo-redo-row">
  <button className="btn-secondary" onClick={undo} disabled={!canUndo}>↩ Undo</button>
  <button className="btn-secondary" onClick={redo} disabled={!canRedo}>↪ Redo</button>
</div>
```

### Modified: `src/App.css`
```css
.undo-redo-row {
  display: flex;
  gap: 0.3rem;
}
.undo-redo-row button {
  flex: 1;
}
```

## Constants
```js
const MAX_HISTORY = 20;
```

## Out of Scope
- Per-stroke granularity (mid-stroke undo)
- Persisting history across page reloads
- Undo for regenerate / tileset changes
