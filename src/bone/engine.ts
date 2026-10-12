/* =====================================================================
   Interactive morphometry engine.
   ---------------------------------------------------------------------
   Structure: two-level-cut Gaussian random field.  A band-pass GRF y
   and an independent low-frequency field g give a scalar field
         q(r) = |y(r)| / (1 + a * g(r))
   and bone is the region  q < beta.  `beta` controls BV/TV and is a pure
   threshold, so the GPU can re-segment instantly; `a` perforates plates
   into rods (connectivity).  The field is periodic, so it tiles.
   ===================================================================== */

import { blur3, mulberry32, toFloat, type Dims } from "./volume";
import { ramp, type Stop } from "./colormap";

/** Physical voxel size: 64 voxels ~ 4.2 mm human trabecular core. */
export const VOX_MM = 0.065;

export type V3 = [number, number, number];

function gauss(N: number, seed: number) {
  const r = mulberry32(seed);
  const out = new Float32Array(N);
  for (let i = 0; i < N; i += 2) {
    const u = Math.max(1e-9, r());
    const v = r();
    const m = Math.sqrt(-2 * Math.log(u));
    out[i] = m * Math.cos(2 * Math.PI * v);
    if (i + 1 < N) out[i + 1] = m * Math.sin(2 * Math.PI * v);
  }
  return out;
}

function standardise(f: Float32Array) {
  let m = 0;
  for (let i = 0; i < f.length; i++) m += f[i];
  m /= f.length;
  let v = 0;
  for (let i = 0; i < f.length; i++) {
    f[i] -= m;
    v += f[i] * f[i];
  }
  const k = 1 / Math.sqrt(v / f.length || 1);
  for (let i = 0; i < f.length; i++) f[i] *= k;
}

export type Field = { dims: Dims; N: number; y: Float32Array; ay: Float32Array; g: Float32Array };

/** q field. `signed` (same values with the sign of y) is what the GPU interpolates:
 *  interpolating |y| directly puts a kink at every plate midplane and ripples thin plates at voxel scale. */
export type QField = Float32Array & { signed?: Float32Array };

/** `s` = correlation length per axis (voxels). Unequal s => anisotropic fabric along x. */
export function makeField(seed: number, dims: Dims, s: Dims): Field {
  const N = dims[0] * dims[1] * dims[2];
  const n1 = gauss(N, seed);
  const b1 = blur3(n1, dims, s);
  const b2 = blur3(n1, dims, [s[0] * 1.8, s[1] * 1.8, s[2] * 1.8]);
  const ay = new Float32Array(N);
  for (let i = 0; i < N; i++) ay[i] = b1[i] - b2[i];
  standardise(ay);
  const y = ay.slice();
  for (let i = 0; i < N; i++) ay[i] = Math.abs(ay[i]);
  const g = blur3(gauss(N, seed * 7919 + 13), dims, [s[0] * 1.7, s[1] * 1.7, s[2] * 1.7]);
  standardise(g);
  return { dims, N, y, ay, g };
}

export function qField(f: Field, a: number): QField {
  const q: QField = new Float32Array(f.N);
  const sq = new Float32Array(f.N);
  for (let i = 0; i < f.N; i++) {
    const v = f.y[i] / Math.max(0.12, 1 + a * f.g[i]);
    sq[i] = Math.max(-4, Math.min(4, v));
    q[i] = Math.abs(sq[i]);
  }
  q.signed = sq;
  return q;
}

export const sortedCopy = (q: Float32Array) => Float32Array.from(q).sort();

export function betaForBV(sorted: Float32Array, bv: number) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(bv * sorted.length)))];
}

export function bvForBeta(sorted: Float32Array, beta: number) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (sorted[m] < beta) lo = m + 1;
    else hi = m;
  }
  return lo / sorted.length;
}

export function binarize(q: Float32Array, beta: number) {
  const b = new Uint8Array(q.length);
  for (let i = 0; i < q.length; i++) b[i] = q[i] < beta ? 1 : 0;
  return b;
}

/* ------------------------------ topology ---------------------------- */

/**
 * Euler characteristic chi = V - E + F - C of the union of closed bone
 * voxels (26-connected bone).  Connectivity (Odgaard & Gundersen 1993):
 * beta1 = beta0 - chi + beta2 ~ 1 - chi for one connected network
 * without enclosed cavities.
 */
