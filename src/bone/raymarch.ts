/* =====================================================================
   Raymarched trabecular volume (WebGL2): ray/box intersection, fixed-step
   march, bisection refinement, gradient normals, and a procedural bone
   material (ivory albedo with mottling, faint lacunae, short-range AO).
   Every specimen face is a closed cut, exactly like a micro-CT core.
   Renders on demand only; the viewer draws a frame when something changes.
   ===================================================================== */

import * as THREE from "three";
import { cssRampStops, type Stop } from "./colormap";
import type { Dims } from "./volume";
import type { V3 } from "./engine";

const vert = /* glsl */ `
uniform vec3 uCamPos;
out vec3 vOrigin;
out vec3 vDir;
void main() {
  vOrigin = uCamPos;
  vDir = position - uCamPos;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */ `
precision highp float;
precision highp sampler3D;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
in vec3 vOrigin;
in vec3 vDir;
out vec4 outColor;

uniform sampler3D uQ;
uniform sampler3D uLT;
uniform sampler2D uRamp;
uniform float uBeta;
uniform float uPhase;   // +1 bone, -1 marrow
uniform float uMode;    // 0 bone material, 1 local-thickness colour map
uniform float uAlpha;
uniform float uPick;
uniform float uPickW;
uniform float uPickOn;
uniform float uCut;
uniform float uCutOn;
uniform float uSteps;
uniform vec3 uSize;
uniform mat3 uTexRot;

vec3 tc(vec3 p) { return uTexRot * p + 0.5; }
// R = signed q (smooth across plate midplanes), G = |q| as sampled: smooth surface without sub-voxel ghost films
float qv(vec3 p) { return abs(texture(uQ, tc(p)).r); }
float phaseD(vec3 p) { return uPhase * (uBeta - qv(p)); }
float dens(vec3 p) {
  float d = phaseD(p);
  vec3 a = 0.5 - abs(p);
  d = min(d, min(min(a.x, a.y), a.z) * 6.0);
  if (uCutOn > 0.5) d = min(d, (uCut - p.y) * 6.0);
  return d;
}

vec2 hitBox(vec3 o, vec3 d) {
  vec3 inv = 1.0 / d;
  vec3 t0 = (vec3(-0.5) - o) * inv;
  vec3 t1 = (vec3(0.5) - o) * inv;
  vec3 mn = min(t0, t1);
  vec3 mx = max(t0, t1);
  return vec2(max(max(mn.x, mn.y), mn.z), min(min(mx.x, mx.y), mx.z));
}

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
float worley(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  float md = 1.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(x, y, z);
    vec3 r = o + vec3(hash(i + o), hash(i + o + 17.31), hash(i + o + 41.7)) * vec3(1.0, 0.45, 1.0) - f;
    md = min(md, dot(r, r));
  }
  return sqrt(md);
}

