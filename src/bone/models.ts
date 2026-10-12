/* =====================================================================
   Specimen models for the sandbox.
   ---------------------------------------------------------------------
   Voronoi-based models are the standard synthetic trabecular bone:
   random cell centres, bone along the cell walls (plates, F2 - F1 small)
   or along the cell edges where three cells meet (rods, F3 - F1 small).
     plates   cellular plate network, perforated by a low-frequency field
     rods     rod network along the cell edges (osteoporotic look)
     mixed    plates in some regions, rods in others (human cancellous)
     grf      the original two level cut Gaussian random field (wavy)
     braced   a fixed vertical scaffold with a set fraction of transverse
              links kept (rung retention), so the transverse fraction
              varies continuously over nested link sets
   Every model returns a non-negative field q with bone = { q < beta };
   beta is chosen from the sorted field, so BV/TV is exact. The field is
   periodic, lightly smoothed (no creases or floating specks), and the
   fabric ratio k stretches the structure along x.
   ===================================================================== */

import { makeField, qField } from "./engine";
import { blur3, mulberry32, type Dims } from "./volume";

export type ModelId = "graph" | "columns" | "rungs" | "hybrid" | "braced" | "tworod" | "mixed" | "plates" | "rods" | "grf";
export const MODELS: { id: ModelId; name: string; note: string; bv: number }[] = [
  { id: "tworod", name: "Two-surface rods", note: "smooth struts where two random surfaces intersect", bv: 0.14 },
  { id: "rungs", name: "Rungs and columns", note: "dense horizontal cross-braces tying thinner vertical columns together", bv: 0.14 },
  { id: "hybrid", name: "Hybrid", note: "columns with rungs and oblique struts at irregular junctions", bv: 0.17 },
  { id: "columns", name: "Columns and rungs", note: "vertical columns with thinner horizontal cross-braces; vertebral bone", bv: 0.14 },
  { id: "braced", name: "Braced columns", note: "a fixed vertical scaffold keeping a set fraction of its transverse rungs", bv: 0.14 },
  { id: "graph", name: "Strut graph", note: "random nodes joined to their neighbours by tapered rods", bv: 0.14 },
  { id: "mixed", name: "Plate and rod", note: "Voronoi plates breaking into rods", bv: 0.17 },
  { id: "rods", name: "Voronoi rods", note: "rods along Voronoi cell edges", bv: 0.13 },
  { id: "grf", name: "Random field", note: "two level cut Gaussian random field", bv: 0.24 },
];

