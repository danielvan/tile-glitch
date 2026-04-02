# FBO Post-Processing Effects — Design Spec

**Date:** 2026-04-02
**Status:** Approved

## Goal

Add a framebuffer (FBO) rendering pipeline so the fully-composited scene (background + tiles) can be post-processed with a suite of 80s/90s CRT-style effects in a single additional shader pass.

## Effects

All effects are sliders (0–100%, default 0). They are applied in this order inside a single fragment shader:

| Effect | What it does |
|--------|-------------|
| **Chromatic Aberration** | Radially separates R and B channels outward from centre |
| **Scanlines** | Darkens every other horizontal pixel row (CRT line structure) |
| **Barrel Distortion** | Warps the image outward (CRT screen curvature); clips edges to black |
| **Vignette** | Darkens corners and edges |
| **Film Grain** | Adds animated random noise |
| **CRT Mask** | Applies a faint red/green/blue vertical stripe pattern (phosphor triads) |

Bloom is out of scope — it requires a separate blur pass.

## Rendering Pipeline (New)

**Before:** background → tiles → canvas

**After:** background → tiles → FBO texture → post-processing pass → canvas

The FBO pipeline is always active. With all effects at 0, the post pass is a near-zero-cost passthrough blit.

## Architecture

### Modified: `src/webgl/shaders.js`

Add two new exports:

**`POST_VERTEX_SHADER`** — fullscreen quad, passes UV through:
```glsl
#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
  vUV = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
}
```

**`POST_FRAGMENT_SHADER`** — applies all effects in order:
```glsl
#version 300 es
precision mediump float;

uniform sampler2D uScene;
uniform vec2      uResolution;
uniform float     uTime;
uniform float     uChroma;
uniform float     uScanlines;
uniform float     uBarrel;
uniform float     uVignette;
uniform float     uGrain;
uniform float     uCRTMask;

in vec2 vUV;
out vec4 fragColor;

vec2 barrelDistort(vec2 uv, float k) {
  vec2 d = uv - 0.5;
  return uv + d * dot(d, d) * k * 2.0;
}

void main() {
  // 1. Barrel distortion — warp UV, clip edges to black
  vec2 uv = mix(vUV, barrelDistort(vUV, uBarrel), uBarrel);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // 2. Chromatic aberration — radial R/B offset
  vec3 color;
  if (uChroma > 0.001) {
    vec2 dir    = normalize(uv - 0.5);
    float dist  = length(uv - 0.5);
    vec2 offset = dir * dist * uChroma * 0.05;
    color.r = texture(uScene, uv + offset).r;
    color.g = texture(uScene, uv).g;
    color.b = texture(uScene, uv - offset).b;
  } else {
    color = texture(uScene, uv).rgb;
  }

  // 3. Scanlines — darken every other row
  float line = mod(floor(gl_FragCoord.y), 2.0);
  color *= mix(1.0, 1.0 - line * 0.5, uScanlines);

  // 4. CRT RGB mask — phosphor stripe pattern
  float mx = mod(floor(gl_FragCoord.x), 3.0);
  vec3 phosphor = vec3(
    step(mx, 0.5),
    step(abs(mx - 1.0), 0.5),
    step(abs(mx - 2.0), 0.5)
  );
  color *= mix(vec3(1.0), 0.6 + 0.4 * phosphor, uCRTMask * 0.7);

  // 5. Film grain — animated per-frame noise
  float grain = fract(sin(dot(vUV + fract(uTime * 0.001), vec2(12.9898, 78.233))) * 43758.5453);
  color = mix(color, vec3(grain), uGrain * 0.15);

  // 6. Vignette — darken edges
  float vig = 1.0 - length((uv - 0.5) * 1.8) * uVignette;
  color *= clamp(vig, 0.0, 1.0);

  fragColor = vec4(color, 1.0);
}
```

### Modified: `src/hooks/useWebGLRenderer.js`

**New refs:**
- `fboRef: useRef(null)` — WebGLFramebuffer
- `fboTexRef: useRef(null)` — RGBA texture (canvas dimensions)
- `postProgramInfoRef: useRef(null)` — twgl program for post pass
- `postVaoRef: useRef(null)` — fullscreen quad VAO for post pass

**In the initialization effect** (runs once):
- Import `POST_VERTEX_SHADER`, `POST_FRAGMENT_SHADER`
- Create `postProgramInfo = twgl.createProgramInfo(gl, [POST_VERTEX_SHADER, POST_FRAGMENT_SHADER])`
- Create framebuffer: `fboRef.current = gl.createFramebuffer()`
- Create `postVao` with a fullscreen quad buffer (`[-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]`) bound to `aPos` — same geometry as `bgVao`, separate VAO because different program attribute locations

