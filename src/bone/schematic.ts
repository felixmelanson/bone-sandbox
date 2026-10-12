/* =====================================================================
   Fixed schematic illustrations of Hildebrand sphere fitting, after the
   reference figure: one smooth trabecular network (left column with
   holes, an arch, a Y at top right, a leg under the arch).
   ---------------------------------------------------------------------
   The bone is a signed distance field: each strut is a tapered tube
   round a curved axis, joined with a smooth minimum so junctions blend.
   It is meshed with surface nets. Spheres are read from the same field,
   so they are exact maximal spheres for the drawn surface:
     Tb.Th  centred on the arch axis, radius = distance to the surface
     Tb.Sp  centred where the distance to bone peaks in each pore
   The slider scales every strut radius; mesh and spheres follow.
   ===================================================================== */

import * as THREE from "three";
import { surfaceNets } from "./mesh";
import { makeCamera, type Viewable } from "./raymarch";
import { markStudio } from "./views";

type P = [number, number, number];

/** Strut axis (control points) and radius at its start and end (at slider scale 1). */
const STRUTS: { pts: P[]; r0: number; r1: number }[] = [
  // left column, with two side branches leaving holes at the frame edge
  { pts: [[-0.8, -1.35, 0], [-0.74, -0.3, 0.05], [-0.7, 0.45, 0], [-0.75, 1.35, -0.05]], r0: 0.15, r1: 0.13 },
  { pts: [[-0.72, 0.52, 0], [-0.98, 0.3, 0.05], [-1.35, 0.36, 0]], r0: 0.1, r1: 0.09 },
  { pts: [[-0.76, -0.18, 0], [-1.0, -0.55, 0], [-1.35, -0.6, 0]], r0: 0.09, r1: 0.085 },
  // the arch that carries the Tb.Th chain: thick on the left, thinning to the right
  { pts: [[-0.74, -0.05, 0.02], [-0.48, 0.14, 0.05], [-0.18, 0.36, 0.04], [0.1, 0.38, 0], [0.33, 0.2, 0], [0.47, -0.12, 0.02], [0.58, -0.55, 0], [0.66, -1.35, 0]], r0: 0.165, r1: 0.085 },
  // the Y at top right
  { pts: [[0.08, 0.38, 0], [0.0, 0.8, -0.05], [-0.08, 1.35, -0.08]], r0: 0.11, r1: 0.1 },
  { pts: [[0.3, 0.24, 0], [0.62, 0.72, -0.04], [0.92, 1.35, -0.05]], r0: 0.11, r1: 0.1 },
  // leg under the arch, set back, and a right branch
  { pts: [[-0.32, 0.24, -0.12], [-0.4, -0.4, -0.18], [-0.5, -1.35, -0.2]], r0: 0.12, r1: 0.11 },
  { pts: [[0.52, -0.3, 0], [0.9, -0.42, -0.04], [1.35, -0.38, -0.05]], r0: 0.09, r1: 0.085 },
];
const ARCH = 3;
const SEG = 48;
const K = 0.07; // smooth-union blend width

/** Each strut as a polyline with per-vertex radius (scale 1). */
const POLY = STRUTS.map((s) => {
  const c = new THREE.CatmullRomCurve3(s.pts.map((p) => new THREE.Vector3(...p)), false, "centripetal");
  const pts = c.getSpacedPoints(SEG);
  return { curve: c, pts, rad: pts.map((_, i) => s.r0 + (s.r1 - s.r0) * (i / SEG)) };
});

/** Distance from p to strut k's axis, and the axis radius at the nearest point, written to AX (no allocation). */
const AX = { a: 0, r: 0 };
function axisDistInto(k: number, x: number, y: number, z: number) {
  const { pts, rad } = POLY[k];
  let best = Infinity;
  let r = rad[0];
  for (let i = 0; i < SEG; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (y - a.y) * aby + (z - a.z) * abz) / (abx * abx + aby * aby + abz * abz)));
    const dx = x - a.x - abx * t;
    const dy = y - a.y - aby * t;
    const dz = z - a.z - abz * t;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < best) {
      best = d;
      r = rad[i] + (rad[i + 1] - rad[i]) * t;
    }
  }
  AX.a = Math.sqrt(best);
  AX.r = r;
}

