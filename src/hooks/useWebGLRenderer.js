import { useEffect, useRef, useState } from 'react';
import * as twgl from 'twgl.js';
import { VERTEX_SHADER, FRAGMENT_SHADER } from '../webgl/shaders.js';
import { FLOATS_PER_INSTANCE } from '../webgl/constants.js';

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Manages the WebGL 2 render loop.
 *
 * @param canvasRef       - ref to the <canvas> element
 * @param atlasData       - from useTileset (provides atlasCanvas)
 * @param instanceData    - Float32Array from usePatternGenerator
 * @param renderSettings  - { backgroundColor, scale, canvasSize, animateMasks, animationSpeed }
 *
 * Returns fps: number | null (null when animation is off)
 */
export function useWebGLRenderer(canvasRef, atlasData, instanceData, renderSettings) {
  const { backgroundColor, scale, canvasSize, animateMasks, animationSpeed } = renderSettings;

  const glRef           = useRef(null);
  const programInfoRef  = useRef(null);
  const vaoRef          = useRef(null);
  const instanceBufRef  = useRef(null);
  const atlasTexRef     = useRef(null);
  const instanceCountRef = useRef(0);
  const rafRef          = useRef(null);
  const [fps, setFps]   = useState(null);

  // --- Initialize WebGL once ---
  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      preserveDrawingBuffer: true,  // needed for export PNG
    });
    if (!gl) { console.error('WebGL 2 not supported'); return; }
    glRef.current = gl;

    // Compile shaders via twgl
    const programInfo = twgl.createProgramInfo(gl, [VERTEX_SHADER, FRAGMENT_SHADER]);
    programInfoRef.current = programInfo;
    const prog = programInfo.program;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Quad geometry: 6 vertices (2 triangles), positions in [-0.5, 0.5]
    const quadVerts = new Float32Array([
      -0.5, -0.5,  0.5, -0.5, -0.5,  0.5,
      -0.5,  0.5,  0.5, -0.5,  0.5,  0.5,
    ]);
    const quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

    // Instance buffer (filled later)
    const instBuf = gl.createBuffer();
    instanceBufRef.current = instBuf;

    // VAO
    const vao = gl.createVertexArray();
    vaoRef.current = vao;
    gl.bindVertexArray(vao);

    // --- Quad position attribute (per-vertex, divisor 0) ---
    const quadPosLoc = gl.getAttribLocation(prog, 'aQuadPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(quadPosLoc);
    gl.vertexAttribPointer(quadPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(quadPosLoc, 0);

    // --- Per-instance attributes (divisor 1) ---
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    const stride = FLOATS_PER_INSTANCE * 4;

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

    gl.bindVertexArray(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Upload atlas texture when atlasData changes ---
  useEffect(() => {
    const gl = glRef.current;
    if (!gl || !atlasData) return;

    // Delete previous texture if any
    if (atlasTexRef.current) gl.deleteTexture(atlasTexRef.current);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasData.atlasCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    atlasTexRef.current = tex;
  }, [atlasData]);

  // --- Upload instance data when it changes ---
  useEffect(() => {
    const gl = glRef.current;
    if (!gl || !instanceData) return;

    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBufRef.current);
    gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.DYNAMIC_DRAW);
    instanceCountRef.current = instanceData.length / FLOATS_PER_INSTANCE;
  }, [instanceData]);

  // --- Draw loop ---
  useEffect(() => {
    const gl = glRef.current;
    if (!gl || !programInfoRef.current) return;

    const draw = (timestamp) => {
      const [r, g, b] = hexToRgb(backgroundColor);
      gl.clearColor(r / 255, g / 255, b / 255, 1);
      gl.viewport(0, 0, canvasSize.width, canvasSize.height);
      gl.clear(gl.COLOR_BUFFER_BIT);

      if (!atlasTexRef.current || instanceCountRef.current === 0) return;

      gl.useProgram(programInfoRef.current.program);

      twgl.setUniforms(programInfoRef.current, {
        uCanvasSize: [canvasSize.width, canvasSize.height],
        uTileSize:   8 * scale,
        uAtlas:      atlasTexRef.current,
        uTime:       timestamp ?? 0,
        uBaseSpeed:  (animationSpeed / 1000) * 0.1,
        uAnimate:    animateMasks,
      });

      gl.bindVertexArray(vaoRef.current);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instanceCountRef.current);
      gl.bindVertexArray(null);
    };

    if (!animateMasks) {
      // Single static draw
      draw(0);
      setFps(null);
      return;
    }

    // Animation loop with FPS counter
    let frameCount   = 0;
    let lastFpsTime  = performance.now();

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
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [animateMasks, animationSpeed, backgroundColor, canvasSize, scale, instanceData]);

  return fps;
}
