/* =====================================================================
   5.2 Twins · 5.3 Where the missing bone went · 5.4 Phosphate · caveats
   Data: scrutiny.json (male right tibiae, production 10 µm; V12 out unless noted).
   ===================================================================== */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import SCR from "./data/scrutiny.json";
import { Seg, Toggle } from "./ui";
import { reducedMotion, tween } from "./utils/tween";

const INK = "#1C1C1E";
const MUTED = "#76797E";
const COPPER = "#C06A1C";
const MID = "#9A9DA2";
const SILVER = "#BCC3CB";
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const sub = (n: number) => String.fromCharCode(0x2080 + n);
const fmtSigned = (v: number, d = 0) => (v < 0 ? `-${Math.abs(v).toFixed(d)}` : `+${v.toFixed(d)}`);

type Rat = (typeof SCR.per_rat_band)[number];
const PR = SCR.per_rat_band as Rat[];

/** Run `fn` once when `ref` first scrolls `threshold` into view. */
function useOnView(ref: React.RefObject<Element | null>, fn: () => void, threshold = 0.4) {
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !done.current) {
          done.current = true;
          fn();
        }
      },
      { threshold }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, fn, threshold]);
}

function Block({ id, num, title, abbr, children }: { id: string; num: string; title: string; abbr: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-t`} className="row-full border-t border-[#e7e5e4] pt-8">
      <h3 id={`${id}-t`}>
        <span className="secnum">{num}</span>
        {title}
      </h3>
      <p className="abbr">{abbr}</p>
      {children}
    </section>
  );
}

const Foot = ({ children }: { children: ReactNode }) => <p className="mt-2 max-w-[90ch] text-[11.5px] leading-relaxed text-[#76797E]">{children}</p>;
const Cap = ({ children }: { children: ReactNode }) => <p className="mt-4 max-w-[90ch] text-[14px] leading-relaxed text-[#1C1C1E]">{children}</p>;

/* =============================== 5.2 ================================ */

const AMB_POOL = PR.filter((r) => r.load === "AMB" && !r.qc_exclude && r.P2_far !== null && !r.orientation_flag);
const TWINS = SCR.matched_twins;
const TWIN_ROWS = [...TWINS].map((t) => ({ ...t, gap: t.tbth_um - t.twin_tbth_um })).sort((a, b) => a.gap - b.gap);
const ambPt = (rat: string, s: number) => AMB_POOL.find((r) => r.rat === rat && r.stratum === s);

function Twins() {
  const [stage, setStage] = useState(0);
  const [p1, setP1] = useState(0); // twin lines drawn
  const [p2, setP2] = useState(0); // morph to dumbbells
  const cancel = useRef<() => void>(() => {});
  const W = 640;
  const H = 420;
  const m = { l: 58, r: 20, t: 18, b: 46 };
  const xA = (v: number) => m.l + (v / 0.45) * (W - m.l - m.r);
  const yA = (v: number) => H - m.b - (v / 0.5) * (H - m.t - m.b);
  const xB = (v: number) => m.l + ((v - 90) / 70) * (W - m.l - m.r);
  const yB = (i: number) => m.t + 26 + (i + 0.5) * ((H - m.t - m.b - 26) / TWIN_ROWS.length);
  const DRAW = 300;
  const STAG = 40;
  const T1 = DRAW + STAG * (TWINS.length - 1);

  const next = () => {
    cancel.current();
    if (stage === 0) {
      setStage(1);
      cancel.current = tween(0, 1, T1, setP1, { ease: (t) => t });
    } else if (stage === 1) {
      setStage(2);
      cancel.current = tween(0, 1, 1200, setP2);
    } else {
      setStage(0);
      setP1(0);
      setP2(0);
    }
  };

  const gaps = TWIN_ROWS.map((r) => r.gap);
  const meanGap = mean(gaps);
  const thinner = gaps.filter((g) => g < 0).length;
  const lineOp = clamp01(1 - p2 / 0.25);
  const twinSet = new Set(TWINS.flatMap((t) => t.twins.map((w) => `${w.rat}-${w.stratum}`)));
  const tMs = p1 * T1;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[720px]" role="img" aria-label="Unloaded rats matched to their three nearest ambulatory rat-strata on BV/TV and P2far, then compared on thickness">
        {/* axes A: BV/TV vs P2 */}
        <g opacity={1 - p2}>
          <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} stroke={INK} />
          <line x1={m.l} x2={m.l} y1={m.t} y2={H - m.b} stroke={INK} />
          {[0, 0.1, 0.2, 0.3, 0.4].map((v) => (
            <text key={v} x={xA(v)} y={H - m.b + 16} textAnchor="middle" fontSize="11" fill={INK}>
              {v.toFixed(1)}
            </text>
          ))}
          {[0, 0.1, 0.2, 0.3, 0.4, 0.5].map((v) => (
            <text key={v} x={m.l - 8} y={yA(v)} textAnchor="end" dominantBaseline="middle" fontSize="11" fill={INK}>
              {v.toFixed(1)}
            </text>
          ))}
          <text x={(m.l + W - m.r) / 2} y={H - 8} textAnchor="middle" fontSize="12" fill={INK}>
            BV/TV
          </text>
          <text transform={`translate(16 ${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle" fontSize="12" fill={INK}>
            P₂far
          </text>
        </g>
        {/* axes B: Tb.Th */}
        <g opacity={p2}>
          <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} stroke={INK} />
          {[90, 100, 110, 120, 130, 140, 150, 160].map((v) => (
            <g key={v}>
              <line x1={xB(v)} x2={xB(v)} y1={m.t} y2={H - m.b} stroke="#F0F0F0" />
              <text x={xB(v)} y={H - m.b + 16} textAnchor="middle" fontSize="11" fill={INK}>
                {v}
              </text>
            </g>
          ))}
          <text x={(m.l + W - m.r) / 2} y={H - 8} textAnchor="middle" fontSize="12" fill={INK}>
            Tb.Th (µm)
          </text>
        </g>

        {/* ambulatory pool */}
        <g opacity={1 - p2}>
          {AMB_POOL.map((r) => {
            const tw = twinSet.has(`${r.rat}-${r.stratum}`);
            return (
              <circle key={`${r.rat}-${r.stratum}`} cx={xA(r.bvtv)} cy={yA(r.P2_far as number)} r={tw ? lerp(3, 4, p1) : 3} fill={tw && p1 > 0 ? `color-mix(in srgb, ${SILVER}, ${INK} ${Math.round(45 * p1)}%)` : SILVER}>
                <title>{`${r.rat} S${r.stratum} (ambulatory)`}</title>
              </circle>
            );
          })}
        </g>

        {/* hairlines to the three twins */}
        <g opacity={lineOp}>
          {TWINS.map((t, i) => {
            const k = clamp01((tMs - i * STAG) / DRAW);
            return t.twins.map((w) => {
              const a = ambPt(w.rat, w.stratum);
              if (!a) return null;
              const x1 = xA(t.bvtv);
              const y1 = yA(t.P2_far);
              const x2 = xA(a.bvtv);
              const y2 = yA(a.P2_far as number);
              const len = Math.hypot(x2 - x1, y2 - y1);
              return <line key={`${i}-${w.rat}-${w.stratum}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={COPPER} strokeWidth={0.8} strokeDasharray={len} strokeDashoffset={len * (1 - k)} opacity={0.75} />;
            });
          })}
        </g>

        {/* dumbbells and unloaded points */}
        {TWIN_ROWS.map((t, i) => {
          const hx = lerp(xA(t.bvtv), xB(t.tbth_um), p2);
          const hy = lerp(yA(t.P2_far), yB(i), p2);
          const cx = lerp(xA(t.twin_bvtv), xB(t.twin_tbth_um), p2);
          const cy = lerp(yA(t.twin_P2_far), yB(i), p2);
          const s2 = t.stratum === 2;
          return (
            <g key={`${t.hlu_rat}-${t.stratum}`}>
              <line x1={hx} y1={hy} x2={cx} y2={cy} stroke={MID} strokeWidth={2} opacity={p2} />
              <circle cx={cx} cy={cy} r={4} fill={MID} opacity={Math.max(p2, 0)} />
              <circle cx={hx} cy={hy} r={5} fill={s2 ? COPPER : "white"} stroke={COPPER} strokeWidth={s2 ? 0 : 1.6}>
                <title>{`${t.hlu_rat} S${t.stratum} (unloaded)`}</title>
              </circle>
              <text x={Math.max(hx, cx) + 8} y={hy} dominantBaseline="middle" fontSize="10" fill={MUTED} opacity={p2}>
                {t.hlu_rat} S{sub(t.stratum)}
              </text>
            </g>
          );
        })}

        {/* summary: group means of the unloaded points and of their twins */}
        <g opacity={clamp01((p2 - 0.8) / 0.2)}>
          {[
            { v: mean(TWIN_ROWS.map((r) => r.tbth_um)), c: COPPER },
            { v: mean(TWIN_ROWS.map((r) => r.twin_tbth_um)), c: MID },
          ].map((g) => (
            <line key={g.c} x1={xB(g.v)} x2={xB(g.v)} y1={m.t + 22} y2={H - m.b} stroke={g.c} strokeDasharray="4 3" />
          ))}
          <text x={(m.l + W - m.r) / 2} y={m.t + 4} textAnchor="middle" dominantBaseline="hanging" fontSize="13" fontWeight="bold" fill={INK}>
            {thinner} / {TWIN_ROWS.length} thinner · mean {fmtSigned(meanGap)} µm
          </text>
        </g>

        {/* legend */}
        <g opacity={1 - p2} fontSize="11" fill={INK}>
          <circle cx={W - 190} cy={m.t + 6} r={5} fill={COPPER} />
          <text x={W - 180} y={m.t + 6} dominantBaseline="middle">
            unloaded, S₂
          </text>
          <circle cx={W - 190} cy={m.t + 22} r={5} fill="white" stroke={COPPER} strokeWidth={1.6} />
          <text x={W - 180} y={m.t + 22} dominantBaseline="middle">
            unloaded, S₃
          </text>
          <circle cx={W - 190} cy={m.t + 38} r={3} fill={SILVER} />
          <text x={W - 180} y={m.t + 38} dominantBaseline="middle">
            ambulatory rat-strata
          </text>
        </g>
      </svg>
      <button type="button" onClick={next} className="mt-2 rounded-full border border-stone-300 px-4 py-1.5 text-[13px] text-stone-800 hover:bg-stone-100">
        {stage === 0 ? "Find twins" : stage === 1 ? "Compare thickness" : "Reset"}
      </button>
    </div>
  );
}

export function TwinsSection() {
  return (
    <Block id="twins" num="5.2" title="Same density, same order, thinner bone" abbr="Each unloaded rat against its three nearest ambulatory rat-strata">
      <Twins />
      <Cap>
        Pick any unloaded rat, find the ambulatory bone that matches it on density and on strut order, and the unloaded bone is still thinner every
        time. Thickness is carrying information that density and order miss, which is why the grid colour matters.
      </Cap>
      <Foot>Distance in AMB SD units of BV/TV and P2far; 3 nearest neighbours; AMB pool S1-S6; orientation-flagged strata excluded; V12 excluded.</Foot>
    </Block>
  );
}

/* =============================== 5.3 ================================ */

const DEC = SCR.bvtv_loss_decomposition;
const THIN = SCR.thinning_ratio_by_class;
const CLASSES = [
  { k: "longitudinal" as const, c: INK, t: "longitudinal" },
  { k: "oblique" as const, c: MID, t: "oblique" },
  { k: "transverse" as const, c: COPPER, t: "transverse" },
];
const G = SCR.hedges_g_HLU_minus_AMB as Record<string, Record<string, number>>;

function Decomposition() {
  const ref = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(reducedMotion() ? 1e9 : 0);
  const start = useMemo(
    () => () => {
      const t0 = performance.now();
      const total = 500 + 700 + 80 * 5 + 600 + 50;
      if (reducedMotion()) return setT(1e9);
      const tick = (now: number) => {
        const e = now - t0;
        setT(e);
        if (e < total) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    []
  );
  useOnView(ref, start, 0.4);

  const maxL = Math.max(...DEC.map((d) => Math.abs(d.log_bvtv_ratio)));
  const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
  const leftDone = 500 + 700 + 80 * 5;

  return (
    <div ref={ref} className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[44px_minmax(0,1.25fr)_minmax(0,1fr)_92px] gap-x-4 pb-2 text-[11.5px] text-[#76797E]">
          <span />
          <span>where the lost volume went (length of bar = lost BV/TV, log ratio)</span>
          <span>class mix: standing ambulatory length (top) vs length lost (bottom)</span>
          <span>thickness kept, L · O · T</span>
        </div>
        {DEC.map((d, i) => {
          const k1 = ease(clamp01((t - i * 80) / 500));
          const k2 = ease(clamp01((t - i * 80 - 500) / 700));
          const k3 = ease(clamp01((t - leftDone - i * 80) / 600));
          const full = Math.abs(d.log_bvtv_ratio) / maxL;
          const thinW = full * d.frac_from_thinning * k1;
          const lenW = full * d.frac_from_length * k2;
          const lost = d.share_of_lost_length;
          const stand = d.share_standing_AMB;
          const propEnd = stand.longitudinal + stand.oblique; // copper should start here if loss were proportional
          const th = THIN.find((x) => x.stratum === d.stratum)!;
          return (
            <div key={d.stratum} className="grid grid-cols-[44px_minmax(0,1.25fr)_minmax(0,1fr)_92px] items-center gap-x-4 border-t border-[#F0F0F0] py-2">
              <span className="text-[14px] italic text-[#1C1C1E]">S{sub(d.stratum)}</span>
              <div className="flex h-5 items-center">
                <div className="h-full bg-[#D6D3D1]" style={{ width: `${thinW * 100}%` }} title={`thinning ${(d.frac_from_thinning * 100).toFixed(0)}%`} />
                {CLASSES.map((c) => (
                  <div key={c.k} className="h-full" style={{ width: `${lenW * lost[c.k] * 100}%`, background: c.c }} title={`missing ${c.t} length`} />
                ))}
                <span className="num ml-2 whitespace-nowrap text-[11px] text-[#76797E]" style={{ opacity: k2 }}>
                  {(d.frac_from_thinning * 100).toFixed(0)}% thinning · {(d.frac_from_length * 100).toFixed(0)}% missing length
                </span>
              </div>
              <div className="relative space-y-1">
                <div className="flex h-2.5 overflow-hidden rounded-sm">
                  {CLASSES.map((c) => (
                    <div key={c.k} style={{ width: `${stand[c.k] * 100}%`, background: c.c }} />
                  ))}
                </div>
                <div className="flex h-2.5 overflow-hidden rounded-sm bg-stone-100">
                  {CLASSES.map((c) => (
                    <div key={c.k} style={{ width: `${lost[c.k] * 100 * k3}%`, background: c.c }} />
                  ))}
                </div>
                <span className="absolute -top-1 h-[26px] w-[2px] bg-[#C06A1C]" style={{ left: `calc(${propEnd * 100}% - 1px)`, opacity: k3 }} />
              </div>
              <span className="num text-[11.5px] text-[#1C1C1E]">
                {th.longitudinal.toFixed(2)} · {th.oblique.toFixed(2)} · <span style={{ color: COPPER }}>{th.transverse.toFixed(2)}</span>
              </span>
            </div>
          );
        })}
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-[#1C1C1E]">
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-3 bg-[#D6D3D1]" /> thinning
          </span>
          {CLASSES.map((c) => (
            <span key={c.k} className="flex items-center gap-1.5">
              <i className="inline-block h-2.5 w-3" style={{ background: c.c }} /> {c.t} length
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-3 w-[2px] bg-[#C06A1C]" /> where transverse would start if loss were proportional
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-y border-[#E8E8E8] py-2 text-[12.5px] text-[#1C1C1E]">
          <span className="font-bold">At S₂, effect size is not effect share:</span>
          <span className="num">Tb.Th g {G.tbth_um["2"].toFixed(1)} · {(DEC[1].frac_from_thinning * 100).toFixed(0)}% of lost volume</span>
          <span className="num">transverse strut share g {G.frac_transverse["2"].toFixed(1)}</span>
          <span className="num">tr/long length ratio g {G.trlong["2"].toFixed(1)}</span>
        </div>
      </div>
    </div>
  );
}

export function DecompositionSection() {
  return (
    <Block id="missing-bone" num="5.3" title="Where the missing bone went" abbr="Lost bone volume split into thinning and missing strut length, by orientation class">
      <Decomposition />
      <Cap>
        Thickness has the biggest effect sizes in the standard suite, so it gets read as the result. It isn't. At 0.5-1.5 mm below the plate, thinning
        explains about a third of the missing bone, and it hits every strut orientation equally. The rest is struts that are gone, and the ones that are
        gone are disproportionately the cross-braces. A thinning metric can't tell you which struts left; a length-by-orientation metric can.
      </Cap>
      <Foot>
        Volume split assumes each class contributes length × π (t/2)² using skeleton length density and length-weighted thickness per class (Morphometry
        IV, all branches). This proxy correlates r = 0.86 with measured BV/TV. S1 class shares include near-cortex points, which inflates the transverse
        share there.
      </Foot>
    </Block>
  );
}

/* =============================== 5.4 ================================ */

type MetricDef = { key: string; name: string; get: (r: Rat) => number | null; p: string; d: number };
const METRICS: MetricDef[] = [
  { key: "P2_far", name: "P₂far", get: (r) => (r.P2_far === null || (r.orientation_flag && !r.qc_exclude) ? null : r.P2_far), p: "P2_far", d: 2 },
  { key: "ltr", name: "log tr/long", get: (r) => (r.tr_long_ratio > 0 ? Math.log(r.tr_long_ratio) : null), p: "ltr", d: 2 },
  { key: "lbv", name: "log BV/TV", get: (r) => (r.bvtv > 0 ? Math.log(r.bvtv) : null), p: "lbv", d: 2 },
  { key: "tbth", name: "Tb.Th (µm)", get: (r) => r.tbth_um, p: "tbth_um", d: 0 },
];
const PHOS_STRATA = [1, 2, 3, 4];
const jit = (s: string) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return ((h % 1000) / 1000 - 0.5) * 0.16;
};
/** Fixed y range per metric across S1-S4 (V12 included) so plots do not rescale. */
const RANGES = Object.fromEntries(
  METRICS.map((m) => {
    const v = PR.filter((r) => r.stratum <= 4).map(m.get).filter((x): x is number => x !== null && Number.isFinite(x));
    const lo = Math.min(...v);
    const hi = Math.max(...v);
    const pad = (hi - lo) * 0.08;
    return [m.key, [lo - pad, hi + pad] as [number, number]];
  })
);

function cellMeans(m: MetricDef, s: number, v12: boolean) {
  const out: Record<string, number> = {};
  for (const load of ["AMB", "HLU"])
    for (const diet of ["HP", "NP"]) {
      const v = PR.filter((r) => r.load === load && r.diet === diet && r.stratum === s && (v12 || !r.qc_exclude))
        .map(m.get)
        .filter((x): x is number => x !== null && Number.isFinite(x));
      out[`${load}-${diet}`] = mean(v);
    }
  return out;
}

function InteractionPlot({ m, s, v12, shown }: { m: MetricDef; s: number; v12: boolean; shown: Record<string, number> }) {
  const W = 200;
  const H = 190;
  const pad = { l: 40, r: 12, t: 12, b: 28 };
  const [lo, hi] = RANGES[m.key];
  const X = (i: number) => pad.l + 18 + i * (W - pad.l - pad.r - 36);
  const Y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const p = SCR.diet_x_load_interaction.find((x) => x.stratum === s && x.metric === m.p);
  const dots = PR.filter((r) => r.stratum === s && (v12 || !r.qc_exclude));
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${m.name} by loading and diet at stratum ${s}`}>
        <line x1={pad.l} x2={pad.l} y1={pad.t} y2={H - pad.b} stroke={INK} />
        {[lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1].map((v) => (
          <text key={v} x={pad.l - 5} y={Y(v)} textAnchor="end" dominantBaseline="middle" fontSize="9.5" fill={MUTED}>
            {v.toFixed(m.d)}
          </text>
        ))}
        {["AMB", "HLU"].map((l, i) => (
          <text key={l} x={X(i)} y={H - pad.b + 16} textAnchor="middle" fontSize="11" fill={INK}>
            {l}
          </text>
        ))}
        {dots.map((r) => {
          const v = m.get(r);
          if (v === null || !Number.isFinite(v)) return null;
          const i = r.load === "AMB" ? 0 : 1;
          const x = X(i) + (r.diet === "HP" ? -10 : 10) + jit(r.rat) * 60;
          const col = r.diet === "HP" ? COPPER : MID;
          return r.qc_exclude ? (
            <circle key={r.rat} cx={x} cy={Y(v)} r={3.6} fill="white" stroke={col} strokeWidth={1.2} strokeDasharray="2 1.5">
              <title>V12 (QC excluded)</title>
            </circle>
          ) : (
            <circle key={r.rat} cx={x} cy={Y(v)} r={2.6} fill={col} opacity={0.35}>
              <title>{`${r.rat} ${r.load} ${r.diet}`}</title>
            </circle>
          );
        })}
        {(["HP", "NP"] as const).map((d) => (
          <g key={d}>
            <line x1={X(0)} x2={X(1)} y1={Y(shown[`AMB-${d}`])} y2={Y(shown[`HLU-${d}`])} stroke={d === "HP" ? COPPER : MID} strokeWidth={2.4} />
            <circle cx={X(0)} cy={Y(shown[`AMB-${d}`])} r={4} fill={d === "HP" ? COPPER : MID} />
            <circle cx={X(1)} cy={Y(shown[`HLU-${d}`])} r={4} fill={d === "HP" ? COPPER : MID} />
          </g>
        ))}
      </svg>
      <figcaption className="text-[12px] text-[#1C1C1E]" style={{ textAlign: "center" }}>
        {m.name}
        <span className="ml-2 text-[11px] text-[#76797E]">p {p ? p.perm_p.toFixed(2) : "-"}</span>
      </figcaption>
    </figure>
  );
}

function Phosphate() {
  const [s, setS] = useState(2);
  const [v12, setV12] = useState(false);
  const target = useMemo(() => Object.fromEntries(METRICS.map((m) => [m.key, cellMeans(m, s, v12)])), [s, v12]);
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const a = from.current;
    return tween(0, 1, 500, (k) => {
      const next = Object.fromEntries(METRICS.map((m) => [m.key, Object.fromEntries(Object.keys(target[m.key]).map((c) => [c, lerp(a[m.key][c], target[m.key][c], k)]))]));
      from.current = next;
      setShown(next);
    });
  }, [target]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4">
        <Seg label="Stratum" value={String(s) as "1" | "2" | "3" | "4"} onChange={(v) => setS(+v)} options={PHOS_STRATA.map((k) => ({ v: String(k) as "1" | "2" | "3" | "4", t: `S${sub(k)}` }))} />
        <Toggle on={v12} onChange={setV12}>
          include V12
        </Toggle>
        <span className="flex items-center gap-3 text-[11.5px] text-[#1C1C1E]">
          <span className="flex items-center gap-1">
            <i className="inline-block h-[3px] w-4" style={{ background: COPPER }} /> high phosphate
          </span>
          <span className="flex items-center gap-1">
            <i className="inline-block h-[3px] w-4" style={{ background: MID }} /> normal phosphate
          </span>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {METRICS.map((m) => (
          <InteractionPlot key={m.key} m={m} s={s} v12={v12} shown={shown[m.key]} />
        ))}
      </div>
      <Foot>
        Parallel lines mean no diet by loading interaction. p is the permutation test of (HLU-HP minus AMB-HP) minus (HLU-NP minus AMB-NP), diet
        shuffled within load, 4000 permutations, V12 out; n = 5/5/5/4. V12 is drawn as a hollow dashed dot when included.
      </Foot>
    </div>
  );
}

export function PhosphateSection() {
  return (
    <Block id="phosphate" num="5.4" title="Phosphate" abbr="Does diet change the unloading effect, or just the starting point?">
      <Phosphate />
      <Cap>
        High phosphate makes everything worse, loaded or not, so the unloaded high-phosphate row starts from a lower floor. Whether phosphate specifically
        speeds up rung loss is suggestive at 0.5-1.0 mm and not resolvable with five rats a cell. One rat with a segmentation fault was most of the
        thickness difference.
      </Cap>
    </Block>
  );
}

/* ============================== caveats ============================= */

export function Caveats() {
  return (
    <details className="mt-6 border-t border-[#E8E8E8] pt-3 text-[12px] leading-relaxed text-[#76797E]">
      <summary className="cursor-pointer select-none text-[12.5px] font-bold text-[#1C1C1E]">Caveats for section 5</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Ellipsoid shape is P2far only. It cannot separate lost rungs from columns tilting toward the depth axis; the class lengths in 5.3 are what pin down rung loss.</li>
        <li>P2far is measured against the local depth gradient. Against scan z it reads 0.02-0.20 higher in the rats checked; whether the AMB-HLU gap depends on the reference is not yet tested.</li>
        <li>n = 5 per cell (4 for HLU-NP after V12). Effect sizes at this n have wide intervals; the effect chart already shows them.</li>
        <li>Fixed-depth strata compare bone of different ages across groups; step 3 of 5.1 is the bone-age view and uses one growth ratio (1.93) from baseline sacs.</li>
        <li>Right tibiae only. Left/right are confounded with scan order and batch, so sides are not pooled.</li>
        <li>Sacrifice fed state differs by group (AMB mostly fed, HLU mostly fasted). Not expected to move trabecular architecture over hours, but it is a group-level confound.</li>
      </ul>
    </details>
  );
}
