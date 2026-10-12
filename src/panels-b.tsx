import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { cssRamp, EF_RAMP } from "./bone/colormap";
import {
  betaForBV,
  binarize,
  eigSym3,
  ellipsoidFactor,
  gradTensor,
  makeField,
  qField,
  sortedCopy,
  tensorAt,
  type V3,
} from "./bone/engine";
import { addLights, makeCamera, tube, VolumeScene, type Viewable } from "./bone/raymarch";
import type { Dims } from "./bone/volume";
import { markStudio, Viewer } from "./bone/views";
import { disposeScene } from "./bone/dispose";
import { boneAt, gstRose, mil, svd } from "./bone/fabric";
import { MilSvdPanel, type FabricData } from "./milsvd";
import { Controls, fmt, Panel, Readout, Readouts, schedule, Seg, Slider, useDebounced, useInView } from "./ui";

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

export function DAPanel({ className }: { className?: string }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const [vs, setVs] = useState<VolumeScene | null>(null);
  const [k, setK] = useState(1);
  const [psi, setPsi] = useState(32);
  const lab = useRef<{ local: Float32Array[]; bone: Uint8Array; d: Dims } | null>(null);
  // fabric ellipse overlay state, read by the view's 2-D overlay
  const ovState = useRef<{ G: number[]; psi: number; da: number } | null>(null);
  const [fab, setFab] = useState<{ vals: V3; vec: V3; G: number[]; da: number } | null>(null);
  const [fabric, setFabric] = useState<FabricData | null>(null);

  useEffect(() => {
    if (!seen || vs) return;
    schedule(() => {
      const v = new VolumeScene([64, 64, 64], { view: [0.16, 0.3, 1], fov: 24, dist: 3.9 });
      (v as Viewable).overlay = (ctx, cam, w, h) => drawFabric(ctx, cam, w, h, ovState.current);
      setVs(v);
    });
  }, [seen, vs]);

  useDebounced(
    () => {
      if (!vs) return;
      schedule(() => {
        const d: Dims = [64, 64, 64];
        const q = qField(makeField(7331, d, [3.8 * k, 3.8, 3.8]), 0.6);
        const beta = betaForBV(sortedCopy(q), 0.28);
        const bone = binarize(q, beta);
        const { G, local } = gradTensor(bone, d, 3.5);
        const e = eigSym3(G);
        lab.current = { local: local!, bone, d };
        vs.setQ(q);
        vs.set({ uBeta: beta });
        setFab({ vals: e.values, vec: e.vectors[2], G, da: 1 - e.values[2] / e.values[0] });
        // MIL / SVD / GST on the same volume, timed, sampled on the continuous field
        schedule(() => {
          const t0 = performance.now();
          const g0 = gradTensor(bone, d, 0).G;
          const gst = gstRose(g0, performance.now() - t0);
          const inBone = boneAt(q, d, beta);
          const inMarrow = (x: number, y: number, z: number) => !inBone(x, y, z);
          setFabric({ q, d, beta, inBone, gst, mil: mil(inBone, d), svdA: svd(inMarrow, d, 11), svdB: svd(inMarrow, d, 97) });
        });
      });
    },
    [vs, k],
    120
  );

  // rotate the fabric with the loading direction and redraw the fabric ellipse
  useEffect(() => {
    if (!vs || !fab) return;
    const c = Math.cos(rad(psi));
    const s = Math.sin(rad(psi));
    vs.setTexRot(new THREE.Matrix3().set(c, s, 0, -s, c, 0, 0, 0, 1));
    ovState.current = { G: fab.G, psi, da: fab.da };
    vs.onChange();
  }, [vs, fab, psi]);

  const iso = fab ? fab.da < 0.3 : true;
  const pv = fab?.vec;
  const pw = pv ? [Math.cos(rad(psi)) * pv[0] - Math.sin(rad(psi)) * pv[1], Math.sin(rad(psi)) * pv[0] + Math.cos(rad(psi)) * pv[1], pv[2]] : null;
  const inPlane = pw ? ((deg(Math.atan2(pw[1], pw[0])) % 180) + 180) % 180 : 0;

  return (
    <Panel wide id="da" num="3.5" fig={5} className={className}>
      <div ref={ref} className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div>
          <p className="mb-2 text-[13px] font-bold text-stone-900">Structure tensor fabric (used here)</p>
          <div className="fig aspect-square">
            <Viewer view={vs} interactive={false} alt="Frontal view of the specimen with the in-plane fabric ellipse and its principal axis" />
          </div>
          <p className="mt-2 text-center text-[14px] leading-snug text-stone-800">
            {iso ? "Isotropic" : "Anisotropic"} trabeculae, DA → {iso ? "0" : "1"}
          </p>
        </div>
        <div>
          <p className="mb-2 text-[13px] font-bold text-stone-900">Why not MIL or SVD</p>
          <MilSvdPanel f={fabric} />
        </div>
      </div>
      <Controls>
        <Seg
          label="Preset"
          value={k === 1 ? "iso" : k === 3.2 ? "aniso" : "custom"}
          onChange={(v) => v !== "custom" && setK(v === "iso" ? 1 : 3.2)}
          options={[
            { v: "iso", t: "Isotropic" },
            { v: "aniso", t: "Anisotropic" },
            { v: "custom", t: "Custom" },
          ]}
        />
        <Slider label="Fabric alignment" hint="correlation length ratio" value={k} min={1} max={4} step={0.1} onChange={setK} format={(v) => `${v.toFixed(1)} : 1`} />
        <Slider label="Loading direction" hint="principal axis" value={psi} min={0} max={180} step={1} onChange={setPsi} format={(v) => `${v.toFixed(0)}°`} />
        <Readouts>
          <Readout label="DA" value={fab ? fmt(fab.da, 3) : "-"} accent />
          <Readout label="λ₁ / λ₂ / λ₃" value={fab ? fab.vals.map((v) => v.toFixed(2)).join(" / ") : "-"} />
          <Readout label="Principal axis" value={fab ? inPlane.toFixed(0) : "-"} unit="° in plane" />
          <Readout label="Out of plane" value={pw ? deg(Math.asin(Math.min(1, Math.abs(pw[2])))).toFixed(0) : "-"} unit="°" />
        </Readouts>
        {fab && <Mat3 m={tensorMat(fab.G)} label="M (fabric)" />}
      </Controls>
    </Panel>
  );
}

