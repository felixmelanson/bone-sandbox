/* =====================================================================
   MIL and SVD drawn on the 3-D specimen.
     MIL  a bundle of parallel test lines crossing the cube in direction
          theta (in the front plane); a dot marks every entry into bone.
          MIL(theta) = total line length / number of entries.
     SVD  points in the marrow with rays in many directions, each ray
          running until it meets bone; the marrow star volume is
          V* = (4 pi / 3) mean(l^3).
   `inWorld(p)` says whether world point p (cube spans -0.5..0.5) is bone.
   ===================================================================== */

import * as THREE from "three";
import { mulberry32 } from "./volume";

export type InWorld = (x: number, y: number, z: number) => boolean;

const INK = new THREE.LineBasicMaterial({ color: 0x1c1917, transparent: true, opacity: 0.55, depthTest: false });
const HIT = new THREE.MeshBasicMaterial({ color: 0xff3b55, depthTest: false, transparent: true });
const SRC = new THREE.MeshBasicMaterial({ color: 0xff3b2f, depthTest: false, transparent: true });
const DOT = new THREE.SphereGeometry(1, 12, 8);

/** Clip the line o + t u to the cube; returns [t0, t1] or null. */
function clip(o: THREE.Vector3, u: THREE.Vector3): [number, number] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (const k of ["x", "y", "z"] as const) {
    if (Math.abs(u[k]) < 1e-9) {
      if (Math.abs(o[k]) > 0.5) return null;
      continue;
    }
    const a = (-0.5 - o[k]) / u[k];
    const b = (0.5 - o[k]) / u[k];
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return t1 > t0 ? [t0, t1] : null;
}

/** Test lines and their bone entries for direction theta; `voxelMM` converts world length to mm. */
export function milLines(inWorld: InWorld, theta: number, voxelMM: number) {
  const u = new THREE.Vector3(Math.cos(theta), Math.sin(theta), 0);
  const n = new THREE.Vector3(-u.y, u.x, 0);
  const seg: number[] = [];
  const hits: THREE.Vector3[] = [];
  let len = 0;
  for (const z of [-0.3, 0, 0.3])
    for (let k = -5; k <= 5; k++) {
      const o = n.clone().multiplyScalar(k * 0.085).setZ(z);
      const c = clip(o, u);
      if (!c) continue;
      const a = o.clone().addScaledVector(u, c[0]);
      const b = o.clone().addScaledVector(u, c[1]);
      seg.push(a.x, a.y, a.z, b.x, b.y, b.z);
      len += c[1] - c[0];
      let prev = inWorld(a.x, a.y, a.z);
      const steps = Math.ceil((c[1] - c[0]) * 220);
      for (let i = 1; i <= steps; i++) {
        const t = c[0] + ((c[1] - c[0]) * i) / steps;
        const p = o.clone().addScaledVector(u, t);
        const b2 = inWorld(p.x, p.y, p.z);
        if (b2 && !prev) hits.push(p);
        prev = b2;
      }
    }
  return { seg, hits, mil: (len * voxelMM) / Math.max(1, hits.length) };
}

/** MIL at many angles (for the rose). */
export function milRose(inWorld: InWorld, voxelMM: number, n = 36) {
  return Array.from({ length: n }, (_, i) => milLines(inWorld, (i / n) * Math.PI, voxelMM).mil);
}

/** Fill `g` with the MIL test lines and entry dots. */
export function drawMIL(g: THREE.Group, m: ReturnType<typeof milLines>) {
  clearGroup(g);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(m.seg, 3));
  const lines = new THREE.LineSegments(geo, INK);
  lines.renderOrder = 10;
  g.add(lines);
  const dots = new THREE.InstancedMesh(DOT, HIT, Math.max(1, m.hits.length));
  const mx = new THREE.Matrix4();
  m.hits.forEach((p, i) => dots.setMatrixAt(i, mx.makeScale(0.011, 0.011, 0.011).setPosition(p)));
  dots.count = m.hits.length;
  dots.renderOrder = 11;
  g.add(dots);
}

/** Fibonacci directions on the sphere. */
function dirs(n: number) {
  const out: THREE.Vector3[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    out.push(new THREE.Vector3(Math.cos(ga * i) * r, y, Math.sin(ga * i) * r));
  }
  return out;
}

