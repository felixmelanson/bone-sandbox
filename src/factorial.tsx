/* =====================================================================
   5.1  Density makes unloading look like ageing.
   ---------------------------------------------------------------------
   Grid of metallic ellipsoids (4 conditions x 6 depth strata) with a
   story stepper and the unloading effect chart underneath.
   Encoding (from the analysis handoff):
     shape   axisymmetric about the vertical depth axis; q = 2 * P2,
             semi-axes sqrt(1 - q) across and sqrt(1 + 2q) along
     colour  condition-mean BV/TV or Tb.Th on the orange-gold-pearl-silver ramp
     rings   each rat's own ellipsoid silhouette; V12 dashed (QC exclusion)
   Cell means are rebuilt from scrutiny.json per_rat_band with V12 removed.
   ===================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import FAC from "./data/factorial_web.json";
import SCR from "./data/scrutiny.json";
import { attachStudio, createRendererIn, destroyRenderer, hasWebGL, markStudio } from "./bone/views";
import { disposeScene } from "./bone/dispose";
import { Seg } from "./ui";
import { reducedMotion, tween } from "./utils/tween";

/* ------------------------------- data ------------------------------- */

type RatBand = (typeof SCR.per_rat_band)[number];
const GROUPS = FAC.groups as { loading: string; diet: string; label: string }[];
const STRATA = FAC.strata_mm as [number, number][];
const PALETTE = FAC.palette_bvtv.map((h) => new THREE.Color(h));
const BV_RANGE: [number, number] = [0.04, 0.42];
const TB_RANGE: [number, number] = [100, 155];
const GAIN = 2;

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const ratsOf = (load: string, diet: string, s: number) => SCR.per_rat_band.filter((r) => r.load === load && r.diet === diet && r.stratum === s);

type Cell = { row: number; col: number; P2: number; bvtv: number; tbth: number; rats: RatBand[] };
/** Condition means with QC-excluded rats removed from every metric; orientation-flagged strata left out of P2. */
const CELLS: Cell[][] = GROUPS.map((g, row) =>
  STRATA.map((_, col) => {
    const all = ratsOf(g.loading, g.diet, col + 1);
    const ok = all.filter((r) => !r.qc_exclude);
    return {
      row,
      col,
      P2: mean(ok.filter((r) => r.P2_far !== null && !r.orientation_flag).map((r) => r.P2_far as number)),
      bvtv: mean(ok.map((r) => r.bvtv)),
      tbth: mean(ok.map((r) => r.tbth_um)),
      rats: all,
    };
  })
);

/** Hedges g (HLU minus AMB, V12 out) with an approximate 95% CI from the group sizes. */
function effect(metric: "P2_far" | "frac_transverse" | "da" | "bvtv") {
  const g = SCR.hedges_g_HLU_minus_AMB[metric] as Record<string, number>;
  return STRATA.map((_, i) => {
    const s = i + 1;
    const orient = metric === "P2_far" || metric === "frac_transverse";
    const n = (load: string) =>
      SCR.per_rat_band.filter((r) => r.load === load && r.stratum === s && !r.qc_exclude && (!orient || (r.P2_far !== null && !r.orientation_flag))).length;
    const n1 = n("AMB");
    const n2 = n("HLU");
    const v = g[String(s)];
    const se = Math.sqrt((n1 + n2) / (n1 * n2) + (v * v) / (2 * (n1 + n2)));
    return { g: v, lo: v - 1.96 * se, hi: v + 1.96 * se };
  });
}

/* ------------------------------ layout ------------------------------ */

const NCOL = 6;
const NROW = 4;
const DY = 0.72;
const BASE = 0.19;
const AXIS_H = 0.42; // room under the rows for the bone-age axis
const HALF_W = NCOL / 2;
const GRID_H = NROW * DY;
const VIEW_H = GRID_H + AXIS_H;
const colX = (c: number) => c - (NCOL - 1) / 2;
const rowY = (r: number) => GRID_H / 2 - (r + 0.5) * DY;

/** HLU depth d sits where AMB depth 1.93 d does (growth during unloading 0.90 vs 1.74 mm). */
const AGE = 1.93;
const ageCol = (c: number) => (AGE * (0.25 + 0.5 * c) - 0.25) / 0.5;

/** The pair compared in steps 1 and 2: HLU-HP S2 and AMB-HP S5. */
const SPOT = [
  { row: 2, col: 1 },
  { row: 0, col: 4 },
];