const smin = (a: number, b: number) => {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / K));
  return b + (a - b) * h - K * h * (1 - h);
};

/** Signed distance to the bone surface at slider scale s (negative inside bone). */
function sdf(x: number, y: number, z: number, s: number) {
  let d = Infinity;
  for (let k = 0; k < STRUTS.length; k++) {
    axisDistInto(k, x, y, z);
    d = d === Infinity ? AX.a - s * AX.r : smin(d, AX.a - s * AX.r);
  }
  return d;
}

/* ---------------------- precomputed field (shared) ------------------ */

const X0 = -1.3;
const Y0 = -1.3;
const Z0 = -0.5;
const H = 0.026;
const NX = 100;
const NY = 100;
const NZ = 35;
const TOP = 4; // nearest struts kept per voxel

/** Per voxel: the TOP nearest struts' axis distance and radius, so a new scale only needs arithmetic. */
let FIELD: { d: Float32Array; r: Float32Array } | null = null;
function field() {
  if (FIELD) return FIELD;
  const N = NX * NY * NZ;
  const d = new Float32Array(N * TOP).fill(10);
  const r = new Float32Array(N * TOP);
  // per voxel, keep the TOP struts with the smallest surface distance (a - r) by insertion; nothing is allocated in the loop
  const ka = new Float64Array(TOP);
  const kr = new Float64Array(TOP);
  const ks = new Float64Array(TOP);
  for (let iz = 0; iz < NZ; iz++)
    for (let iy = 0; iy < NY; iy++)
      for (let ix = 0; ix < NX; ix++) {
        const x = X0 + ix * H;
        const y = Y0 + iy * H;
        const z = Z0 + iz * H;
        ks.fill(Infinity);
        for (let k = 0; k < STRUTS.length; k++) {
          axisDistInto(k, x, y, z);
          const sk = AX.a - AX.r;
          if (sk >= ks[TOP - 1]) continue;
          let j = TOP - 1;
          while (j > 0 && ks[j - 1] > sk) {
            ks[j] = ks[j - 1];
            ka[j] = ka[j - 1];
            kr[j] = kr[j - 1];
            j--;
          }
          ks[j] = sk;
          ka[j] = AX.a;
          kr[j] = AX.r;
        }
        const o = ((iz * NY + iy) * NX + ix) * TOP;
        for (let j = 0; j < TOP; j++) {
          d[o + j] = ka[j];
          r[o + j] = kr[j];
        }
      }
  FIELD = { d, r };
  return FIELD;
}

/* bone colouring, matching the raymarched specimens: ivory mottled toward umber, with faint lacunae */
function hash3(x: number, y: number, z: number) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x: number, y: number, z: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const f = (t: number) => t * t * (3 - 2 * t);
  const u = f(x - xi);
  const v = f(y - yi);
  const w = f(z - zi);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
const fbm = (x: number, y: number, z: number) => 0.55 * vnoise(x, y, z) + 0.3 * vnoise(2.03 * x, 2.03 * y, 2.03 * z) + 0.15 * vnoise(4.1 * x, 4.1 * y, 4.1 * z);
/** Distance to the nearest jittered cell point (Worley), for lacuna pits. */
function worley(x: number, y: number, z: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  let md = 9;
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx + hash3(xi + dx, yi + dy, zi + dz);
        const cy = yi + dy + hash3(xi + dx + 17.3, yi + dy, zi + dz) * 0.5;
        const cz = zi + dz + hash3(xi + dx, yi + dy + 41.7, zi + dz);
        md = Math.min(md, (cx - x) ** 2 + (cy - y) ** 2 + (cz - z) ** 2);
      }
  return Math.sqrt(md);
}
const IVORY = new THREE.Color().setRGB(0.91, 0.875, 0.8, THREE.SRGBColorSpace);
const UMBER = new THREE.Color().setRGB(0.7, 0.64, 0.54, THREE.SRGBColorSpace);

