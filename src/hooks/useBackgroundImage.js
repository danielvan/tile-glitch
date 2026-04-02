// src/hooks/useBackgroundImage.js
import { useState, useCallback } from 'react';

/**
 * Manages a user-uploaded background image.
 *
 * Returns:
 *   bgImage:          HTMLImageElement | null
 *   bgUrl:            string | null  (object URL, for thumbnail <img>)
 *   handleBgUpload:   (e: InputEvent) => void
 *   clearBackground:  () => void
 */
export function useBackgroundImage() {
  const [bgImage, setBgImage] = useState(null);
  const [bgUrl,   setBgUrl]   = useState(null);

  const handleBgUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setBgImage(img);
      setBgUrl(url);
    };
    img.src = url;
  }, []);

  const clearBackground = useCallback(() => {
    setBgImage(null);
    setBgUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  return { bgImage, bgUrl, handleBgUpload, clearBackground };
}
