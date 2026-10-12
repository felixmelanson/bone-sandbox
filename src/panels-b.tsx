import { useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import {
  betaForBV,
  binarize,
  eigSym3,
  ellipsoidFactor,
  gradTensor,
  sortedCopy,
  tensorAt,
  type QField,
  type V3,
} from "./bone/engine";
import { tube, VolumeScene, type Uniforms, type Viewable } from "./bone/raymarch";
import type { Dims } from "./bone/volume";
import { markStudio, Viewer } from "./bone/views";
import { disposeScene } from "./bone/dispose";
import { boneAt, gstRose, mil, roseDA, svd, type Rose } from "./bone/fabric";
import { mulberry32 } from "./bone/volume";
import { MilPanel, Placeholder, SvdPanel, type FabricData } from "./milsvd";
import { getModel, useSpecField, useSpecimen } from "./specimen";
import { fmt, Panel, Readout, Readouts, schedule, Slider, useDebounced, useInView } from "./ui";

const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;
const wrapI = (v: number, n: number) => ((Math.round(v) % n) + n) % n;

/** Nearest voxel of the bone phase to (x,y,z) on a periodic grid. */
export function snapToBone(bone: Uint8Array, d: Dims, x: number, y: number, z: number, R = 3) {
  const [nx, ny, nz] = d;
  let best = -1;
  let bd = Infinity;
  let off: V3 = [0, 0, 0];
  for (let dz = -R; dz <= R; dz++)
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 >= bd) continue;
        const i = (wrapI(z + dz, nz) * ny + wrapI(y + dy, ny)) * nx + wrapI(x + dx, nx);
        if (bone[i]) {
          bd = r2;
          best = i;
          off = [dx, dy, dz];
        }
      }
  return best < 0 ? null : { i: best, off };
}

export function Mat3({ m, label }: { m: number[][]; label: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[13px] italic text-stone-600">{label} =</span>
      <div className="num relative grid grid-cols-3 gap-x-2.5 px-2 text-[11.5px] leading-[1.45] text-stone-800 before:absolute before:inset-y-0 before:left-0 before:w-1.5 before:border-y before:border-l before:border-stone-500 after:absolute after:inset-y-0 after:right-0 after:w-1.5 after:border-y after:border-r after:border-stone-500">
        {m.flat().map((v, i) => (
          <span key={i} className="text-right">
            {v >= 0 ? "\u2007" : ""}
            {v.toFixed(3)}
          </span>
        ))}
      </div>
    </div>
  );
}

export const tensorMat = (t: number[]) => [
  [t[0], t[3], t[4]],
  [t[3], t[1], t[5]],
  [t[4], t[5], t[2]],
];

/* ================================ DA ================================ */

/**
 * In-plane fabric ellipse on the specimen's front face: axes from the eigenvalues of the
 * x-y block of the gradient structure tensor (long axis along the struts, length ~ 1/sqrt(lambda)),
 * rotated with the loading direction, with the principal axis drawn through it.
 */
