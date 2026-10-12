/* =====================================================================
   3-D trabecular bone volumes
   ---------------------------------------------------------------------
   Structure model: two-level-cut Gaussian random field (Berk 1987;
   Roberts & Garboczi).  A band-pass GRF y(r) is generated and the solid
   phase is the band  |y(r)| < beta, which yields interconnected,
   curved trabecular *plates* centred on the y = 0 level set.

   A second, independent, low-frequency field g(r) modulates the band
   width:  |y| < beta * (1 + a * g).  Where the modulation drives the
   band to zero, plates perforate and break up into *rods* - the same
   plate-to-rod transition seen in osteoporotic bone.  `a` therefore
   controls connectivity, `beta` (solved for) controls BV/TV.

   Metrics are computed exactly as micro-CT software does:
     - exact 3-D Euclidean distance transform (Felzenszwalb-Huttenlocher)
     - local thickness (Hildebrand & Ruegsegger 1997): the diameter of
       the largest sphere that contains the voxel and fits in the phase,
       evaluated by painting maximal spheres centred on the distance
       ridge.  Bone phase -> Tb.Th, marrow phase -> Tb.Sp.
   ===================================================================== */

export type Dims = [number, number, number];

export type Volume = {
  dims: Dims;
  N: number;
  /** continuous level-set field: > 0 bone, < 0 marrow */
  F: Float32Array;
  /** 1 = bone, 0 = marrow */
  bone: Uint8Array;
  /** world units per voxel (the longest axis spans 1 world unit) */
  scale: number;
  bvtv: number;
};

export type VolParams = {
  seed: number;
  dims: Dims;
  /** base correlation length in voxels, per axis for anisotropy */
  s: number | Dims;
  /** perforation strength (0 = intact plates, >1.5 = fragmented rods) */
  a: number;
  /** target bone volume fraction */
  bv: number;
};

/* ------------------------------ random ------------------------------ */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianNoise(N: number, seed: number) {
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

/* ------------------------------ lines ------------------------------- */

/** Visit every 1-D line of the volume along `axis`. */
function forLines(d: Dims, axis: number, cb: (base: number, stride: number, len: number) => void) {
  const [nx, ny, nz] = d;
  if (axis === 0) {
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) cb((z * ny + y) * nx, 1, nx);
  } else if (axis === 1) {
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) cb(z * nx * ny + x, nx, ny);
  } else {
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) cb(y * nx + x, nx * ny, nz);
  }
}

/* ------------------------------ blur -------------------------------- */

/** Box half-width whose 3-fold iteration has standard deviation ~ s. */
const boxR = (s: number) =>
  s < 0.35 ? 0 : Math.max(1, Math.round((Math.sqrt(1 + 4 * s * s) - 1) / 2));

/**
 * Separable 3-D Gaussian (three iterated sliding-window box passes per
 * axis, O(N) regardless of radius).  `wrap` = periodic boundaries.
 */
export function blur3(src: Float32Array, d: Dims, s: Dims, wrap = true): Float32Array {
  const r = s.map(boxR);
  let a = src.slice();
  let b = new Float32Array(src.length);
  const L = Math.max(...d);
  const buf = new Float32Array(L);
  for (let p = 0; p < 3; p++) {
    for (let axis = 0; axis < 3; axis++) {
      const rr = r[axis];
      if (!rr) continue;
      const norm = 1 / (2 * rr + 1);
      forLines(d, axis, (base, stride, len) => {
        const ix = wrap
          ? (i: number) => ((i % len) + len) % len
          : (i: number) => (i < 0 ? 0 : i >= len ? len - 1 : i);
        for (let i = 0; i < len; i++) buf[i] = a[base + i * stride];
        let acc = 0;
        for (let k = -rr; k <= rr; k++) acc += buf[ix(k)];
        for (let i = 0; i < len; i++) {
          b[base + i * stride] = acc * norm;
          acc += buf[ix(i + rr + 1)] - buf[ix(i - rr)];
        }
      });
      const t = a;
      a = b;
      b = t;
    }
  }
  return a;
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
  const inv = 1 / Math.sqrt(v / f.length || 1);
  for (let i = 0; i < f.length; i++) f[i] *= inv;
}