/** Bone mesh at scale s, in world units. */
function boneGeometry(s: number) {
  const { d, r } = field();
  const N = NX * NY * NZ;
  const F = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const o = i * TOP;
    let v = d[o] - s * r[o];
    for (let j = 1; j < TOP; j++) v = smin(v, d[o + j] - s * r[o + j]);
    F[i] = -v; // surface nets meshes F > 0
  }
  const m = surfaceNets(F, [NX, NY, NZ], -1);
  const pos = m.positions;
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] = X0 + pos[i] * H;
    pos[i + 1] = Y0 + pos[i + 1] * H;
    pos[i + 2] = Z0 + pos[i + 2] * H;
  }
  // ambient occlusion from the field itself: how much bone lies just outside each vertex along its normal
  const Fat = (x: number, y: number, z: number) => {
    const gx = Math.min(NX - 1.001, Math.max(0, (x - X0) / H));
    const gy = Math.min(NY - 1.001, Math.max(0, (y - Y0) / H));
    const gz = Math.min(NZ - 1.001, Math.max(0, (z - Z0) / H));
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const z0 = Math.floor(gz);
    const tx = gx - x0;
    const ty = gy - y0;
    const tz = gz - z0;
    const at = (a: number, b: number, c: number) => F[((z0 + c) * NY + y0 + b) * NX + x0 + a];
    const c00 = at(0, 0, 0) * (1 - tx) + at(1, 0, 0) * tx;
    const c10 = at(0, 1, 0) * (1 - tx) + at(1, 1, 0) * tx;
    const c01 = at(0, 0, 1) * (1 - tx) + at(1, 0, 1) * tx;
    const c11 = at(0, 1, 1) * (1 - tx) + at(1, 1, 1) * tx;
    return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
  };
  const nrm = m.normals;
  const col = new Float32Array(pos.length);
  const c = new THREE.Color();
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i] * 5;
    const y = pos[i + 1] * 5;
    const z = pos[i + 2] * 5;
    c.copy(UMBER).lerp(IVORY, 0.3 + 0.6 * fbm(x, y, z));
    const pit = worley(x * 6, y * 8, z * 6);
    c.multiplyScalar(0.62 + 0.38 * Math.min(1, Math.max(0, (pit - 0.07) / 0.08)));
    let occ = 0;
    for (let k = 1; k <= 5; k++) {
      const d = k * 0.035;
      if (Fat(pos[i] + nrm[i] * d, pos[i + 1] + nrm[i + 1] * d, pos[i + 2] + nrm[i + 2] * d) > 0) occ += 1 / k;
    }
    c.multiplyScalar(0.78 * (1 - 0.62 * (occ / 2.28)));
    col[i] = c.r;
    col[i + 1] = c.g;
    col[i + 2] = c.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  return g;
}

/* ---------------------------- annotations --------------------------- */

function screenSphere(c: THREE.Vector3, r: number, cam: THREE.Camera, w: number, h: number) {
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
  const a = c.clone().project(cam);
  const b = c.clone().addScaledVector(right, r).project(cam);
  const x = ((a.x + 1) / 2) * w;
  const y = ((1 - a.y) / 2) * h;
  return { x, y, r: Math.hypot(((b.x + 1) / 2) * w - x, ((1 - b.y) / 2) * h - y) };
}

function arrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, s: number) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - s * Math.cos(a - 0.45), y1 - s * Math.sin(a - 0.45));
  ctx.lineTo(x1 - s * Math.cos(a + 0.45), y1 - s * Math.sin(a + 0.45));
  ctx.closePath();
  ctx.fill();
}