export function drawFabric(ctx: CanvasRenderingContext2D, cam: THREE.Camera, w: number, h: number, st: { G: number[]; psi: number; da: number } | null) {
  if (!st) return;
  const [xx, yy, , xy] = st.G;
  const tr = xx + yy;
  const det = xx * yy - xy * xy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const lmin = tr / 2 - disc;
  const lmax = tr / 2 + disc;
  // eigenvector of the smaller eigenvalue = trabecular direction (texture frame), then the loading rotation
  const ang = Math.atan2(lmin - xx, xy || 1e-9) + rad(st.psi);
  const px = (x: number, y: number) => {
    const v = new THREE.Vector3(x, y, 0.5).project(cam);
    return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h] as const;
  };
  const [cx, cy] = px(0, 0);
  // size everything from the projected front face, not the canvas
  const face = Math.hypot(px(0.5, 0)[0] - px(-0.5, 0)[0], px(0, 0.5)[1] - px(0, -0.5)[1]) / Math.SQRT2;
  w = face; // local scale for line widths and arrows below
  const R = face * 0.36;
  const rs = R * Math.sqrt(Math.max(0.05, lmin / lmax));
  const ux = Math.cos(ang);
  const uy = -Math.sin(ang); // screen y points down
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.atan2(uy, ux));
  ctx.fillStyle = "rgba(224,50,43,0.10)";
  ctx.strokeStyle = "#e0322b";
  ctx.lineWidth = Math.max(1.5, w / 240);
  ctx.beginPath();
  ctx.ellipse(0, 0, R, rs, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // principal axis with arrowheads, minor axis thin
  const L = face * 0.48;
  const a = face * 0.03;
  ctx.setLineDash([w * 0.02, w * 0.012]);
  ctx.beginPath();
  ctx.moveTo(-L, 0);
  ctx.lineTo(L, 0);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#e0322b";
  for (const sg of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(sg * L, 0);
    ctx.lineTo(sg * (L - a * 1.6), a * 0.7);
    ctx.lineTo(sg * (L - a * 1.6), -a * 0.7);
    ctx.fill();
  }
  ctx.lineWidth = Math.max(1, w / 400);
  ctx.beginPath();
  ctx.moveTo(0, -rs);
  ctx.lineTo(0, rs);
  ctx.stroke();
  ctx.restore();
  // the DA value is shown by the page, not drawn on the specimen
}

/* ---------------- DA: strut axes on frontal views, MIL and SVD ---------------- */

type FabSpec = { q: QField; d: Dims; beta: number; bone: Uint8Array; local: Float32Array[]; G: number[]; da: number };

const D64: Dims = [64, 64, 64];

/** Fabric of one specimen field at the given BV/TV: binary image, local and global structure tensor, DA. */
function fabSpec(q: QField, sorted: Float32Array, bv: number): FabSpec {
  const d = D64;
  const beta = betaForBV(sorted, bv);
  const bone = binarize(q, beta);
  const { G, local } = gradTensor(bone, d, 2.5);
  const e = eigSym3(G);
  return { q, d, beta, bone, local: local!, G, da: 1 - e.values[2] / e.values[0] };
}

/** Same camera direction and framing as the other specimen views. */
const DA_VIEW: V3 = [1.2, 0.95, 1.4];

const texRot = (psi: number) => {
  const c = Math.cos(rad(psi));
  const s = Math.sin(rad(psi));
  return new THREE.Matrix3().set(c, s, 0, -s, c, 0, 0, 0, 1);
};

/**
 * Strut axes near the front face: streamlines of the structure tensor's strut direction (the eigenvector of
 * its smallest eigenvalue), traced through bone from random seeds and fitted with a straight segment. The
 * longest well separated segments are kept. `M` maps world to texture coordinates, as in the shader.
 */
