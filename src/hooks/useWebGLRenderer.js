import { useEffect, useRef, useState } from 'react';
import * as twgl from 'twgl.js';
import { VERTEX_SHADER, FRAGMENT_SHADER, BG_VERTEX_SHADER, BG_FRAGMENT_SHADER, POST_VERTEX_SHADER, POST_FRAGMENT_SHADER } from '../webgl/shaders.js';
import { FLOATS_PER_INSTANCE, TILE_SIZE } from '../webgl/constants.js';

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Compute UV scale + offset for cover-fit of an image in a canvas
function computeCoverUVs(canvasW, canvasH, imgW, imgH) {
  const ca = canvasW / canvasH;
  const ia = imgW   / imgH;
  let scaleU, scaleV, offsetU, offsetV;
  if (ca > ia) {
    scaleU = 1.0;       scaleV  = ia / ca;
    offsetU = 0.0;      offsetV = (1.0 - scaleV)  / 2.0;
  } else {
    scaleU = ca / ia;   scaleV  = 1.0;
    offsetU = (1.0 - scaleU) / 2.0;  offsetV = 0.0;
  }
  return [scaleU, scaleV, offsetU, offsetV];
}

/**
 * Manages the WebGL 2 render loop.
 *
 * @param canvasRef       - ref to the <canvas> element
 * @param atlasData       - from useTileset (provides atlasCanvas)
 * @param instanceData    - Float32Array from usePatternGenerator
 * @param renderSettings  - {
 *   backgroundColor, scale, canvasSize, animateMasks, animationSpeed,
 *   bgImage,         // HTMLImageElement | null
 *   maskTextureRef,  // React ref holding WebGLTexture | null
 *   maskVersion,     // number — increments when mask GPU data changes
 * }
 *
 * Returns fps: number | null (null when animation is off)
 */