/** Two arrows at opposite ends of a diameter (screen direction d) and a bold label past the +d arrow. */
function diameterMark(ctx: CanvasRenderingContext2D, s: { x: number; y: number; r: number }, d: [number, number], label: string, w: number) {
  const L = w * 0.07;
  ctx.strokeStyle = "#1c1917";
  ctx.fillStyle = "#1c1917";
  ctx.lineWidth = Math.max(1.2, w / 300);
  for (const k of [1, -1]) {
    const ex = s.x + k * d[0] * (s.r + w * 0.004);
    const ey = s.y + k * d[1] * (s.r + w * 0.004);
    arrow(ctx, ex + k * d[0] * L, ey + k * d[1] * L, ex, ey, w * 0.016);
  }
  ctx.font = `bold ${Math.round(w * 0.07)}px Arial, sans-serif`;
  ctx.textAlign = d[0] < 0 ? "right" : "left";
  ctx.textBaseline = d[1] < 0 ? "bottom" : "top";
  ctx.lineWidth = w * 0.012;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  const lx = s.x + d[0] * (s.r + L * 1.15);
  const ly = s.y + d[1] * (s.r + L * 1.15);
  ctx.strokeText(label, lx, ly);
  ctx.fillText(label, lx, ly);
}

/* ------------------------------- base ------------------------------- */

const BONE = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, envMapIntensity: 0.1 });
// spheres are drawn over the bone, as in the reference figure (Tb.Th spheres sit inside the strut)
const BALL = new THREE.MeshPhysicalMaterial({
  color: 0xb3244f,
  metalness: 0.85,
  roughness: 0.26,
  clearcoat: 0.5,
  clearcoatRoughness: 0.15,
  envMapIntensity: 1.3,
  depthTest: false,
});
const BALL_GEO = new THREE.SphereGeometry(1, 48, 32);

abstract class Schematic implements Viewable {
  scene = new THREE.Scene();
  camera = makeCamera([0, 0, 1], 16, 7.1);
  onChange = () => {};
  protected group = new THREE.Group();
  protected marks: { c: THREE.Vector3; r: number }[] = [];
  constructor() {
    markStudio(this.scene);
    // lit like the raymarched specimens: strong key from upper left, hemisphere fill, little ambient
    // oblique key so each strut shades across its width, as on the raymarched specimens
    const key = new THREE.DirectionalLight(0xfffaf0, 2.6);
    key.position.set(-2.2, 1.6, 0.9);
    this.scene.add(key, new THREE.HemisphereLight(0xffffff, 0x2e2a24, 0.32), this.group);
  }
  tick() {
    return false;
  }
  update(s: number) {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      if (o instanceof THREE.Mesh && o.geometry !== BALL_GEO) o.geometry.dispose();
    }
    this.group.add(new THREE.Mesh(boneGeometry(s), BONE));
    this.marks = this.spheres(s);
    for (const m of this.marks) {
      const b = new THREE.Mesh(BALL_GEO, BALL);
      b.position.copy(m.c);
      b.scale.setScalar(Math.max(1e-4, m.r));
      b.renderOrder = 5;
      this.group.add(b);
    }
    this.onChange();
  }
  protected abstract spheres(s: number): { c: THREE.Vector3; r: number }[];
  abstract overlay(ctx: CanvasRenderingContext2D, cam: THREE.Camera, w: number, h: number): void;
}

/* ------------------------------- Tb.Th ------------------------------ */

/** Chain of maximal spheres along the arch: centre on the axis, radius = distance to the surface. */
export class ThicknessSchematic extends Schematic {
  protected spheres(s: number) {
    const curve = POLY[ARCH].curve;
    const L = curve.getLength();
    const out: { c: THREE.Vector3; r: number }[] = [];
    for (let t = 0.13; t < 0.8; ) {
      const c = curve.getPointAt(t);
      const r = -sdf(c.x, c.y, c.z, s);
      if (r <= 0.005) break;
      out.push({ c, r });
      t += (1.95 * r) / L; // neighbours just touching
    }
    return out;
  }
  overlay(ctx: CanvasRenderingContext2D, cam: THREE.Camera, w: number, h: number) {
    if (this.marks.length < 2) return;
    const first = screenSphere(this.marks[0].c, this.marks[0].r, cam, w, h);
    const last = screenSphere(this.marks[this.marks.length - 1].c, this.marks[this.marks.length - 1].r, cam, w, h);
    diameterMark(ctx, first, [-0.55, -0.83], "Tb.Th", w);
    diameterMark(ctx, last, [-0.96, -0.28], "Tb.Th", w);
  }
}

