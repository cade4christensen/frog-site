import * as THREE from "three";
import type { Pond } from "./pond";

/**
 * Turns the frog and the pond into one grid of square dots: each cell is
 * either a solid square or empty, chosen by ordered (Bayer) dithering of its
 * brightness. The frog wins where it covers a cell; otherwise the pond's
 * ripples/fireflies (red channel), then its glow (green channel).
 */

export const CELL = 4; // CSS px per dot cell
const GAP = 1; // CSS px of space between dots

const fragmentShader = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tPond;
  uniform vec2 gridSize;
  uniform float cell;
  uniform float gap;
  uniform vec3 color;
  uniform vec3 rippleColor;
  uniform vec3 glowColor;
  uniform float black;
  uniform float white;

  // Compact 4x4 Bayer matrix.
  float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
  float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

  void main() {
    vec2 frag = gl_FragCoord.xy;
    vec2 c = floor(frag / cell);
    vec2 uv = (c + 0.5) / gridSize;

    vec2 local = mod(frag, cell);
    if (local.x >= cell - gap || local.y >= cell - gap) discard;

    float threshold = bayer4(c) + 0.03;
    vec4 s = texture2D(tScene, uv);
    if (s.a >= 0.5) {
      // Render target holds linear light; convert to perceived brightness.
      float lum = pow(dot(s.rgb, vec3(0.299, 0.587, 0.114)), 1.0 / 2.2);
      lum = clamp((lum - black) / (white - black), 0.0, 1.0);
      if (lum <= threshold) discard;
      gl_FragColor = vec4(color, 1.0);
      return;
    }

    vec4 p = texture2D(tPond, uv);
    if (p.r > threshold) {
      gl_FragColor = vec4(rippleColor, 1.0);
    } else if (p.g > threshold) {
      gl_FragColor = vec4(glowColor, 1.0);
    } else {
      discard;
    }
  }
`;

// The shader writes colors straight to the screen, so skip Three's
// sRGB-to-linear conversion or they come out much darker than the hex.
const rawColor = (hex: number) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);

export class DitherPass {
  private target = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  private material: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private pondTexture: THREE.CanvasTexture;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private pond: Pond,
  ) {
    this.pondTexture = new THREE.CanvasTexture(pond.canvas);
    this.pondTexture.minFilter = this.pondTexture.magFilter = THREE.NearestFilter;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.target.texture },
        tPond: { value: this.pondTexture },
        gridSize: { value: new THREE.Vector2() },
        cell: { value: CELL },
        gap: { value: GAP },
        color: { value: rawColor(0xece6d6) },
        rippleColor: { value: rawColor(0x56705f) },
        glowColor: { value: rawColor(0x0e1d15) },
        black: { value: 0.04 },
        white: { value: 0.5 },
      },
      vertexShader: "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader,
      transparent: true,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
  }

  setSize() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const dpr = this.renderer.getPixelRatio();
    // One texel per dot cell is all the shader needs.
    const cell = CELL * dpr;
    const grid = new THREE.Vector2(Math.ceil(size.x / cell), Math.ceil(size.y / cell));
    this.target.setSize(grid.x, grid.y);
    this.material.uniforms.gridSize.value.copy(grid);
    this.material.uniforms.cell.value = cell;
    this.material.uniforms.gap.value = GAP * dpr;
    this.pond.setSize(grid.x, grid.y);
    // The canvas was resized, so the GPU texture must be reallocated.
    this.pondTexture.dispose();
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    this.pondTexture.needsUpdate = true;
    this.renderer.setRenderTarget(this.target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    this.renderer.render(this.quad, this.camera);
  }
}