function ramp(t: number, out = new THREE.Color()) {
  const x = Math.min(1, Math.max(0, t)) * (PALETTE.length - 1);
  const i = Math.min(PALETTE.length - 2, Math.floor(x));
  return out.copy(PALETTE[i]).lerp(PALETTE[i + 1], x - i);
}
const rampCss = `linear-gradient(to top, ${FAC.palette_bvtv.join(", ")})`;
const tBV = (v: number) => (v - BV_RANGE[0]) / (BV_RANGE[1] - BV_RANGE[0]);
const tTB = (v: number) => (v - TB_RANGE[0]) / (TB_RANGE[1] - TB_RANGE[0]);

function axes(p2: number) {
  const q = Math.max(-0.49, Math.min(0.99, GAIN * p2));
  return [BASE * Math.sqrt(1 - q), BASE * Math.sqrt(1 + 2 * q)] as const;
}
const sub = (n: number) => String.fromCharCode(0x2080 + n);

/* --------------------------- story state ---------------------------- */

type Step = 1 | 2 | 3 | "explore";
const STEPS: { v: Step; t: string }[] = [
  { v: 1, t: "1 Density" },
  { v: 2, t: "2 Thickness" },
  { v: 3, t: "3 Same age" },
  { v: "explore", t: "Explore" },
];
const CAPTIONS: Record<string, string> = {
  1: "Colour by density and unloaded bone just under the growth plate looks like ambulatory bone two millimetres deeper. Just as sparse, just as tall. Read this way, unloading is ageing on fast-forward.",
  2: "Colour by thickness and the match falls apart. Deep ambulatory bone is ordered and thick: fewer, sturdier columns. Unloaded bone is just as ordered while its struts are a quarter thinner. Different bone that happens to share a density.",
  3: "Line the rows up by when the bone was made rather than where it sits. The unloaded rows now compare against ambulatory bone of the same age. Every unloaded cell is taller and thinner than the nearest ambulatory cell above it.",
  explore: "Explore freely: switch the colour beside the legend, or the depth axis between fixed depth and bone age.",
};

/** Animated view state shared between React and the render loop. */
type Live = { mix: number; spot: number; age: number[]; col: number | null; colDim: number[] };

/* ------------------------------ 3-D grid ---------------------------- */