function noise(n: number, seed: number) {
  const r = mulberry32(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = r() - 0.5;
  return out;
}
function standardise(f: Float32Array) {
  let m = 0;
  for (const v of f) m += v;
  m /= f.length;
  let s = 0;
  for (let i = 0; i < f.length; i++) {
    f[i] -= m;
    s += f[i] * f[i];
  }
  const k = 1 / Math.sqrt(s / f.length || 1);
  for (let i = 0; i < f.length; i++) f[i] *= k;
  return f;
}
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Precomputed parts of a model; `combine(a)` applies the perforation without rebuilding. */
/** Link census of a strut model: counts and strut volume (length x mean radius squared) by orientation class. */
export type LinkStats = { vertical: number; oblique: number; transverse: number; volV: number; volO: number; volT: number };
export type ModelBase = { combine: (a: number) => Float32Array; links?: LinkStats };

export function buildModel(id: ModelId, seed: number, d: Dims, k: number, opts: { rung?: number } = {}): ModelBase {
  const N = d[0] * d[1] * d[2];
  if (id === "graph" || id === "columns" || id === "rungs" || id === "hybrid" || id === "braced") return strutGraph(id, seed, d, k, opts.rung ?? 0.5);
  if (id === "tworod") {
    const f1 = makeField(seed, d, [4.6 * k, 4.6, 4.6]);
    const f2 = makeField(seed * 13 + 5, d, [4.6 * k, 4.6, 4.6]);
    return {
      combine: (a) => {
        // tubes along the curves where two random level surfaces cross; perforation breaks some apart
        const g = f1.g;
        const q = new Float32Array(N);
        for (let i = 0; i < N; i++) q[i] = Math.hypot(f1.ay[i], f2.ay[i]) / Math.max(0.5, 1 + 0.1 * a * g[i]);
        return blur3(q, d, [0.6, 0.6, 0.6]);
      },
    };
  }
  if (id === "grf") {
    const f = makeField(seed, d, [4 * k, 4, 4]);
    return {
      combine: (a) => {
        // smooth the signed field (keeps thin plates intact, removes sub-voxel specks), then take |.|
        const q = qField(f, a);
        const sg = blur3(q.signed!, d, [0.6, 0.6, 0.6]);
        const out = new Float32Array(sg.length) as Float32Array & { signed?: Float32Array };
        for (let i = 0; i < sg.length; i++) out[i] = Math.abs(sg[i]);
        out.signed = sg;
        return out;
      },
    };
  }

  // periodic Voronoi: jittered cell centres, ~17 voxels (~1.1 mm) apart
  const cell = id === "plates" ? 17 : 21; // strut models: fewer, longer struts
  const r = mulberry32(seed);
  const nc = [Math.max(2, Math.round(d[0] / (cell * k))), Math.round(d[1] / cell), Math.round(d[2] / cell)];
  const pts: number[] = [];
  for (let z = 0; z < nc[2]; z++)
    for (let y = 0; y < nc[1]; y++)
      for (let x = 0; x < nc[0]; x++)
        pts.push(((x + 0.15 + 0.7 * r()) / nc[0]) * d[0], ((y + 0.15 + 0.7 * r()) / nc[1]) * d[1], ((z + 0.15 + 0.7 * r()) / nc[2]) * d[2]);
  const np = pts.length / 3;
  const P = new Float32Array(N); // F2 - F1: small on cell walls
  const E = new Float32Array(N); // F3 - F1: small on cell edges
  const [nx, ny, nz] = d;
  const hx = nx / 2;
  const hy = ny / 2;
  const hz = nz / 2;
  let o = 0;
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        let f1 = 1e9;
        let f2 = 1e9;
        let f3 = 1e9;
        for (let p = 0; p < np; p++) {
          let dx = x - pts[3 * p];
          let dy = y - pts[3 * p + 1];
          let dz = z - pts[3 * p + 2];
          if (dx > hx) dx -= nx;
          else if (dx < -hx) dx += nx;
          if (dy > hy) dy -= ny;
          else if (dy < -hy) dy += ny;
          if (dz > hz) dz -= nz;
          else if (dz < -hz) dz += nz;
          dx /= k;
          const q = dx * dx + dy * dy + dz * dz;
          if (q < f1) {
            f3 = f2;
            f2 = f1;
            f1 = q;
          } else if (q < f2) {
            f3 = f2;
            f2 = q;
          } else if (q < f3) f3 = q;
        }
        const s1 = Math.sqrt(f1);
        P[o] = Math.sqrt(f2) - s1;
        E[o] = Math.sqrt(f3) - s1;
        o++;
      }
  // low-frequency field (where plates perforate) and fine surface relief
  const g = standardise(blur3(noise(N, seed * 31 + 7), d, [5 * k, 5, 5]));
  const rough = standardise(blur3(noise(N, seed * 17 + 3), d, [1.4, 1.4, 1.4]));

  return {
    combine: (a) => {
      const q = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        let v: number;
        if (id === "plates") v = P[i] / Math.max(0.15, 1 + 0.6 * a * g[i]);
        else if (id === "rods") v = (0.55 * E[i]) / Math.max(0.3, 1 + 0.3 * a * g[i]);
        else {
          // mostly rods; low-frequency patches stay plate-like, fewer as perforation rises
          const m = smooth(-0.5, 0.5, g[i] + 0.55 + (a - 0.85) * 0.7);
          v = P[i] * 1.25 * (1 - m) + 0.55 * E[i] * m;
        }
        q[i] = Math.max(0, v + (id === "plates" ? 0.32 : 0.22) * rough[i]);
      }
      return blur3(q, d, [0.8, 0.8, 0.8]);
    },
  };
}

/**
 * Despeckle at threshold beta (as micro-CT software does): bone particles smaller than
 * `minVox` voxels (26-connected) are pushed into marrow. Returns a new field; the input is untouched.
 */
