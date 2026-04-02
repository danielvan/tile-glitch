# FBO Post-Processing Effects — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a framebuffer (FBO) rendering pipeline and a single post-processing shader pass with six 80s/90s CRT-style effects: chromatic aberration, scanlines, barrel distortion, vignette, film grain, CRT phosphor mask.

**Architecture:** Tiles and background render to an offscreen FBO texture. A new fullscreen post-processing pass reads that texture and applies all effects in one fragment shader. The FBO texture is recreated whenever canvas size changes. All six effect intensities (0–100) are passed as uniforms. A new Effects section in the controls panel exposes them.

**Tech Stack:** WebGL 2, GLSL 300 es, React hooks, twgl.js

---

## File Map

| File | Change |
|------|--------|
| `src/webgl/shaders.js` | Add `POST_VERTEX_SHADER`, `POST_FRAGMENT_SHADER` exports |
| `src/hooks/useWebGLRenderer.js` | FBO setup in init effect, FBO resize effect, post pass in draw loop, accept `effects` in renderSettings |
| `src/App.jsx` | 6 new effect state values, Effects section in UI, pass `effects` to renderer |

---

### Task 1: Add post-processing shaders

**Files:**
- Modify: `src/webgl/shaders.js`

- [ ] **Step 1: Read the current file**

Read `src/webgl/shaders.js` in full.

- [ ] **Step 2: Append POST shaders at the end of the file**

Add after the last line of `BG_FRAGMENT_SHADER`:

```js
// Post-processing shaders — fullscreen CRT effects pass
export const POST_VERTEX_SHADER = `#version 300 es

in vec2 aPos;
out vec2 vUV;

void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
  vUV = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
}`;

export const POST_FRAGMENT_SHADER = `#version 300 es
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
    vec2 d      = uv - 0.5;
    float dist  = length(d);
    vec2 offset = normalize(d) * dist * uChroma * 0.05;
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
}`;
```

- [ ] **Step 3: Commit**

```bash
git add src/webgl/shaders.js
git commit -m "feat: add POST_VERTEX_SHADER and POST_FRAGMENT_SHADER for CRT effects"
```

---

### Task 2: Update useWebGLRenderer — FBO + post pass

**Files:**
- Modify: `src/hooks/useWebGLRenderer.js`

- [ ] **Step 1: Read the current file**

Read `src/hooks/useWebGLRenderer.js` in full.

- [ ] **Step 2: Add POST shader imports**

Find:

```js
import { VERTEX_SHADER, FRAGMENT_SHADER, BG_VERTEX_SHADER, BG_FRAGMENT_SHADER } from '../webgl/shaders.js';
```

Replace with:

```js
import { VERTEX_SHADER, FRAGMENT_SHADER, BG_VERTEX_SHADER, BG_FRAGMENT_SHADER, POST_VERTEX_SHADER, POST_FRAGMENT_SHADER } from '../webgl/shaders.js';
```

- [ ] **Step 3: Add new refs**

Find the block of existing refs (starting with `const glRef`). Add four new refs directly after `const rafRef = useRef(null);`:

```js
  const fboRef             = useRef(null);
  const fboTexRef          = useRef(null);
  const postProgramInfoRef = useRef(null);
  const postVaoRef         = useRef(null);
```

- [ ] **Step 4: Destructure effects from renderSettings**

Find:

```js
  const {
    backgroundColor, scale, canvasSize, animateMasks, animationSpeed,
    bgImage, maskTextureRef, maskVersion,
  } = renderSettings;
```

Replace with:

```js
  const {
    backgroundColor, scale, canvasSize, animateMasks, animationSpeed,
    bgImage, maskTextureRef, maskVersion,
    effects,
  } = renderSettings;
  const { chroma = 0, scanlines = 0, barrel = 0, vignette = 0, grain = 0, crtMask = 0 } = effects ?? {};
```

- [ ] **Step 5: Add FBO + post program setup to the initialization effect**

Find the end of the initialization effect, just before `gl.bindVertexArray(null);` that closes the bgVao setup:

```js
    gl.bindVertexArray(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
```

Replace with:

```js
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
```

- [ ] **Step 6: Add FBO texture resize effect**

Add this new `useEffect` directly after the initialization effect (before the atlas texture upload effect):

```js
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
```

- [ ] **Step 7: Update the draw function to render to FBO then post-process**

