// src/hooks/useMask.js
import { useRef, useState, useCallback, useEffect } from 'react';

/**
 * Owns the paintable tile mask.
 *
 * @param canvasRef      - ref to the WebGL <canvas>
 * @param cols           - number of tile columns
 * @param rows           - number of tile rows
 * @param scaledTileSize - tile size in CSS pixels (TILE_SIZE * scale)
 * @param paintMode      - 'paint' | 'erase'
 * @param brushSize      - radius in tiles (1–10)
 *
 * Returns:
 *   maskTextureRef  - React ref holding WebGLTexture | null
 *   maskVersion     - increments after every GPU upload (use as render trigger)
 *   resetMask       - () => void
 *   brushPreview    - { col, row, size } | null  (cursor tile + radius)
 */
export function useMask(canvasRef, cols, rows, scaledTileSize, paintMode, brushSize) {
  const maskArrayRef   = useRef(null);   // Uint8Array, cols × rows
  const maskTextureRef = useRef(null);   // WebGLTexture
  const oldDimsRef     = useRef(null);   // { cols, rows } from previous allocation
  const isPaintingRef  = useRef(false);

  const MAX_HISTORY     = 20;
  const historyRef      = useRef([]);
  const historyIndexRef = useRef(-1);
  const [historyVersion, setHistoryVersion] = useState(0);

  const [maskVersion,   setMaskVersion]   = useState(0);
  const [brushPreview,  setBrushPreview]  = useState(null);

  // Upload the full mask array to the GPU
  const uploadMask = useCallback(() => {
    const gl = canvasRef.current?.getContext('webgl2');
    if (!gl || !maskArrayRef.current || !maskTextureRef.current) return;
    const { cols: c, rows: r } = oldDimsRef.current;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, maskTextureRef.current);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, c, r, 0, gl.RED, gl.UNSIGNED_BYTE, maskArrayRef.current);
    setMaskVersion(v => v + 1);
  }, [canvasRef]);

  const saveSnapshot = useCallback(() => {
    if (!maskArrayRef.current) return;
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(maskArrayRef.current.slice());
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    historyIndexRef.current = historyRef.current.length - 1;
    setHistoryVersion(v => v + 1);
  }, []);

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current--;
    maskArrayRef.current.set(historyRef.current[historyIndexRef.current]);
    uploadMask();
    setHistoryVersion(v => v + 1);
  }, [uploadMask]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current++;
    maskArrayRef.current.set(historyRef.current[historyIndexRef.current]);
    uploadMask();
    setHistoryVersion(v => v + 1);
  }, [uploadMask]);

  const canUndo = historyIndexRef.current > 0;
  const canRedo = historyIndexRef.current < historyRef.current.length - 1;

  // Allocate / resize mask array and create/update GPU texture
  useEffect(() => {
    if (!cols || !rows) return;
    const gl = canvasRef.current?.getContext('webgl2');
    if (!gl) return;

    const newMask = new Uint8Array(cols * rows);

    // Nearest-neighbour scale of old mask data into new grid
    if (maskArrayRef.current && oldDimsRef.current) {
      const { cols: oc, rows: or } = oldDimsRef.current;
      const old = maskArrayRef.current;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const sc = Math.min(Math.round(c / cols * oc), oc - 1);
          const sr = Math.min(Math.round(r / rows * or), or - 1);
          newMask[r * cols + c] = old[sr * oc + sc];
        }
      }
    }

    historyRef.current      = [];
    historyIndexRef.current = -1;
    setHistoryVersion(v => v + 1);
    maskArrayRef.current = newMask;
    oldDimsRef.current   = { cols, rows };

    // Create texture on first call, reuse thereafter
    if (!maskTextureRef.current) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      maskTextureRef.current = tex;
    }

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, maskTextureRef.current);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, cols, rows, 0, gl.RED, gl.UNSIGNED_BYTE, newMask);
    setMaskVersion(v => v + 1);
  }, [canvasRef, cols, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Paint cells at (clientX, clientY) according to current mode and brush
  const paintAt = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas || !maskArrayRef.current || !oldDimsRef.current) return;

    const rect  = canvas.getBoundingClientRect();
    const x     = clientX - rect.left;
    const y     = clientY - rect.top;
    const tileCol = Math.floor(x / scaledTileSize);
    const tileRow = Math.floor(y / scaledTileSize);
    const { cols: c, rows: r } = oldDimsRef.current;
    const value = paintMode === 'paint' ? 255 : 0;

    let changed = false;
    for (let dr = -brushSize; dr <= brushSize; dr++) {
      for (let dc = -brushSize; dc <= brushSize; dc++) {
        const cc = tileCol + dc;
        const rr = tileRow + dr;
        if (cc >= 0 && cc < c && rr >= 0 && rr < r) {
          maskArrayRef.current[rr * c + cc] = value;
          changed = true;
        }
      }
    }
    if (changed) uploadMask();
  }, [canvasRef, scaledTileSize, paintMode, brushSize, uploadMask]);

  // Pointer events: paint on drag, update brush preview
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onPointerDown = (e) => {
      isPaintingRef.current = true;
      canvas.setPointerCapture(e.pointerId);
      paintAt(e.clientX, e.clientY);
    };

    const onPointerMove = (e) => {
      const rect    = canvas.getBoundingClientRect();
      const col     = Math.floor((e.clientX - rect.left) / scaledTileSize);
      const row     = Math.floor((e.clientY - rect.top)  / scaledTileSize);
      setBrushPreview({ col, row, size: brushSize });

      if (isPaintingRef.current) paintAt(e.clientX, e.clientY);
    };

    const onPointerUp = () => {
      isPaintingRef.current = false;
      saveSnapshot();
    };

    const onPointerLeave = () => {
      setBrushPreview(null);
      isPaintingRef.current = false;
    };

    canvas.addEventListener('pointerdown',  onPointerDown);
    canvas.addEventListener('pointermove',  onPointerMove);
    canvas.addEventListener('pointerup',    onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);

    return () => {
      canvas.removeEventListener('pointerdown',  onPointerDown);
      canvas.removeEventListener('pointermove',  onPointerMove);
      canvas.removeEventListener('pointerup',    onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [canvasRef, scaledTileSize, paintMode, brushSize, paintAt, saveSnapshot]);

  useEffect(() => {
    const onKeyDown = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); }
      if (mod &&  e.shiftKey && e.key === 'z') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  const resetMask = useCallback(() => {
    if (!maskArrayRef.current) return;
    saveSnapshot();
    maskArrayRef.current.fill(0);
    uploadMask();
  }, [saveSnapshot, uploadMask]);

  return { maskTextureRef, maskVersion, resetMask, brushPreview, undo, redo, canUndo, canRedo };
}
