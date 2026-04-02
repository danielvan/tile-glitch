// src/webgl/shaders.js

export const VERTEX_SHADER = `#version 300 es

// Base quad geometry: 6 vertices, positions in [-0.5, 0.5]
in vec2 aQuadPos;

// Per-instance attributes (divisor = 1)
in vec2  aPos;        // top-left corner in canvas pixels
in vec4  aUV;         // uvX, uvY, uvW, uvH in atlas (0-1)
in float aFlip;       // 0 = normal, 1 = horizontal flip
in float aOpacity;    // 0.0 to 1.0 (0 = disappeared tile)
in float aCircular;   // 0 = no mask, 1 = circular mask
in float aPhase;      // random starting phase for animation
in float aSpeed;      // animation speed multiplier (0.5 - 2.5)
in float aDirection;  // 1.0 or -1.0 (oscillation direction)
in vec4  aColor;      // r, g, b, a chaos tint overlay
in vec2  aGridPos;    // normalized grid coords: (col/cols, row/rows)

uniform vec2  uCanvasSize;
uniform float uTileSize;  // TILE_SIZE * scale in pixels

out vec2  vTexCoord;
out float vOpacity;
out float vCircular;
out float vPhase;
out float vSpeed;
out float vDirection;
out vec2  vLocalPos;   // [-0.5, 0.5] used for circular mask distance
out vec4  vColor;
out vec2  vMaskCoord;  // UV into mask texture (centre of tile cell)

void main() {
  // Position this vertex in canvas pixel space
  vec2 pixelPos = aPos + (aQuadPos + 0.5) * uTileSize;

  // Convert to WebGL clip space [-1, 1], flip Y axis
  vec2 clip = (pixelPos / uCanvasSize) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);

  // UV: flip horizontally by mirroring the x offset around center
  float ux = aFlip > 0.5
    ? aUV.x + (0.5 - aQuadPos.x) * aUV.z
    : aUV.x + (aQuadPos.x + 0.5) * aUV.z;
  float uy = aUV.y + (aQuadPos.y + 0.5) * aUV.w;
  vTexCoord  = vec2(ux, uy);

  vOpacity   = aOpacity;
  vCircular  = aCircular;
  vPhase     = aPhase;
  vSpeed     = aSpeed;
  vDirection = aDirection;
  vLocalPos  = aQuadPos;
  vColor     = aColor;
  vMaskCoord = aGridPos;
}`;

export const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

uniform sampler2D uAtlas;
uniform sampler2D uMask;
uniform bool      uHasMask;
uniform float     uTime;       // rAF timestamp in ms
uniform float     uBaseSpeed;  // (animationSpeed / 1000) * 0.1
uniform bool      uAnimate;    // animateMasks toggle

in vec2  vTexCoord;
in float vOpacity;
in float vCircular;
in float vPhase;
in float vSpeed;
in float vDirection;
in vec2  vLocalPos;
in vec4  vColor;
in vec2  vMaskCoord;

out vec4 fragColor;

void main() {
  // Mask: tile is transparent so background shows through
  if (uHasMask && texture(uMask, vMaskCoord).r > 0.5) discard;

  // Skip fully transparent tiles (disappeared)
  if (vOpacity < 0.01) discard;

  vec4 color = texture(uAtlas, vTexCoord);

  // Apply chaos tint overlay
  if (vColor.a > 0.01) {
    color.rgb = mix(color.rgb, vColor.rgb, vColor.a);
  }

  float alpha = vOpacity;

  if (uAnimate) {
    // Replicates original: time = (timestamp * baseSpeed * speed + phase) * direction
    float t = (uTime * uBaseSpeed * vSpeed + vPhase) * vDirection;

    if (vCircular > 0.5) {
      // Circular mask: radius oscillates 0 → 0.5 (half tile width)
      float scale01 = (sin(t) + 1.0) / 2.0;
      float radius  = scale01 * 0.5;
      if (length(vLocalPos) > radius) discard;
    } else {
      // Opacity oscillates 0 → 1
      alpha *= (sin(t) + 1.0) / 2.0;
    }
  } else if (vCircular > 0.5) {
    // Static circular mask: hard clip at 0.5 radius
    if (length(vLocalPos) > 0.5) discard;
  }

  fragColor = vec4(color.rgb, color.a * alpha);
}`;

// Background image shaders — simple full-screen quad with cover-fit UV
export const BG_VERTEX_SHADER = `#version 300 es

in vec2 aPos;  // clip-space quad: [-1, 1]

uniform vec2 uBgUVScale;   // cover-fit scale
uniform vec2 uBgUVOffset;  // cover-fit offset

out vec2 vUV;

void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
  // aPos.y=1 is top in clip space → UV.y=0 (top of image)
  vec2 uv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  vUV = uv * uBgUVScale + uBgUVOffset;
}`;

export const BG_FRAGMENT_SHADER = `#version 300 es
precision mediump float;

uniform sampler2D uBgImage;

in vec2 vUV;
out vec4 fragColor;

void main() {
  fragColor = texture(uBgImage, vUV);
}`;