/** Instanced metallic ellipsoids with a per-instance opacity attribute. */
class Grid {
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-HALF_W, HALF_W, GRID_H / 2, GRID_H / 2 - VIEW_H, 0.1, 50);
  mesh: THREE.InstancedMesh;
  private op: THREE.InstancedBufferAttribute;
  rings = new THREE.Group();
  private q = Array.from({ length: NROW * NCOL }, () => new THREE.Quaternion());
  private m = new THREE.Matrix4();

  constructor() {
    this.camera.position.set(0, 0, 10);
    this.camera.lookAt(0, 0, 0);
    markStudio(this.scene);
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(-2, 3, 4);
    this.scene.add(key);
    const mat = new THREE.MeshPhysicalMaterial({
      metalness: 0.9,
      roughness: 0.25,
      clearcoat: 0.4,
      clearcoatRoughness: 0.15,
      iridescence: 0.3,
      iridescenceIOR: 1.3,
      envMapIntensity: 1.15,
      transparent: true,
    });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float aOp;\nvarying float vOp;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvOp = aOp;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vOp;")
        .replace("vec4 diffuseColor = vec4( diffuse, opacity );", "vec4 diffuseColor = vec4( diffuse, opacity * vOp );");
    };
    const geo = new THREE.SphereGeometry(1, 64, 48);
    this.op = new THREE.InstancedBufferAttribute(new Float32Array(NROW * NCOL).fill(1), 1);
    geo.setAttribute("aOp", this.op);
    this.mesh = new THREE.InstancedMesh(geo, mat, NROW * NCOL);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < NROW * NCOL; i++) this.mesh.setColorAt(i, new THREE.Color(1, 1, 1));
    this.scene.add(this.mesh, this.rings);
  }

  /** Per-cell current x (column units), opacity and scale, for the overlay. */
  state: { x: number; op: number; s: number }[] = Array.from({ length: NROW * NCOL }, () => ({ x: 0, op: 1, s: 1 }));

  frame(live: Live, aim: [number, number] | null, still: boolean) {
    let moving = false;
    const col = new THREE.Color();
    const c2 = new THREE.Color();
    this.rings.clear();
    const fwd = new THREE.Vector3(0, 0, 1);
    for (let r = 0; r < NROW; r++)
      for (let c = 0; c < NCOL; c++) {
        const i = r * NCOL + c;
        const cell = CELLS[r][c];
        const hlu = r >= 2;
        const xc = hlu ? c + (ageCol(c) - c) * live.age[c] : c;
        const fade = Math.min(1, Math.max(0, (5.65 - xc) / 0.45));
        const spotOn = SPOT.some((p) => p.row === r && p.col === c);
        const op = (1 - live.spot * (spotOn ? 0 : 0.7)) * fade * live.colDim[c];
        const s = fade;
        this.state[i] = { x: xc, op, s };

        // orientation: every ellipsoid tilts together toward the cursor; idle sway otherwise
        let target: THREE.Quaternion;
        if (still) target = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.17, -0.35, 0));
        else if (aim) target = new THREE.Quaternion().setFromUnitVectors(fwd, new THREE.Vector3(aim[0] * 0.5, aim[1] * 0.5, 3).normalize());
        else target = REST;
        const q = this.q[i];
        if (q.angleTo(target) > 1e-3) moving = true;
        q.slerp(target, still ? 1 : 0.08);

        // colour: cross-fade BV/TV to Tb.Th, desaturate outside the spotlight
        ramp(tBV(cell.bvtv), col);
        ramp(tTB(cell.tbth), c2);
        col.lerp(c2, live.mix);
        if (!spotOn && live.spot > 0) {
          const hsl = { h: 0, s: 0, l: 0 };
          col.getHSL(hsl);
          col.setHSL(hsl.h, hsl.s * (1 - 0.4 * live.spot), hsl.l);
        }
        this.mesh.setColorAt(i, col);
        this.op.setX(i, op);

        const p2 = Number.isFinite(cell.P2) ? cell.P2 : 0;
        const [a, b] = axes(p2);
        const x = colX(xc);
        const y = rowY(r);
        this.m.compose(new THREE.Vector3(x, y, 1), q, new THREE.Vector3(a * s + 1e-5, b * s + 1e-5, a * s + 1e-5));
        this.mesh.setMatrixAt(i, this.m);

        // per-rat silhouettes at this cell's tilt; V12 dashed
        if (op > 0.02) {
          const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
          const ct = Math.abs(up.y);
          for (const rat of cell.rats) {
            if (rat.P2_far === null || (rat.orientation_flag && !rat.qc_exclude)) continue;
            const [ra, rb] = axes(rat.P2_far);
            const h = Math.sqrt(rb * rb * ct * ct + ra * ra * (1 - ct * ct)) * s;
            const ring = new THREE.LineLoop(rat.qc_exclude ? DASHED : UNIT, ringMat(op, rat.qc_exclude));
            ring.position.set(x, y, -2);
            ring.rotation.z = Math.atan2(-up.x, up.y);
            ring.scale.set(ra * s, h, 1);
            this.rings.add(ring);
          }
        }
      }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.op.needsUpdate = true;
    return moving;
  }
}

const REST = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, -0.2, 0));
const circle = (n: number) => Array.from({ length: n }, (_, k) => new THREE.Vector3(Math.cos((k / n) * Math.PI * 2), Math.sin((k / n) * Math.PI * 2), 0));
const UNIT = new THREE.BufferGeometry().setFromPoints(circle(96));
const DASHED = new THREE.BufferGeometry().setFromPoints(circle(96));
new THREE.LineLoop(DASHED).computeLineDistances();
/** Ring materials cached per opacity step (solid rats, dashed V12). */
const RING_MATS = new Map<string, THREE.LineBasicMaterial>();
function ringMat(op: number, dashed: boolean) {
  const k = `${dashed ? "d" : "s"}${Math.round(op * 20)}`;
  let m = RING_MATS.get(k);
  if (!m) {
    const o = Math.round(op * 20) / 20;
    m = dashed
      ? new THREE.LineDashedMaterial({ color: 0x8a8d92, dashSize: 0.16, gapSize: 0.12, transparent: true, opacity: o })
      : new THREE.LineBasicMaterial({ color: 0xc2c6cc, transparent: true, opacity: o });
    RING_MATS.set(k, m);
  }
  return m;
}

/* ------------------------------ overlay ----------------------------- */

/** World (column units, row) to canvas pixels. */
const toPx = (xCol: number, y: number, w: number, h: number) => [((colX(xCol) + HALF_W) / NCOL) * w, ((GRID_H / 2 - y) / VIEW_H) * h] as const;

