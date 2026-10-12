/* =====================================================================
   Shared state and computation for the three layout concepts.
   One hook returns everything a concept draws, so the three files
   differ only in layout, never in behaviour.
   ===================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import SCR from "../data/scrutiny.json";
import { SP_RAMP, TH_RAMP } from "../bone/colormap";
import {
  betaForBV,
  binarize,
  bvForBeta,
  connectivity,
  eigSym3,
  gradTensor,
  phaseStats,
  renderCoronal,
  renderSlice,
  sampleWrap,
  shadeBinary,
  shadeGrey,
  shadeLT,
  sortedCopy,
  VOX_MM,
  type QField,
} from "../bone/engine";
import { clearGroup, drawMILFace, drawSVD, faceSection, milFace, milFaceRose, svdFace } from "../bone/fabric3d";
import { buildModel, MODELS, type ModelBase, type ModelId } from "../bone/models";
import { buildNematic, drawFabric, FieldScene, type FieldStats } from "../panels-b";
import { coronalOutline, planeOutline, VolumeScene, type Viewable } from "../bone/raymarch";
import { localThickness, smoothInPhase, type Dims } from "../bone/volume";
import { METRICS } from "../text";
import { schedule, useDebounced, useRaster, type Raster } from "../ui";
import { reducedMotion } from "../utils/tween";

/* ------------------------------ constants ---------------------------- */

export const D: Dims = [64, 64, 64];
const SEED = 2203;
const R = 220; // section raster
const TV = D[0] * D[1] * D[2] * VOX_MM ** 3;
const L_MM = D[0] * VOX_MM;

export type MetricId = "bv-tv" | "conn-d" | "tb-th" | "tb-sp" | "da" | "ef";
export type FabMode = "gst" | "mil" | "svd";
export type SidebarTab = "about" | "readouts" | "context";

export type MetricMeta = {
  id: MetricId;
  num: string;
  sym: string;
  name: string;
  /** one plain sentence, for the rail and the spotlight */
  blurb: string;
  legend?: "thickness" | "separation" | "metal";
};

export const METRIC_ORDER: MetricMeta[] = [
  { id: "bv-tv", num: "3.1", sym: "BV/TV", name: "Bone volume fraction", blurb: "Share of the volume that is bone." },
  { id: "conn-d", num: "3.2", sym: "Conn.D", name: "Connectivity density", blurb: "Redundant loops in the trabecular network." },
  { id: "tb-th", num: "3.3", sym: "Tb.Th", name: "Trabecular thickness", blurb: "Local thickness inside each strut.", legend: "thickness" },
  { id: "tb-sp", num: "3.4", sym: "Tb.Sp", name: "Trabecular separation", blurb: "Local width of the marrow space.", legend: "separation" },
  { id: "da", num: "3.5", sym: "DA", name: "Degree of anisotropy", blurb: "How strongly the struts share one direction." },
  { id: "ef", num: "3.6", sym: "EF", name: "Ellipsoid factor", blurb: "Plate or rod, read locally.", legend: "metal" },
];

export const METRIC = (id: MetricId) => METRIC_ORDER.find((m) => m.id === id)!;

const VIEWS: Record<MetricId, [number, number, number]> = {
  "bv-tv": [1.2, 0.95, 1.4],
  "conn-d": [1.2, 0.95, 1.4],
  "tb-th": [1.2, 0.95, 1.4],
  "tb-sp": [1.2, 0.95, 1.4],
  da: [0.16, 0.3, 1],
  ef: [1.25, 0.9, 1.45],
};

export const THICK = {
  "tb-th": { fg: 1 as const, max: 0.5, stops: TH_RAMP, band: 0.035, label: "Tb.Th", cross: "strut" },
  "tb-sp": { fg: 0 as const, max: 1.7, stops: SP_RAMP, band: 0.11, label: "Tb.Sp", cross: "pore" },
};

export const pct = (v: number) => `${(v * 100).toFixed(1)} %`;
const rad = (d: number) => (d * Math.PI) / 180;

/* ------------------------- specimen shelf (2-D) ---------------------- */
/* Small coronal sections of every model, drawn once and shared by all
   three concepts. Built one at a time on the idle queue so the first
   paint is not blocked by nine model builds. */