void main() {
  vec3 dir = normalize(vDir);
  vec2 b = hitBox(vOrigin, dir);
  if (b.x > b.y) discard;
  b.x = max(b.x, 0.0);

  float dt = 1.75 / uSteps;
  float t = b.x + 1e-4;
  float prevT = t;
  bool hit = false;
  for (int i = 0; i < 640; i++) {
    if (float(i) >= uSteps || t > b.y) break;
    if (dens(vOrigin + dir * t) > 0.0) { hit = true; break; }
    prevT = t;
    t += dt;
  }
  if (!hit) discard;

  // bisection refinement of the crossing
  float t0 = prevT, t1 = t;
  if (t1 > t0 + 1e-6) {
    for (int k = 0; k < 6; k++) {
      float tm = 0.5 * (t0 + t1);
      if (dens(vOrigin + dir * tm) > 0.0) t1 = tm; else t0 = tm;
    }
  }
  vec3 p = vOrigin + dir * t1;

  float h = 1.0 / uSize.x;
  vec3 g = vec3(
    dens(p + vec3(h, 0, 0)) - dens(p - vec3(h, 0, 0)),
    dens(p + vec3(0, h, 0)) - dens(p - vec3(0, h, 0)),
    dens(p + vec3(0, 0, h)) - dens(p - vec3(0, 0, h)));
  vec3 n = -normalize(g + 1e-7);

  // signed distance (object units) to the trabecular surface, >0 inside
  vec3 gq = vec3(
    phaseD(p + vec3(h, 0, 0)) - phaseD(p - vec3(h, 0, 0)),
    phaseD(p + vec3(0, h, 0)) - phaseD(p - vec3(0, h, 0)),
    phaseD(p + vec3(0, 0, h)) - phaseD(p - vec3(0, 0, h))) / (2.0 * h);
  float dist = max(0.0, phaseD(p) / max(length(gq), 1e-3));

  // ---------- material ----------
  float m = fbm(p * 26.0);
  vec3 alb;
  if (uMode < 0.5) {
    vec3 ivory = vec3(0.91, 0.875, 0.80);
    vec3 umber = vec3(0.70, 0.64, 0.54);
    alb = mix(umber, ivory, 0.45 + 0.55 * m);
    // lamellae, lacunae and roughness kept faint: at figure size they alias into moire and speckle
    float onCut = smoothstep(0.0015, 0.006, dist);
    float w = worley(p * vec3(85.0, 110.0, 85.0) + vec3(0.0, dist * 30.0, 0.0));
    alb *= mix(0.86, 1.0, smoothstep(0.07, 0.15, w));
    alb = mix(alb, alb * vec3(1.03, 0.98, 0.9), onCut * 0.5);
    n = normalize(n + 0.05 * (vec3(vnoise(p * 90.0), vnoise(p * 90.0 + 7.1), vnoise(p * 90.0 + 3.3)) - 0.5));
  } else {
    float lt = texture(uLT, p + 0.5 - n * (1.5 / uSize.x)).r;
    alb = pow(texture(uRamp, vec2(clamp(lt, 0.002, 0.998), 0.5)).rgb, vec3(2.2));
    alb *= 0.88 + 0.12 * m;
    if (uPickOn > 0.5) {
      float k = 1.0 - smoothstep(uPickW, uPickW * 1.8, abs(lt - uPick));
      vec3 grey = vec3(dot(alb, vec3(0.3, 0.55, 0.15))) * 0.55 + 0.32;
      alb = mix(grey, alb * 1.08, 0.18 + 0.82 * k);
    }
  }

  // ---------- ambient occlusion ----------
  float occ = 0.0;
  for (int k = 1; k <= 5; k++) {
    float s = float(k) * 1.6 / uSize.x;
    occ += step(0.0, phaseD(p + n * s)) / float(k);
  }
  float ao = 1.0 - 0.42 * occ / 2.28;

  vec3 L = normalize(vec3(-0.45, 0.9, 0.55));
  vec3 V = -dir;
  float diff = max(dot(n, L), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(n, H), 0.0), 36.0) * (uMode < 0.5 ? 0.22 : 0.16);
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0) * 0.12;
  vec3 col = alb * (0.16 + 0.26 * hemi + 0.82 * diff) * ao + spec + rim;
  col *= mix(1.0, 0.6, smoothstep(0.05, 0.95, t1 - b.x));

  outColor = vec4(pow(col, vec3(1.0 / 2.2)), uAlpha);
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
}`;

/* ----------------------------- textures ----------------------------- */

function tex3(d: Dims, wrap: THREE.Wrapping, channels: 1 | 2) {
  const t = new THREE.Data3DTexture(new Uint16Array(d[0] * d[1] * d[2] * channels), d[0], d[1], d[2]);
  t.format = channels === 2 ? THREE.RGFormat : THREE.RedFormat;
  t.type = THREE.HalfFloatType;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = wrap;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

export function rampTexture(stops: Stop[]) {
  const data = new Uint8Array(256 * 4);
  const s = cssRampStops(stops, 256);
  for (let i = 0; i < 256; i++) {
    data[i * 4] = s[i][0];
    data[i * 4 + 1] = s[i][1];
    data[i * 4 + 2] = s[i][2];
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, 256, 1);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export interface Viewable {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  tick(): boolean;
  onChange: () => void;
  /** Views sharing this camera; they redraw when this one is rotated. */
  peers?: Viewable[];
  /** Optional 2-D annotations drawn over the rendered frame (labels, arrows). */
  overlay?(ctx: CanvasRenderingContext2D, cam: THREE.Camera, w: number, h: number): void;
}

export type Uniforms = Partial<{
  uBeta: number;
  uPhase: number;
  uMode: number;
  uAlpha: number;
  uPick: number;
  uPickW: number;
  uPickOn: number;
  uCut: number;
  uCutOn: number;
  uSteps: number;
  uGrey: number;
}>;

export function addLights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x625a50, 1.1));
  const k = new THREE.DirectionalLight(0xffffff, 2.2);
  k.position.set(-1, 2.2, 1.4);
  scene.add(k);
  const f = new THREE.DirectionalLight(0xffffff, 0.6);
  f.position.set(2, 0.3, 1);
  scene.add(f);
}

export function makeCamera(view: V3, fov = 26, dist = 4.1) {
  const cam = new THREE.PerspectiveCamera(fov, 1, 0.05, 50);
  cam.position.set(...view).normalize().multiplyScalar(dist);
  cam.lookAt(0, 0, 0);
  return cam;
}

export class VolumeScene implements Viewable {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  mat: THREE.ShaderMaterial;
  box: THREE.Mesh;
  qTex: THREE.Data3DTexture;
  ltTex: THREE.Data3DTexture;
  onChange: () => void = () => {};
  peers?: Viewable[];
  private anims: (() => boolean)[] = [];

  constructor(public dims: Dims, opts: { view?: V3; fov?: number; dist?: number; ramp?: Stop[] } = {}) {
    addLights(this.scene);
    this.camera = makeCamera(opts.view ?? [1.2, 0.95, 1.4], opts.fov, opts.dist);
    this.qTex = tex3(dims, THREE.RepeatWrapping, 2);
    this.ltTex = tex3(dims, THREE.ClampToEdgeWrapping, 1);
    this.mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vert,
      fragmentShader: frag,
      side: THREE.BackSide,
      transparent: true,
      uniforms: {
        uQ: { value: this.qTex },
        uLT: { value: this.ltTex },
        uRamp: { value: opts.ramp ? rampTexture(opts.ramp) : null },
        uBeta: { value: 0.5 },
        uPhase: { value: 1 },
        uMode: { value: 0 },
        uAlpha: { value: 1 },
        uPick: { value: 0.5 },
        uPickW: { value: 0.05 },
        uPickOn: { value: 0 },
        uCut: { value: 0 },
        uCutOn: { value: 0 },
        uSteps: { value: 300 },
        uSize: { value: new THREE.Vector3(...dims) },
        uTexRot: { value: new THREE.Matrix3() },
        uCamPos: { value: new THREE.Vector3() },
      },
    });
    this.box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.mat);
    this.box.renderOrder = 2;
    this.box.onBeforeRender = (_r, _s, cam) => {
      const u = this.mat.uniforms.uCamPos.value as THREE.Vector3;
      u.copy(cam.position);
      this.box.worldToLocal(u);
    };
    this.scene.add(this.box);
  }

  /** R = signed q, G = |q| (see the shader's qv). */
  setQ(q: Float32Array & { signed?: Float32Array }) {
    const s = q.signed ?? q;
    const arr = (this.qTex.image as unknown as { data: Uint16Array }).data;
    const toHalf = THREE.DataUtils.toHalfFloat;
    for (let i = 0; i < q.length; i++) {
      arr[2 * i] = toHalf(s[i]);
      arr[2 * i + 1] = toHalf(q[i]);
    }
    this.qTex.needsUpdate = true;
    this.onChange();
  }
  setLT(lt: Float32Array) {
    const arr = (this.ltTex.image as unknown as { data: Uint16Array }).data;
    const toHalf = THREE.DataUtils.toHalfFloat;
    for (let i = 0; i < lt.length; i++) arr[i] = toHalf(lt[i]);
    this.ltTex.needsUpdate = true;
    this.onChange();
  }
  /** Swap the colour ramp used by the local-thickness mode. */
  setRamp(stops: Stop[]) {
    (this.mat.uniforms.uRamp.value as THREE.Texture | null)?.dispose();
    this.mat.uniforms.uRamp.value = rampTexture(stops);
    this.onChange();
  }
  setTexRot(m: THREE.Matrix3) {
    (this.mat.uniforms.uTexRot.value as THREE.Matrix3).copy(m);
    this.onChange();
  }
  set(u: Uniforms) {
    for (const [k, v] of Object.entries(u)) if (this.mat.uniforms[k]) this.mat.uniforms[k].value = v;
    if (u.uAlpha !== undefined) this.mat.depthWrite = u.uAlpha >= 0.999;
    this.onChange();
  }
  addAnim(fn: () => boolean) {
    this.anims.push(fn);
  }
  tick() {
    let on = false;
    for (const f of this.anims) if (f()) on = true;
    return on;
  }
}

/* ------------------------------ helpers ----------------------------- */

/** Voxel index -> object-space position for a volume spanning [-0.5,0.5]^3. */
export const vox2world = (d: Dims, x: number, y: number, z: number): V3 => [
  (x + 0.5) / d[0] - 0.5,
  (y + 0.5) / d[1] - 0.5,
  (z + 0.5) / d[2] - 0.5,
];

export type Ball = { p: V3; r: number; c?: THREE.ColorRepresentation };

/** Instanced spheres that ease toward their targets (radius and position). */
export class SphereSet {
  mesh: THREE.InstancedMesh;
  private cur: Float32Array;
  private tgt: Float32Array;
  private m = new THREE.Matrix4();
  private col = new THREE.Color();

  constructor(private vs: VolumeScene, private max = 64) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.05 });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 40, 26), mat, max);
    this.mesh.renderOrder = 0;
    this.mesh.frustumCulled = false;
    this.cur = new Float32Array(max * 4);
    this.tgt = new Float32Array(max * 4);
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, this.col.set(0xc2335f));
    vs.scene.add(this.mesh);
    vs.addAnim(() => this.step());
    this.write();
  }

  setTargets(list: Ball[]) {
    for (let i = 0; i < this.max; i++) {
      const b = list[i];
      const o = i * 4;
      if (b) {
        if (this.cur[o + 3] < 1e-4) {
          this.cur[o] = b.p[0];
          this.cur[o + 1] = b.p[1];
          this.cur[o + 2] = b.p[2];
        }
        this.tgt.set([b.p[0], b.p[1], b.p[2], b.r], o);
        this.mesh.setColorAt(i, this.col.set(b.c ?? 0xc2335f));
      } else this.tgt[o + 3] = 0;
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.vs.onChange();
  }

  setVisible(v: boolean) {
    this.mesh.visible = v;
    this.vs.onChange();
  }

  private step() {
    let moving = false;
    for (let i = 0; i < this.cur.length; i++) {
      const d = this.tgt[i] - this.cur[i];
      if (Math.abs(d) > 1e-4) {
        this.cur[i] += d * 0.16;
        moving = true;
      } else this.cur[i] = this.tgt[i];
    }
    if (moving) this.write();
    return moving;
  }

  private write() {
    for (let i = 0; i < this.max; i++) {
      const o = i * 4;
      const r = Math.max(1e-5, this.cur[o + 3]);
      this.m.makeScale(r, r, r).setPosition(this.cur[o], this.cur[o + 1], this.cur[o + 2]);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Thick tube segment between two points (for outlines, axes, dashes). */
export function tube(a: V3, b: V3, r: number, mat: THREE.Material) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}

/** The analysis plane outline drawn around the specimen. */
export function planeOutline(y = 0, half = 0.6, color: THREE.ColorRepresentation = 0x000000, opacity = 1, r = 0.0085) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
  const P: V3[] = [
    [-half, y, -half],
    [half, y, -half],
    [half, y, half],
    [-half, y, half],
  ];
  for (let i = 0; i < 4; i++) g.add(tube(P[i], P[(i + 1) % 4], r, mat));
  return g;
}

/** The coronal plane outline (vertical, facing +z) drawn around the specimen. */
export function coronalOutline(z = 0, half = 0.6, color: THREE.ColorRepresentation = 0x000000, opacity = 1, r = 0.0085) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
  const P: V3[] = [
    [-half, -half, z],
    [half, -half, z],
    [half, half, z],
    [-half, half, z],
  ];
  for (let i = 0; i < 4; i++) g.add(tube(P[i], P[(i + 1) % 4], r, mat));
  return g;
}

/** Red dashed line drawn on top of the volume. */
export function dashedLine(a: V3, b: V3, color = 0xe0322b, r = 0.011, dash = 0.05, gap = 0.032) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true });
  const A = new THREE.Vector3(...a);
  const D = new THREE.Vector3(...b).sub(A);
  const L = D.length();
  D.normalize();
  for (let s = 0; s < L; s += dash + gap) {
    const e = Math.min(L, s + dash);
    const p0 = A.clone().addScaledVector(D, s);
    const p1 = A.clone().addScaledVector(D, e);
    const m = tube([p0.x, p0.y, p0.z], [p1.x, p1.y, p1.z], r, mat);
    m.renderOrder = 10;
    g.add(m);
  }
  return g;
}

/** Wireframe cube (12 tubes) of edge `size` centred at `c`, e.g. to mark an inset region. */
export function boxOutline(c: V3, size: number, color = 0x1c1917, r = 0.006) {
  const g = new THREE.Group();
  // drawn over the volume so the marked region stays visible inside an opaque specimen
  const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true });
  const h = size / 2;
  const P = (x: number, y: number, z: number): V3 => [c[0] + x * h, c[1] + y * h, c[2] + z * h];
  const E: [V3, V3][] = [];
  for (const a of [-1, 1])
    for (const b of [-1, 1]) {
      E.push([P(-1, a, b), P(1, a, b)], [P(a, -1, b), P(a, 1, b)], [P(a, b, -1), P(a, b, 1)]);
    }
  for (const [a, b] of E) {
    const m = tube(a, b, r, mat);
    m.renderOrder = 10;
    g.add(m);
  }
  return g;
}