function drawOverlay(ctx: CanvasRenderingContext2D, grid: Grid, live: Live, w: number, h: number) {
  const fs = Math.max(10, w * 0.0135);
  // P2 value under each ellipsoid
  ctx.font = `${fs}px Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  for (let r = 0; r < NROW; r++)
    for (let c = 0; c < NCOL; c++) {
      const st = grid.state[r * NCOL + c];
      if (st.op < 0.05) continue;
      const v = CELLS[r][c].P2;
      const [x, y] = toPx(st.x + 0.2, rowY(r) - DY * 0.36, w, h);
      ctx.fillStyle = `rgba(118,121,126,${st.op})`;
      ctx.fillText(Number.isFinite(v) ? v.toFixed(2) : "-", x, y);
    }

  // spotlight connector and labels
  if (live.spot > 0.01) {
    const [A, B] = SPOT.map((p) => toPx(p.col, rowY(p.row), w, h));
    ctx.save();
    ctx.globalAlpha = live.spot;
    ctx.strokeStyle = "#76797E";
    ctx.lineWidth = Math.max(1, w / 900);
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(A[0] + w * 0.035, A[1] - h * 0.02);
    ctx.quadraticCurveTo((A[0] + B[0]) / 2, Math.min(A[1], B[1]) - h * 0.02, B[0] - w * 0.035, B[1] + h * 0.03);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `${fs * 1.05}px Arial, sans-serif`;
    ctx.fillStyle = "#1C1C1E";
    SPOT.forEach((p, k) => {
      const cell = CELLS[p.row][p.col];
      const [x, y] = toPx(p.col, rowY(p.row) - DY * 0.47, w, h);
      ctx.textAlign = "center";
      const a = `P₂ ${cell.P2.toFixed(2)} · BV/TV ${cell.bvtv.toFixed(2)}`;
      const b = `${Math.round(cell.tbth * live.mix)} µm`;
      ctx.globalAlpha = live.spot * (1 - live.mix);
      ctx.fillText(a, x, y + (k === 0 ? fs * 0.2 : 0));
      ctx.globalAlpha = live.spot * live.mix;
      ctx.fillText(b, x, y + (k === 0 ? fs * 0.2 : 0));
    });
    ctx.restore();
  }

  // bone-age axis under the unloaded rows
  const ag = Math.min(...live.age);
  if (ag > 0.01) {
    ctx.save();
    ctx.globalAlpha = ag;
    const y0 = ((GRID_H + AXIS_H * 0.25) / VIEW_H) * h;
    const xs = (d: number) => toPx((AGE * d - 0.25) / 0.5, 0, w, h)[0];
    ctx.strokeStyle = "#76797E";
    ctx.fillStyle = "#76797E";
    ctx.lineWidth = Math.max(1, w / 900);
    ctx.beginPath();
    ctx.moveTo(xs(0), y0);
    ctx.lineTo(Math.min(w, xs(1.55)), y0);
    ctx.stroke();
    ctx.font = `${fs}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const d of [0, 0.5, 1, 1.5]) {
      const x = xs(d);
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y0 + fs * 0.45);
      ctx.stroke();
      ctx.textAlign = d === 0 ? "left" : "center";
      ctx.fillText(`${d.toFixed(1)} mm`, x, y0 + fs * 0.6);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("depth in unloaded rats", w - fs * 0.3, y0 - fs * 0.25);
    ctx.restore();
  }
}

/* ----------------------------- component ---------------------------- */