/* ---------------------------- generation ---------------------------- */

export function makeVolume(p: VolParams): Volume {
  const d = p.dims;
  const N = d[0] * d[1] * d[2];
  const s: Dims = typeof p.s === "number" ? [p.s, p.s, p.s] : p.s;
  const mul = (k: number): Dims => [s[0] * k, s[1] * k, s[2] * k];

  // band-pass field (difference of Gaussians) -> cellular length scale
  const n1 = gaussianNoise(N, p.seed);
  const b1 = blur3(n1, d, s);
  const b2 = blur3(n1, d, mul(1.8));
  const y = new Float32Array(N);
  for (let i = 0; i < N; i++) y[i] = b1[i] - b2[i];
  standardise(y);

  // independent low-frequency modulation -> perforations
  const g = blur3(gaussianNoise(N, p.seed * 7919 + 13), d, mul(1.7));
  standardise(g);

  const m = new Float32Array(N);
  const ay = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    m[i] = 1 + p.a * g[i];
    ay[i] = Math.abs(y[i]);
  }

  // solve for the cut level that gives the requested BV/TV
  let lo = 0;
  let hi = 4;
  for (let it = 0; it < 24; it++) {
    const t = (lo + hi) / 2;
    let c = 0;
    for (let i = 0; i < N; i++) if (ay[i] < t * m[i]) c++;
    if (c / N < p.bv) lo = t;
    else hi = t;
  }
  const beta = (lo + hi) / 2;

  const F = new Float32Array(N);
  const bone = new Uint8Array(N);
  let c = 0;
  for (let i = 0; i < N; i++) {
    F[i] = beta * m[i] - ay[i];
    if (F[i] > 0) {
      bone[i] = 1;
      c++;
    }
  }
  return { dims: d, N, F, bone, scale: 1 / (Math.max(...d) - 1), bvtv: c / N };
}

/* ---------------------- exact distance transform -------------------- */

const INF = 1e12;

function dt1(f: Float64Array, len: number, out: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < len; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < len; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    out[q] = dq * dq + f[v[k]];
  }
}

/**
 * Euclidean distance (voxels) from each voxel of phase `fg` to the
 * nearest voxel of the other phase.  Space outside the volume is treated
 * as continuing the same phase, so cut faces do not bias the metric.
 */
export function edt3(mask: Uint8Array, d: Dims, fg: number): Float32Array {
  const N = mask.length;
  const g = new Float64Array(N);
  for (let i = 0; i < N; i++) g[i] = mask[i] === fg ? INF : 0;
  const L = Math.max(...d);
  const f = new Float64Array(L);
  const o = new Float64Array(L);
  const v = new Int32Array(L);
  const z = new Float64Array(L + 1);
  for (let axis = 0; axis < 3; axis++) {
    forLines(d, axis, (base, stride, len) => {
      for (let i = 0; i < len; i++) f[i] = g[base + i * stride];
      dt1(f, len, o, v, z);
      for (let i = 0; i < len; i++) g[base + i * stride] = o[i];
    });
  }
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = Math.sqrt(Math.min(g[i], 1e8));
  return out;
}

/** Distance map plus its ridge (centres of locally maximal spheres). */
export function ridgePoints(mask: Uint8Array, d: Dims, fg: number) {
  const D = edt3(mask, d, fg);
  const [nx, ny, nz] = d;
  const sxy = nx * ny;
  const ridge: number[] = [];
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const i = z * sxy + y * nx + x;
        if (mask[i] !== fg) continue;
        const r = D[i];
        if (
          (x > 0 && D[i - 1] > r) ||
          (x < nx - 1 && D[i + 1] > r) ||
          (y > 0 && D[i - nx] > r) ||
          (y < ny - 1 && D[i + nx] > r) ||
          (z > 0 && D[i - sxy] > r) ||
          (z < nz - 1 && D[i + sxy] > r)
        )
          continue;
        ridge.push(i);
      }
  return { D, ridge };
}