export function euler(bone: Uint8Array, d: Dims) {
  const [nx, ny, nz] = d;
  const sxy = nx * ny;
  const b = (x: number, y: number, z: number) =>
    x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? 0 : bone[z * sxy + y * nx + x];
  let V = 0;
  let E = 0;
  let F = 0;
  let C = 0;
  for (let z = 0; z <= nz; z++)
    for (let y = 0; y <= ny; y++)
      for (let x = 0; x <= nx; x++) {
        const v000 = b(x - 1, y - 1, z - 1);
        const v100 = b(x, y - 1, z - 1);
        const v010 = b(x - 1, y, z - 1);
        const v110 = b(x, y, z - 1);
        const v001 = b(x - 1, y - 1, z);
        const v101 = b(x, y - 1, z);
        const v011 = b(x - 1, y, z);
        const v111 = b(x, y, z);
        if (v000 | v100 | v010 | v110 | v001 | v101 | v011 | v111) V++;
        if (x < nx && v100 | v110 | v101 | v111) E++;
        if (y < ny && v010 | v110 | v011 | v111) E++;
        if (z < nz && v001 | v101 | v011 | v111) E++;
        if (y < ny && z < nz && v011 | v111) F++;
        if (x < nx && z < nz && v101 | v111) F++;
        if (x < nx && y < ny && v110 | v111) F++;
        if (v111) C++;
      }
  return V - E + F - C;
}

/**
 * Connectivity after purification (BoneJ convention): keep only the largest
 * 26-connected bone particle, fill enclosed marrow cavities, then
 * beta1 = 1 - chi of the purified image (beta0 = 1, beta2 = 0 by construction).
 * Loose fragments would otherwise add spurious voxel-scale loops.
 */
export function connectivity(bone: Uint8Array, d: Dims) {
  const [nx, ny, nz] = d;
  const sxy = nx * ny;
  const N = bone.length;
  const seen = new Uint8Array(N);
  const vis = new Int32Array(N); // indices of the component being flooded
  /** Flood the `fg` component of `mask` from `start`; fills vis[0..n). Returns [n, touches boundary]. */
  const flood = (mask: Uint8Array, start: number, fg: number, full: boolean): [number, boolean] => {
    let head = 0;
    let n = 0;
    let edge = false;
    vis[n++] = start;
    seen[start] = 1;
    while (head < n) {
      const i = vis[head++];
      const z = (i / sxy) | 0;
      const y = ((i - z * sxy) / nx) | 0;
      const x = i - z * sxy - y * nx;
      if (x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1) edge = true;
      for (let dz = -1; dz <= 1; dz++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const m = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
            if (!m || (!full && m > 1)) continue;
            const xx = x + dx;
            const yy = y + dy;
            const zz = z + dz;
            if (xx < 0 || yy < 0 || zz < 0 || xx >= nx || yy >= ny || zz >= nz) continue;
            const j = zz * sxy + yy * nx + xx;
            if (seen[j] || mask[j] !== fg) continue;
            seen[j] = 1;
            vis[n++] = j;
          }
    }
    return [n, edge];
  };
  // largest 26-connected bone particle
  const pure = new Uint8Array(N);
  let b0 = 0;
  let best = 0;
  for (let i = 0; i < N; i++) {
    if (seen[i] || !bone[i]) continue;
    const [n] = flood(bone, i, 1, true);
    b0++;
    if (n > best) {
      best = n;
      pure.fill(0);
      for (let k = 0; k < n; k++) pure[vis[k]] = 1;
    }
  }
  // fill marrow components (6-connected) of the purified image that never reach the boundary
  seen.fill(0);
  for (let i = 0; i < N; i++) {
    if (seen[i] || pure[i]) continue;
    const [n, edge] = flood(pure, i, 0, false);
    if (!edge) for (let k = 0; k < n; k++) pure[vis[k]] = 1;
  }
  const chi = euler(pure, d);
  return { chi, b0, b1: Math.max(0, 1 - chi) };
}

/* ------------------------------- fabric ----------------------------- */

/**
 * Gradient structure tensor of the (lightly smoothed) bone phase.
 * Its eigenvectors give the dominant surface-normal directions; the
 * trabecular (fabric) direction is the eigenvector of the *smallest*
 * eigenvalue.  `local` = per-voxel tensor smoothed over `ls` voxels.
 */