const BONE: [number, number, number] = [238, 234, 224];
const MARROW: [number, number, number] = [20, 20, 22];
const shadeSpec = (c: number): [number, number, number] => [
  MARROW[0] + (BONE[0] - MARROW[0]) * c,
  MARROW[1] + (BONE[1] - MARROW[1]) * c,
  MARROW[2] + (BONE[2] - MARROW[2]) * c,
];

let shelfCache: Record<string, string> | null = null;
let shelfPending: Promise<Record<string, string>> | null = null;

/** Object URLs of a coronal section per model, 160 px, built in the background. */
export function useSpecimenShelf(): Record<string, string> {
  const [shelf, setShelf] = useState<Record<string, string>>(shelfCache ?? {});
  useEffect(() => {
    if (shelfCache) return;
    if (!shelfPending) {
      shelfPending = new Promise((resolve) => {
        const out: Record<string, string> = {};
        let i = 0;
        const step = () => {
          const m = MODELS[i++];
          const q = buildModel(m.id, SEED, D, 1).combine(0.85) as QField;
          const c = document.createElement("canvas");
          c.width = c.height = 160;
          const ctx = c.getContext("2d")!;
          const img = ctx.createImageData(160, 160);
          img.data.set(renderCoronal(q, D, betaForBV(sortedCopy(q), m.bv), (D[2] - 1) / 2, 160, shadeSpec) as unknown as Uint8ClampedArray);
          ctx.putImageData(img, 0, 0);
          out[m.id] = c.toDataURL();
          if (i < MODELS.length) schedule(step);
          else {
            shelfCache = out;
            resolve(out);
          }
        };
        schedule(step);
      });
    }
    let live = true;
    shelfPending.then((s) => {
      if (live) setShelf(s);
    });
    return () => {
      live = false;
    };
  }, []);
  return shelf;
}

/* ------------------------------- the lab ----------------------------- */

export type Lab = ReturnType<typeof useLab>;

let uid = 0;

/**
 * Every bit of state, geometry and readout for one specimen. `onMetric`
 * lets a concept react when the channel changes (stepping a stage back,
 * scrolling a strip) without owning the state.
 */
