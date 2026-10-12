/* =====================================================================
   Fabric estimates for the DA comparison, in the x-z plane (the plane of
   the analysis section): mean intercept length (MIL), star volume
   distribution (SVD) and the gradient structure tensor (GST).
   Bone = { q < beta } sampled trilinearly on the continuous field with
   random line offsets, so the estimates are not biased toward the voxel
   grid axes. Each estimate is timed.
   ===================================================================== */

import { sampleWrap } from "./engine";
import { mulberry32, type Dims } from "./volume";

export type Rose = { theta: number[]; r: number[]; ms: number };

export const directions = (n = 36) => Array.from({ length: n }, (_, i) => (i / n) * Math.PI);

/** Bone indicator on the continuous field (|signed| when available). */
export function boneAt(q: Float32Array & { signed?: Float32Array }, d: Dims, beta: number) {
  const s = q.signed;
  return s ? (x: number, y: number, z: number) => Math.abs(sampleWrap(s, d, x, y, z)) < beta : (x: number, y: number, z: number) => sampleWrap(q, d, x, y, z) < beta;
}

/** MIL(theta) = test-line length / bone entries, over parallel lines in many x-z planes. */
export function mil(inBone: (x: number, y: number, z: number) => boolean, d: Dims, theta = directions(), seed = 5): Rose {
  const t0 = performance.now();
  const rnd = mulberry32(seed);
  const L = d[0] * 1.5;
  const step = 0.5;
  const r = theta.map((th) => {
    const ux = Math.cos(th);
    const uz = Math.sin(th);
    let entries = 0;
    let len = 0;
    for (let y = 0; y < d[1]; y += 4)
      for (let k = 0; k < 24; k++) {
        // random line through the periodic plane
        const x0 = rnd() * d[0];
        const z0 = rnd() * d[2];
        let prev = inBone(x0, y, z0);
        for (let s = step; s <= L; s += step) {
          const b = inBone(x0 + ux * s, y, z0 + uz * s);
          if (b && !prev) entries++;
          prev = b;
        }
        len += L;
      }
    return len / Math.max(1, entries);
  });
  return { theta, r, ms: performance.now() - t0 };
}

/** Intercept length through (x,z) along +/-theta inside the phase, capped at `lim`. */
export function intercept(inBone: (x: number, y: number, z: number) => boolean, x: number, y: number, z: number, th: number, lim: number) {
  const ux = Math.cos(th);
  const uz = Math.sin(th);
  const out: [number, number] = [0, 0];
  [1, -1].forEach((sg, i) => {
    let s = 0.25;
    while (s < lim && inBone(x + sg * ux * s, y, z + sg * uz * s)) s += 0.25;
    out[i] = s;
  });
  return out;
}

/** SVD(theta) = mean cubed intercept length through random bone points. */
export function svd(inBone: (x: number, y: number, z: number) => boolean, d: Dims, seed: number, theta = directions(), n = 600): Rose {
  const t0 = performance.now();
  const rnd = mulberry32(seed);
  const pts: [number, number, number][] = [];
  for (let k = 0; pts.length < n && k < n * 60; k++) {
    const p: [number, number, number] = [rnd() * d[0], rnd() * d[1], rnd() * d[2]];
    if (inBone(...p)) pts.push(p);
  }
  const lim = d[0] / 2;
  const r = theta.map((th) => {
    let acc = 0;
    for (const [x, y, z] of pts) {
      const [a, b] = intercept(inBone, x, y, z, th, lim);
      acc += (a + b) ** 3;
    }
    return acc / Math.max(1, pts.length);
  });
  return { theta, r, ms: performance.now() - t0 };
}

/** GST rose in the x-z plane: 1 / (u^T G u), G = [xx,yy,zz,xy,xz,yz]; long along the struts. */
export function gstRose(G: number[], ms: number, theta = directions()): Rose {
  const r = theta.map((th) => {
    const ux = Math.cos(th);
    const uz = Math.sin(th);
    return 1 / Math.max(1e-6, G[0] * ux * ux + G[2] * uz * uz + 2 * G[4] * ux * uz);
  });
  return { theta, r, ms };
}

/** In-plane anisotropy of a rose as 1 - min/max (same convention as DA). */
export const roseDA = (rose: Rose) => 1 - Math.min(...rose.r) / Math.max(...rose.r);
