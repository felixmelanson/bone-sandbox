import { useCallback, useEffect, useRef, useState } from "react";
import { SP_RAMP, TH_RAMP, type Stop } from "./bone/colormap";
import {
  betaForBV,
  connectivity,
  binarize,
  bvForBeta,
  makeField,
  phaseStats,
  qField,
  renderSlice,
  shadeBinary,
  shadeGrey,
  shadeLT,
  sortedCopy,
  VOX_MM,
} from "./bone/engine";
import { planeOutline, VolumeScene } from "./bone/raymarch";
import { localThickness, smoothInPhase, type Dims } from "./bone/volume";
import { prepareSchematics, SeparationSchematic, ThicknessSchematic } from "./bone/schematic";
import { Viewer } from "./bone/views";
import {
  Controls,
  fmt,
  Frame,
  ColorBar,
  Panel,
  Readout,
  Readouts,
  schedule,
  Seg,
  SliceCanvas,
  Slider,
  Toggle,
  useDebounced,
  useFrame,
  useInView,
  useRaster,
} from "./ui";

const R = 220;
const vol = (d: Dims) => d[0] * d[1] * d[2] * VOX_MM ** 3;
const pct = (v: number) => `${(v * 100).toFixed(1)} %`;

/* =============================== BV/TV ============================== */

export function BVPanel({ className }: { className?: string }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const lab = useRef<{ q: Float32Array; sorted: Float32Array; d: Dims } | null>(null);
  const [vs, setVs] = useState<VolumeScene | null>(null);
  const [bv, setBv] = useState(0.24);
  const [cut, setCut] = useState(false);
  const [px, setPx] = useRaster();

  useEffect(() => {
    if (!seen || lab.current) return;
    schedule(() => {
      const d: Dims = [72, 72, 72];
      const q = qField(makeField(1307, d, [4.2, 4.2, 4.2]), 0.85);
      lab.current = { q, sorted: sortedCopy(q), d };
      const v = new VolumeScene(d);
      v.setQ(q);
      v.scene.add(planeOutline(0));
      setVs(v);
    });
  }, [seen]);

  const L = lab.current;
  const beta = vs && L ? betaForBV(L.sorted, bv) : 0;

  useEffect(() => {
    vs?.set({ uBeta: beta, uCutOn: cut ? 1 : 0, uCut: 0 });
  }, [vs, beta, cut]);

  useFrame(() => {
    if (L && vs) setPx(renderSlice(L.q, L.d, beta, (L.d[1] - 1) / 2, R, shadeBinary));
  }, [vs, beta]);

  const real = L ? bvForBeta(L.sorted, beta) : bv;
  const TV = L ? vol(L.d) : 0;

  return (
    <Panel id="bv-tv" num="3.1" fig={1} className={className}>
      <div ref={ref} className="grid grid-cols-[1.3fr_1fr] items-center gap-4 sm:gap-7">
        <div className="fig aspect-square">
          <Viewer view={vs} alt="Raymarched micro-CT volume of trabecular bone with the analysis plane" />
        </div>
        <Frame>
          <SliceCanvas pixels={px} R={R} alt="Binarised section at the analysis plane: bone white, marrow black" />
        </Frame>
      </div>
      <Controls>
        <Slider label="Segmentation threshold" hint="target BV/TV" value={bv} min={0.06} max={0.5} step={0.005} onChange={setBv} format={pct} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Toggle on={cut} onChange={setCut}>
            Cut specimen at analysis plane
          </Toggle>
        </div>
        <Readouts>
          <Readout label="BV/TV" value={(real * 100).toFixed(1)} unit="%" accent />
          <Readout label="BV" value={fmt(real * TV, 1)} unit="mm³" />
          <Readout label="TV" value={fmt(TV, 1)} unit="mm³" />
          <Readout label="Voxel" value={(VOX_MM * 1000).toFixed(0)} unit="µm" />
        </Readouts>
      </Controls>
    </Panel>
  );
}

/* ============================== Conn.D ============================== */

/* Three stages of plate-to-rod loss. Conn.D counts loops, so it is not monotonic in "health":
   intact plates have few loops, perforation adds one per hole, fragmentation removes them again. */