export function useLab(opts: { initialModel?: ModelId; onMetric?: (m: MetricId) => void } = {}) {
  const initial = MODELS.find((m) => m.id === opts.initialModel) ?? MODELS[0];
  const onMetric = opts.onMetric;
  const [metric, setMetricRaw] = useState<MetricId>("bv-tv");
  const [model, setModel] = useState<ModelId>(initial.id);
  const [fabMode, setFabMode] = useState<FabMode>("gst");
  const [bv, setBv] = useState(initial.bv);
  const [a, setA] = useState(0.85);
  const [k, setK] = useState(1);
  const [psi, setPsi] = useState(30);
  const [cut, setCut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [sidebar, setSidebar] = useState<SidebarTab>("about");
  const id = useMemo(() => `lg${++uid}`, []);

  const setMetric = useCallback(
    (m: MetricId) => {
      setMetricRaw(m);
      setSidebar("about");
      onMetric?.(m);
    },
    [onMetric]
  );

  /* ---------------------------- specimen ---------------------------- */
  const vs = useMemo(() => {
    const v = new VolumeScene(D);
    v.set({ uSteps: 440 });
    const outline = planeOutline(0);
    outline.name = "plane";
    v.scene.add(outline);
    const cor = coronalOutline(0);
    cor.name = "coronal";
    cor.visible = false;
    v.scene.add(cor);
    return v;
  }, []);
  const base = useRef<ModelBase | null>(null);
  const spec = useRef<{ q: QField; sorted: Float32Array } | null>(null);
  const [specV, setSpecV] = useState(0);
  const apply = useCallback(
    (q: Float32Array) => {
      spec.current = { q, sorted: sortedCopy(q) };
      vs.setQ(q);
      setSpecV((n) => n + 1);
    },
    [vs]
  );
  useDebounced(
    () =>
      schedule(() => {
        base.current = buildModel(model, SEED, D, k);
        apply(base.current.combine(a));
      }),
    [model, k],
    150
  );
  useDebounced(() => {
    if (base.current) apply(base.current.combine(a));
  }, [a], 60);

  const beta = spec.current ? betaForBV(spec.current.sorted, bv) : 0.5;
  const realBV = spec.current ? bvForBeta(spec.current.sorted, beta) : bv;

  /* ---------------------- view state per metric ---------------------- */
  const thick = metric === "tb-th" || metric === "tb-sp" ? THICK[metric] : null;
  const isMil = metric === "da" && fabMode === "mil";
  const isSvd = metric === "da" && fabMode === "svd";
  const frontal = isMil || isSvd;

  useEffect(() => {
    vs.set({
      uBeta: beta,
      uMode: thick ? 1 : 0,
      uPhase: metric === "tb-sp" ? -1 : 1,
      uAlpha: 1,
      uCutOn: metric === "bv-tv" && cut ? 1 : 0,
      uCut: 0,
    });
  }, [vs, beta, metric, cut, thick]);
  useEffect(() => {
    if (thick) vs.setRamp(thick.stops);
  }, [vs, thick]);
  useEffect(() => {
    const c = Math.cos(rad(psi));
    const s = Math.sin(rad(psi));
    vs.setTexRot(metric === "da" && fabMode === "gst" ? new THREE.Matrix3().set(c, s, 0, -s, c, 0, 0, 0, 1) : new THREE.Matrix3());
    const plane = vs.scene.getObjectByName("plane");
    if (plane) plane.visible = metric !== "da";
    const cor = vs.scene.getObjectByName("coronal");
    if (cor) cor.visible = metric === "bv-tv" || metric === "conn-d";
  }, [vs, metric, psi, fabMode]);
  useEffect(() => {
    const v: [number, number, number] = frontal ? [0, 0, 1] : VIEWS[metric];
    vs.camera.position.set(...v).normalize().multiplyScalar(frontal ? 3.25 : metric === "da" ? 3.9 : 4.1);
    vs.camera.lookAt(0, 0, 0);
    vs.onChange();
  }, [vs, metric, frontal]);

  /* ------------------------------ sections ---------------------------- */
  const [px, setPx] = useRaster();
  const [pxCor, setPxCor] = useRaster();
  useEffect(() => {
    const S = spec.current;
    if (!S) return;
    const rid = requestAnimationFrame(() => {
      const shade = metric === "bv-tv" ? shadeBinary : metric === "conn-d" ? shadeGrey([140, 140, 146]) : null;
      if (!shade) return;
      setPx(renderSlice(S.q, D, beta, (D[1] - 1) / 2, R, shade) as unknown as Uint8ClampedArray);
      setPxCor(renderCoronal(S.q, D, beta, (D[2] - 1) / 2, R, shade) as unknown as Uint8ClampedArray);
    });
    return () => cancelAnimationFrame(rid);
  }, [metric, beta, specV, setPx, setPxCor]);

  /* ------------------------------ Conn.D ------------------------------ */
  const [conn, setConn] = useState<{ chi: number; b0: number; b1: number } | null>(null);
  useDebounced(() => {
    if (metric !== "conn-d" || !spec.current) return;
    const S = spec.current;
    schedule(() => setConn(connectivity(binarize(S.q, beta), D)));
  }, [metric, beta, specV], 200);

  /* --------------------------- Tb.Th / Tb.Sp -------------------------- */
  const [st, setSt] = useState<null | (ReturnType<typeof phaseStats> & { bv: number })>(null);
  // the colour sweep: the band walks the ramp, the view highlights what it covers
  const [sweep, setSweep] = useState<number | null>(null);
  const sweepRaf = useRef(0);
  const autoSweep = useRef(false);
  const play = useCallback(() => {
    if (!thick || reducedMotion()) return;
    cancelAnimationFrame(sweepRaf.current);
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 3600);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      setSweep(thick.max * (1 - e));
      if (t < 1) sweepRaf.current = requestAnimationFrame(step);
      else setTimeout(() => setSweep(null), 350);
    };
    sweepRaf.current = requestAnimationFrame(step);
  }, [thick]);
  useEffect(() => {
    cancelAnimationFrame(sweepRaf.current);
    setSweep(null);
    autoSweep.current = metric === "tb-th" || metric === "tb-sp";
  }, [metric]);
  useEffect(() => {
    if (thick) vs.set({ uPick: (sweep ?? 0) / thick.max, uPickW: (thick.band * 1.4) / thick.max, uPickOn: sweep === null ? 0 : 1 });
  }, [vs, sweep, thick]);
  useDebounced(() => {
    if (!thick || !spec.current) return;
    const S = spec.current;
    setBusy(true);
    schedule(() => {
      const bone = binarize(S.q, beta);
      const raw = localThickness(bone, D, thick.fg);
      const mm = raw.map((v) => v * VOX_MM);
      const norm = smoothInPhase(raw, bone, thick.fg, D).map((v) => (v * VOX_MM) / thick.max);
      vs.setLT(norm);
      setSt({ ...phaseStats(mm, bone, thick.fg, thick.max), bv: bvForBeta(S.sorted, beta) });
      setPx(renderSlice(S.q, D, beta, (D[1] - 1) / 2, R, shadeLT(norm, D, thick.stops, thick.fg)) as unknown as Uint8ClampedArray);
      setBusy(false);
      if (autoSweep.current) {
        autoSweep.current = false;
        play();
      }
    });
  }, [metric, beta, specV], 220);

  /* -------------------------------- DA -------------------------------- */
  const ovState = useRef<{ G: number[]; psi: number; da: number } | null>(null);
  const [fab, setFab] = useState<{ G: number[]; vals: number[]; da: number } | null>(null);
  useDebounced(() => {
    if (metric !== "da" || !spec.current || fabMode !== "gst") return;
    const S = spec.current;
    schedule(() => {
      const { G } = gradTensor(binarize(S.q, beta), D, 0);
      const e = eigSym3(G);
      setFab({ G, vals: e.values, da: 1 - e.values[2] / e.values[0] });
    });
  }, [metric, beta, specV, fabMode], 200);
  useEffect(() => {
    (vs as Viewable).overlay = metric === "da" && fabMode === "gst" ? (ctx, cam, w, h) => drawFabric(ctx, cam, w, h, ovState.current) : undefined;
    ovState.current = fab ? { G: fab.G, psi, da: fab.da } : null;
    vs.onChange();
  }, [vs, metric, fab, psi, fabMode]);

  /* -------------------- MIL / SVD on the cut face --------------------- */
  const fabGroup = useMemo(() => {
    const g = new THREE.Group();
    vs.scene.add(g);
    return g;
  }, [vs]);
  const faceGroup = useMemo(() => {
    const g = new THREE.Group();
    vs.scene.add(g);
    return g;
  }, [vs]);
  const inWorld = useMemo(() => {
    const S = spec.current;
    if (!S) return null;
    return (x: number, y: number, z: number) =>
      sampleWrap(S.q, D, (x + 0.5) * D[0] - 0.5, (y + 0.5) * D[1] - 0.5, (z + 0.5) * D[2] - 0.5) < beta;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specV, beta]);
  useEffect(() => {
    for (const o of [...faceGroup.children]) {
      faceGroup.remove(o);
      const m = o as THREE.Mesh;
      m.geometry.dispose();
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
    if (frontal && inWorld) faceGroup.add(faceSection(inWorld));
    vs.onChange();
  }, [frontal, inWorld, faceGroup, vs]);
  useEffect(() => {
    if (!frontal) {
      clearGroup(fabGroup);
      vs.onChange();
    }
  }, [frontal, fabGroup, vs]);

  const [theta, setTheta] = useState(0);
  const [milVal, setMilVal] = useState<number | null>(null);
  const [milN, setMilN] = useState(0);
  const [rose, setRose] = useState<number[] | null>(null);
  const milIntro = useRef(0);
  const milRaf = useRef(0);
  const sweepMil = useCallback(() => {
    cancelAnimationFrame(milRaf.current);
    if (reducedMotion()) return;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 5000);
      setTheta(Math.round(t * 180));
      if (t < 1) milRaf.current = requestAnimationFrame(step);
    };
    milRaf.current = requestAnimationFrame(step);
  }, []);
  useEffect(() => {
    if (isMil) {
      milIntro.current = 0;
      setTheta(0);
      sweepMil();
    } else cancelAnimationFrame(milRaf.current);
  }, [isMil, sweepMil]);
  useEffect(() => {
    if (!isMil || !inWorld) return;
    const m = milFace(inWorld, rad(theta), L_MM);
    setMilVal(m.mil);
    setMilN(m.hits.length);
    if (milIntro.current >= 1 || reducedMotion()) {
      drawMILFace(fabGroup, m, 1);
      vs.onChange();
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 1400);
      milIntro.current = t;
      drawMILFace(fabGroup, m, t);
      vs.onChange();
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [isMil, inWorld, theta, fabGroup, vs]);
  useDebounced(() => {
    if (isMil && inWorld) schedule(() => setRose(milFaceRose(inWorld, L_MM)));
  }, [isMil, inWorld], 250);

  const [svdSeed, setSvdSeed] = useState(1);
  const [vstar, setVstar] = useState<number | null>(null);
  const [svdN, setSvdN] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    if (!isSvd || !inWorld) return;
    const s = svdFace(inWorld, svdSeed, L_MM);
    setVstar(s.vstar);
    setSvdN([s.stars.length, s.stars.length ? s.stars[0].len.length : 0]);
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = reducedMotion() ? 1 : Math.min(1, (now - t0) / 1600);
      drawSVD(fabGroup, s, 1 - (1 - t) ** 3);
      vs.onChange();
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [isSvd, inWorld, svdSeed, fabGroup, vs]);

  /* -------------------------------- EF -------------------------------- */
  const efScene = useMemo(() => (metric === "ef" ? new FieldScene(D, false) : null), [metric]);
  const [fs, setFs] = useState<FieldStats | null>(null);
  useDebounced(() => {
    if (!efScene || !spec.current) return;
    const S = spec.current;
    schedule(() => setFs(buildNematic(efScene, S.q, binarize(S.q, beta), D, beta)));
  }, [efScene, beta, specV], 200);

  const view: Viewable | null = metric === "ef" ? efScene : vs;

  /* ------------------------------ readouts ---------------------------- */
  const primary: { label: string; value: string; unit?: string } =
    metric === "bv-tv"
      ? { label: "BV/TV", value: (realBV * 100).toFixed(1), unit: "%" }
      : metric === "conn-d"
        ? { label: "Conn.D", value: conn ? (conn.b1 / TV).toFixed(2) : "…", unit: "mm⁻³" }
        : thick
          ? { label: `${thick.label} mean`, value: st ? st.mean.toFixed(3) : "…", unit: "mm" }
          : isMil
            ? { label: `MIL at θ ${theta}°`, value: milVal !== null ? milVal.toFixed(3) : "…", unit: "mm" }
            : isSvd
              ? { label: "Marrow star volume", value: vstar !== null ? vstar.toFixed(3) : "…", unit: "mm³" }
              : metric === "da"
                ? { label: "DA", value: fab ? fab.da.toFixed(3) : "…" }
                : { label: "⟨EF⟩", value: fs ? fs.ef.toFixed(3) : "…" };

  const secondary =
    metric === "ef" && fs
      ? `order S ${fs.S.toFixed(3)} · cone β̄ ${((Math.acos(Math.min(1, Math.sqrt((2 * fs.S + 1) / 3))) * 180) / Math.PI).toFixed(0)}°`
      : thick && st
        ? `SD ${st.sd.toFixed(3)} mm · max ${st.max.toFixed(2)} mm`
        : metric === "conn-d" && conn
          ? `β₁ ${conn.b1} · χ ${conn.chi}`
          : isMil
            ? `${milN} bone entries along the test lines`
            : isSvd
              ? "V* = 4π/3 · mean(l³) over rays from marrow points"
              : metric === "da" && fab
                ? `λ ${fab.vals.map((v) => v.toFixed(2)).join(" / ")}`
                : `BV ${(realBV * TV).toFixed(1)} mm³ of ${TV.toFixed(1)} mm³`;

  const rows: { label: string; value: string; unit?: string; accent?: boolean }[] =
    metric === "bv-tv"
      ? [
          { label: "BV/TV", value: (realBV * 100).toFixed(1), unit: "%", accent: true },
          { label: "Bone volume", value: (realBV * TV).toFixed(1), unit: "mm³" },
          { label: "Total volume", value: TV.toFixed(1), unit: "mm³" },
          { label: "Voxel", value: (VOX_MM * 1000).toFixed(0), unit: "µm" },
        ]
      : metric === "conn-d"
        ? [
            { label: "Conn.D", value: conn ? (conn.b1 / TV).toFixed(2) : "-", unit: "mm⁻³", accent: true },
            { label: "χ (purified)", value: conn ? String(conn.chi) : "-" },
            { label: "Particles", value: conn ? String(conn.b0) : "-" },
            { label: "Loops β₁", value: conn ? String(conn.b1) : "-" },
          ]
        : thick
          ? [
              { label: `${thick.label} mean`, value: st ? st.mean.toFixed(3) : "-", unit: "mm", accent: true },
              { label: "SD", value: st ? st.sd.toFixed(3) : "-", unit: "mm" },
              { label: `${thick.label} max`, value: st ? st.max.toFixed(2) : "-", unit: "mm" },
              { label: "BV/TV", value: st ? (st.bv * 100).toFixed(1) : "-", unit: "%" },
            ]
          : metric === "da" && fabMode === "gst"
            ? [
                { label: "DA", value: fab ? fab.da.toFixed(3) : "-", accent: true },
                { label: "λ₁ / λ₂ / λ₃", value: fab ? fab.vals.map((v) => v.toFixed(2)).join(" / ") : "-" },
                { label: "Angle ψ", value: String(psi), unit: "°" },
              ]
            : isMil
              ? [
                  { label: "MIL(θ)", value: milVal !== null ? milVal.toFixed(3) : "-", unit: "mm", accent: true },
                  { label: "Bone entries", value: String(milN) },
                  { label: "Direction θ", value: String(theta), unit: "°" },
                  { label: "Rose 1 − min/max", value: rose ? (1 - Math.min(...rose) / Math.max(...rose)).toFixed(2) : "-" },
                ]
              : isSvd
                ? [
                    { label: "V* (section)", value: vstar !== null ? vstar.toFixed(3) : "-", unit: "mm³", accent: true },
                    { label: "Marrow points", value: String(svdN[0]) },
                    { label: "Rays each", value: String(svdN[1]) },
                  ]
                : [
                    { label: "⟨EF⟩", value: fs ? fs.ef.toFixed(3) : "-", accent: true },
                    { label: "Order S", value: fs ? fs.S.toFixed(3) : "-" },
                    { label: "Plates / rods", value: fs ? `${(fs.plates * 100).toFixed(0)} / ${(fs.rods * 100).toFixed(0)}` : "-", unit: "%" },
                    { label: "Glyphs", value: fs ? String(fs.n) : "-" },
                  ];

  const meta = METRIC(metric);
  const info = METRICS[metric];
  const tip =
    metric === "ef"
      ? "Raise fabric alignment to send the struts one way."
      : isMil
        ? `In-plane anisotropy 1 − min/max = ${rose ? (1 - Math.min(...rose) / Math.max(...rose)).toFixed(2) : "-"}.`
        : isSvd
          ? "Cubed ray lengths let a few long rays dominate; new marrow points move the estimate."
          : fabMode === "mil"
            ? "MIL follows the bone and marrow interface, not the volume fabric."
            : metric === "da"
              ? "Switch the method to compare the structure tensor, MIL and SVD on one specimen."
              : thick
                ? `Mean of the local ${thick.cross} width, sampled only inside the ${thick.cross === "strut" ? "bone" : "marrow"} phase.`
                : metric === "conn-d"
                  ? "Bone that can be cut without splitting the network into two parts."
                  : "The slider moves the segmentation threshold on an unchanged field.";

  return {
    id,
    // state
    metric,
    setMetric,
    model,
    setModel,
    fabMode,
    setFabMode,
    bv,
    setBv,
    a,
    setA,
    k,
    setK,
    psi,
    setPsi,
    cut,
    setCut,
    theta,
    setTheta,
    bumpSvdSeed: () => setSvdSeed((v) => v + 1),
    sweep,
    play,
    zoom,
    setZoom,
    sidebar,
    setSidebar,
    // view
    view,
    vs,
    thick,
    isMil,
    isSvd,
    frontal,
    playMil: sweepMil,
    // data
    meta,
    info,
    primary,
    secondary,
    rows,
    tip,
    busy,
    realBV,
    // sections
    px: px as Raster,
    pxCor: pxCor as Raster,
    sectionR: R,
    // fabric
    rose,
    fab: fab ? { G: fab.G, values: fab.vals, da: fab.da } : null,
    fs,
  };
}