function strutLines(S: FabSpec, M: THREE.Matrix3, n = 8, view: V3 = DA_VIEW): [V3, V3][] {
  const { d, bone, local } = S;
  const Mt = M.clone().transpose();
  const t = new THREE.Vector3();
  const vox = (p: THREE.Vector3) => {
    t.copy(p).applyMatrix3(M);
    return (wrapI((t.z + 0.5) * d[2] - 0.5, d[2]) * d[1] + wrapI((t.y + 0.5) * d[1] - 0.5, d[1])) * d[0] + wrapI((t.x + 0.5) * d[0] - 0.5, d[0]);
  };
  const dirAt = (p: THREE.Vector3) => new THREE.Vector3(...eigSym3(tensorAt(local, vox(p))).vectors[2]).applyMatrix3(Mt).normalize();
  const inside = (p: THREE.Vector3) => Math.abs(p.x) < 0.47 && Math.abs(p.y) < 0.47 && Math.abs(p.z) < 0.49;
  const rnd = mulberry32(17);
  const U = new THREE.Vector3(...view).normalize();
  // screen axes for the overlap test: two directions perpendicular to the view
  const E1 = new THREE.Vector3(0, 1, 0).cross(U).normalize();
  const E2 = U.clone().cross(E1);
  const h = 0.012;
  const tracks: { pts: THREE.Vector3[]; len: number }[] = [];
  for (let s = 0; s < 400; s++) {
    // seeds in the shell of the cube facing the camera, so the traced struts are the visible ones
    const p0 = new THREE.Vector3(-0.44 + rnd() * 0.88, -0.44 + rnd() * 0.88, -0.44 + rnd() * 0.88);
    if (p0.dot(U) < 0.15 || !bone[vox(p0)]) continue;
    const half = (sign: number) => {
      const out: THREE.Vector3[] = [];
      const p = p0.clone();
      let prev = dirAt(p).multiplyScalar(sign);
      for (let i = 0; i < 70; i++) {
        const v = dirAt(p);
        if (v.dot(prev) < 0) v.negate();
        if (v.dot(prev) < 0.85) break; // the strut turns or ends
        p.addScaledVector(v, h);
        if (!inside(p) || !bone[vox(p)]) break;
        out.push(p.clone());
        prev = v;
      }
      return out;
    };
    const pts = [...half(-1).reverse(), p0, ...half(1)];
    const len = (pts.length - 1) * h;
    if (len > 0.12) tracks.push({ pts, len });
  }
  tracks.sort((a, b) => b.len - a.len);
  const lines: [V3, V3][] = [];
  for (const tr of tracks) {
    if (lines.length >= n) break;
    const c = tr.pts.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / tr.pts.length);
    const ax = tr.pts[tr.pts.length - 1].clone().sub(tr.pts[0]).normalize();
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of tr.pts) {
      const u = p.clone().sub(c).dot(ax);
      lo = Math.min(lo, u);
      hi = Math.max(hi, u);
    }
    const A = c.clone().addScaledVector(ax, lo);
    const B = c.clone().addScaledVector(ax, hi);
    // as seen from the front: keep only segments that stay clear of those already taken
    const pr = (v: THREE.Vector3 | V3) => {
      const w = Array.isArray(v) ? new THREE.Vector3(...v) : v;
      return [w.dot(E1), w.dot(E2)] as const;
    };
    const [a1, a2] = pr(A);
    const [b1, b2] = pr(B);
    if (lines.some(([P, Q]) => segDist2(a1, a2, b1, b2, ...pr(P), ...pr(Q)) < 0.075)) continue;
    lines.push([
      [A.x, A.y, A.z],
      [B.x, B.y, B.z],
    ]);
  }
  return lines;
}

/** Distance between two 2-D segments (0 if they cross). */
function segDist2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) {
  const ptSeg = (px: number, py: number, x0: number, y0: number, x1: number, y1: number) => {
    const vx = x1 - x0;
    const vy = y1 - y0;
    const t = Math.max(0, Math.min(1, ((px - x0) * vx + (py - y0) * vy) / (vx * vx + vy * vy || 1)));
    return Math.hypot(px - x0 - t * vx, py - y0 - t * vy);
  };
  const side = (x0: number, y0: number, x1: number, y1: number, px: number, py: number) => Math.sign((x1 - x0) * (py - y0) - (y1 - y0) * (px - x0));
  if (side(ax, ay, bx, by, cx, cy) * side(ax, ay, bx, by, dx, dy) < 0 && side(cx, cy, dx, dy, ax, ay) * side(cx, cy, dx, dy, bx, by) < 0) return 0;
  return Math.min(ptSeg(ax, ay, cx, cy, dx, dy), ptSeg(bx, by, cx, cy, dx, dy), ptSeg(cx, cy, ax, ay, bx, by), ptSeg(dx, dy, ax, ay, bx, by));
}

