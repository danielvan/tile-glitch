// src/hooks/useBackgroundImage.js
import { useState, useEffect, useCallback } from 'react';

/**
 * Manages a user-uploaded background image.
 * Uses data URLs (not object URLs) so the image can be persisted to localStorage.
 *
 * Returns:
 *   bgImage:          HTMLImageElement | null
 *   bgUrl:            string | null  (data URL, for thumbnail <img>)
 *   bgDataUrl:        string | null  (same as bgUrl, for saving)
 *   handleBgUpload:   (e: InputEvent) => void
 *   clearBackground:  () => void
 */
export function useBackgroundImage(initialDataUrl = null) {
  const [bgImage,   setBgImage]   = useState(null);
  const [bgDataUrl, setBgDataUrl] = useState(null);

  // Restore from saved data URL on mount
  useEffect(() => {
    if (!initialDataUrl) return;
    const img = new Image();
    img.onload = () => {
      setBgImage(img);
      setBgDataUrl(initialDataUrl);
    };
    img.src = initialDataUrl;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBgUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const dataUrl = evt.target.result;
      const img = new Image();
      img.onload = () => {
        setBgImage(img);
        setBgDataUrl(dataUrl);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }, []);

  const clearBackground = useCallback(() => {
    setBgImage(null);
    setBgDataUrl(null);
  }, []);

  return { bgImage, bgUrl: bgDataUrl, bgDataUrl, handleBgUpload, clearBackground };
}