/* ------------------------- published-figure data --------------------- */
/* Descriptive numbers from the same study the Results tab reports, kept
   here so the concepts can carry real evidence instead of invented copy. */

type Rat = Record<string, string | number | boolean> & {
  rat: string;
  load: string;
  diet: string;
  stratum: number;
  bvtv: number;
  tbth_um: number;
  tbsp_um: number;
  da: number;
  tbn_permm: number;
  tr_long_ratio: number;
  qc_exclude: boolean;
  orientation_flag: boolean;
};

const PR = SCR.per_rat_band as unknown as Rat[];

export const SECTION_LABEL = ["S1", "S2", "S3", "S4", "S5", "S6"];

/** Thickness of unloaded and ambulatory bone in the second 0.5 mm stratum. */
export const STRATUM22: Record<"HLU" | "AMB", number[]> = {
  HLU: PR.filter((r) => r.load === "HLU" && r.stratum === 2 && !r.qc_exclude).map((r) => r.tbth_um as number),
  AMB: PR.filter((r) => r.load === "AMB" && r.stratum === 2 && !r.qc_exclude).map((r) => r.tbth_um as number),
};

export const G = SCR.hedges_g_HLU_minus_AMB as unknown as Record<string, Record<string, number>>;

export const THIN_BY_STRATUM = SCR.thinning_ratio_by_class as unknown as { stratum: number; tbth: number }[];