/* ================================ EF ================================ */

function label(text: string, color = "#222") {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.font = "italic 84px Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = color;
  g.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(0.2, 0.2, 1);
  s.renderOrder = 30;
  return s;
}

function doubleArrow(len: number, color: THREE.ColorRepresentation, r = 0.014) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4 });
  const head = 0.1;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 2 * (len - head), 12), mat);
  g.add(shaft);
  for (const s of [1, -1]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r * 3, head, 18), mat);
    cone.position.y = s * (len - head / 2);
    if (s < 0) cone.rotation.x = Math.PI;
    g.add(cone);
  }
  return g;
}

function latLong() {
  const p: number[] = [];
  const seg = 72;
  for (let m = 0; m < 8; m++) {
    const ph = (m / 8) * Math.PI;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * 2 * Math.PI;
      const b = ((i + 1) / seg) * 2 * Math.PI;
      p.push(Math.cos(a), Math.sin(a) * Math.cos(ph), Math.sin(a) * Math.sin(ph));
      p.push(Math.cos(b), Math.sin(b) * Math.cos(ph), Math.sin(b) * Math.sin(ph));
    }
  }
  for (let l = 1; l < 8; l++) {
    const x = -1 + (2 * l) / 8;
    const rr = Math.sqrt(1 - x * x);
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * 2 * Math.PI;
      const b = ((i + 1) / seg) * 2 * Math.PI;
      p.push(x, rr * Math.cos(a), rr * Math.sin(a), x, rr * Math.cos(b), rr * Math.sin(b));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  return g;
}

const AX = { c: 0xc8324f, b: 0x2a9d8f, a: 0x3b6fb6 };

/** One ellipsoid: semi-axes a <= b <= c, major axis at polar theta / azimuth phi. */
class EllipsoidScene implements Viewable {
  scene = new THREE.Scene();
  camera = makeCamera([1.55, 1.05, 1.9], 30, 5.7);
  onChange = () => {};
  private frame = new THREE.Group();
  private shape = new THREE.Group();
  private arrows = new THREE.Group();
  private section: THREE.LineLoop;
  private disc: THREE.Mesh;
  private arcs = new THREE.Group();
  private lt = label("θ");
  private lp = label("φ");