/** Star rays from marrow points; lengths in world units (capped at the cube). */
export function svdStars(inWorld: InWorld, seed: number, voxelMM: number, nPts = 5, nDir = 34) {
  const r = mulberry32(seed);
  const D = dirs(nDir);
  const ray = (p: THREE.Vector3, u: THREE.Vector3) => {
    let t = 0.004;
    while (t < 0.9) {
      const q = p.clone().addScaledVector(u, t);
      if (Math.abs(q.x) > 0.5 || Math.abs(q.y) > 0.5 || Math.abs(q.z) > 0.5 || inWorld(q.x, q.y, q.z)) break;
      t += 0.004;
    }
    return t;
  };
  // candidate marrow points, keep the roomiest few that are well apart
  const cand: { p: THREE.Vector3; room: number }[] = [];
  for (let i = 0; i < 300; i++) {
    const p = new THREE.Vector3(r() * 0.7 - 0.35, r() * 0.7 - 0.35, r() * 0.7 - 0.35);
    if (inWorld(p.x, p.y, p.z)) continue;
    let room = 0;
    for (const u of D.slice(0, 10)) room += Math.min(0.2, ray(p, u));
    cand.push({ p, room });
  }
  cand.sort((a, b) => b.room - a.room);
  const stars: { p: THREE.Vector3; ends: THREE.Vector3[]; len: number[] }[] = [];
  for (const c of cand) {
    if (stars.length >= nPts) break;
    if (stars.some((s) => s.p.distanceTo(c.p) < 0.22)) continue;
    const len = D.map((u) => ray(c.p, u));
    stars.push({ p: c.p, ends: D.map((u, i) => c.p.clone().addScaledVector(u, len[i])), len });
  }
  const all = stars.flatMap((s) => s.len.map((l) => (l * voxelMM) ** 3));
  const vstar = ((4 * Math.PI) / 3) * (all.reduce((a, b) => a + b, 0) / Math.max(1, all.length));
  return { stars, vstar };
}

const RAY_MAT = new THREE.MeshBasicMaterial({ color: 0xff4a3d, depthTest: false, transparent: true });
const RAY_GEO = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);

/** Fill `g` with the stars, rays (thin tubes) grown to fraction `t` of their length. */
export function drawSVD(g: THREE.Group, s: { stars: { p: THREE.Vector3; ends: THREE.Vector3[] }[] }, t: number, r = 0.0035) {
  clearGroup(g);
  const n = s.stars.reduce((acc, st) => acc + st.ends.length, 0);
  const rays = new THREE.InstancedMesh(RAY_GEO, RAY_MAT, Math.max(1, n));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  let i = 0;
  for (const st of s.stars)
    for (const e of st.ends) {
      const d = e.clone().sub(st.p).multiplyScalar(t);
      const len = Math.max(1e-5, d.length());
      q.setFromUnitVectors(up, d.clone().normalize());
      m.compose(st.p.clone().addScaledVector(d, 0.5), q, new THREE.Vector3(r, len, r));
      rays.setMatrixAt(i++, m);
    }
  rays.count = i;
  rays.renderOrder = 10;
  g.add(rays);
  for (const st of s.stars) {
    const mm = new THREE.Mesh(DOT, SRC);
    mm.position.copy(st.p);
    mm.scale.setScalar(0.014);
    mm.renderOrder = 11;
    g.add(mm);
  }
}

export function clearGroup(g: THREE.Group) {
  for (const o of [...g.children]) {
    g.remove(o);
    if (o instanceof THREE.LineSegments) o.geometry.dispose();
    if (o instanceof THREE.InstancedMesh) o.dispose();
  }
}

/* ---------------- on the front face (frontal view, opaque bone) ---------------- */

const FACE_Z = 0.4995; // sample just inside the front cut face
const DRAW_Z = 0.503; // draw just in front of it
const LINE_W = new THREE.LineBasicMaterial({ color: 0xffffff });
const LINE_K = new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true });

/** MIL on the front face: parallel test lines at angle theta, entries into bone marked. */
export function milFace(inWorld: InWorld, theta: number, voxelMM: number, spacing = 0.07) {
  const u = new THREE.Vector3(Math.cos(theta), Math.sin(theta), 0);
  const n = new THREE.Vector3(-u.y, u.x, 0);
  const seg: number[] = [];
  const hits: THREE.Vector3[] = [];
  let len = 0;
  const kmax = Math.ceil(0.75 / spacing);
  for (let k = -kmax; k <= kmax; k++) {
    const o = n.clone().multiplyScalar(k * spacing).setZ(FACE_Z);
    const c = clip(new THREE.Vector3(o.x, o.y, 0), u);
    if (!c) continue;
    const a = o.clone().addScaledVector(u, c[0]);
    const b = o.clone().addScaledVector(u, c[1]);
    seg.push(a.x, a.y, DRAW_Z, b.x, b.y, DRAW_Z);
    len += c[1] - c[0];
    let prev = inWorld(a.x, a.y, FACE_Z);
    const steps = Math.ceil((c[1] - c[0]) * 400);
    for (let i = 1; i <= steps; i++) {
      const t = c[0] + ((c[1] - c[0]) * i) / steps;
      const p = o.clone().addScaledVector(u, t);
      const bb = inWorld(p.x, p.y, FACE_Z);
      if (bb && !prev) hits.push(new THREE.Vector3(p.x, p.y, DRAW_Z));
      prev = bb;
    }
  }
  return { seg, hits, mil: (len * voxelMM) / Math.max(1, hits.length) };
}

