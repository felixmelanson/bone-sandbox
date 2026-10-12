/* =====================================================================
   Morphometry sandbox: one specimen, one high-quality 3-D view.
   ---------------------------------------------------------------------
   Pick a metric and the same specimen is shown the way that metric sees
   it: bone material (BV/TV, Conn.D), local-thickness colour on bone or
   marrow (Tb.Th, Tb.Sp), the fabric ellipse or MIL / SVD on the cut face
   (DA), or a transparent specimen with the fabric glyph field (EF).
   The specimen controls are shared by every metric. Only one raymarched
   scene exists at a time.
   ===================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { SP_RAMP, TH_RAMP } from "./bone/colormap";
import {
  betaForBV,
  binarize,
  bvForBeta,
  connectivity,
  eigSym3,
  gradTensor,
  phaseStats,
  renderSlice,
  sampleWrap,
  shadeBinary,
  shadeGrey,
  shadeLT,
  sortedCopy,
  VOX_MM,
  type QField,
} from "./bone/engine";
import { clearGroup, drawMILFace, drawSVD, faceSection, milFace, milFaceRose, svdFace } from "./bone/fabric3d";
import { buildModel, MODELS, type ModelBase, type ModelId } from "./bone/models";
import { planeOutline, VolumeScene, type Viewable } from "./bone/raymarch";
import { prepareSchematics, SeparationSchematic, ThicknessSchematic } from "./bone/schematic";
import { Viewer } from "./bone/views";
import { localThickness, smoothInPhase, type Dims } from "./bone/volume";
import { buildNematic, drawFabric, FieldScene, Mat3, METAL_CSS, tensorMat, type FieldStats } from "./panels-b";
import { METRICS } from "./text";
import { ColorBar, fmt, Frame, Readout, Readouts, schedule, Seg, SliceCanvas, Slider, Toggle, useDebounced, useRaster } from "./ui";
import { reducedMotion } from "./utils/tween";

type MetricId = "bv-tv" | "conn-d" | "tb-th" | "tb-sp" | "da" | "ef";
type FabMode = "gst" | "mil" | "svd";
const RAIL: { id: MetricId; num: string; sym: string; name: string }[] = [
  { id: "bv-tv", num: "3.1", sym: "BV/TV", name: "Bone volume fraction" },
  { id: "conn-d", num: "3.2", sym: "Conn.D", name: "Connectivity density" },
  { id: "tb-th", num: "3.3", sym: "Tb.Th", name: "Trabecular thickness" },
  { id: "tb-sp", num: "3.4", sym: "Tb.Sp", name: "Trabecular separation" },
  { id: "da", num: "3.5", sym: "DA", name: "Degree of anisotropy" },
  { id: "ef", num: "3.6", sym: "EF", name: "Ellipsoid factor" },
];

const D: Dims = [64, 64, 64];
const SEED = 2203;
const R = 220; // section raster
const TV = D[0] * D[1] * D[2] * VOX_MM ** 3;
const L_MM = D[0] * VOX_MM; // world unit (cube edge) in mm
const pct = (v: number) => `${(v * 100).toFixed(1)} %`;
const rad = (d: number) => (d * Math.PI) / 180;
const VIEWS: Record<MetricId, [number, number, number]> = {
  "bv-tv": [1.2, 0.95, 1.4],
  "conn-d": [1.2, 0.95, 1.4],
  "tb-th": [1.2, 0.95, 1.4],
  "tb-sp": [1.2, 0.95, 1.4],
  da: [0.16, 0.3, 1],
  ef: [1.25, 0.9, 1.45],
};
const THICK = {
  "tb-th": { fg: 1 as const, max: 0.5, stops: TH_RAMP, band: 0.035, label: "Tb.Th" },
  "tb-sp": { fg: 0 as const, max: 1.7, stops: SP_RAMP, band: 0.11, label: "Tb.Sp" },
};
const strutScale = (bv: number) => 0.75 + (bv - 0.1) * 2.8;

/** Lede (first paragraph and equation) and the rest of a metric's text. */
function splitBody(id: MetricId) {
  const body = METRICS[id].body as { props?: { children?: ReactNode } };
  const kids = Array.isArray(body?.props?.children) ? (body.props!.children as ReactNode[]) : [METRICS[id].body];
  return { lede: kids.slice(0, 2), rest: kids.slice(2) };
}