export function gradTensor(bone: Uint8Array, d: Dims, ls = 0) {
  const [nx, ny, nz] = d;
  const sxy = nx * ny;
  const N = bone.length;
  const b = blur3(toFloat(bone), d, [1, 1, 1]);
  const comps = Array.from({ length: 6 }, () => new Float32Array(N));
  const G = [0, 0, 0, 0, 0, 0];
  for (let z = 0; z < nz; z++) {
    const zm = ((z - 1 + nz) % nz) * sxy;
    const zp = ((z + 1) % nz) * sxy;
    for (let y = 0; y < ny; y++) {
      const ym = ((y - 1 + ny) % ny) * nx;
      const yp = ((y + 1) % ny) * nx;
      for (let x = 0; x < nx; x++) {
        const xm = (x - 1 + nx) % nx;
        const xp = (x + 1) % nx;
        const zs = z * sxy;
        const ys = y * nx;
        const gx = b[zs + ys + xp] - b[zs + ys + xm];
        const gy = b[zs + yp + x] - b[zs + ym + x];
        const gz = b[zp + ys + x] - b[zm + ys + x];
        const i = zs + ys + x;
        const v = [gx * gx, gy * gy, gz * gz, gx * gy, gx * gz, gy * gz];
        for (let k = 0; k < 6; k++) {
          comps[k][i] = v[k];
          G[k] += v[k];
        }
      }
    }
  }
  const tr = G[0] + G[1] + G[2] || 1;
  for (let k = 0; k < 6; k++) G[k] /= tr;
  const local = ls > 0 ? comps.map((c) => blur3(c, d, [ls, ls, ls])) : null;
  return { G, local };
}

export const tensorAt = (local: Float32Array[], i: number) => local.map((c) => c[i]);

/** Jacobi eigen-decomposition of a symmetric 3x3 [xx,yy,zz,xy,xz,yz]; values descending. */
export function eigSym3(m: ArrayLike<number>) {
  const A = [
    [m[0], m[3], m[4]],
    [m[3], m[1], m[5]],
    [m[4], m[5], m[2]],
  ];
  const V = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 32; sweep++) {
    const off = A[0][1] ** 2 + A[0][2] ** 2 + A[1][2] ** 2;
    if (off < 1e-20) break;
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      if (Math.abs(A[p][q]) < 1e-22) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const kp = A[k][p];
        const kq = A[k][q];
        A[k][p] = c * kp - s * kq;
        A[k][q] = s * kp + c * kq;
      }
      for (let k = 0; k < 3; k++) {
        const pk = A[p][k];
        const qk = A[q][k];
        A[p][k] = c * pk - s * qk;
        A[q][k] = s * pk + c * qk;
      }
      for (let k = 0; k < 3; k++) {
        const kp = V[k][p];
        const kq = V[k][q];
        V[k][p] = c * kp - s * kq;
        V[k][q] = s * kp + c * kq;
      }
    }
  }
  const idx = [0, 1, 2].sort((i, j) => A[j][j] - A[i][i]);
  return {
    values: idx.map((i) => A[i][i]) as V3,
    vectors: idx.map((i) => [V[0][i], V[1][i], V[2][i]] as V3),
  };
}

/** EF of an ellipsoid (BoneJ, Doube 2015): EF = a/b - b/c with a <= b <= c. */
export function ellipsoidFactor(r: number[]) {
  const [a, b, c] = [...r].sort((x, y) => x - y);
  return a / b - b / c;
}

/* ------------------------------ statistics -------------------------- */

export function phaseStats(val: Float32Array, mask: Uint8Array, fg: number, max: number, bins = 28) {
  let n = 0;
  let s = 0;
  let s2 = 0;
  let mx = 0;
  const h = new Array(bins).fill(0);
  for (let i = 0; i < val.length; i++) {
    if (mask[i] !== fg) continue;
    const v = val[i];
    n++;
    s += v;
    s2 += v * v;
    if (v > mx) mx = v;
    h[Math.min(bins - 1, Math.floor((v / max) * bins))]++;
  }
  const mean = n ? s / n : 0;
  const peak = Math.max(1, ...h);
  return {
    mean,
    sd: n ? Math.sqrt(Math.max(0, s2 / n - mean * mean)) : 0,
    max: mx,
    n,
    hist: h.map((c) => c / peak),
    frac: (lo: number, hi: number) => {
      let c = 0;
      for (let i = 0; i < val.length; i++) if (mask[i] === fg && val[i] >= lo && val[i] <= hi) c++;
      return n ? c / n : 0;
    },
  };
}

