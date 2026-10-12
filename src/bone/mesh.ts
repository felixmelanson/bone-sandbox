/* =====================================================================
   Naive Surface Nets isosurface extraction.
   One vertex per sign-changing cell, placed at the mean of the edge
   crossings; one quad per sign-changing grid edge.  The field is padded
   with an "outside" value so every strut cut by the specimen boundary
   gets a flat cap, exactly like a sectioned micro-CT specimen.
   Normals come from the analytic field gradient (smooth shading).
   ===================================================================== */

import { sampleTri, type Dims } from "./volume";

export type RawMesh = {
  /** vertex positions in voxel coordinates of the source volume */
  positions: Float32Array;
  /** outward unit normals (pointing out of the meshed phase) */
  normals: Float32Array;
  indices: Uint32Array;
};

const C = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];
const E = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/** Mesh the region where `F > 0`. */
export function surfaceNets(F: Float32Array, d: Dims, pad = -0.6): RawMesh {
  const [nx, ny, nz] = d;
  const X = nx + 2;
  const Y = ny + 2;
  const Z = nz + 2;
  const XY = X * Y;
  const G = new Float32Array(X * Y * Z).fill(pad);
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++) {
      const src = (z * ny + y) * nx;
      const dst = (z + 1) * XY + (y + 1) * X + 1;
      for (let x = 0; x < nx; x++) G[dst + x] = F[src + x];
    }

  const cell = new Int32Array(X * Y * Z).fill(-1);
  const pos: number[] = [];
  const off = C.map(([a, b, c]) => a + b * X + c * XY);
  const v = new Float32Array(8);
  let vc = 0;

  for (let z = 0; z < Z - 1; z++)
    for (let y = 0; y < Y - 1; y++)
      for (let x = 0; x < X - 1; x++) {
        const i = z * XY + y * X + x;
        let mask = 0;
        for (let k = 0; k < 8; k++) {
          v[k] = G[i + off[k]];
          if (v[k] > 0) mask |= 1 << k;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (const [a, b] of E) {
          if (((mask >> a) & 1) === ((mask >> b) & 1)) continue;
          const t = v[a] / (v[a] - v[b]);
          const ca = C[a];
          const cb = C[b];
          sx += ca[0] + t * (cb[0] - ca[0]);
          sy += ca[1] + t * (cb[1] - ca[1]);
          sz += ca[2] + t * (cb[2] - ca[2]);
          n++;
        }
        // back to un-padded voxel coordinates
        pos.push(x + sx / n - 1, y + sy / n - 1, z + sz / n - 1);
        cell[i] = vc++;
      }

  // gradient normals
  const PD: Dims = [X, Y, Z];
  const normals = new Float32Array(pos.length);
  const h = 0.7;
  for (let k = 0; k < vc; k++) {
    const px = pos[3 * k] + 1;
    const py = pos[3 * k + 1] + 1;
    const pz = pos[3 * k + 2] + 1;
    const gx = sampleTri(G, PD, px + h, py, pz) - sampleTri(G, PD, px - h, py, pz);
    const gy = sampleTri(G, PD, px, py + h, pz) - sampleTri(G, PD, px, py - h, pz);
    const gz = sampleTri(G, PD, px, py, pz + h) - sampleTri(G, PD, px, py, pz - h);
    const l = Math.hypot(gx, gy, gz) || 1;
    normals[3 * k] = -gx / l;
    normals[3 * k + 1] = -gy / l;
    normals[3 * k + 2] = -gz / l;
  }

  // quads
  const idx: number[] = [];
  const strides = [1, X, XY];
  const P = [X, Y, Z];
  const c = [0, 0, 0];
  for (let z = 0; z < Z; z++)
    for (let y = 0; y < Y; y++)
      for (let x = 0; x < X; x++) {
        const i = z * XY + y * X + x;
        const in0 = G[i] > 0;
        c[0] = x;
        c[1] = y;
        c[2] = z;
        for (let axis = 0; axis < 3; axis++) {
          if (c[axis] >= P[axis] - 1) continue;
          if (G[i + strides[axis]] > 0 === in0) continue;
          const u = (axis + 1) % 3;
          const w = (axis + 2) % 3;
          if (c[u] < 1 || c[w] < 1) continue;
          const a0 = cell[i];
          const a1 = cell[i - strides[u]];
          const a2 = cell[i - strides[u] - strides[w]];
          const a3 = cell[i - strides[w]];
          if (a0 < 0 || a1 < 0 || a2 < 0 || a3 < 0) continue;
          idx.push(a0, a1, a2, a0, a2, a3);
        }
      }

  // orient every triangle to agree with the field normal
  for (let t = 0; t < idx.length; t += 3) {
    const A = idx[t] * 3;
    const B = idx[t + 1] * 3;
    const Cc = idx[t + 2] * 3;
    const e1x = pos[B] - pos[A];
    const e1y = pos[B + 1] - pos[A + 1];
    const e1z = pos[B + 2] - pos[A + 2];
    const e2x = pos[Cc] - pos[A];
    const e2y = pos[Cc + 1] - pos[A + 1];
    const e2z = pos[Cc + 2] - pos[A + 2];
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    const nx2 = normals[A] + normals[B] + normals[Cc];
    const ny2 = normals[A + 1] + normals[B + 1] + normals[Cc + 1];
    const nz2 = normals[A + 2] + normals[B + 2] + normals[Cc + 2];
    if (cx * nx2 + cy * ny2 + cz * nz2 < 0) {
      const tmp = idx[t + 1];
      idx[t + 1] = idx[t + 2];
      idx[t + 2] = tmp;
    }
  }

  return {
    positions: new Float32Array(pos),
    normals,
    indices: new Uint32Array(idx),
  };
}