export function despeckle(q: Float32Array & { signed?: Float32Array }, d: Dims, beta: number, minVox = 300) {
  const [nx, ny, nz] = d;
  const N = q.length;
  const lab = new Int32Array(N);
  const stack = new Int32Array(N);
  const out = Float32Array.from(q) as Float32Array & { signed?: Float32Array };
  const sg = q.signed ? Float32Array.from(q.signed) : null;
  let id = 0;
  for (let s = 0; s < N; s++) {
    if (lab[s] || q[s] >= beta) continue;
    id++;
    let top = 0;
    let n = 0;
    const members: number[] = [];
    stack[top++] = s;
    lab[s] = id;
    while (top) {
      const i = stack[--top];
      n++;
      if (members.length < minVox) members.push(i);
      const z = (i / (nx * ny)) | 0;
      const y = ((i / nx) | 0) % ny;
      const x = i % nx;
      for (let dz = -1; dz <= 1; dz++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            const zz = z + dz;
            if (xx < 0 || yy < 0 || zz < 0 || xx >= nx || yy >= ny || zz >= nz) continue;
            const j = (zz * ny + yy) * nx + xx;
            if (lab[j] || q[j] >= beta) continue;
            lab[j] = id;
            stack[top++] = j;
          }
    }
    if (n < minVox)
      for (const i of members) {
        out[i] = beta * 1.6;
        if (sg) sg[i] = beta * 1.6;
      }
  }
  if (sg) out.signed = sg;
  return out;
}


/**
 * Strut graph: jittered nodes ~0.9 mm apart, each joined to nearby nodes by rods whose radius
 * tapers toward the middle (thicker at the joints, like real trabeculae). The field is the
 * distance to the nearest rod axis divided by that rod's radius, so one threshold scales every
 * rod together. `columns` keeps near-vertical rods thick and makes horizontal ones thin rungs.
 */