/** Polar MIL rose (mirrored), with the current test-line direction marked. */
function MilRose({ rose, theta }: { rose: number[]; theta: number }) {
  const S = 180;
  const R0 = 76;
  const mx = Math.max(...rose);
  const pts: string[] = [];
  for (const flip of [0, Math.PI])
    rose.forEach((v, i) => {
      const a = (i / rose.length) * Math.PI + flip;
      const r = (v / mx) * R0;
      pts.push(`${(S / 2 + r * Math.cos(a)).toFixed(1)},${(S / 2 - r * Math.sin(a)).toFixed(1)}`);
    });
  const a = rad(theta);
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="mx-auto block h-[180px] w-[180px]" aria-label="MIL rose">
      <circle cx={S / 2} cy={S / 2} r={R0} fill="none" stroke="#e7e5e4" />
      <circle cx={S / 2} cy={S / 2} r={R0 / 2} fill="none" stroke="#f0efed" />
      <path d={`M${pts.join("L")}Z`} fill="#b3244f22" stroke="#b3244f" strokeWidth={1.8} />
      <line x1={S / 2 - Math.cos(a) * R0} y1={S / 2 + Math.sin(a) * R0} x2={S / 2 + Math.cos(a) * R0} y2={S / 2 - Math.sin(a) * R0} stroke="#1c1917" strokeDasharray="3 3" />
    </svg>
  );
}