  constructor() {
    addLights(this.scene);
    const grey = new THREE.MeshBasicMaterial({ color: 0x9a948a });
    const ends: [V3, string][] = [
      [[1.35, 0, 0], "x"],
      [[0, 1.35, 0], "y"],
      [[0, 0, 1.35], "z"],
    ];
    for (const [e, n] of ends) {
      this.scene.add(tube([-e[0], -e[1], -e[2]], e, 0.004, grey));
      const s = label(n, "#8a847a");
      s.position.set(e[0] * 1.08, e[1] * 1.08, e[2] * 1.08);
      s.scale.set(0.14, 0.14, 1);
      this.scene.add(s);
    }
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 64),
      new THREE.MeshPhysicalMaterial({ color: 0xe9e1cf, roughness: 0.36, clearcoat: 0.6, clearcoatRoughness: 0.25, transparent: true, opacity: 0.8, depthWrite: false })
    );
    const wire = new THREE.LineSegments(latLong(), new THREE.LineBasicMaterial({ color: 0x6f6658, transparent: true, opacity: 0.35 }));
    this.shape.add(body, wire);
    this.section = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x4a7bd0 }));
    this.disc = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x4a7bd0, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false })
    );
    this.disc.rotation.y = Math.PI / 2;
    this.frame.add(this.shape, this.arrows, this.section, this.disc);
    this.scene.add(this.frame, this.arcs, this.lt, this.lp);
  }

  update(c: number, b: number, a: number, theta: number, phi: number) {
    const u = new THREE.Vector3(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
    this.frame.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), u);
    this.shape.scale.set(c, b, a);

    this.arrows.clear();
    const ac = doubleArrow(c + 0.24, AX.c);
    ac.rotation.z = -Math.PI / 2;
    const ab = doubleArrow(b + 0.24, AX.b);
    const aa = doubleArrow(a + 0.24, AX.a);
    aa.rotation.x = Math.PI / 2;
    this.arrows.add(ac, ab, aa);

    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 96; i++) {
      const t = (i / 96) * Math.PI * 2;
      pts.push(new THREE.Vector3(0, b * Math.cos(t), a * Math.sin(t)));
    }
    this.section.geometry.dispose();
    this.section.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    const m = 2.5 * Math.max(a, b);
    this.disc.scale.set(m, m, 1);

    // angle arcs: theta from +y to the major axis, phi in the xz plane from +x
    this.arcs.clear();
    const lineMat = new THREE.LineBasicMaterial({ color: 0x222222 });
    const dashMat = new THREE.LineDashedMaterial({ color: 0x555555, dashSize: 0.04, gapSize: 0.03 });
    const y = new THREE.Vector3(0, 1, 0);
    const arcT: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) arcT.push(y.clone().lerp(u, i / 40).normalize().multiplyScalar(0.62));
    this.arcs.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(arcT), lineMat));
    this.lt.position.copy(y.clone().lerp(u, 0.5).normalize().multiplyScalar(0.8));
    const proj = new THREE.Vector3(u.x, 0, u.z);
    const pl = proj.length();
    if (pl > 1e-3) {
      proj.normalize();
      const arcP: THREE.Vector3[] = [];
      for (let i = 0; i <= 40; i++) {
        const f = (phi * i) / 40;
        arcP.push(new THREE.Vector3(Math.cos(f), 0, Math.sin(f)).multiplyScalar(0.5));
      }
      this.arcs.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(arcP), lineMat));
      const tip = u.clone().multiplyScalar(c);
      const drop = new THREE.Line(new THREE.BufferGeometry().setFromPoints([tip, new THREE.Vector3(tip.x, 0, tip.z), new THREE.Vector3(0, 0, 0)]), dashMat);
      drop.computeLineDistances();
      this.arcs.add(drop);
      this.lp.position.set(Math.cos(phi / 2) * 0.66, 0, Math.sin(phi / 2) * 0.66);
      this.lp.visible = true;
    } else this.lp.visible = false;
    this.onChange();
  }
  tick() {
    return false;
  }
}

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
export const M_TEX = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(QROT));
export const M_WORLD = M_TEX.clone().transpose();

export type FieldStats = { S: number; N: V3; Q: number[]; ef: number; plates: number; rods: number; n: number };

/**
 * Local fabric glyphs (structure-tensor ellipsoids on a 6x6x6 grid, snapped to bone) and the
 * nematic order tensor of their long axes, written into a FieldScene. Returns the summary stats.
 */