function strutGraph(mode: "graph" | "columns" | "rungs" | "hybrid" | "braced", seed: number, d: Dims, k: number, rung = 0.5): ModelBase {
  const hybrid = mode === "hybrid";
  const braced = mode === "braced";
  const columns = mode === "columns" || hybrid || braced;
  const rungs = mode === "rungs";
  const [nx, ny, nz] = d;
  const N = nx * ny * nz;
  const r = mulberry32(seed + (columns ? 101 : rungs ? 211 : 0));
  const sp = 17; // node spacing, voxels (~1.1 mm): fewer, longer struts
  const n = [Math.round(nx / (sp * k)), Math.round(ny / sp), Math.round(nz / sp)];
  const nodes: [number, number, number][] = [];
  for (let z = 0; z < n[2]; z++)
    for (let y = 0; y < n[1]; y++)
      for (let x = 0; x < n[0]; x++)
        {
          const j = hybrid ? 0.9 : 0.6; // hybrid: scatter nodes further off the lattice so bracing is irregular
          const o = (1 - j) / 2;
          nodes.push([((x + o + j * r()) / n[0]) * nx, ((y + o + j * r()) / n[1]) * ny, ((z + o + j * r()) / n[2]) * nz]);
        }
  const wrap = (v: number, L: number) => (v > L / 2 ? v - L : v < -L / 2 ? v + L : v);
  // orientation classes as in the pruning rules: vertical > 0.75, transverse < 0.4, oblique between
  function tally(vert: number, len: number, rad: number) {
    const vol = len * rad * rad;
    if (vert > 0.75) {
      links.vertical++;
      links.volV += vol;
    } else if (vert < 0.4) {
      links.transverse++;
      links.volT += vol;
    } else {
      links.oblique++;
      links.volO += vol;
    }
  }
  type Seg = { a: number[]; b: number[]; r0: number; r1: number };
  const segs: Seg[] = [];
  const links: LinkStats = { vertical: 0, oblique: 0, transverse: 0, volV: 0, volO: 0, volT: 0 };
  const reach = sp * (hybrid ? 1.55 : 1.5);
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = wrap(nodes[j][0] - nodes[i][0], nx);
      const dy = wrap(nodes[j][1] - nodes[i][1], ny);
      const dz = wrap(nodes[j][2] - nodes[i][2], nz);
      const L = Math.hypot(dx / k, dy, dz);
      if (L > reach) continue;
      const vert = Math.abs(dy) / Math.hypot(dx, dy, dz); // 1 = along the y (vertical) axis
      if (braced) {
        // every link draws the same three numbers whatever the retention, so raising it only adds rungs to the same scaffold
        const u = r();
        const j0 = 0.9 + 0.2 * r();
        const j1 = 0.65 + 0.15 * r();
        if (vert > 0.75 ? u > 0.85 : u > rung) continue;
        const base = vert > 0.75 ? 1.15 : 0.7;
        segs.push({ a: nodes[i], b: [nodes[i][0] + dx, nodes[i][1] + dy, nodes[i][2] + dz], r0: base * j0, r1: base * j1 });
        tally(vert, Math.hypot(dx, dy, dz), base * (j0 + j1) / 2);
        continue;
      }
      if (hybrid) {
        // columns as in the columns model; keep most horizontal rungs too, drop most diagonals
        if (vert > 0.75 ? r() > 0.85 : vert < 0.35 ? r() > 0.55 : r() > 0.55) continue; // a mix of columns, obliques and rungs
      } else if (rungs) {
        // keep nearly every horizontal rung, about half the columns, few obliques
        if (vert < 0.4 ? r() > 0.95 : vert > 0.75 ? r() > 0.55 : r() > 0.3) continue;
      } else if (columns ? vert < 0.75 && r() > 0.6 : r() > 0.85) continue; // prune some links
      const base = hybrid
        ? vert > 0.75
          ? 1.15
          : vert < 0.35
            ? 0.75
            : 0.72 + 0.12 * r()
        : rungs
          ? vert < 0.4
            ? 1.05
            : vert > 0.75
              ? 0.8
              : 0.55
          : columns
            ? vert > 0.75
              ? 1.15
              : 0.55
            : 0.75 + 0.5 * r();
      const r0 = base * (0.9 + 0.2 * r());
      const r1 = base * (0.65 + 0.15 * r());
      segs.push({ a: nodes[i], b: [nodes[i][0] + dx, nodes[i][1] + dy, nodes[i][2] + dz], r0, r1 });
      tally(vert, Math.hypot(dx, dy, dz), (r0 + r1) / 2);
    }
  const q = new Float32Array(N).fill(8);
  for (const sg of segs) {
    const [ax, ay, az] = sg.a;
    const bx = sg.b[0] - ax;
    const by = sg.b[1] - ay;
    const bz = sg.b[2] - az;
    const bb = bx * bx + by * by + bz * bz;
    const pad = 6;
    const x0 = Math.floor(Math.min(ax, ax + bx) - pad);
    const x1 = Math.ceil(Math.max(ax, ax + bx) + pad);
    const y0 = Math.floor(Math.min(ay, ay + by) - pad);
    const y1 = Math.ceil(Math.max(ay, ay + by) + pad);
    const z0 = Math.floor(Math.min(az, az + bz) - pad);
    const z1 = Math.ceil(Math.max(az, az + bz) + pad);
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const px = x - ax;
          const py = y - ay;
          const pz = z - az;
          const t = Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / bb));
          const ex = px - bx * t;
          const ey = py - by * t;
          const ez = pz - bz * t;
          const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
          // radius tapers to the middle of the strut (waisted), r0 at the ends
          const rad = sg.r0 + (sg.r1 - sg.r0) * Math.sin(Math.PI * t);
          const v = dist / rad;
          const i = (((z % nz) + nz) % nz) * nx * ny + (((y % ny) + ny) % ny) * nx + (((x % nx) + nx) % nx);
          // smooth union so junctions fillet instead of creasing
          const cur = q[i];
          const kf = 0.35;
          const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (v - cur)) / kf));
          q[i] = v + (cur - v) * h - kf * h * (1 - h);
        }
  }
  const rough = standardise(blur3(noise(N, seed * 7 + 1), d, [1.6, 1.6, 1.6]));
  const g = standardise(blur3(noise(N, seed * 29 + 3), d, [6, 6, 6]));
  return {
    links,
    combine: (a) => {
      const out = new Float32Array(N);
      for (let i = 0; i < N; i++) out[i] = Math.max(0, q[i] * (1 + 0.06 * a * g[i]) + 0.025 * rough[i]);
      return blur3(out, d, [0.6, 0.6, 0.6]);
    },
  };
}