export function Sandbox() {
  // a model can be preselected from the link (#sandbox?model=tworod)
  const initial = (() => {
    const m = new URLSearchParams(location.hash.split("?")[1] ?? "").get("model");
    return MODELS.find((x) => x.id === m) ?? MODELS[0];
  })();
  const [metric, setMetric] = useState<MetricId>("bv-tv");
  const [model, setModel] = useState<ModelId>(initial.id);
  const [fabMode, setFabMode] = useState<FabMode>("gst");
  const [bv, setBv] = useState(initial.bv);
  const [a, setA] = useState(0.85);
  const [k, setK] = useState(1);
  const [psi, setPsi] = useState(30);
  const [cut, setCut] = useState(false);
  const [busy, setBusy] = useState(false);

  /* ---------------------------- specimen ---------------------------- */
  const vs = useMemo(() => {
    const v = new VolumeScene(D);
    v.set({ uSteps: 440 }); // one view only, so it can afford finer ray steps
    const outline = planeOutline(0);
    outline.name = "plane";
    v.scene.add(outline);
    return v;
  }, []);
  const base = useRef<ModelBase | null>(null);
  const spec = useRef<{ q: QField; sorted: Float32Array } | null>(null);
  const [specV, setSpecV] = useState(0); // bumps when the specimen field changes
  const apply = useCallback(
    (q: Float32Array) => {
      spec.current = { q, sorted: sortedCopy(q) };
      vs.setQ(q);
      setSpecV((n) => n + 1);
    },
    [vs]
  );
  // model and fabric alignment rebuild the structure; perforation only recombines it
  useDebounced(
    () =>
      schedule(() => {
        base.current = buildModel(model, SEED, D, k);
        apply(base.current.combine(a));
      }),
    [model, k],
    150
  );
  useDebounced(
    () => {
      if (base.current) apply(base.current.combine(a));
    },
    [a],
    60
  );
  const beta = spec.current ? betaForBV(spec.current.sorted, bv) : 0.5;
  const realBV = spec.current ? bvForBeta(spec.current.sorted, beta) : bv;

  /* ---------------------- view state per metric ---------------------- */
  const thick = metric === "tb-th" || metric === "tb-sp" ? THICK[metric] : null;
  const isMil = metric === "da" && fabMode === "mil";
  const isSvd = metric === "da" && fabMode === "svd";
  const frontal = isMil || isSvd; // MIL and SVD are drawn on the front cut face, seen straight on
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
  }, [vs, metric, psi, fabMode]);
  // each metric starts from its own camera angle
  useEffect(() => {
    const v: [number, number, number] = frontal ? [0, 0, 1] : VIEWS[metric];
    vs.camera.position.set(...v).normalize().multiplyScalar(frontal ? 3.25 : metric === "da" ? 3.9 : 4.1);
    vs.camera.lookAt(0, 0, 0);
    vs.onChange();
  }, [vs, metric, frontal]);

  /* ------------------------------ section ---------------------------- */
  const [px, setPx] = useRaster();
  useEffect(() => {
    const S = spec.current;
    if (!S) return;
    const id = requestAnimationFrame(() => {
      if (metric === "bv-tv") setPx(renderSlice(S.q, D, beta, (D[1] - 1) / 2, R, shadeBinary));
      else if (metric === "conn-d") setPx(renderSlice(S.q, D, beta, (D[1] - 1) / 2, R, shadeGrey([140, 140, 146])));
    });
    return () => cancelAnimationFrame(id);
  }, [metric, beta, specV, setPx]);

  /* ----------------------------- Conn.D ------------------------------ */
  const [conn, setConn] = useState<{ chi: number; b0: number; b1: number } | null>(null);
  useDebounced(
    () => {
      if (metric !== "conn-d" || !spec.current) return;
      const S = spec.current;
      schedule(() => setConn(connectivity(binarize(S.q, beta), D)));
    },
    [metric, beta, specV],
    200
  );

  /* ---------------------------- Tb.Th / Tb.Sp ------------------------- */
  const [st, setSt] = useState<null | (ReturnType<typeof phaseStats> & { bv: number })>(null);
  useDebounced(
    () => {
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
        setPx(renderSlice(S.q, D, beta, (D[1] - 1) / 2, R, shadeLT(norm, D, thick.stops, thick.fg)));
        setBusy(false);
      });
    },
    [metric, beta, specV],
    220
  );
  // sphere-fitting schematic
  const sch = useMemo(() => (metric === "tb-th" ? new ThicknessSchematic() : metric === "tb-sp" ? new SeparationSchematic() : null), [metric]);
  const [schReady, setSchReady] = useState(false);
  useEffect(() => {
    if (!sch) return;
    schedule(() => {
      prepareSchematics();
      setSchReady(true);
    });
  }, [sch]);
  useEffect(() => {
    if (sch && schReady) sch.update(strutScale(bv));
  }, [sch, schReady, bv]);
  // colour sweep
  const [sweep, setSweep] = useState<number | null>(null);
  const sweepRafC = useRef(0);
  const play = useCallback(() => {
    if (!thick || reducedMotion()) return;
    cancelAnimationFrame(sweepRafC.current);
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 3600);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      setSweep(thick.max * (1 - e));
      if (t < 1) sweepRafC.current = requestAnimationFrame(step);
      else setTimeout(() => setSweep(null), 350);
    };
    sweepRafC.current = requestAnimationFrame(step);
  }, [thick]);
  useEffect(() => {
    cancelAnimationFrame(sweepRafC.current);
    setSweep(null);
  }, [metric]);
  useEffect(() => {
    if (thick) vs.set({ uPick: (sweep ?? 0) / thick.max, uPickW: (thick.band * 1.4) / thick.max, uPickOn: sweep === null ? 0 : 1 });
  }, [vs, sweep, thick]);

  /* -------------------------------- DA -------------------------------- */
  const ovState = useRef<{ G: number[]; psi: number; da: number } | null>(null);
  const [fab, setFab] = useState<{ G: number[]; vals: number[]; da: number } | null>(null);
  useDebounced(
    () => {
      if (metric !== "da" || !spec.current) return;
      const S = spec.current;
      schedule(() => {
        const { G } = gradTensor(binarize(S.q, beta), D, 0);
        const e = eigSym3(G);
        setFab({ G, vals: e.values, da: 1 - e.values[2] / e.values[0] });
      });
    },
    [metric, beta, specV],
    200
  );
  useEffect(() => {
    (vs as Viewable).overlay = metric === "da" && fabMode === "gst" ? (ctx, cam, w, h) => drawFabric(ctx, cam, w, h, ovState.current) : undefined;
    ovState.current = fab ? { G: fab.G, psi, da: fab.da } : null;
    vs.onChange();
  }, [vs, metric, fab, psi, fabMode]);

  /* ------------------- MIL / SVD on the front cut face ----------------- */
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
    return (x: number, y: number, z: number) => sampleWrap(S.q, D, (x + 0.5) * D[0] - 0.5, (y + 0.5) * D[1] - 0.5, (z + 0.5) * D[2] - 0.5) < beta;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specV, beta]);
  // opaque section of the front face under the lines / stars
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

  // MIL: lines draw in, then theta sweeps through 180 degrees by itself
  const [theta, setTheta] = useState(0);
  const [milVal, setMilVal] = useState<number | null>(null);
  const [milN, setMilN] = useState(0);
  const [rose, setRose] = useState<number[] | null>(null);
  const milIntro = useRef(0);
  const sweepRaf = useRef(0);
  const sweepMil = useCallback(() => {
    cancelAnimationFrame(sweepRaf.current);
    if (reducedMotion()) return;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 5000);
      setTheta(Math.round(t * 180));
      if (t < 1) sweepRaf.current = requestAnimationFrame(step);
    };
    sweepRaf.current = requestAnimationFrame(step);
  }, []);
  useEffect(() => {
    if (isMil) {
      milIntro.current = 0;
      setTheta(0);
    } else cancelAnimationFrame(sweepRaf.current);
  }, [isMil]);
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
      else sweepMil();
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [isMil, inWorld, theta, fabGroup, vs, sweepMil]);
  useDebounced(
    () => {
      if (isMil && inWorld) schedule(() => setRose(milFaceRose(inWorld, L_MM)));
    },
    [isMil, inWorld],
    250
  );

  // SVD: rays grow out from each marrow point
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
  useDebounced(
    () => {
      if (!efScene || !spec.current) return;
      const S = spec.current;
      schedule(() => setFs(buildNematic(efScene, S.q, binarize(S.q, beta), D, beta)));
    },
    [efScene, beta, specV],
    200
  );

  /* ------------------------------- layout ----------------------------- */
  const view = metric === "ef" ? efScene : vs;
  const info = METRICS[metric];
  const { lede, rest } = splitBody(metric);
  const rail = RAIL.find((r) => r.id === metric)!;

  // primary readout for the active channel
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
              ? { label: "Marrow star volume (section)", value: vstar !== null ? vstar.toFixed(3) : "…", unit: "mm³" }
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

  return (
    <div className="lab">
      <nav className="lab-tabs" aria-label="Metric">
        {RAIL.map((r) => (
          <button key={r.id} type="button" className={`lab-tab ${metric === r.id ? "on" : ""}`} onClick={() => setMetric(r.id)} aria-pressed={metric === r.id}>
            <span className="lab-tab-num">{r.num}</span>
            <span className="lab-tab-sym">{r.sym}</span>
            <span className="lab-tab-name">{r.name}</span>
          </button>
        ))}
      </nav>

      <div className="lab-main">
        <section className="lab-stage">
          <div className="lab-vp">
            <i className="vp-c tl" />
            <i className="vp-c tr" />
            <i className="vp-c bl" />
            <i className="vp-c br" />
            <Viewer key={metric === "ef" ? "ef" : frontal ? "front" : "main"} view={view} interactive={!frontal} alt={`Specimen shown for ${rail.name}`} />
            <div className="hud hud-tl">
              <p className="hud-label">{primary.label}</p>
              <p className="hud-value">
                {primary.value}
                {primary.unit && <span>{primary.unit}</span>}
              </p>
              <p className="hud-sub">{secondary}</p>
            </div>
            <div className="hud hud-tr">
              <p>
                {D.join(" × ")} voxels · {(VOX_MM * 1000).toFixed(0)} µm
              </p>
              <p>field of view {(D[0] * VOX_MM).toFixed(2)} mm</p>
              <p>
                BV/TV {(realBV * 100).toFixed(1)} % · a {a.toFixed(2)} · fabric {k.toFixed(1)}:1
              </p>
            </div>
            {thick && (
              <div className="vp-bar">
                <ColorBar
                  stops={thick.stops}
                  max={thick.max}
                  sweep={sweep}
                  hist={st?.hist}
                  band={thick.band}
                  label={
                    <>
                      {thick.label}
                      <br />
                      [mm]
                    </>
                  }
                />
              </div>
            )}
            {metric === "ef" && (
              <div className="vp-legend">
                <span>bronze · ⊥ N</span>
                <i style={{ background: METAL_CSS }} />
                <span>gold · ∥ N</span>
              </div>
            )}
            {busy && <span className="vp-busy">computing…</span>}
          </div>

          <div className="lab-dock">
            <div className="dock-group">
              <div className="dock-top">
                <p className="dock-h">Specimen</p>
                <div className="model-pick" role="radiogroup" aria-label="Specimen model">
                  {MODELS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={model === m.id}
                      title={m.note}
                      className={model === m.id ? "on" : ""}
                      onClick={() => {
                        setModel(m.id);
                        setBv(m.bv); // each model starts at a typical BV/TV for its type
                      }}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="dock-row">
                <Slider label="Bone volume fraction" value={bv} min={0.08} max={0.45} step={0.005} onChange={setBv} format={pct} />
                <Slider label="Plate perforation" hint="plates → rods" value={a} min={0} max={2.2} step={0.05} onChange={setA} format={(v) => v.toFixed(2)} />
                <Slider label="Fabric alignment" value={k} min={1} max={3.5} step={0.1} onChange={setK} format={(v) => `${v.toFixed(1)} : 1`} />
              </div>
            </div>
            {(metric === "bv-tv" || thick || metric === "da") && (
              <div className="dock-group dock-metric">
                <p className="dock-h">{rail.sym}</p>
                {metric === "bv-tv" && (
                  <Toggle on={cut} onChange={setCut}>
                    Cut specimen at analysis plane
                  </Toggle>
                )}
                {thick && (
                  <button type="button" onClick={play} className="insp-btn">
                    ▶ Sweep the colour scale
                  </button>
                )}
                {metric === "da" && (
                  <Seg
                    label="Fabric method"
                    value={fabMode}
                    onChange={setFabMode}
                    options={[
                      { v: "gst", t: "Structure tensor" },
                      { v: "mil", t: "MIL" },
                      { v: "svd", t: "SVD" },
                    ]}
                  />
                )}
                {metric === "da" && fabMode === "gst" && <Slider label="Loading direction" value={psi} min={0} max={180} step={1} onChange={setPsi} format={(v) => `${v.toFixed(0)}°`} />}
                {isMil && (
                  <>
                    <Slider label="Test line direction θ" value={theta} min={0} max={180} step={1} onChange={setTheta} format={(v) => `${v.toFixed(0)}°`} />
                    <button type="button" onClick={sweepMil} className="insp-btn">
                      ▶ Sweep θ
                    </button>
                  </>
                )}
                {isSvd && (
                  <button type="button" onClick={() => setSvdSeed((v) => v + 1)} className="insp-btn">
                    ↻ New marrow points
                  </button>
                )}
              </div>
            )}
          </div>
        </section>

        <aside className="lab-side">
          <div className="side-card">
            <p className="side-h">
              <span>{rail.num}</span> {info.title}
            </p>
            <p className="side-abbr">{info.abbr}</p>
            <div className="prose side-lede">{lede}</div>
          </div>

          <div className="side-card">
            <p className="side-h">Readouts</p>
            {metric === "bv-tv" && (
              <Readouts>
                <Readout label="BV/TV" value={(realBV * 100).toFixed(1)} unit="%" accent />
                <Readout label="BV" value={fmt(realBV * TV, 1)} unit="mm³" />
                <Readout label="TV" value={fmt(TV, 1)} unit="mm³" />
                <Readout label="Voxel" value={(VOX_MM * 1000).toFixed(0)} unit="µm" />
              </Readouts>
            )}
            {metric === "conn-d" && (
              <Readouts>
                <Readout label="Conn.D" value={conn ? fmt(conn.b1 / TV, 2) : "-"} unit="mm⁻³" accent />
                <Readout label="χ (purified)" value={conn ? String(conn.chi) : "-"} />
                <Readout label="Particles" value={conn ? String(conn.b0) : "-"} />
                <Readout label="Loops β₁" value={conn ? String(conn.b1) : "-"} />
              </Readouts>
            )}
            {thick && (
              <Readouts>
                <Readout label={`${thick.label} mean`} value={st ? fmt(st.mean, 3) : "-"} unit="mm" accent />
                <Readout label="SD" value={st ? fmt(st.sd, 3) : "-"} unit="mm" />
                <Readout label={`${thick.label} max`} value={st ? fmt(st.max, 2) : "-"} unit="mm" />
                <Readout label="BV/TV" value={st ? (st.bv * 100).toFixed(1) : "-"} unit="%" />
              </Readouts>
            )}
            {metric === "da" && fabMode === "gst" && (
              <Readouts>
                <Readout label="DA" value={fab ? fmt(fab.da, 3) : "-"} accent />
                <Readout label="λ₁ / λ₂ / λ₃" value={fab ? fab.vals.map((v) => v.toFixed(2)).join(" / ") : "-"} />
              </Readouts>
            )}
            {isMil && (
              <Readouts>
                <Readout label="MIL(θ)" value={milVal !== null ? milVal.toFixed(3) : "-"} unit="mm" accent />
                <Readout label="Bone entries" value={String(milN)} />
                <Readout label="Direction θ" value={String(theta)} unit="°" />
                <Readout label="Rose 1 − min/max" value={rose ? (1 - Math.min(...rose) / Math.max(...rose)).toFixed(2) : "-"} />
              </Readouts>
            )}
            {isSvd && (
              <Readouts>
                <Readout label="V* (section)" value={vstar !== null ? vstar.toFixed(3) : "-"} unit="mm³" accent />
                <Readout label="Marrow points" value={String(svdN[0])} />
                <Readout label="Rays each" value={String(svdN[1])} />
              </Readouts>
            )}
            {metric === "ef" && (
              <Readouts>
                <Readout label="⟨EF⟩" value={fs ? fs.ef.toFixed(3) : "-"} accent />
                <Readout label="Order S" value={fs ? fs.S.toFixed(3) : "-"} />
                <Readout label="Plates / rods" value={fs ? `${(fs.plates * 100).toFixed(0)} / ${(fs.rods * 100).toFixed(0)}` : "-"} unit="%" />
                <Readout label="Glyphs" value={fs ? String(fs.n) : "-"} />
              </Readouts>
            )}
            {metric === "ef" && <p className="insp-note">Raise fabric alignment to make the struts anisotropic.</p>}
          </div>

          {(metric === "bv-tv" || metric === "conn-d" || thick) && (
            <div className="side-card">
              <p className="side-h">Insets</p>
              <div className={`side-insets ${thick ? "two" : ""}`}>
                <div>
                  <p className="strip-h">Section at the analysis plane</p>
                  <Frame>
                    <SliceCanvas pixels={px} R={R} alt="Section at the analysis plane" />
                  </Frame>
                </div>
                {thick && sch && (
                  <div>
                    <p className="strip-h">Largest sphere in each {metric === "tb-th" ? "strut" : "pore"}</p>
                    <Frame>
                      <Viewer view={sch} interactive={false} maxDpr={2} alt="Sphere fitting schematic" />
                    </Frame>
                  </div>
                )}
              </div>
            </div>
          )}
          {isMil && rose && (
            <div className="side-card">
              <p className="side-h">MIL rose</p>
              <MilRose rose={rose} theta={theta} />
              <p className="insp-note">
                In-plane anisotropy 1 − min/max = {(1 - Math.min(...rose) / Math.max(...rose)).toFixed(2)}. MIL sees only the bone and marrow interface, so it
                follows interface density rather than the volume fabric.
              </p>
            </div>
          )}
          {metric === "da" && (
            <div className="side-card">
              <p className="side-h">{fabMode === "gst" ? "Why the structure tensor" : fabMode === "mil" ? "Mean intercept length" : "Star volume distribution"}</p>
              <p className="insp-note" style={{ marginTop: 0 }}>
                {fabMode === "gst"
                  ? "Switch the fabric method to MIL or SVD to see the two classical estimates measured on this same specimen."
                  : fabMode === "mil"
                    ? "MIL(θ) = L / N(θ): test line length over bone entries. Lines draw in, then θ sweeps through 180°. It only sees the bone and marrow interface, and it depends on line spacing and how lines fall on the voxel grid."
                    : "V* = (4π/3)⟨l³⟩ from rays run out of marrow points until they meet bone. Cubed lengths let a few long rays dominate, so it needs many points to be stable; press New marrow points to see it move."}
              </p>
            </div>
          )}
          {metric === "ef" && fs && (
            <div className="side-card">
              <p className="side-h">Order tensor of the strut long axes</p>
              <Mat3 m={tensorMat(fs.Q)} label="Q" />
            </div>
          )}

          <div className="side-card">
            <p className="side-cap">{info.caption}</p>
            {rest.length > 0 && (
              <details className="insp-more">
                <summary>Method</summary>
                <div className="prose">{rest}</div>
              </details>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