const PRESETS = {
  intact: { a: 0.25, bv: 0.38, t: "Intact plates" },
  perforated: { a: 0.6, bv: 0.25, t: "Perforated plates" },
  fragmented: { a: 1.9, bv: 0.11, t: "Fragmented rods" },
};
type PresetKey = keyof typeof PRESETS;

export function ConnPanel({ className }: { className?: string }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const lab = useRef<{ f: ReturnType<typeof makeField>; d: Dims } | null>(null);
  const [vs, setVs] = useState<VolumeScene | null>(null);
  const [a, setA] = useState(PRESETS.intact.a);
  const [bv, setBv] = useState(PRESETS.intact.bv);
  const [px, setPx] = useRaster();
  const [m, setM] = useState<{ chi: number; b0: number; conn: number; cd: number; bv: number } | null>(null);

  useEffect(() => {
    if (!seen || lab.current) return;
    schedule(() => {
      const d: Dims = [64, 64, 64];
      lab.current = { f: makeField(5821, d, [4.0, 4.0, 4.0]), d };
      setVs(new VolumeScene(d));
    });
  }, [seen]);

  useDebounced(
    () => {
      const L = lab.current;
      if (!L || !vs) return;
      const q = qField(L.f, a);
      const sorted = sortedCopy(q);
      const beta = betaForBV(sorted, bv);
      const { chi, b0, b1: conn } = connectivity(binarize(q, beta), L.d);
      vs.setQ(q);
      vs.set({ uBeta: beta });
      setPx(renderSlice(q, L.d, beta, (L.d[1] - 1) / 2, R, shadeGrey([140, 140, 146])));
      setM({ chi, b0, conn, cd: conn / vol(L.d), bv: bvForBeta(sorted, beta) });
    },
    [vs, a, bv],
    30
  );

  const preset: PresetKey | "custom" = (Object.keys(PRESETS) as PresetKey[]).find((k) => PRESETS[k].a === a && PRESETS[k].bv === bv) ?? "custom";

  return (
    <Panel id="conn-d" num="3.2" fig={2} className={className}>
      <div ref={ref} className="grid grid-cols-[1.3fr_1fr] items-center gap-4 sm:gap-7">
        <div className="fig aspect-square">
          <Viewer view={vs} alt="Trabecular network whose connectivity changes with the controls" />
        </div>
        <div>
          <p className="mb-2 text-center text-[15px] text-stone-800">{preset === "custom" ? "Custom structure" : PRESETS[preset].t}</p>
          <Frame>
            <SliceCanvas pixels={px} R={R} alt="Grey section through the network" />
          </Frame>
          <p className="mt-2 text-center text-[19px] text-stone-900">
            Conn.D = {m ? fmt(m.cd, 2) : "-"} mm<sup>−3</sup>
          </p>
        </div>
      </div>
      <Controls>
        <Seg
          label="Preset"
          value={preset}
          onChange={(v) => {
            if (v === "custom") return;
            setA(PRESETS[v].a);
            setBv(PRESETS[v].bv);
          }}
          options={[
            ...(Object.keys(PRESETS) as PresetKey[]).map((k) => ({ v: k as PresetKey | "custom", t: PRESETS[k].t })),
            { v: "custom", t: "Custom" },
          ]}
        />
        <Slider label="Plate perforation" hint="plates → rods" value={a} min={0} max={2.4} step={0.05} onChange={setA} format={(v) => v.toFixed(2)} />
        <Slider label="Bone volume fraction" value={bv} min={0.06} max={0.45} step={0.01} onChange={setBv} format={pct} />
        <Readouts>
          <Readout label="Conn.D" value={m ? fmt(m.cd, 2) : "-"} unit="mm⁻³" accent />
          <Readout label="χ (purified) / particles" value={m ? `${m.chi} / ${m.b0}` : "-"} />
          <Readout label="Conn β₁" value={m ? String(m.conn) : "-"} />
          <Readout label="BV/TV" value={m ? (m.bv * 100).toFixed(1) : "-"} unit="%" />
        </Readouts>
      </Controls>
    </Panel>
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

export function ThicknessPanel({ kind, className }: { kind: Kind; className?: string }) {
  const C = CFG[kind];
  const [ref, seen] = useInView<HTMLDivElement>();
  const lab = useRef<{ q: Float32Array; sorted: Float32Array; d: Dims; lt: Float32Array | null; beta: number } | null>(null);
  const [vs, setVs] = useState<VolumeScene | null>(null);
  const [sch, setSch] = useState<ThicknessSchematic | SeparationSchematic | null>(null);
  const [bv, setBv] = useState(C.bv);
  const [sweep, setSweep] = useState<number | null>(null);
  // colour bar matches the height of the section frame beside it
  const sliceBox = useRef<HTMLDivElement>(null);
  const [barH, setBarH] = useState(0);
  const barBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sliceBox.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setBarH((el.firstElementChild as HTMLElement | null)?.getBoundingClientRect().height ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const played = useRef(false);
  const [busy, setBusy] = useState(false);
  const [st, setSt] = useState<null | (ReturnType<typeof phaseStats> & { bv: number })>(null);
  const [px, setPx] = useRaster();

  useEffect(() => {
    if (!seen || lab.current) return;
    schedule(() => {
      const d: Dims = [64, 64, 64];
      const q = qField(makeField(C.seed, d, [C.s, C.s, C.s]), C.a);
      lab.current = { q, sorted: sortedCopy(q), d, lt: null, beta: 0 };
      const v = new VolumeScene(d, { ramp: C.stops });
      v.setQ(q);
      v.set({ uMode: 1, uPhase: C.fg ? 1 : -1, uAlpha: 1 });
      v.scene.add(planeOutline(0));
      setVs(v);
      schedule(() => {
        prepareSchematics(); // shared distance field, built once for both insets
        setSch(kind === "th" ? new ThicknessSchematic() : new SeparationSchematic());
      });
    });
  }, [seen, C, kind]);

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
    [vs, bv],
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
    <Panel wide id={kind === "th" ? "tb-th" : "tb-sp"} num={kind === "th" ? "3.3" : "3.4"} fig={kind === "th" ? 3 : 4} className={className}>
      {/* one horizontal row: colour bar, specimen, section, sphere-fitting schematic */}
      <div ref={ref} className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-4 gap-y-5 lg:grid-cols-[auto_1.15fr_1fr_1fr] lg:gap-x-6">
        <div ref={barBox} className="row-span-2 lg:row-span-1" style={{ height: barH || 200 }}>
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
        <div className="fig relative aspect-square">
          <Viewer view={vs} interactive={false} alt={`Volume coloured by local ${kind === "th" ? "thickness" : "separation"}`} />
          {busy && <span className="absolute left-1 top-1 rounded-full bg-white/85 px-2 py-0.5 text-[10px] text-stone-500">fitting spheres…</span>}
        </div>
        <div ref={sliceBox}>
          <Frame>
            <SliceCanvas pixels={px} R={R} alt={`Section at the analysis plane coloured by local ${kind === "th" ? "thickness" : "separation"}`} />
          </Frame>
        </div>
        <div className="col-span-2 lg:col-span-1">
          <Frame>
            <Viewer
              view={sch}
              interactive={false}
              maxDpr={2}
              alt={kind === "th" ? "Schematic trabecula with its chain of maximal inscribed spheres" : "Schematic pores between trabeculae with the largest sphere in each pore"}
            />
          </Frame>
        </div>
      </div>
      <p className="mx-auto mt-5 max-w-[60ch] text-center text-[16px] leading-snug text-stone-800">
        {C.label} is calculated as the diameter of the largest sphere that fits inside each {kind === "th" ? "trabecula of bone" : "pore"}.
      </p>

      <Controls>
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
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-stone-500">
          <button type="button" onClick={play} className="rounded-full border border-stone-300 px-3 py-1 text-[12px] text-stone-700 hover:bg-stone-100">
            ▶ Sweep the colour scale
          </button>
          <span>{sweep === null ? "All values shown" : `Highlighting ${fmt(Math.max(0, sweep - C.band), 2)} to ${fmt(sweep + C.band, 2)} mm`}</span>
        </div>
        <Readouts>
          <Readout label={`${metric} mean`} value={st ? fmt(st.mean, 3) : "-"} unit="mm" accent />
          <Readout label="SD" value={st ? fmt(st.sd, 3) : "-"} unit="mm" />
          <Readout label={`${metric} max`} value={st ? fmt(st.max, 2) : "-"} unit="mm" />
          <Readout label="BV/TV" value={st ? (st.bv * 100).toFixed(1) : "-"} unit="%" />
        </Readouts>
      </Controls>
    </Panel>
  );
}