function GridView({ live, dimRow }: { live: React.MutableRefObject<Live>; dimRow: number | null }) {
  const host = useRef<HTMLDivElement>(null);
  const ov = useRef<HTMLCanvasElement>(null);
  const grid = useMemo(() => new Grid(), []);
  const kick = useRef<() => void>(() => {});
  useEffect(() => {
    kick.current();
  });

  useEffect(() => {
    const hEl = host.current;
    const o = ov.current;
    if (!hEl || !o || !hasWebGL()) return;
    const r = createRendererIn(hEl, "absolute inset-0 block h-full w-full");
    if (!r) return;
    const c = r.domElement;
    attachStudio(grid.scene, r);
    let raf = 0;
    let visible = false;
    let aim: [number, number] | null = null;
    let size = "";
    let lastLive = "";
    const still = reducedMotion();
    const draw = () => {
      const box = c.getBoundingClientRect();
      if (!box.width) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const key = `${box.width}x${box.height}@${dpr}`;
      if (key !== size) {
        size = key;
        r.setPixelRatio(dpr);
        r.setSize(box.width, box.height, false);
        o.width = Math.round(box.width * dpr);
        o.height = Math.round(box.height * dpr);
      }
      r.render(grid.scene, grid.camera);
      const ctx = o.getContext("2d")!;
      ctx.clearRect(0, 0, o.width, o.height);
      drawOverlay(ctx, grid, live.current, o.width, o.height);
    };
    const frame = () => {
      raf = 0;
      if (!visible) return;
      const L = live.current;
      const sig = `${L.mix.toFixed(4)}|${L.spot.toFixed(4)}|${L.age.map((a) => a.toFixed(4)).join(",")}|${L.colDim.map((a) => a.toFixed(3)).join(",")}`;
      const tweening = sig !== lastLive;
      lastLive = sig;
      const moving = grid.frame(L, aim, still);
      draw();
      // redraw only while the cursor moves or a transition is running; otherwise the grid is idle
      if (moving || tweening) raf = requestAnimationFrame(frame);
    };
    const go = () => {
      if (visible && !raf) raf = requestAnimationFrame(frame);
    };
    kick.current = go;
    const move = (e: PointerEvent) => {
      const b = c.getBoundingClientRect();
      aim = [(((e.clientX - b.left) / b.width) * 2 - 1) * HALF_W, (1 - ((e.clientY - b.top) / b.height) * 2) * (VIEW_H / 2)];
      go();
    };
    const leave = () => {
      aim = null;
      go();
    };
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerleave", leave);
    const ro = new ResizeObserver(go);
    ro.observe(c);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) go();
      else {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    });
    io.observe(c);
    return () => {
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerleave", leave);
      ro.disconnect();
      io.disconnect();
      cancelAnimationFrame(raf);
      disposeScene(grid.scene);
      destroyRenderer(r);
    };
  }, [grid, live]);

  return (
    <div className="relative" style={{ aspectRatio: `${NCOL} / ${VIEW_H}` }}>
      {Array.from({ length: NROW - 1 }, (_, i) => (
        <div key={i} className="pointer-events-none absolute inset-x-0 border-t border-[#E8E8E8]" style={{ top: `${(((i + 1) * DY) / VIEW_H) * 100}%` }} />
      ))}
      {dimRow !== null && (
        <div
          className="pointer-events-none absolute inset-x-0 bg-white/70"
          style={{ top: 0, height: `${(GRID_H / VIEW_H) * 100}%`, clipPath: `polygon(0 0, 100% 0, 100% ${(dimRow / NROW) * 100}%, 0 ${(dimRow / NROW) * 100}%, 0 ${((dimRow + 1) / NROW) * 100}%, 100% ${((dimRow + 1) / NROW) * 100}%, 100% 100%, 0 100%)` }}
        />
      )}
      <div ref={host} className="absolute inset-0" role="img" aria-label="Grid of metallic ellipsoids: rows are conditions, columns are depth strata; taller means struts run more along the depth axis, colour is BV/TV or Tb.Th" />
      <canvas ref={ov} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
    </div>
  );
}

/* ------------------------------- chart ------------------------------ */

const SERIES = [
  { key: "P2_far" as const, name: "P₂far (order about depth)", color: "#B07A22", width: 3 },
  { key: "frac_transverse" as const, name: "transverse strut fraction", color: "#5B5F66", width: 1.6 },
  { key: "da" as const, name: "DA (conventional fabric)", color: "#A9AFB7", width: 1.6 },
  { key: "bvtv" as const, name: "BV/TV", color: "#C9A97C", width: 1.6 },
];
const EFFECTS = Object.fromEntries(SERIES.map((s) => [s.key, effect(s.key)]));