/* ------------------------------- sections --------------------------- */

/** Periodic trilinear sample. Allocation-free on purpose: it runs ~10^5 times per slider frame. */
const tri = (a: Float32Array, d: Dims, x: number, y: number, z: number) => {
  const nx = d[0];
  const ny = d[1];
  const nz = d[2];
  x = ((x % nx) + nx) % nx;
  y = ((y % ny) + ny) % ny;
  z = ((z % nz) + nz) % nz;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = x0 + 1 === nx ? 0 : x0 + 1;
  const y1 = y0 + 1 === ny ? 0 : y0 + 1;
  const z1 = z0 + 1 === nz ? 0 : z0 + 1;
  const tx = x - x0;
  const ty = y - y0;
  const tz = z - z0;
  const s = nx * ny;
  const r00 = z0 * s + y0 * nx;
  const r10 = z0 * s + y1 * nx;
  const r01 = z1 * s + y0 * nx;
  const r11 = z1 * s + y1 * nx;
  const c00 = a[r00 + x0] * (1 - tx) + a[r00 + x1] * tx;
  const c10 = a[r10 + x0] * (1 - tx) + a[r10 + x1] * tx;
  const c01 = a[r01 + x0] * (1 - tx) + a[r01 + x1] * tx;
  const c11 = a[r11 + x0] * (1 - tx) + a[r11 + x1] * tx;
  return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
};
export const sampleWrap = tri;

export type Shade = (bone: number, x: number, y: number, z: number) => V3;

/**
 * Horizontal section at voxel height `yv`, viewed from above, with
 * analytic edge antialiasing (coverage = 0.5 + F / |dF|).
 */
export function renderSlice(q: QField, d: Dims, beta: number, yv: number, R: number, shade: Shade) {
  const out = new Uint8ClampedArray(R * R * 4);
  const src = q.signed ?? q;
  const at = (x: number, y: number, z: number) => Math.max(Math.abs(tri(src, d, x, y, z)), tri(q, d, x, y, z) - 0.3 * beta);
  const sx = d[0] / R;
  const sz = d[2] / R;
  for (let j = 0; j < R; j++) {
    for (let i = 0; i < R; i++) {
      const x = (i + 0.5) * sx - 0.5;
      const z = (j + 0.5) * sz - 0.5;
      const f = beta - at(x, yv, z);
      const fu = beta - at(x + sx, yv, z) - f;
      const fv = beta - at(x, yv, z + sz) - f;
      const cov = Math.min(1, Math.max(0, 0.5 + f / (Math.hypot(fu, fv) + 1e-6)));
      const c = shade(cov, x, yv, z);
      const o = (j * R + i) * 4;
      out[o] = c[0];
      out[o + 1] = c[1];
      out[o + 2] = c[2];
      out[o + 3] = 255;
    }
  }
  return out;
}

export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export const shadeBinary: Shade = (c) => [255 * c, 255 * c, 255 * c];

export const shadeGrey =
  (rgb: V3): Shade =>
  (c) => [mix(255, rgb[0], c), mix(255, rgb[1], c), mix(255, rgb[2], c)];

/** Colour the chosen phase by a normalised local-thickness field. */
export const shadeLT =
  (lt: Float32Array, d: Dims, stops: Stop[], phase: 1 | 0): Shade =>
  (cov, x, y, z) => {
    const k = phase === 1 ? cov : 1 - cov;
    const c = ramp(stops, sampleClamp(lt, d, x, y, z));
    return [mix(255, c[0], k), mix(255, c[1], k), mix(255, c[2], k)];
  };

function sampleClamp(a: Float32Array, d: Dims, x: number, y: number, z: number) {
  const c = (v: number, n: number) => Math.min(n - 1, Math.max(0, v));
  return tri(a, d, c(x, d[0]), c(y, d[1]), c(z, d[2]));
}