Find the `draw` function inside the draw loop effect. The current opening is:

```js
    const draw = (timestamp) => {
      const [r, g, b] = hexToRgb(backgroundColor);
      gl.clearColor(r / 255, g / 255, b / 255, 1);
      gl.viewport(0, 0, canvasSize.width, canvasSize.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
```

Replace with:

```js
    const draw = (timestamp) => {
      if (!fboRef.current || !fboTexRef.current || !postProgramInfoRef.current) return;

      // --- Render scene to FBO ---
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboRef.current);
      const [r, g, b] = hexToRgb(backgroundColor);
      gl.clearColor(r / 255, g / 255, b / 255, 1);
      gl.viewport(0, 0, canvasSize.width, canvasSize.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
```

Then find the very end of the tile pass (just before the closing `};` of the `draw` function):

```js
      gl.bindVertexArray(vaoRef.current);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instanceCountRef.current);
      gl.bindVertexArray(null);
    };
```

Replace with:

```js
      gl.bindVertexArray(vaoRef.current);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instanceCountRef.current);
      gl.bindVertexArray(null);

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
```

- [ ] **Step 8: Add effect values to draw effect dependency array**

Find:

```js
  }, [animateMasks, animationSpeed, backgroundColor, canvasSize, scale,
      instanceData, bgImage, maskVersion, maskTextureRef]);
```

Replace with:

```js
  }, [animateMasks, animationSpeed, backgroundColor, canvasSize, scale,
      instanceData, bgImage, maskVersion, maskTextureRef,
      chroma, scanlines, barrel, vignette, grain, crtMask]);
```

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useWebGLRenderer.js
git commit -m "feat: FBO pipeline — render to offscreen texture, post-processing pass with CRT effects"
```

---

### Task 3: Wire effects in App.jsx

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Read the current file**

Read `src/App.jsx` in full.

- [ ] **Step 2: Add effect state values**

Add these six state declarations after the existing `livePreview` state line:

```js
  const [effectChroma,    setEffectChroma]    = useState(0);
  const [effectScanlines, setEffectScanlines] = useState(0);
  const [effectBarrel,    setEffectBarrel]    = useState(0);
  const [effectVignette,  setEffectVignette]  = useState(0);
  const [effectGrain,     setEffectGrain]     = useState(0);
  const [effectCRTMask,   setEffectCRTMask]   = useState(0);
```

- [ ] **Step 3: Pass effects to useWebGLRenderer**

Find:

```js
  const fps = useWebGLRenderer(canvasRef, atlasData, instanceData, {
    backgroundColor, scale, canvasSize, animateMasks, animationSpeed,
    bgImage, maskTextureRef, maskVersion,
  });
```

Replace with:

```js
  const fps = useWebGLRenderer(canvasRef, atlasData, instanceData, {
    backgroundColor, scale, canvasSize, animateMasks, animationSpeed,
    bgImage, maskTextureRef, maskVersion,
    effects: {
      chroma:    effectChroma,
      scanlines: effectScanlines,
      barrel:    effectBarrel,
      vignette:  effectVignette,
      grain:     effectGrain,
      crtMask:   effectCRTMask,
    },
  });
```

- [ ] **Step 4: Add Effects section to UI**

Add this new section directly after the Colors section (after the Exclude Tolerance slider, before the Background Image section header):

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

- [ ] **Step 5: Verify**

Run `npm run dev`. Load a tileset and generate a pattern.

- With all effects at 0: output looks identical to before
- Dragging Chromatic Aberration: red/blue fringing appears at edges, live
- Dragging Scanlines: dark horizontal line pattern overlaid
- Dragging Barrel: image curves outward, edges clip to black
- Dragging Vignette: corners and edges darken
- Dragging Film Grain: animated noise appears over the image
- Dragging CRT Mask: faint RGB stripe pattern visible (most visible on solid colours)
- Animating masks with effects on: FPS should still be smooth (all effects are one extra draw call)
- Export PNG: captures the post-processed output (barrel, chroma etc. visible in exported file)

- [ ] **Step 6: Commit and tag**

```bash
git add src/App.jsx
git commit -m "feat: wire CRT effects UI — 6 sliders, Effects section, live preview"
git tag v5-crt-effects
git push origin main --tags
```

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests | 0 | — | — |

**VERDICT:** NO REVIEWS YET