export const DECOMP = SCR.bvtv_loss_decomposition as unknown as {
  stratum: number;
  frac_from_length: number;
  frac_from_thinning: number;
  length_ratio: { longitudinal: number; oblique: number; transverse: number };
}[];

export const AMB_REF = (() => {
  const a = PR.filter((r) => r.load === "AMB" && !r.qc_exclude && !r.orientation_flag);
  const m = (k: "tbth_um" | "bvtv") => a.reduce((s, r) => s + (r[k] as number), 0) / a.length;
  const s = (k: "tbth_um" | "bvtv") => Math.sqrt(a.reduce((acc, r) => acc + ((r[k] as number) - m(k)) ** 2, 0) / a.length);
  return { tbth: m("tbth_um"), tbthSd: s("tbth_um"), bvtv: m("bvtv"), bvtvSd: s("bvtv"), n: a.length };
})();

export type RatKey = "tbth_um" | "tbsp_um" | "bvtv" | "da" | "tbn_permm" | "tr_long_ratio";

/** Unloaded and ambulatory measurements in one stratum, for the context figures. */
export function ratPairs(key: RatKey, stratum = 2) {
  const pick = (load: string) =>
    PR.filter((r) => r.load === load && r.stratum === stratum && !r.qc_exclude && !r.orientation_flag)
      .map((r) => r[key] as number)
      .filter((v): v is number => Number.isFinite(v));
  const HLU = pick("HLU");
  const AMB = pick("AMB");
  const all = [...HLU, ...AMB];
  const lo = Math.floor(Math.min(...all) * 0.94);
  const hi = Math.ceil(Math.max(...all) * 1.04);
  return { HLU, AMB, lo, hi };
}

/** Mean thickness ratio (unloaded over ambulatory) for each 0.5 mm stratum. */
export const THIN_ROWS = THIN_BY_STRATUM.map((r) => ({ label: SECTION_LABEL[r.stratum - 1], value: r.tbth }));

/** Bone volume lost, split into missing struts and thinner struts. */
export const SPLIT_ROWS = DECOMP.map((r) => ({ label: SECTION_LABEL[r.stratum - 1], length: r.frac_from_length, thin: r.frac_from_thinning }));