function EffectChart({ stratum, setStratum }: { stratum: number | null; setStratum: (s: number | null) => void }) {
  const W = 640;
  const H = 300;
  const m = { l: 58, r: 16, t: 14, b: 36 };
  const yMin = -5.5;
  const yMax = 5;
  const X = (s: number) => m.l + ((s + 0.5) / NCOL) * (W - m.l - m.r);
  const Y = (g: number) => m.t + ((yMax - g) / (yMax - yMin)) * (H - m.t - m.b);
  const off = [-0.12, -0.04, 0.04, 0.12];
  const colW = (W - m.l - m.r) / NCOL;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_200px]">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Hedges g of unloading minus ambulatory at each stratum with 95% confidence intervals" onPointerLeave={() => setStratum(null)}>
        {stratum !== null && <rect x={X(stratum) - colW / 2} y={m.t} width={colW} height={H - m.t - m.b} fill="#f5f5f4" />}
        {[-4, -2, 0, 2, 4].map((g) => (
          <g key={g}>
            <line x1={m.l - 4} x2={m.l} y1={Y(g)} y2={Y(g)} stroke="#1C1C1E" />
            <text x={m.l - 8} y={Y(g)} textAnchor="end" dominantBaseline="middle" fontSize="12" fill="#1C1C1E">
              {g < 0 ? `−${-g}` : g}
            </text>
          </g>
        ))}
        <line x1={m.l} x2={W - m.r} y1={Y(0)} y2={Y(0)} stroke="#BDBDBD" />
        <line x1={m.l} x2={m.l} y1={m.t} y2={H - m.b} stroke="#1C1C1E" />
        <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} stroke="#1C1C1E" />
        <text transform={`translate(14 ${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle" fontSize="11.5" fill="#1C1C1E">
          unloaded minus ambulatory (Hedges g, 95% CI)
        </text>
        {STRATA.map((_, s) => (
          <text key={s} x={X(s)} y={H - m.b + 20} textAnchor="middle" fontSize="13" fontStyle="italic" fill="#1C1C1E">
            S{sub(s + 1)}
          </text>
        ))}
        {[...SERIES].reverse().map((ser) => {
          const k = SERIES.indexOf(ser);
          const e = EFFECTS[ser.key];
          const pts = e.map((p, s) => [X(s) + off[k] * colW, Y(p.g)] as const);
          return (
            <g key={ser.key}>
              {pts.map(([x], s) => (
                <line key={s} x1={x} x2={x} y1={Y(e[s].lo)} y2={Y(e[s].hi)} stroke={ser.color} strokeWidth={1.4} />
              ))}
              <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={ser.color} strokeWidth={ser.width} />
              {pts.map(([x, y], s) => (
                <circle key={s} cx={x} cy={y} r={ser.width > 2 ? 5 : 4} fill={ser.color} />
              ))}
            </g>
          );
        })}
        {STRATA.map((_, s) => (
          <rect key={s} x={X(s) - colW / 2} y={m.t} width={colW} height={H - m.t - m.b} fill="transparent" onPointerEnter={() => setStratum(s)} />
        ))}
      </svg>
      <ul className="space-y-1.5 self-center text-[12.5px] text-[#1C1C1E]">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <svg width="26" height="10" aria-hidden="true">
              <line x1="0" x2="26" y1="5" y2="5" stroke={s.color} strokeWidth={s.width} />
              <circle cx="13" cy="5" r="3.5" fill={s.color} />
            </svg>
            {s.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------ legend ------------------------------ */

function ShapeIcon({ p2 }: { p2: number }) {
  const [a, b] = axes(p2);
  return (
    <svg width="34" height="46" viewBox="-0.45 -0.5 0.9 1" aria-hidden="true">
      <defs>
        <radialGradient id={`sh${p2}`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#f5f5f5" />
          <stop offset="0.45" stopColor="#9a9a9a" />
          <stop offset="1" stopColor="#3f3f3f" />
        </radialGradient>
      </defs>
      <ellipse rx={a * 1.15} ry={b * 1.15} fill={`url(#sh${p2})`} />
    </svg>
  );
}

function Ticks({ by, opacity }: { by: "bvtv" | "tbth"; opacity: number }) {
  const [lo, hi] = by === "bvtv" ? BV_RANGE : TB_RANGE;
  const ticks = by === "bvtv" ? [0.1, 0.2, 0.3, 0.4] : [110, 125, 140, 155];
  return (
    <div className="absolute inset-0" style={{ opacity }}>
      {ticks.map((t) => (
        <span key={t} className="num absolute -translate-y-1/2 whitespace-nowrap text-[11px]" style={{ top: `${(1 - (t - lo) / (hi - lo)) * 100}%` }}>
          - {by === "bvtv" ? t.toFixed(1) : t}
        </span>
      ))}
    </div>
  );
}