/** Hildebrand-Ruegsegger local thickness (voxel units, diameters). */
export function localThickness(mask: Uint8Array, d: Dims, fg: number): Float32Array {
  const { D, ridge } = ridgePoints(mask, d, fg);
  const [nx, ny, nz] = d;
  const sxy = nx * ny;
  const LT = new Float32Array(mask.length);
  for (const i of ridge) {
    const r = D[i];
    const R = Math.ceil(r);
    const r2 = r * r;
    const val = 2 * r;
    const z = (i / sxy) | 0;
    const y = ((i - z * sxy) / nx) | 0;
    const x = i - z * sxy - y * nx;
    for (let dz = -R; dz <= R; dz++) {
      const zz = z + dz;
      if (zz < 0 || zz >= nz) continue;
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy;
        const e = dz * dz + dy * dy;
        if (yy < 0 || yy >= ny || e >= r2) continue;
        const row = zz * sxy + yy * nx;
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= nx || e + dx * dx >= r2) continue;
          const j = row + xx;
          if (mask[j] === fg && LT[j] < val) LT[j] = val;
        }
      }
    }
  }
  for (let i = 0; i < LT.length; i++) if (mask[i] === fg && LT[i] === 0) LT[i] = 2 * D[i];
  return LT;
}

/**
 * Normalised convolution restricted to one phase: smooths a per-voxel
 * value for display without bleeding the other phase's zeros into it.
 */
export function smoothInPhase(val: Float32Array, mask: Uint8Array, fg: number, d: Dims) {
  const num = new Float32Array(val.length);
  const den = new Float32Array(val.length);
  for (let i = 0; i < val.length; i++) {
    if (mask[i] === fg) {
      num[i] = val[i];
      den[i] = 1;
    }
  }
  const bn = blur3(num, d, [1, 1, 1], false);
  const bd = blur3(den, d, [1, 1, 1], false);
  const out = new Float32Array(val.length);
  for (let i = 0; i < out.length; i++) out[i] = bd[i] > 1e-3 ? bn[i] / bd[i] : 0;
  return out;
}

export function percentile(val: Float32Array, mask: Uint8Array, fg: number, p: number) {
  const a: number[] = [];
  for (let i = 0; i < val.length; i++) if (mask[i] === fg) a.push(val[i]);
  if (!a.length) return 1;
  a.sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
}

/* ------------------------------ sampling ---------------------------- */

export function sampleTri(arr: Float32Array, d: Dims, x: number, y: number, z: number) {
  const [nx, ny, nz] = d;
  x = x < 0 ? 0 : x > nx - 1 ? nx - 1 : x;
  y = y < 0 ? 0 : y > ny - 1 ? ny - 1 : y;
  z = z < 0 ? 0 : z > nz - 1 ? nz - 1 : z;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = Math.min(x0 + 1, nx - 1);
  const y1 = Math.min(y0 + 1, ny - 1);
  const z1 = Math.min(z0 + 1, nz - 1);
  const tx = x - x0;
  const ty = y - y0;
  const tz = z - z0;
  const sxy = nx * ny;
  const g = (xx: number, yy: number, zz: number) => arr[zz * sxy + yy * nx + xx];
  const c00 = g(x0, y0, z0) * (1 - tx) + g(x1, y0, z0) * tx;
  const c10 = g(x0, y1, z0) * (1 - tx) + g(x1, y1, z0) * tx;
  const c01 = g(x0, y0, z1) * (1 - tx) + g(x1, y0, z1) * tx;
  const c11 = g(x0, y1, z1) * (1 - tx) + g(x1, y1, z1) * tx;
  const c0 = c00 * (1 - ty) + c10 * ty;
  const c1 = c01 * (1 - ty) + c11 * ty;
  return c0 * (1 - tz) + c1 * tz;
}

export function toFloat(mask: Uint8Array, fg = 1) {
  const out = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] === fg ? 1 : 0;
  return out;
}
