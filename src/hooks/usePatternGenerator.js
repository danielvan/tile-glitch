import { useEffect, useRef, useState, useCallback } from 'react';
import PatternWorker from '../workers/patternWorker.js?worker';

/**
 * Bridges App state to the pattern worker.
 *
 * @param atlasData  - output of useTileset (null if no tilesets loaded)
 * @param settings   - stable object: { cols, rows, scaledTileSize, chaos, coherence,
 *                     normalize, circularMaskChance, disappearChance, cycleTiles,
 *                     tilesetWeights }
 * @param livePreview - if true, auto-generates when settings change (rAF-throttled)
 *
 * Returns { instanceData: Float32Array | null, generate: () => void }
 */
export function usePatternGenerator(atlasData, settings, livePreview, locked) {
  const [instanceData, setInstanceData] = useState(null);
  const workerRef   = useRef(null);
  const rafRef      = useRef(null);

  // Create worker once
  useEffect(() => {
    workerRef.current = new PatternWorker();
    workerRef.current.onmessage = (e) => setInstanceData(e.data.instanceData);
    return () => {
      workerRef.current?.terminate();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Send init message when atlas data changes
  useEffect(() => {
    if (!workerRef.current) return;
    if (!atlasData) {
      setInstanceData(null);
      return;
    }
    workerRef.current.postMessage({
      type:    'init',
      tiles:   atlasData.tiles,
      uvData:  atlasData.uvData,
      tileMap: atlasData.tileMap,
    });
  }, [atlasData]);

  // Imperative generate: sends current settings to worker
  // `overrides` lets callers inject values (e.g. a fresh seed) before state updates
  const generate = useCallback((overrides = {}) => {
    if (!atlasData || !workerRef.current) return;
    workerRef.current.postMessage({ type: 'generate', ...settings, ...overrides });
  }, [atlasData, settings]);

  // Auto-generate when atlas or settings change (skipped when locked)
  useEffect(() => {
    if (!atlasData || locked) return;

    if (livePreview) {
      // Throttle to one frame: cancel pending rAF and schedule a new one
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        generate();
        rafRef.current = null;
      });
    }
    // If !livePreview, generate() is called manually from App (on pointer-up or button)
  }, [atlasData, settings, livePreview, locked, generate]);

  return { instanceData, generate };
}