function drawStruts(ctx: CanvasRenderingContext2D, cam: THREE.Camera, w: number, h: number, lines: [V3, V3][]) {
  const px = (v: V3) => {
    const p = new THREE.Vector3(...v).project(cam);
    return [((p.x + 1) / 2) * w, ((1 - p.y) / 2) * h] as const;
  };
  const s = Math.min(w, h);
  ctx.save();
  ctx.strokeStyle = "#e0322b";
  ctx.lineWidth = Math.max(2, s * 0.016);
  ctx.setLineDash([s * 0.042, s * 0.028]);
  for (const [a, b] of lines) {
    const [x0, y0] = px(a);
    const [x1, y1] = px(b);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.restore();
}

/** Fixed frontal view of one specimen with its strut axes dashed on top. */
function FabricView({ spec, psi, vs, lines }: { spec: FabSpec | null; psi: number; vs: VolumeScene; lines: React.MutableRefObject<[V3, V3][]> }) {
  useEffect(() => {
    if (!spec) return;
    vs.setQ(spec.q);
    vs.set({ uBeta: spec.beta });
  }, [vs, spec]);
  useEffect(() => {
    if (!spec) return;
    const M = texRot(psi);
    vs.setTexRot(M);
    lines.current = strutLines(spec, M);
    vs.onChange();
  }, [vs, spec, psi]);
  return <Viewer view={spec ? vs : null} hint={false} alt="Specimen with dashed lines along the struts" />;
}

export function DAPanel(_: { num?: string; fig?: number }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const daLines = useRef<[V3, V3][]>([]);
  const [daVs] = useState(() => {
    const v = new VolumeScene([64, 64, 64], { view: DA_VIEW, dist: 4.0 });
    (v as Viewable).overlay = (ctx, cam, w, h) => drawStruts(ctx, cam, w, h, daLines.current);
    return v;
  });
  const S = useSpecimen();
  const [k, setK] = useState(1);
  const [psi, setPsi] = useState(0);
  const f = useSpecField(seen, D64, { k });
  const [spec, setSpec] = useState<FabSpec | null>(null);
  const [fabric, setFabric] = useState<FabricData | null>(null);
  const [milR, setMilR] = useState<Rose | null>(null);
  const [svdR, setSvdR] = useState<{ a: Rose; b: Rose } | null>(null);

  useEffect(() => {
    if (!f) return;
    schedule(() => {
      const sp = fabSpec(f.q, f.sorted, S.bv);
      setSpec(sp);
      const t0 = performance.now();
      const G = gradTensor(sp.bone, sp.d, 0).G;
      setFabric({ q: sp.q, d: sp.d, beta: sp.beta, inBone: boneAt(sp.q, sp.d, sp.beta), gst: gstRose(G, performance.now() - t0) });
    });
  }, [f, S.bv]);
  // MIL and SVD on the same specimen, one short task each
  useEffect(() => {
    if (!fabric) return;
    const inMarrow = (x: number, y: number, z: number) => !fabric.inBone(x, y, z);
    let a: Rose | null = null;
    schedule(() => setMilR(mil(fabric.inBone, fabric.d)));
    schedule(() => {
      a = svd(inMarrow, fabric.d, 11);
    });
    schedule(() => a && setSvdR({ a, b: svd(inMarrow, fabric.d, 97) }));
  }, [fabric]);

  return (
    <Panel
      id="da"
      cut={[daVs]}
      view={
        <div ref={ref} className="h-full w-full">
          <FabricView spec={spec} psi={psi} vs={daVs} lines={daLines} />
        </div>
      }
      side={
        <div className="ws-pair">
          <div>{fabric && milR ? <MilPanel compact f={fabric} rose={milR} /> : <Placeholder />}</div>
          <div>{fabric && svdR ? <SvdPanel compact f={fabric} a={svdR.a} b={svdR.b} /> : <Placeholder />}</div>
        </div>
      }
      readouts={
        <Readouts>
          <Readout label="DA" value={spec ? fmt(spec.da, 3) : "-"} accent />
          <Readout label="Tensor 1 − min/max" value={fabric ? roseDA(fabric.gst).toFixed(2) : "-"} />
          <Readout label="MIL 1 − min/max" value={milR ? roseDA(milR).toFixed(2) : "-"} />
          <Readout label="SVD 1 − min/max" value={svdR ? roseDA(svdR.a).toFixed(2) : "-"} />
        </Readouts>
      }
      controls={
        <>
          <Slider label="Fabric alignment" hint="stretch along the principal axis" value={k} min={1} max={4} step={0.1} onChange={setK} format={(v) => `${v.toFixed(1)} : 1`} />
          <Slider label="Alignment direction" value={psi} min={0} max={180} step={1} onChange={setPsi} format={(v) => `${v.toFixed(0)}°`} />
        </>
      }
    />
  );
}

/* ================================ EF ================================ */


/* Medal metals (linear base reflectance): bronze = misaligned, silver = intermediate, gold = aligned with N. */
const BRONZE = new THREE.Color(0.8, 0.46, 0.24);
const SILVER = new THREE.Color(0.95, 0.94, 0.92);
const GOLD = new THREE.Color(1.0, 0.71, 0.29);
export const METAL_CSS = "linear-gradient(to right, rgb(205,127,50), rgb(192,192,196), rgb(212,175,55))";

/** Nematic order P2 = (3cos²β − 1)/2 in [−0.5, 1] → bronze, silver, gold. */
export function medal(p2: number, out: THREE.Color) {
  const t = (p2 + 0.5) / 1.5;
  return t < 0.5 ? out.copy(BRONZE).lerp(SILVER, t * 2) : out.copy(SILVER).lerp(GOLD, (t - 0.5) * 2);
}

/** Nematic analysis of a real bone volume: local fabric ellipsoids + Q-tensor. */
export class FieldScene extends VolumeScene {
  glyphs: THREE.InstancedMesh;
  director = new THREE.Group();
  /** Solid twin of this volume, sharing the camera (left of the pair). */
  bone: VolumeScene | null = null;
  private ord: { N: THREE.Vector3; vecs: THREE.Vector3[]; L: number[]; S: number; beta: number } | null = null;
  constructor(dims: Dims = [48, 48, 48], twin = true) {
    super(dims, { view: [1.25, 0.9, 1.45], fov: 26, dist: 4.1 });
    this.glyphs = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 40, 28),
      new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.22, envMapIntensity: 1.15 }),
      216
    );
    markStudio(this.scene);
    this.glyphs.count = 0;
    this.glyphs.frustumCulled = false;
    this.scene.add(this.glyphs, this.director);
    this.set({ uAlpha: 0.12 });
    if (twin) {
      // solid twin of this volume sharing the camera (the side-by-side view)
      this.bone = new VolumeScene(dims);
      this.bone.camera = this.camera;
      this.peers = [this.bone];
      this.bone.peers = [this];
    }
  }

  /** The cut plane also clips the glyphs, so nothing floats above the cut volume. */
  private clip = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)];
  set(u: Uniforms) {
    super.set(u);
    if (u.uCutOn !== undefined && this.glyphs) {
      (this.glyphs.material as THREE.Material).clippingPlanes = u.uCutOn ? this.clip : [];
      this.onChange();
    }
  }

  /**
   * Order-tensor construction: director axis N, eigenframe of Q (axis length grows with
   * its eigenvalue), the cone of mean deviation beta = acos(sqrt((2S + 1) / 3)) about +/-N,
   * and the equator perpendicular to N.
   */
  setOrder(vals: number[], vecs: V3[], S: number) {
    const G = this.director;
    disposeScene(G);
    G.clear();
    const N = new THREE.Vector3(...vecs[0]).normalize();
    const top = (m: THREE.Object3D) => {
      m.renderOrder = 20;
      m.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
          (o.material as THREE.Material).depthTest = false;
          (o.material as THREE.Material).transparent = true;
        }
      });
      G.add(m);
    };
    const dark = new THREE.MeshBasicMaterial({ color: 0x1c1917 });
    // director axis, end to end through the specimen
    top(tube([-N.x * 0.8, -N.y * 0.8, -N.z * 0.8], [N.x * 0.8, N.y * 0.8, N.z * 0.8], 0.0045, dark));
    // eigenframe of Q
    const COLS = [0xb07a22, 0x5b5f66, 0xa9afb7];
    const L = vals.map((v) => 0.22 + 0.38 * ((v + 0.5) / 1.5));
    vecs.forEach((e, i) => {
      const u = new THREE.Vector3(...e).normalize().multiplyScalar(L[i]);
      const m = new THREE.MeshBasicMaterial({ color: COLS[i] });
      top(tube([-u.x, -u.y, -u.z], [u.x, u.y, u.z], i === 0 ? 0.009 : 0.006, m));
      for (const s of [1, -1]) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(i === 0 ? 0.022 : 0.016, 20, 14), m);
        dot.position.copy(u).multiplyScalar(s);
        top(dot);
      }
    });
    // order cones about +N and -N
    const beta = Math.acos(Math.min(1, Math.sqrt((2 * S + 1) / 3)));
    const h = 0.34;
    const rim = h * Math.tan(beta);
    const up = new THREE.Vector3(0, 1, 0);
    for (const s of [1, -1]) {
      const g = new THREE.ConeGeometry(rim, h, 72, 1, true);
      g.rotateX(Math.PI);
      g.translate(0, h / 2, 0);
      const cone = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xd4a017, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false }));
      cone.quaternion.setFromUnitVectors(up, N.clone().multiplyScalar(s));
      top(cone);
      const ring: THREE.Vector3[] = [];
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        ring.push(new THREE.Vector3(Math.cos(a) * rim, h, Math.sin(a) * rim));
      }
      const loop = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), new THREE.LineBasicMaterial({ color: 0xb07a22 }));
      loop.quaternion.copy(cone.quaternion);
      top(loop);
    }
    // equator perpendicular to N
    const eq: THREE.Vector3[] = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      eq.push(new THREE.Vector3(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5));
    }
    const eqL = new THREE.Line(new THREE.BufferGeometry().setFromPoints(eq), new THREE.LineDashedMaterial({ color: 0x76797e, dashSize: 0.03, gapSize: 0.022 }));
    eqL.computeLineDistances();
    eqL.quaternion.setFromUnitVectors(up, N);
    top(eqL);
    // arc marking the cone half-angle
    const side = new THREE.Vector3().crossVectors(N, Math.abs(N.y) < 0.9 ? up : new THREE.Vector3(1, 0, 0)).normalize();
    const arc: THREE.Vector3[] = [];
    for (let i = 0; i <= 32; i++) {
      const a = (beta * i) / 32;
      arc.push(N.clone().multiplyScalar(Math.cos(a) * 0.36).addScaledVector(side, Math.sin(a) * 0.36));
    }
    top(new THREE.Line(new THREE.BufferGeometry().setFromPoints(arc), new THREE.LineBasicMaterial({ color: 0x1c1917 })));
    this.ord = { N, vecs: vecs.map((v) => new THREE.Vector3(...v).normalize()), L, S, beta };
    this.onChange();
  }

  overlay(ctx: CanvasRenderingContext2D, cam: THREE.Camera, w: number, h: number) {
    const o = this.ord;
    if (!o) return;
    const at = (p: THREE.Vector3) => {
      const v = p.clone().project(cam);
      return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h] as const;
    };
    const m = Math.min(w, h);
    const fs = Math.round(m * 0.045);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const put = (t: string, p: THREE.Vector3, color = "#1c1917", italic = true) => {
      const [x, y] = at(p);
      ctx.font = `${italic ? "italic " : ""}${fs}px Arial, sans-serif`;
      ctx.lineWidth = fs * 0.28;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.strokeText(t, x, y);
      ctx.fillStyle = color;
      ctx.fillText(t, x, y);
    };
    put("N̂", o.N.clone().multiplyScalar(0.9));
    ["λ₁", "λ₂", "λ₃"].forEach((t, i) => i > 0 && put(t, o.vecs[i].clone().multiplyScalar(o.L[i] + 0.07), "#5b5f66"));
    const side = new THREE.Vector3().crossVectors(o.N, Math.abs(o.N.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
    put("β̄", o.N.clone().multiplyScalar(Math.cos(o.beta / 2) * 0.46).addScaledVector(side, Math.sin(o.beta / 2) * 0.46));
    // S and the cone angle are shown by the page readouts
  }
}