/* ------------------------------- Tb.Sp ------------------------------ */

/** One seed per pore; the centre climbs to the peak of the distance to bone. */
const SEEDS: [number, number][] = [
  [-0.38, 0.72],
  [0.3, 0.82],
  [0.05, -0.45],
  [0.98, 0.2],
  [0.98, -0.85],
  [-0.6, -0.62],
];

/** Extra spheres in the open centre under the arch: a big one, then a smaller one above it, each the largest that still fits. */
const FILL: [number, number][] = [
  [0.05, -0.08],
  [0.08, 0.24],
];

/** Largest sphere in each pore: hill-climb the distance to bone in the plane of the network. */
export class SeparationSchematic extends Schematic {
  private centres = SEEDS.map(([x, y]) => new THREE.Vector2(x, y));
  private fill = FILL.map(([x, y]) => new THREE.Vector2(x, y));
  protected spheres(s: number) {
    const out: { c: THREE.Vector3; r: number }[] = [];
    // clearance to bone, and (for the fill spheres) to spheres already placed
    const clear = (x: number, y: number, pack: boolean) => {
      let d = sdf(x, y, 0, s);
      if (pack) for (const o of out) d = Math.min(d, Math.hypot(o.c.x - x, o.c.y - y) - o.r);
      return d;
    };
    const climb = (c: THREE.Vector2, pack: boolean) => {
      let d = clear(c.x, c.y, pack);
      for (const step of [0.05, 0.02, 0.008, 0.003])
        for (let moved = true, it = 0; moved && it < 60; it++) {
          moved = false;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const x = c.x + dx * step;
            const y = c.y + dy * step;
            if (Math.abs(x) > 1.3 || Math.abs(y) > 1.3) continue;
            const nd = clear(x, y, pack);
            if (nd > d) {
              c.set(x, y);
              d = nd;
              moved = true;
            }
          }
        }
      return d;
    };
    for (const c of this.centres) {
      let d = sdf(c.x, c.y, 0, s);
      for (const step of [0.05, 0.02, 0.008, 0.003]) {
        for (let moved = true, it = 0; moved && it < 60; it++) {
          moved = false;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const x = c.x + dx * step;
            const y = c.y + dy * step;
            if (Math.abs(x) > 1.3 || Math.abs(y) > 1.3) continue;
            const nd = sdf(x, y, 0, s);
            if (nd > d) {
              c.set(x, y);
              d = nd;
              moved = true;
            }
          }
        }
      }
      if (d > 0.01 && out.every((o) => Math.hypot(o.c.x - c.x, o.c.y - c.y) > 0.05)) out.push({ c: new THREE.Vector3(c.x, c.y, 0), r: d });
    }
    for (const c of this.fill) {
      const d = climb(c, true);
      if (d > 0.02) out.push({ c: new THREE.Vector3(c.x, c.y, 0), r: d });
    }
    return out;
  }
  overlay(ctx: CanvasRenderingContext2D, cam: THREE.Camera, w: number, h: number) {
    // label the two smallest pores that sit fully inside the frame
    const vis = this.marks
      .map((m) => screenSphere(m.c, m.r, cam, w, h))
      .filter((s) => s.x - s.r > 0 && s.x + s.r < w && s.y - s.r > 0 && s.y + s.r < h)
      .sort((a, b) => a.r - b.r)
      .slice(0, 2);
    // each label points toward the side of the box with room; the second flips vertically if they would meet
    let prev: [number, number] | null = null;
    vis.forEach((s) => {
      let d: [number, number] = [s.x < w / 2 ? 0.94 : -0.94, s.y < h / 2 ? 0.34 : -0.34];
      if (prev && prev[0] === d[0] && prev[1] === d[1]) d = [d[0], -d[1]];
      prev = d;
      diameterMark(ctx, s, d, "Tb.Sp", w);
    });
  }
}

/** Build the shared field ahead of time (call from a scheduled task). */
export const prepareSchematics = () => void field();