export function milFaceRose(inWorld: InWorld, voxelMM: number, n = 36) {
  return Array.from({ length: n }, (_, i) => milFace(inWorld, (i / n) * Math.PI, voxelMM).mil);
}

/** Draw face MIL lines; `progress` (0..1) reveals the lines one after another. */
export function drawMILFace(g: THREE.Group, m: ReturnType<typeof milFace>, progress = 1) {
  clearGroup(g);
  const nLines = m.seg.length / 6;
  const show = Math.max(0, Math.min(nLines, Math.ceil(nLines * progress)));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(m.seg.slice(0, show * 6), 3));
  const lines = new THREE.LineSegments(geo, LINE_K);
  lines.renderOrder = 10;
  g.add(lines);
  // entries belonging to the revealed lines
  const shown = m.hits.filter((h) => {
    if (progress >= 1) return true;
    const ys = m.seg; // line k spans indices k*6..k*6+5
    for (let k = 0; k < show; k++) {
      const ax = ys[k * 6];
      const ay = ys[k * 6 + 1];
      const bx = ys[k * 6 + 3];
      const by = ys[k * 6 + 4];
      const cross = (bx - ax) * (h.y - ay) - (by - ay) * (h.x - ax);
      if (Math.abs(cross) / Math.hypot(bx - ax, by - ay) < 0.004) return true;
    }
    return false;
  });
  const dots = new THREE.InstancedMesh(DOT, HIT, Math.max(1, shown.length));
  const mx = new THREE.Matrix4();
  shown.forEach((p, i) => dots.setMatrixAt(i, mx.makeScale(0.012, 0.012, 0.004).setPosition(p)));
  dots.count = shown.length;
  dots.renderOrder = 11;
  g.add(dots);
}

/** SVD on the front face: in-plane stars from marrow points until they reach bone. */
export function svdFace(inWorld: InWorld, seed: number, voxelMM: number, nPts = 4, nDir = 24) {
  const r = mulberry32(seed);
  const ray = (x: number, y: number, ux: number, uy: number) => {
    let t = 0.003;
    while (t < 1.2) {
      const px = x + ux * t;
      const py = y + uy * t;
      if (Math.abs(px) > 0.5 || Math.abs(py) > 0.5 || inWorld(px, py, FACE_Z)) break;
      t += 0.003;
    }
    return t;
  };
  const cand: { x: number; y: number; room: number }[] = [];
  for (let i = 0; i < 400; i++) {
    const x = r() * 0.8 - 0.4;
    const y = r() * 0.8 - 0.4;
    if (inWorld(x, y, FACE_Z)) continue;
    let room = 0;
    for (let j = 0; j < 8; j++) room += Math.min(0.25, ray(x, y, Math.cos((j / 8) * Math.PI * 2), Math.sin((j / 8) * Math.PI * 2)));
    cand.push({ x, y, room });
  }
  cand.sort((a, b) => b.room - a.room);
  const stars: { p: THREE.Vector3; ends: THREE.Vector3[]; len: number[] }[] = [];
  for (const c of cand) {
    if (stars.length >= nPts) break;
    if (stars.some((s) => Math.hypot(s.p.x - c.x, s.p.y - c.y) < 0.25)) continue;
    const len: number[] = [];
    const ends: THREE.Vector3[] = [];
    for (let j = 0; j < nDir; j++) {
      const a = (j / nDir) * Math.PI * 2;
      const l = ray(c.x, c.y, Math.cos(a), Math.sin(a));
      len.push(l);
      ends.push(new THREE.Vector3(c.x + Math.cos(a) * l, c.y + Math.sin(a) * l, DRAW_Z));
    }
    stars.push({ p: new THREE.Vector3(c.x, c.y, DRAW_Z), ends, len });
  }
  const all = stars.flatMap((s) => s.len.map((l) => (l * voxelMM) ** 3));
  const vstar = ((4 * Math.PI) / 3) * (all.reduce((a, b) => a + b, 0) / Math.max(1, all.length));
  return { stars, vstar };
}

export { LINE_W };

/** Opaque section of the front cut face: bone ivory, marrow dark and translucent so deeper struts recede. */
export function faceSection(inWorld: InWorld, n = 320) {
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(n, n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) / n - 0.5;
      const y = 0.5 - (j + 0.5) / n;
      const o = (j * n + i) * 4;
      if (inWorld(x, y, FACE_Z)) {
        img.data[o] = 232;
        img.data[o + 1] = 222;
        img.data[o + 2] = 202;
        img.data[o + 3] = 255;
      } else {
        img.data[o] = 22;
        img.data[o + 1] = 22;
        img.data[o + 2] = 26;
        img.data[o + 3] = 175;
      }
    }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.position.z = 0.501;
  m.renderOrder = 5;
  return m;
}