const U0 = new THREE.Vector3(Math.sin(rad(55)) * Math.cos(rad(30)), Math.cos(rad(55)), Math.sin(rad(55)) * Math.sin(rad(30))).normalize();
const QROT = new THREE.Quaternion().setFromUnitVectors(U0, new THREE.Vector3(1, 0, 0));
export const M_TEX_OBLIQUE = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(QROT));
export const M_WORLD_OBLIQUE = M_TEX_OBLIQUE.clone().transpose();
const IDENT = new THREE.Matrix3();

export type FieldStats = { S: number; N: V3; Q: number[]; ef: number; plates: number; rods: number; n: number };

/**
 * Local fabric glyphs (structure-tensor ellipsoids on a 6x6x6 grid, snapped to bone) and the
 * nematic order tensor of their long axes, written into a FieldScene. Returns the summary stats.
 */
export function buildNematic(F: FieldScene, q: Float32Array, bone: Uint8Array, d: Dims, beta: number, oblique = true): FieldStats {
  // `oblique` samples the field through a fixed rotation so the director is off-axis; off, the specimen
  // is shown exactly as in the other metrics
  const M_TEX = oblique ? M_TEX_OBLIQUE : IDENT;
  const M_WORLD = oblique ? M_WORLD_OBLIQUE : IDENT;
  const { local } = gradTensor(bone, d, 2.5);
  F.setQ(q);
  F.setTexRot(M_TEX);
  F.set({ uBeta: beta });
  F.bone?.setQ(q);
  F.bone?.setTexRot(M_TEX);
  F.bone?.set({ uBeta: beta });

  const n = 6;
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  const Q = [0, 0, 0, 0, 0, 0];
  const dirs: THREE.Vector3[] = [];
  let cnt = 0;
  let efSum = 0;
  let plates = 0;
  let rods = 0;
  for (let iz = 0; iz < n; iz++)
    for (let iy = 0; iy < n; iy++)
      for (let ix = 0; ix < n; ix++) {
        const p = new THREE.Vector3(-0.4 + (0.8 * ix) / (n - 1), -0.4 + (0.8 * iy) / (n - 1), -0.4 + (0.8 * iz) / (n - 1));
        const t = p.clone().applyMatrix3(M_TEX);
        const hit = snapToBone(bone, d, (t.x + 0.5) * d[0] - 0.5, (t.y + 0.5) * d[1] - 0.5, (t.z + 0.5) * d[2] - 0.5, 3);
        if (!hit) continue;
        const T = tensorAt(local!, hit.i);
        const e = eigSym3(T);
        const tr = e.values[0] + e.values[1] + e.values[2] || 1;
        const r = e.values.map((v) => 1 / Math.sqrt(v + 0.03 * tr));
        const sc = 0.062 / r[2];
        const [ra, rb, rc] = [r[0] * sc, r[1] * sc, r[2] * sc];
        const ef = ellipsoidFactor([ra, rb, rc]);
        const long = new THREE.Vector3(...e.vectors[2]).applyMatrix3(M_WORLD).normalize();
        const mid = new THREE.Vector3(...e.vectors[1]).applyMatrix3(M_WORLD).normalize();
        const short = new THREE.Vector3().crossVectors(long, mid).normalize();
        const pos = p.clone().add(new THREE.Vector3(...hit.off).multiplyScalar(1 / d[0]).applyMatrix3(M_WORLD));
        m4.makeBasis(long.multiplyScalar(rc), mid.multiplyScalar(rb), short.multiplyScalar(ra)).setPosition(pos);
        F.glyphs.setMatrixAt(cnt, m4);
        const L = long.normalize();
        dirs.push(L.clone());
        const v = [L.x, L.y, L.z];
        Q[0] += 1.5 * v[0] * v[0] - 0.5;
        Q[1] += 1.5 * v[1] * v[1] - 0.5;
        Q[2] += 1.5 * v[2] * v[2] - 0.5;
        Q[3] += 1.5 * v[0] * v[1];
        Q[4] += 1.5 * v[0] * v[2];
        Q[5] += 1.5 * v[1] * v[2];
        efSum += ef;
        if (ef < -0.25) plates++;
        if (ef > 0.25) rods++;
        cnt++;
      }
  F.glyphs.count = cnt;
  F.glyphs.instanceMatrix.needsUpdate = true;
  for (let i = 0; i < 6; i++) Q[i] /= cnt || 1;
  const eq = eigSym3(Q);
  const N = eq.vectors[0];
  const Nv = new THREE.Vector3(...N);
  dirs.forEach((v, i) => {
    const cb = v.dot(Nv);
    F.glyphs.setColorAt(i, medal(1.5 * cb * cb - 0.5, col));
  });
  if (F.glyphs.instanceColor) F.glyphs.instanceColor.needsUpdate = true;
  F.setOrder(eq.values, eq.vectors, eq.values[0]);
  F.onChange();
  return { S: eq.values[0], N, Q, ef: efSum / (cnt || 1), plates: plates / (cnt || 1), rods: rods / (cnt || 1), n: cnt };
}