export function useWebGLRenderer(canvasRef, atlasData, instanceData, renderSettings) {
  const {
    backgroundColor, scale, canvasSize, animateMasks, animationSpeed,
    bgImage, maskTextureRef, maskVersion,
    effects,
  } = renderSettings;
  const { chroma = 0, scanlines = 0, barrel = 0, vignette = 0, grain = 0, crtMask = 0 } = effects ?? {};

  const glRef              = useRef(null);
  const programInfoRef     = useRef(null);
  const vaoRef             = useRef(null);
  const instanceBufRef     = useRef(null);
  const atlasTexRef        = useRef(null);
  const dummyMaskTexRef    = useRef(null);
  const bgProgramInfoRef   = useRef(null);
  const bgVaoRef           = useRef(null);
  const bgTexRef           = useRef(null);
  const instanceCountRef   = useRef(0);
  const rafRef             = useRef(null);
  const fboRef             = useRef(null);
  const fboTexRef          = useRef(null);
  const postProgramInfoRef = useRef(null);
  const postVaoRef         = useRef(null);
  const [fps, setFps]      = useState(null);
  const drawRef            = useRef(null);

  // --- Initialize tile WebGL program + VAO once ---
  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) { console.error('WebGL 2 not supported'); return; }
    glRef.current = gl;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // --- Tile program ---
    const programInfo = twgl.createProgramInfo(gl, [VERTEX_SHADER, FRAGMENT_SHADER]);
    programInfoRef.current = programInfo;
    const prog = programInfo.program;

    const quadVerts = new Float32Array([
      -0.5, -0.5,  0.5, -0.5, -0.5,  0.5,
      -0.5,  0.5,  0.5, -0.5,  0.5,  0.5,
    ]);
    const quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

    const instBuf = gl.createBuffer();
    instanceBufRef.current = instBuf;

    const vao = gl.createVertexArray();
    vaoRef.current = vao;
    gl.bindVertexArray(vao);

    const quadPosLoc = gl.getAttribLocation(prog, 'aQuadPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(quadPosLoc);
    gl.vertexAttribPointer(quadPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(quadPosLoc, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    const stride = FLOATS_PER_INSTANCE * 4;  // 72 bytes

    const instAttr = (name, size, floatOffset) => {
      const loc = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, floatOffset * 4);
      gl.vertexAttribDivisor(loc, 1);
    };

    instAttr('aPos',       2,  0);
    instAttr('aUV',        4,  2);
    instAttr('aFlip',      1,  6);
    instAttr('aOpacity',   1,  7);
    instAttr('aCircular',  1,  8);
    instAttr('aPhase',     1,  9);
    instAttr('aSpeed',     1, 10);
    instAttr('aDirection', 1, 11);
    instAttr('aColor',     4, 12);
    instAttr('aGridPos',   2, 16);

    gl.bindVertexArray(null);

    // Dummy 1×1 R8 mask texture (used when uHasMask=false)
    const dummyTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, dummyTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    dummyMaskTexRef.current = dummyTex;

    // --- BG program ---
    const bgProgramInfo = twgl.createProgramInfo(gl, [BG_VERTEX_SHADER, BG_FRAGMENT_SHADER]);
    bgProgramInfoRef.current = bgProgramInfo;

    const bgQuadVerts = new Float32Array([
      -1, -1,  1, -1, -1,  1,
      -1,  1,  1, -1,  1,  1,
    ]);
    const bgQuadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bgQuadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, bgQuadVerts, gl.STATIC_DRAW);

    const bgVao = gl.createVertexArray();
    bgVaoRef.current = bgVao;
    gl.bindVertexArray(bgVao);

    const bgPosLoc = gl.getAttribLocation(bgProgramInfo.program, 'aPos');
    gl.enableVertexAttribArray(bgPosLoc);
    gl.vertexAttribPointer(bgPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(bgPosLoc, 0);

    gl.bindVertexArray(null);

    // --- FBO (created here; texture attached in the canvasSize resize effect) ---
    fboRef.current = gl.createFramebuffer();

    // --- Post-processing program ---
    const postProgramInfo = twgl.createProgramInfo(gl, [POST_VERTEX_SHADER, POST_FRAGMENT_SHADER]);
    postProgramInfoRef.current = postProgramInfo;

    const postQuadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, postQuadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1, -1,  1,
      -1,  1,  1, -1,  1,  1,
    ]), gl.STATIC_DRAW);

    const postVao = gl.createVertexArray();
    postVaoRef.current = postVao;
    gl.bindVertexArray(postVao);
    const postPosLoc = gl.getAttribLocation(postProgramInfo.program, 'aPos');
    gl.enableVertexAttribArray(postPosLoc);
    gl.vertexAttribPointer(postPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(postPosLoc, 0);
    gl.bindVertexArray(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Resize FBO texture when canvas size changes ---
  useEffect(() => {
    const gl = glRef.current;
    if (!gl || !fboRef.current) return;

    if (fboTexRef.current) gl.deleteTexture(fboTexRef.current);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvasSize.width, canvasSize.height,
      0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    fboTexRef.current = tex;

    gl.bindFramebuffer(gl.FRAMEBUFFER, fboRef.current);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }, [canvasSize]);

  // --- Upload atlas texture when atlasData changes ---
  useEffect(() => {
    const gl = glRef.current;
    if (!gl) return;
    if (atlasTexRef.current) {
      gl.deleteTexture(atlasTexRef.current);
      atlasTexRef.current = null;
    }
    if (!atlasData) return;

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasData.atlasCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    atlasTexRef.current = tex;
  }, [atlasData]);

  // --- Upload background image texture when bgImage changes ---
  useEffect(() => {
    const gl = glRef.current;
    if (bgTexRef.current) { gl?.deleteTexture(bgTexRef.current); bgTexRef.current = null; }
    if (!gl || !bgImage) return;

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bgImage);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    bgTexRef.current = tex;
  }, [bgImage]);

  // --- Upload instance data when it changes ---
  useEffect(() => {
    const gl = glRef.current;
    if (!gl) return;
    if (!instanceData) {
      instanceCountRef.current = 0;
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBufRef.current);
    gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.DYNAMIC_DRAW);
    instanceCountRef.current = instanceData.length / FLOATS_PER_INSTANCE;
  }, [instanceData]);

  // --- Draw loop ---
  useEffect(() => {
    const gl = glRef.current;
    if (!gl || !programInfoRef.current) return;

    const draw = drawRef.current = (timestamp) => {
      if (!fboRef.current || !fboTexRef.current || !postProgramInfoRef.current) return;

      // --- Render scene to FBO ---
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboRef.current);
      const [r, g, b] = hexToRgb(backgroundColor);
      gl.clearColor(r / 255, g / 255, b / 255, 1);
      gl.viewport(0, 0, canvasSize.width, canvasSize.height);
      gl.clear(gl.COLOR_BUFFER_BIT);

      // --- Background pass ---
      if (bgTexRef.current && bgProgramInfoRef.current && bgImage) {
        gl.useProgram(bgProgramInfoRef.current.program);
        const [su, sv, ou, ov] = computeCoverUVs(
          canvasSize.width, canvasSize.height,
          bgImage.width, bgImage.height
        );
        twgl.setUniforms(bgProgramInfoRef.current, {
          uBgImage:    bgTexRef.current,
          uBgUVScale:  [su, sv],
          uBgUVOffset: [ou, ov],
        });
        gl.bindVertexArray(bgVaoRef.current);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindVertexArray(null);
      }

      // --- Tile pass ---
      if (atlasTexRef.current && instanceCountRef.current > 0) {
        const activeMaskTex = maskTextureRef?.current ?? dummyMaskTexRef.current;
        const hasMask       = !!(maskTextureRef?.current);

        gl.useProgram(programInfoRef.current.program);
        twgl.setUniforms(programInfoRef.current, {
          uCanvasSize: [canvasSize.width, canvasSize.height],
          uTileSize:   TILE_SIZE * scale,
          uAtlas:      atlasTexRef.current,
          uMask:       activeMaskTex,
          uHasMask:    hasMask,
          uTime:       timestamp ?? 0,
          uBaseSpeed:  (animationSpeed / 1000) * 0.1,
          uAnimate:    animateMasks,
        });

        gl.bindVertexArray(vaoRef.current);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instanceCountRef.current);
        gl.bindVertexArray(null);
      }

      // --- Post-processing pass: FBO texture → canvas ---
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvasSize.width, canvasSize.height);

      gl.useProgram(postProgramInfoRef.current.program);
      twgl.setUniforms(postProgramInfoRef.current, {
        uScene:      fboTexRef.current,
        uResolution: [canvasSize.width, canvasSize.height],
        uTime:       timestamp ?? 0,
        uChroma:     chroma     / 100,
        uScanlines:  scanlines  / 100,
        uBarrel:     barrel     / 100,
        uVignette:   vignette   / 100,
        uGrain:      grain      / 100,
        uCRTMask:    crtMask    / 100,
      });
      gl.bindVertexArray(postVaoRef.current);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindVertexArray(null);
    };

    if (!animateMasks) {
      draw(0);
      setFps(null);
      return;
    }

    let frameCount  = 0;
    let lastFpsTime = performance.now();

    const loop = (timestamp) => {
      draw(timestamp);
      frameCount++;
      const now = performance.now();
      if (now - lastFpsTime >= 1000) {
        setFps(frameCount);
        frameCount  = 0;
        lastFpsTime = now;
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [animateMasks, animationSpeed, backgroundColor, canvasSize, scale,
      atlasData, instanceData, bgImage, maskVersion, maskTextureRef,
      chroma, scanlines, barrel, vignette, grain, crtMask]);

  const captureFrame = () => {
    const gl = glRef.current;
    if (!gl || !drawRef.current) return null;
    drawRef.current(0);
    gl.finish();
    const { width, height } = gl.canvas;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { pixels, width, height };
  };

  return { fps, captureFrame };
}
