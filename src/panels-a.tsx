import { useCallback, useEffect, useRef, useState } from "react";
import { SP_RAMP, TH_RAMP, type Stop } from "./bone/colormap";
import {
  betaForBV,
  connectivity,
  binarize,
  bvForBeta,
  phaseStats,
  renderCoronal,
  renderSlice,
  shadeBinary,
  shadeGrey,
  shadeLT,
  VOX_MM,
} from "./bone/engine";
import { coronalOutline, planeOutline, VolumeScene } from "./bone/raymarch";
import { localThickness, smoothInPhase, type Dims } from "./bone/volume";
import { prepareSchematics, SeparationSchematic, ThicknessSchematic } from "./bone/schematic";
import { Viewer } from "./bone/views";
import { useSpecBV, useSpecField, useSpecimen } from "./specimen";
import {
  fmt,
  Frame,
  ColorBar,
  Panel,
  Readout,
  Readouts,
  schedule,
  SquareBtn,
  SliceCanvas,
  Slider,
  useDebounced,
  useFrame,
  useInView,
  useRaster,
} from "./ui";

const R = 220;
const D64: Dims = [64, 64, 64];
/** camera distance for the figure views: close enough that the cube fills its square */
const VIEW_DIST = 4.0;
const vol = (d: Dims) => d[0] * d[1] * d[2] * VOX_MM ** 3;
const pct = (v: number) => `${(v * 100).toFixed(1)} %`;

/* =============================== BV/TV ============================== */

export function BVPanel(_: { num?: string; fig?: number }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const f = useSpecField(seen, D64);
  const [vs, setVs] = useState<VolumeScene | null>(null);
  const [bv, setBv] = useSpecBV();
  const [px, setPx] = useRaster();
  const [pxC, setPxC] = useRaster();

  useEffect(() => {
    if (!f) return;
    if (vs) return vs.setQ(f.q);
    const v = new VolumeScene(D64, { dist: VIEW_DIST });
    v.setQ(f.q);
    v.scene.add(planeOutline(0), coronalOutline(0, 0.6, 0x000000, 0.3, 0.006));
    setVs(v);
  }, [f, vs]);

  const L = f ? { q: f.q, sorted: f.sorted, d: D64 } : null;
  const beta = L ? betaForBV(L.sorted, bv) : 0;

  useEffect(() => {
    vs?.set({ uBeta: beta });
  }, [vs, beta]);

  useFrame(() => {
    if (!L) return;
    setPx(renderSlice(L.q, L.d, beta, (L.d[1] - 1) / 2, R, shadeBinary));
    setPxC(renderCoronal(L.q, L.d, beta, (L.d[2] - 1) / 2, R, shadeBinary));
  }, [f, beta]);


  return (
    <Panel
      id="bv-tv"
      view={
        <div ref={ref} className="h-full w-full">
          <Viewer view={vs} hint={false} alt="Raymarched micro-CT volume of trabecular bone with the analysis planes" />
        </div>
      }
      side={
        <div className="ws-pair">
          <div>
            <Frame>
              <SliceCanvas pixels={px} R={R} alt="Binarised axial section: bone white, marrow black" />
            </Frame>
            <p className="fig-l">Axial</p>
          </div>
          <div>
            <Frame>
              <SliceCanvas pixels={pxC} R={R} alt="Binarised coronal section: bone white, marrow black" />
            </Frame>
            <p className="fig-l">Coronal</p>
          </div>
        </div>
      }
      readouts={
        <Readouts>
          <Readout label="BV/TV" value={L ? (bvForBeta(L.sorted, beta) * 100).toFixed(1) : "-"} unit="%" accent />
          <Readout label="BV" value={L ? fmt(bvForBeta(L.sorted, beta) * vol(D64), 1) : "-"} unit="mm³" />
          <Readout label="TV" value={fmt(vol(D64), 1)} unit="mm³" />
          <Readout label="Voxel" value={(VOX_MM * 1000).toFixed(0)} unit="µm" />
        </Readouts>
      }
      cut={[vs]}
      controls={<Slider label="Segmentation threshold" hint="target BV/TV" value={bv} min={0.06} max={0.5} step={0.005} onChange={setBv} format={pct} />}
    />
  );
}

/* ============================== Conn.D ============================== */