export function EFPanel(_: { num?: string; fig?: number }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const S = useSpecimen();
  const [field, setField] = useState<FieldScene | null>(null);
  const [k, setK] = useState(1);
  const [fs, setFs] = useState<FieldStats | null>(null);

  useEffect(() => {
    if (seen && !field) schedule(() => setField(new FieldScene(D64)));
  }, [seen, field]);

  useDebounced(
    () => {
      const F = field;
      if (!F) return;
      schedule(() => {
        const q = getModel(S.model, D64, k, S.rung).combine(S.a);
        const beta = betaForBV(sortedCopy(q), S.bv);
        const bone = binarize(q, beta);
        setFs(buildNematic(F, q, bone, D64, beta, false));
      });
    },
    [field, k, S.model, S.rung, S.a, S.bv],
    120
  );

  const sph = (v: V3) => {
    const s = v[1] < 0 ? -1 : 1;
    const w = v.map((x) => x * s);
    return { t: deg(Math.acos(Math.min(1, w[1]))), p: ((deg(Math.atan2(w[2], w[0])) % 360) + 360) % 360 };
  };
  const Nd = fs ? sph(fs.N) : null;

  return (
    <Panel
      id="ef"
      cut={[field, field?.bone]}
      view={
        <div ref={ref} className="h-full w-full">
          <Viewer view={field} hint={false} alt="Transparent specimen with fabric ellipsoids, director axis, Q eigenframe and order cone" />
        </div>
      }
      overlay={
        <div className="ws-bar ef-bar" aria-label="Glyph colour: alignment with the director N̂">
          <span>along N̂</span>
          <i style={{ background: METAL_CSS.replace("to right", "to top") }} />
          <span>across N̂</span>
        </div>
      }
      side={
        <div className="ws-pair">
          <div>
            <div className="fig frame2d aspect-square ws-solid">
              <Viewer view={field?.bone ?? null} hint={false} alt="Solid trabecular bone specimen, same camera" />
            </div>
            <p className="fig-l">Solid specimen</p>
          </div>
        </div>
      }
      readouts={
        <Readouts>
          <Readout label="Order S" value={fs ? fs.S.toFixed(3) : "-"} accent />
          <Readout label="Director θ, φ" value={Nd ? `${Nd.t.toFixed(0)}°, ${Nd.p.toFixed(0)}°` : "-"} />
          <Readout label="⟨EF⟩" value={fs ? fs.ef.toFixed(3) : "-"} />
          <Readout label="Plates / rods" value={fs ? `${(fs.plates * 100).toFixed(0)} / ${(fs.rods * 100).toFixed(0)}` : "-"} unit="%" />
        </Readouts>
      }
      controls={<Slider label="Trabecular alignment" hint="isotropic → nematic" value={k} min={1} max={4} step={0.1} onChange={setK} format={(v) => `${v.toFixed(1)} : 1`} />}
    />
  );
}