**New useEffect([canvasSize])** — runs on mount and every resize:
```js
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
```

**Draw loop changes:**

Render to FBO instead of canvas:
```js
// Bind FBO — all draws go to offscreen texture
gl.bindFramebuffer(gl.FRAMEBUFFER, fboRef.current);
gl.viewport(0, 0, canvasSize.width, canvasSize.height);
gl.clear(gl.COLOR_BUFFER_BIT);

// ... existing background pass ...
// ... existing tile pass ...

// Switch back to canvas
gl.bindFramebuffer(gl.FRAMEBUFFER, null);

// Post-processing pass
gl.useProgram(postProgramInfoRef.current.program);
twgl.setUniforms(postProgramInfoRef.current, {
  uScene:      fboTexRef.current,
  uResolution: [canvasSize.width, canvasSize.height],
  uTime:       timestamp ?? 0,
  uChroma:     effects.chroma / 100,
  uScanlines:  effects.scanlines / 100,
  uBarrel:     effects.barrel / 100,
  uVignette:   effects.vignette / 100,
  uGrain:      effects.grain / 100,
  uCRTMask:    effects.crtMask / 100,
});
gl.bindVertexArray(postVaoRef.current);
gl.drawArrays(gl.TRIANGLES, 0, 6);
gl.bindVertexArray(null);
```

**`renderSettings` gains `effects` object:**
```js
effects: { chroma, scanlines, barrel, vignette, grain, crtMask }
```

All six values added to the draw effect dependency array.

### Modified: `src/App.jsx`

New state (all default 0):
```js
const [effectChroma,    setEffectChroma]    = useState(0);
const [effectScanlines, setEffectScanlines] = useState(0);
const [effectBarrel,    setEffectBarrel]    = useState(0);
const [effectVignette,  setEffectVignette]  = useState(0);
const [effectGrain,     setEffectGrain]     = useState(0);
const [effectCRTMask,   setEffectCRTMask]   = useState(0);
```

Passed to `useWebGLRenderer` as:
```js
effects: {
  chroma:    effectChroma,
  scanlines: effectScanlines,
  barrel:    effectBarrel,
  vignette:  effectVignette,
  grain:     effectGrain,
  crtMask:   effectCRTMask,
}
```

New **Effects** section in controls panel (after Colors, before Background Image):
```jsx
<div className="section-header">Effects</div>

<div className="control-group">
  <label>Chromatic Aberration: {effectChroma}%</label>
  <input type="range" min="0" max="100" value={effectChroma}
    onChange={handleChange(setEffectChroma)} />
</div>
<div className="control-group">
  <label>Scanlines: {effectScanlines}%</label>
  <input type="range" min="0" max="100" value={effectScanlines}
    onChange={handleChange(setEffectScanlines)} />
</div>
<div className="control-group">
  <label>Barrel: {effectBarrel}%</label>
  <input type="range" min="0" max="100" value={effectBarrel}
    onChange={handleChange(setEffectBarrel)} />
</div>
<div className="control-group">
  <label>Vignette: {effectVignette}%</label>
  <input type="range" min="0" max="100" value={effectVignette}
    onChange={handleChange(setEffectVignette)} />
</div>
<div className="control-group">
  <label>Film Grain: {effectGrain}%</label>
  <input type="range" min="0" max="100" value={effectGrain}
    onChange={handleChange(setEffectGrain)} />
</div>
<div className="control-group">
  <label>CRT Mask: {effectCRTMask}%</label>
  <input type="range" min="0" max="100" value={effectCRTMask}
    onChange={handleChange(setEffectCRTMask)} />
</div>
```

Effects sliders update live (no `onPointerUp` / `livePreview` guard — they only touch uniforms, not pattern generation).

### `src/App.css`

No new classes needed — effects sliders reuse `.control-group` styling.

## Initialization Order Note

The FBO resize effect depends on `canvasSize` and reads `glRef.current`. It is declared **after** the initialization effect in `useWebGLRenderer`, so on first render the WebGL context is guaranteed to exist when the FBO resize effect runs.

## Export PNG

`preserveDrawingBuffer: true` is on the canvas context. Since the final draw is to the canvas (not the FBO), `canvas.toDataURL()` captures the post-processed output correctly — no change needed.

## Out of Scope

- Bloom / phosphor glow (requires separate blur pass)
- Horizontal sync jitter / tracking artifacts
- Per-effect enable toggles (sliders at 0 = off)
- Saving effect presets