export function ConnPanel(_: { num?: string; fig?: number }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const S = useSpecimen();
  const [a, setA] = useState(S.a);
  useEffect(() => setA(S.a), [S.model, S.a]);
  const [bv, setBv] = useSpecBV();
  const f = useSpecField(seen, D64, { a });
  const [vs, setVs] = useState<VolumeScene | null>(null);
  const [px, setPx] = useRaster();
  const [pxC, setPxC] = useRaster();
  const [m, setM] = useState<{ chi: number; b0: number; conn: number; cd: number; bv: number } | null>(null);

  useEffect(() => {
    if (!f) return;
    if (vs) return vs.setQ(f.q);
    const v = new VolumeScene(D64, { dist: VIEW_DIST });
    v.setQ(f.q);
    v.scene.add(planeOutline(0), coronalOutline(0, 0.6, 0x000000, 0.3, 0.006));
    setVs(v);
  }, [f, vs]);

  useDebounced(
    () => {
      if (!f || !vs) return;
      const beta = betaForBV(f.sorted, bv);
      const { chi, b0, b1: conn } = connectivity(binarize(f.q, beta), D64);
      vs.set({ uBeta: beta });
      setPx(renderSlice(f.q, D64, beta, (D64[1] - 1) / 2, R, shadeGrey([140, 140, 146])));
      setPxC(renderCoronal(f.q, D64, beta, (D64[2] - 1) / 2, R, shadeGrey([140, 140, 146])));
      setM({ chi, b0, conn, cd: conn / vol(D64), bv: bvForBeta(f.sorted, beta) });
    },
    [vs, f, bv],
    30
  );

  return (
    <Panel
      id="conn-d"
      cut={[vs]}
      view={
        <div ref={ref} className="h-full w-full">
          <Viewer view={vs} hint={false} alt="Trabecular network whose connectivity changes with the controls" />
        </div>
      }
      side={
        <div className="ws-pair">
          <div>
            <Frame>
              <SliceCanvas pixels={px} R={R} alt="Grey axial section through the network" />
            </Frame>
            <p className="fig-l">Axial</p>
          </div>
          <div>
            <Frame>
              <SliceCanvas pixels={pxC} R={R} alt="Grey coronal section through the network" />
            </Frame>
            <p className="fig-l">Coronal</p>
          </div>
        </div>
      }
      readouts={
        <Readouts>
          <Readout label="Conn.D" value={m ? fmt(m.cd, 2) : "-"} unit="mm⁻³" accent />
          <Readout label="χ, purified" value={m ? String(m.chi).replace("-", "−") : "-"} />
          <Readout label="Loops β₁" value={m ? String(m.conn) : "-"} />
          <Readout label="Particles β₀" value={m ? String(m.b0) : "-"} />
        </Readouts>
      }
      controls={
        <>
          <Slider label="Plate perforation" hint="plates → rods" value={a} min={0} max={2.4} step={0.05} onChange={setA} format={(v) => v.toFixed(2)} />
          <Slider label="Bone volume fraction" value={bv} min={0.06} max={0.45} step={0.01} onChange={setBv} format={pct} />
        </>
      }
    />
  );
}

/* ======================= Tb.Th / Tb.Sp sphere lab =================== */

type Kind = "th" | "sp";

const CFG: Record<Kind, { seed: number; s: number; a: number; bv: number; range: [number, number]; max: number; stops: Stop[]; fg: 1 | 0; band: number; label: string }> = {
  th: { seed: 2203, s: 4.0, a: 1.0, bv: 0.22, range: [0.1, 0.42], max: 0.5, stops: TH_RAMP, fg: 1, band: 0.035, label: "Tb.Th" },
  sp: { seed: 4111, s: 4.4, a: 0.7, bv: 0.33, range: [0.1, 0.42], max: 1.7, stops: SP_RAMP, fg: 0, band: 0.11, label: "Tb.Sp" },
};

/** Schematic strut-radius scale for a given BV/TV: struts thicken with the slider (1 = reference figure). */
const STRUT_R: Record<Kind, (bv: number) => number> = {
  th: (bv) => 0.75 + (bv - 0.1) * 2.8,
  sp: (bv) => 0.75 + (bv - 0.1) * 2.8,
};