export function buildNematic(F: FieldScene, q: Float32Array, bone: Uint8Array, d: Dims, beta: number): FieldStats {
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

export function EFPanel({ className }: { className?: string }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  // the ellipsoid eigen-frame view is switched off for now; flip to "single" to bring it back
  const [mode] = useState<"single" | "field">("field");
  const [single, setSingle] = useState<EllipsoidScene | null>(null);
  const [field, setField] = useState<FieldScene | null>(null);
  const [ax, setAx] = useState({ c: 1, b: 0.24, a: 0.22 });
  const [th, setTh] = useState(60);
  const [ph, setPh] = useState(35);
  const [k, setK] = useState(2.2);
  const [fs, setFs] = useState<FieldStats | null>(null);

  useEffect(() => {
    if (seen && mode === "single" && !single) schedule(() => setSingle(new EllipsoidScene()));
  }, [seen, mode, single]);
  useEffect(() => {
    if (seen && mode === "field" && !field) schedule(() => setField(new FieldScene()));
  }, [seen, mode, field]);

  useEffect(() => {
    single?.update(ax.c, ax.b, ax.a, rad(th), rad(ph));
  }, [single, ax, th, ph]);

  useDebounced(
    () => {
      const F = field;
      if (!F) return;
      schedule(() => {
        const d: Dims = [48, 48, 48];
        const q = qField(makeField(9101, d, [3.3 * k, 3.3, 3.3]), 0.9);
        const beta = betaForBV(sortedCopy(q), 0.26);
        const bone = binarize(q, beta);
        setFs(buildNematic(F, q, bone, d, beta));
      });
    },
    [field, k],
    120
  );

  const sorted = [ax.a, ax.b, ax.c].sort((p, q) => p - q);
  const EF = sorted[0] / sorted[1] - sorted[1] / sorted[2];
  const shapeName = EF > 0.3 ? "Prolate · rod-like" : EF < -0.3 ? "Oblate · plate-like" : "Intermediate";

  // shape tensor of the ellipsoid  x^T A x = 1,  A = R diag(1/c^2, 1/b^2, 1/a^2) R^T
  const A = useMemo(() => {
    const u = new THREE.Vector3(Math.sin(rad(th)) * Math.cos(rad(ph)), Math.cos(rad(th)), Math.sin(rad(th)) * Math.sin(rad(ph)));
    const qq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), u);
    const R = new THREE.Matrix4().makeRotationFromQuaternion(qq);
    const e = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((v) => v.applyMatrix4(R));
    const l = [1 / ax.c ** 2, 1 / ax.b ** 2, 1 / ax.a ** 2];
    const M = [0, 0, 0, 0, 0, 0];
    e.forEach((v, i) => {
      M[0] += l[i] * v.x * v.x;
      M[1] += l[i] * v.y * v.y;
      M[2] += l[i] * v.z * v.z;
      M[3] += l[i] * v.x * v.y;
      M[4] += l[i] * v.x * v.z;
      M[5] += l[i] * v.y * v.z;
    });
    return { M, eig: eigSym3(M) };
  }, [ax, th, ph]);

  const presets = {
    rod: { c: 1, b: 0.24, a: 0.22 },
    plate: { c: 0.95, b: 0.82, a: 0.14 },
    sphere: { c: 0.6, b: 0.6, a: 0.6 },
  };
  const sph = (v: V3) => {
    const s = v[1] < 0 ? -1 : 1;
    const w = v.map((x) => x * s);
    return { t: deg(Math.acos(Math.min(1, w[1]))), p: ((deg(Math.atan2(w[2], w[0])) % 360) + 360) % 360 };
  };
  const Nd = fs ? sph(fs.N) : null;
  const major = sph(A.eig.vectors[2]);

  return (
    <Panel id="ef" num="3.6" fig={6} className={className}>
      <div ref={ref} />
      <div className={`mx-auto grid grid-cols-1 gap-2 ${mode === "single" ? "max-w-[480px]" : ""}`}>
        {mode === "single" ? (
          <div className="fig aspect-square">
            <Viewer view={single} alt="Ellipsoid with principal axes, section AA and angle construction" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1 text-center text-[12px] text-stone-500">Bone</p>
              <div className="fig aspect-square">
                <Viewer view={field?.bone ?? null} alt="Solid trabecular bone specimen" />
              </div>
            </div>
            <div>
              <p className="mb-1 text-center text-[12px] text-stone-500">Fabric field and order tensor Q</p>
              <div className="fig aspect-square">
                <Viewer view={field} alt="Transparent specimen with metallic fabric ellipsoids, director axis, Q eigenframe and order cone" />
              </div>
            </div>
          </div>
        )}
        {mode === "single" ? (
          <div className="flex items-center gap-2 text-[11px] text-stone-600">
            <span className="whitespace-nowrap">−1 oblate · plate</span>
            <span className="h-2 flex-1 rounded-full" style={{ background: cssRamp(EF_RAMP).replace("to top", "to right") }} />
            <span className="whitespace-nowrap">+1 prolate · rod</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[11px] text-stone-600">
            <span className="whitespace-nowrap">bronze · ⊥ N</span>
            <span className="h-2 flex-1 rounded-full" style={{ background: METAL_CSS }} />
            <span className="whitespace-nowrap">gold · ∥ N</span>
          </div>
        )}
      </div>

      {mode === "single" ? (
        <Controls>
          <Seg
            label="Shape"
            value={(Object.keys(presets) as (keyof typeof presets)[]).find((p) => presets[p].a === ax.a && presets[p].b === ax.b && presets[p].c === ax.c) ?? "custom"}
            onChange={(v) => v !== "custom" && setAx(presets[v as keyof typeof presets])}
            options={[
              { v: "rod", t: "Prolate (EF → +1)" },
              { v: "plate", t: "Oblate (EF → −1)" },
              { v: "sphere", t: "Sphere" },
              { v: "custom", t: "Custom" },
            ]}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <Slider label={<span style={{ color: "#c8324f" }}>c</span>} value={ax.c} min={0.1} max={1} step={0.01} onChange={(c) => setAx({ ...ax, c })} format={(v) => v.toFixed(2)} />
            <Slider label={<span style={{ color: "#2a9d8f" }}>b</span>} value={ax.b} min={0.1} max={1} step={0.01} onChange={(b) => setAx({ ...ax, b })} format={(v) => v.toFixed(2)} />
            <Slider label={<span style={{ color: "#3b6fb6" }}>a</span>} value={ax.a} min={0.1} max={1} step={0.01} onChange={(a) => setAx({ ...ax, a })} format={(v) => v.toFixed(2)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Slider label="Polar angle θ" value={th} min={0} max={180} step={1} onChange={setTh} format={(v) => `${v}°`} />
            <Slider label="Azimuth φ" value={ph} min={0} max={359} step={1} onChange={setPh} format={(v) => `${v}°`} />
          </div>
          <Readouts>
            <Readout label="EF = a/b − b/c" value={EF.toFixed(3)} accent />
            <Readout label="Class" value={shapeName} />
            <Readout label="Major axis θ, φ" value={`${major.t.toFixed(0)}°, ${major.p.toFixed(0)}°`} />
            <Readout label="λ = 1/r²" value={A.eig.values.map((v) => v.toFixed(1)).join(" / ")} />
          </Readouts>
          <Mat3 m={tensorMat(A.M)} label="A" />
        </Controls>
      ) : (
        <Controls>
          <Slider label="Trabecular alignment" hint="isotropic → nematic" value={k} min={1} max={4} step={0.1} onChange={setK} format={(v) => `${v.toFixed(1)} : 1`} />
          <p className="text-[12px] leading-relaxed text-stone-500">
            Each glyph is the local fabric ellipsoid from the gradient structure tensor (axes ∝ λ<sub>i</sub>
            <sup>−½</sup>), coloured by its alignment with the director: P₂(cos β) from bronze (perpendicular) through silver to gold (parallel). Treating the long axes as a nematic director field n, the order tensor Q = ⟨
            <span className="whitespace-nowrap">3/2 n⊗n − ½ I</span>⟩ gives the order parameter S = λ<sub>max</sub>(Q) = ⟨P₂(cos β)⟩ and the director N. The right view draws N, the eigenframe of Q (λ₁ along N), and the cone of mean deviation β̄ = arccos √((2S + 1)/3) about ±N. Both views share one camera.
          </p>
          <Readouts>
            <Readout label="Order S" value={fs ? fs.S.toFixed(3) : "-"} accent />
            <Readout label="Director θ, φ" value={Nd ? `${Nd.t.toFixed(0)}°, ${Nd.p.toFixed(0)}°` : "-"} />
            <Readout label="⟨EF⟩" value={fs ? fs.ef.toFixed(3) : "-"} />
            <Readout label="Plates / rods" value={fs ? `${(fs.plates * 100).toFixed(0)} / ${(fs.rods * 100).toFixed(0)}` : "-"} unit="%" />
          </Readouts>
          {fs && <Mat3 m={tensorMat(fs.Q)} label="Q" />}
        </Controls>
      )}
    </Panel>
  );
}