function Legend({ mix, colorBy, setColorBy }: { mix: number; colorBy: "bvtv" | "tbth"; setColorBy: (v: "bvtv" | "tbth") => void }) {
  return (
    <div className="space-y-4 text-[12px] text-[#1C1C1E]">
      <div>
        <p className="font-bold">shape</p>
        <div className="mt-1 flex items-center gap-2">
          <ShapeIcon p2={0} />
          <span>random, P₂ = 0</span>
        </div>
        <div className="flex items-center gap-2">
          <ShapeIcon p2={0.25} />
          <span>P₂ = 0.25</span>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-[#76797E]">taller = struts run more along depth; shape exaggerated 2×</p>
      </div>
      <div>
        <p className="font-bold">colour</p>
        <div className="mt-1.5 flex items-start gap-3">
          <div className="flex h-[110px] gap-1.5">
            <div className="w-3 rounded-sm" style={{ background: rampCss }} />
            <div className="relative w-12">
              <Ticks by="bvtv" opacity={1 - mix} />
              <Ticks by="tbth" opacity={mix} />
            </div>
          </div>
          <div className="flex flex-col gap-1" role="radiogroup" aria-label="Colour by">
            {(["bvtv", "tbth"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={colorBy === v}
                onClick={() => setColorBy(v)}
                className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${colorBy === v ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 text-stone-600 hover:bg-stone-100"}`}
              >
                {v === "bvtv" ? "BV/TV" : "Tb.Th µm"}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ section ----------------------------- */

export function FactorialSection() {
  const [step, setStep] = useState<Step>(1);
  const [colorBy, setColorBy] = useState<"bvtv" | "tbth">("bvtv");
  const [boneAge, setBoneAge] = useState(false);
  const [mix, setMix] = useState(0);
  const [rowHover, setRowHover] = useState<number | null>(null);
  const [chartStratum, setChartStratum] = useState<number | null>(null);
  const live = useRef<Live>({ mix: 0, spot: 1, age: Array(NCOL).fill(0), col: null, colDim: Array(NCOL).fill(1) });
  const sec = useRef<HTMLElement>(null);
  const cancels = useRef<(() => void)[]>([]);

  // what each step implies
  const spotlight = step === 1 || step === 2;
  const wantColor = step === 1 ? "bvtv" : step === 2 || step === 3 ? "tbth" : colorBy;
  const wantAge = step === 3 ? true : step === "explore" ? boneAge : false;

  useEffect(() => {
    const L = live.current;
    cancels.current.forEach((c) => c());
    cancels.current = [
      tween(L.mix, wantColor === "tbth" ? 1 : 0, 700, (v) => {
        L.mix = v;
        setMix(v);
      }),
      tween(L.spot, spotlight ? 1 : 0, 400, (v) => (L.spot = v)),
      ...Array.from({ length: NCOL }, (_, c) => tween(L.age[c], wantAge ? 1 : 0, 900, (v) => (L.age[c] = v), { delay: c * 60 })),
    ];
  }, [wantColor, spotlight, wantAge]);

  // chart hover dims the other columns
  useEffect(() => {
    const L = live.current;
    const c = Array.from({ length: NCOL }, (_, k) => tween(L.colDim[k], chartStratum === null || chartStratum === k ? 1 : 0.3, 250, (v) => (L.colDim[k] = v)));
    return () => c.forEach((f) => f());
  }, [chartStratum]);

  // keyboard: left/right step through the story while the section is on screen
  const order = STEPS.map((s) => s.v);
  const go = useCallback((d: number) => setStep((s) => order[Math.max(0, Math.min(order.length - 1, order.indexOf(s) + d))]), [order]);
  useEffect(() => {
    let inView = false;
    const io = new IntersectionObserver(([e]) => (inView = e.isIntersecting), { threshold: 0.3 });
    if (sec.current) io.observe(sec.current);
    const key = (e: KeyboardEvent) => {
      if (!inView || (e.target as HTMLElement).closest("input, [role=slider], textarea")) return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", key);
    return () => {
      io.disconnect();
      window.removeEventListener("keydown", key);
    };
  }, [go]);

  const explore = () => setStep("explore");

  return (
    <section ref={sec} id="p2-far" aria-labelledby="p2-far-t" className="row-full">
      <h3 id="p2-far-t">
        <span className="secnum">5.1</span>
        Density makes unloading look like ageing
      </h3>
      <p className="abbr">Strut order about the depth axis, P₂far, by condition and depth</p>
      <div className="prose two-col">
        <p>
          Every ellipsoid summarises thousands of trabecular struts in one 500 µm layer of bone, measured from the growth plate down. A sphere means the
          struts point every which way. The taller it gets, the more the struts run along the depth axis, away from the plate. Colour is how much bone
          is there, or how thick it is.
        </p>
        <p>
          Ambulatory rats start almost random just under the plate and organise with depth. Unloaded rats are the reverse: the layers nearest the plate
          are the most aligned, and the most depleted. Their struts aren't growing in a new direction; the ones that ran across were removed, and the ones
          running along depth survived. Conventional fabric anisotropy (DA), the standard measure, barely registers the change.
        </p>
      </div>

      <figure className="mt-6">
        {/* story stepper */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button type="button" aria-label="Previous step" onClick={() => go(-1)} className="h-8 w-8 rounded-full border border-stone-300 text-stone-700 hover:bg-stone-100">
            ‹
          </button>
          <Seg label="Story step" value={String(step) as "1" | "2" | "3" | "explore"} onChange={(v) => setStep(v === "explore" ? "explore" : (+v as 1 | 2 | 3))} options={STEPS.map((s) => ({ v: String(s.v) as "1" | "2" | "3" | "explore", t: s.t }))} />
          <button type="button" aria-label="Next step" onClick={() => go(1)} className="h-8 w-8 rounded-full border border-stone-300 text-stone-700 hover:bg-stone-100">
            ›
          </button>
          {step === "explore" && (
            <Seg label="Depth axis" value={boneAge ? "age" : "fixed"} onChange={(v) => setBoneAge(v === "age")} options={[{ v: "fixed", t: "Depth: fixed" }, { v: "age", t: "Depth: bone age" }]} />
          )}
        </div>
        <p className="mb-4 min-h-[3.2em] max-w-[90ch] text-[14px] leading-relaxed text-[#1C1C1E]" aria-live="polite">
          {CAPTIONS[String(step)]}
        </p>

        <div className="mx-auto grid max-w-[1000px] grid-cols-[130px_minmax(0,1fr)] gap-x-3 xl:grid-cols-[130px_minmax(0,1fr)_170px]">
          <div />
          <div className="grid grid-cols-6 pb-1 text-center">
            {STRATA.map(([a, b], s) => (
              <div key={s} className={`transition-opacity ${chartStratum !== null && chartStratum !== s ? "opacity-30" : ""}`}>
                <p className="text-[15px] italic text-[#1C1C1E]">S{sub(s + 1)}</p>
                <p className="num text-[11px] text-[#76797E]">
                  {a.toFixed(1)}-{b.toFixed(1)} mm
                </p>
              </div>
            ))}
          </div>
          <div className="hidden xl:block" />

          <div className="relative">
            <div className="absolute inset-x-0 top-0 grid" style={{ height: `${(GRID_H / VIEW_H) * 100}%`, gridTemplateRows: `repeat(${NROW}, 1fr)` }}>
              {GROUPS.map((g, r) => (
                <div
                  key={r}
                  onPointerEnter={() => setRowHover(r)}
                  onPointerLeave={() => setRowHover(null)}
                  className={`flex cursor-default flex-col justify-center border-t border-[#E8E8E8] first:border-t-0 transition-opacity ${rowHover !== null && rowHover !== r ? "opacity-30" : ""}`}
                >
                  <p className="text-[14px] font-bold leading-tight text-[#1C1C1E]">{g.loading === "AMB" ? "Ambulatory" : "Unloaded"}</p>
                  <p className="text-[12px] text-[#76797E]">{g.diet === "HP" ? "high phosphate" : "normal phosphate"}</p>
                </div>
              ))}
            </div>
          </div>
          <GridView live={live} dimRow={rowHover} />
          <div className="col-span-2 mt-4 xl:col-span-1 xl:mt-0">
            <Legend
              mix={mix}
              colorBy={wantColor}
              setColorBy={(v) => {
                setColorBy(v);
                setBoneAge(wantAge);
                explore();
              }}
            />
          </div>
        </div>

        <h4 className="mt-10 text-[15px] font-bold text-[#1C1C1E]">Effect of unloading at each depth</h4>
        <div className="mt-3">
          <EffectChart stratum={chartStratum} setStratum={setChartStratum} />
        </div>

        <p className="mt-4 max-w-[90ch] text-[12px] leading-relaxed text-[#76797E]">
          Male right tibiae, 5 rats per condition (4 unloaded normal phosphate after V12 was excluded for segmentation QC; its own ellipsoid is the dashed
          ring), production 10 µm micro-CT run. Shape exaggerated 2×. Strata whose orientation estimate was flagged unreliable are left out. Effect sizes
          are descriptive; group inference uses the rat-level permutation test.
        </p>
        <figcaption>
          <b>Figure 7.</b> Top: one ellipsoid per condition and depth stratum; height encodes P₂far, colour encodes the condition mean of BV/TV or Tb.Th,
          grey rings are individual rats. Bottom: Hedges g of unloaded minus ambulatory at each stratum with 95% confidence intervals; hover a stratum to
          isolate it in the grid.
        </figcaption>
      </figure>
    </section>
  );
}