export function ThicknessPanel({ kind }: { kind: Kind; num?: string; fig?: number }) {
  const C = CFG[kind];
  const [ref, seen] = useInView<HTMLDivElement>();
  const lab = useRef<{ q: Float32Array; sorted: Float32Array; d: Dims; lt: Float32Array | null; beta: number } | null>(null);
  const [vs, setVs] = useState<VolumeScene | null>(null);
  const [sch, setSch] = useState<ThicknessSchematic | SeparationSchematic | null>(null);
  const [bv, setBv] = useSpecBV();
  const [sweep, setSweep] = useState<number | null>(null);
  const played = useRef(false);
  const [busy, setBusy] = useState(false);
  const [st, setSt] = useState<null | (ReturnType<typeof phaseStats> & { bv: number })>(null);
  const [px, setPx] = useRaster();

  // the specimen chosen in section 1; the view is made once and refilled when the specimen changes
  const f = useSpecField(seen, D64);
  useEffect(() => {
    if (!f) return;
    lab.current = { q: f.q, sorted: f.sorted, d: D64, lt: null, beta: 0 };
    if (vs) return vs.setQ(f.q);
    const v = new VolumeScene(D64, { ramp: C.stops, dist: 4.4 });
    v.setQ(f.q);
    v.set({ uMode: 1, uPhase: C.fg ? 1 : -1, uAlpha: 1 });
    v.scene.add(planeOutline(0));
    setVs(v);
    schedule(() => {
      prepareSchematics(); // shared distance field, built once for both insets
      setSch(kind === "th" ? new ThicknessSchematic() : new SeparationSchematic());
    });
  }, [f, vs, C, kind]);

  // Fast step, every slider frame: resegment the specimen on the GPU and resize the schematic struts and spheres
  useFrame(() => {
    const L = lab.current;
    if (L && vs) vs.set({ uBeta: betaForBV(L.sorted, bv) });
    sch?.update(STRUT_R[kind](bv));
  }, [vs, sch, bv]);

  // Heavy step, debounced: Hildebrand local thickness map, statistics and section
  useDebounced(
    () => {
      const L = lab.current;
      if (!L || !vs) return;
      setBusy(true);
      schedule(() => {
        const { d, q } = L;
        const beta = betaForBV(L.sorted, bv);
        const bone = binarize(q, beta);
        const raw = localThickness(bone, d, C.fg);
        const mm = raw.map((v) => v * VOX_MM);
        const sm = smoothInPhase(raw, bone, C.fg, d);
        const norm = sm.map((v) => (v * VOX_MM) / C.max);
        L.lt = norm;
        L.beta = beta;
        vs.setLT(norm);
        vs.set({ uBeta: beta });
        setSt({ ...phaseStats(mm, bone, C.fg, C.max), bv: bvForBeta(L.sorted, beta) });
        setBusy(false);
      });
    },
    [vs, f, bv],
    160
  );

  // All colours by default. During a sweep, only the band under the marker keeps its colour on the 3-D view.
  useEffect(() => {
    vs?.set({ uPick: (sweep ?? 0) / C.max, uPickW: (C.band * 1.4) / C.max, uPickOn: sweep === null ? 0 : 1 });
  }, [vs, sweep, C]);

  const raf = useRef(0);
  const play = useCallback(() => {
    cancelAnimationFrame(raf.current);
    const T = 3600;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / T);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      setSweep(C.max * (1 - e));
      if (k < 1) raf.current = requestAnimationFrame(step);
      else setTimeout(() => setSweep(null), 350);
    };
    raf.current = requestAnimationFrame(step);
  }, [C]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // play the sweep once, the first time the thickness map is ready
  useEffect(() => {
    if (!st || played.current) return;
    played.current = true;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) setTimeout(play, 500);
  }, [st, play]);

  useEffect(() => {
    const L = lab.current;
    if (!L || !L.lt || !st) return;
    setPx(renderSlice(L.q, L.d, L.beta, (L.d[1] - 1) / 2, R, shadeLT(L.lt, L.d, C.stops, C.fg)));
  }, [st, C]);

    const metric = kind === "th" ? "Tb.Th" : "Tb.Sp";

  return (
    <Panel
      id={kind === "th" ? "tb-th" : "tb-sp"}
      cut={[vs]}
      view={
        <div ref={ref} className="relative h-full w-full">
          <Viewer view={vs} hint={false} alt={`Volume coloured by local ${kind === "th" ? "thickness" : "separation"}`} />
          {busy && <span className="ws-busy">fitting spheres…</span>}
        </div>
      }
      overlay={
        <div className="ws-bar">
          <ColorBar
            stops={C.stops}
            max={C.max}
            sweep={sweep}
            hist={st?.hist}
            band={C.band}
            label={
              <>
                {C.label}
                <br />
                [mm]
              </>
            }
          />
        </div>
      }
      side={
        <div className="ws-pair">
          <div>
            <Frame>
              <SliceCanvas pixels={px} R={R} alt={`Section at the analysis plane coloured by local ${kind === "th" ? "thickness" : "separation"}`} />
            </Frame>
            <p className="fig-l">Analysis plane</p>
          </div>
          <div>
            <Frame>
              <Viewer
                view={sch}
                interactive={false}
                maxDpr={2}
                hint={false}
                alt={kind === "th" ? "Schematic trabecula with its chain of maximal inscribed spheres" : "Schematic pores between trabeculae with the largest sphere in each pore"}
              />
            </Frame>
            <p className="fig-l">Sphere fitting</p>
          </div>
        </div>
      }
      readouts={
        <Readouts>
          <Readout label={`${metric} mean`} value={st ? fmt(st.mean, 3) : "-"} unit="mm" accent />
          <Readout label="SD" value={st ? fmt(st.sd, 3) : "-"} unit="mm" />
          <Readout label={`${metric} max`} value={st ? fmt(st.max, 2) : "-"} unit="mm" />
          <Readout label="BV/TV" value={st ? (st.bv * 100).toFixed(1) : "-"} unit="%" />
        </Readouts>
      }
      controls={
        <>
          <Slider
            label={kind === "th" ? "Trabecular thickening" : "Bone volume (pores shrink →)"}
            hint="BV/TV"
            value={bv}
            min={C.range[0]}
            max={C.range[1]}
            step={0.01}
            onChange={setBv}
            format={pct}
          />
          <SquareBtn onClick={play}>↻ Replay colour sweep</SquareBtn>
        </>
      }
    />
  );
}
