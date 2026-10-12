/* =====================================================================
   5.5  Two clocks: thinning vs rung loss by bone age.
   ---------------------------------------------------------------------
   Each unloaded stratum is compared with ambulatory bone of the same
   bone age (AMB depth = ratio x HLU depth), not the same depth.
   Data: two_clocks.json (grid over growth ratio x stratum x diet, V12 out).
   ===================================================================== */

import { useEffect, useMemo, useRef, useState } from "react";
import TC from "./data/two_clocks.json";
import { Seg, Slider, Toggle } from "./ui";
import { reducedMotion, tween } from "./utils/tween";

type Metric = { hlu_over_amb: number | null; g: number; n_hlu: number; n_amb: number; hlu_rats: number[]; amb_rats: number[] };
type Row = { ratio: number; stratum: number; diet: string; hlu_depth_mm: number; amb_depth_mm: number } & Record<SeriesKey | "tr_long", Metric>;
type SeriesKey = "tbth" | "rung_length" | "column_length" | "bvtv";
type Diet = "all" | "HP" | "NP";

const GRID = TC.grid as unknown as Row[];
const GROW = TC.growth_mm_during_HLU;
const STRATA = [1, 2, 3, 4];
const row = (ratio: number, s: number, diet: Diet) => GRID.find((r) => Math.abs(r.ratio - ratio) < 1e-6 && r.stratum === s && r.diet === diet);

const SERIES: { key: SeriesKey; name: string; color: string; width: number; dash?: string }[] = [
  { key: "tbth", name: "Tb.Th", color: "#C06A1C", width: 2 },
  { key: "rung_length", name: "rung length", color: "#1C1C1E", width: 2 },
  { key: "column_length", name: "column length", color: "#9A9DA2", width: 1.5, dash: "5 4" },
  { key: "bvtv", name: "BV/TV", color: "#D9A23A", width: 1 },
];

const W = 760;
const H = 460;
const M = { l: 64, r: 24, t: 26, b: 78 };
const X = (mm: number) => M.l + (mm / 3.6) * (W - M.l - M.r);
const LY = [Math.log(0.35), Math.log(1.6)];
const Y = (v: number) => M.t + (1 - (Math.log(Math.max(0.3, v)) - LY[0]) / (LY[1] - LY[0])) * (H - M.t - M.b);
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const times = (v: number) => `×${v.toFixed(2)}`;

type Pt = { x: number; y: number };
type Shown = Record<SeriesKey, Pt[]>;

/** Point positions for every series at a grid row (ratio, diet). */
function layout(ratio: number, diet: Diet): Shown {
  return Object.fromEntries(
    SERIES.map((s) => [
      s.key,
      STRATA.map((k) => {
        const r = row(ratio, k, diet);
        return r && r[s.key].hlu_over_amb !== null ? { x: X(r.amb_depth_mm), y: Y(r[s.key].hlu_over_amb as number) } : { x: NaN, y: NaN };
      }),
    ])
  ) as Shown;
}

export function TwoClocksSection() {
  const [diet, setDiet] = useState<Diet>("all");
  const [ratio, setRatio] = useState(1.95);
  const [f, setF] = useState(1);
  const [bv, setBv] = useState(false);
  const [callouts, setCallouts] = useState(true);
  const [tip, setTip] = useState<{ s: number; key: SeriesKey; x: number; y: number } | null>(null);
  const touch = () => setCallouts(false);

  // intro timeline: axes, boundary, Tb.Th line, pause, rung line, column line, callouts
  const box = useRef<HTMLDivElement>(null);
  const [tl, setTl] = useState(reducedMotion() ? 99 : 0);
  useEffect(() => {
    const el = box.current;
    if (!el || reducedMotion()) return;
    let stop = () => {};
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        stop = tween(0, 3650, 3650, setTl, { ease: (t) => t });
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      stop();
    };
  }, []);
  const ph = (start: number, dur: number) => Math.min(1, Math.max(0, (tl - start) / dur));
  const axesOp = ph(0, 300);
  const drop = ph(300, 400);
  const draw: Record<SeriesKey, number> = { tbth: ph(700, 900), rung_length: ph(1850, 900), column_length: ph(2750, 600), bvtv: 1 };
  const calloutOp = ph(3350, 300) * (callouts ? 1 : 0);

  // animated positions: 250 ms for a ratio change, 500 ms for a diet change
  const target = useMemo(() => layout(ratio, diet), [ratio, diet]);
  const [shown, setShown] = useState<Shown>(target);
  const from = useRef(target);
  const last = useRef({ ratio, diet });
  useEffect(() => {
    const a = from.current;
    const ms = last.current.diet !== diet ? 500 : 250;
    last.current = { ratio, diet };
    return tween(0, 1, ms, (k) => {
      const lerp = (p: Pt, q: Pt): Pt => (Number.isNaN(p.x) ? q : Number.isNaN(q.x) ? q : { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
      const next = Object.fromEntries(SERIES.map((s) => [s.key, target[s.key].map((q, i) => lerp(a[s.key][i], q))])) as Shown;
      from.current = next;
      setShown(next);
    });
  }, [target, ratio, diet]);

  // boundary: bone formed when unloading started now sits at AMB depth 1.74 f
  const [bx, setBx] = useState(X(GROW.AMB * f));
  const bxRef = useRef(bx);
  useEffect(() => tween(bxRef.current, X(GROW.AMB * f), 150, (v) => ((bxRef.current = v), setBx(v))), [f]);

  const cell = (s: number) => row(ratio, s, diet);
  const v = (s: number, k: SeriesKey) => cell(s)?.[k].hlu_over_amb ?? NaN;
  const series = SERIES.filter((s) => s.key !== "bvtv" || bv);
  const path = (pts: Pt[]) =>
    pts
      .filter((p) => !Number.isNaN(p.x))
      .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join("");

  const yTicks = [0.4, 0.5, 0.6, 0.8, 1, 1.25, 1.6];
  const xTicks = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
  const s3 = { tb: shown.tbth[2], rung: shown.rung_length[2] };
  const tipRow = tip ? cell(tip.s) : undefined;

  return (
    <section id="two-clocks" aria-labelledby="two-clocks-t" className="row-full border-t border-[#e7e5e4] pt-8">
      <h3 id="two-clocks-t">
        <span className="secnum">5.5</span>
        Two clocks
      </h3>
      <p className="abbr">Unloaded over ambulatory bone of the same age, by depth</p>
      <p className="mb-5 max-w-[80ch] text-[15px] leading-relaxed text-[#1C1C1E]">
        Compare unloaded bone with ambulatory bone of the same age instead of the same depth, and the loss splits in two. Thinning reaches bone that
        was already there when the rats went up. Missing cross-braces don't.
      </p>

      <figure>
        <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-[#1C1C1E]">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-2">
              <svg width="24" height="8" aria-hidden="true">
                <line x1="0" x2="24" y1="4" y2="4" stroke={s.color} strokeWidth={s.width + 0.5} strokeDasharray={s.dash} />
              </svg>
              {s.name}
            </span>
          ))}
          <span className="text-[#76797E]">hollow S₁: primary spongiosa · faded S₄: sparse match, read with caution</span>
        </div>
        <div ref={box} className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Unloaded over ambulatory ratio for Tb.Th, rung length and column length against bone age">
            {/* young-bone shading and boundary */}
            <g opacity={axesOp}>
              <rect x={M.l} y={M.t} width={Math.max(0, bx - M.l)} height={H - M.t - M.b} fill="#F4EFE6" />
              <text x={M.l + 8} y={M.t + 16} fontSize="11" fill="#76797E">
                young when unloading started
              </text>
            </g>
            <g transform={`translate(0 ${(1 - drop) * -(H - M.b)})`} opacity={drop}>
              <line x1={bx} x2={bx} y1={M.t} y2={H - M.b} stroke="#76797E" strokeWidth={1.2} />
              <text x={bx + 5} y={H - M.b - 8} fontSize="11" fill="#1C1C1E">
                unloading starts
              </text>
            </g>

            {/* axes */}
            <g opacity={axesOp} fontSize="11.5" fill="#1C1C1E">
              <line x1={M.l} x2={M.l} y1={M.t} y2={H - M.b} stroke="#1C1C1E" />
              <line x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} stroke="#1C1C1E" />
              {yTicks.map((t) => (
                <g key={t}>
                  <line x1={M.l - 4} x2={M.l} y1={Y(t)} y2={Y(t)} stroke="#1C1C1E" />
                  <text x={M.l - 8} y={Y(t)} textAnchor="end" dominantBaseline="middle">
                    {t}
                  </text>
                </g>
              ))}
              <line x1={M.l} x2={W - M.r} y1={Y(1)} y2={Y(1)} stroke="#BDBDBD" strokeDasharray="4 3" />
              <text x={W - M.r - 4} y={Y(1) - 6} textAnchor="end" fontSize="11" fill="#76797E">
                no difference
              </text>
              {xTicks.map((t) => (
                <g key={t}>
                  <line x1={X(t)} x2={X(t)} y1={H - M.b} y2={H - M.b + 4} stroke="#1C1C1E" />
                  <text x={X(t)} y={H - M.b + 17} textAnchor="middle">
                    {t.toFixed(1)}
                  </text>
                  <text x={X(t)} y={H - M.b + 33} textAnchor="middle" fill="#A9AFB7" fontSize="10.5">
                    {(t / ratio).toFixed(2)}
                  </text>
                </g>
              ))}
              <text x={(M.l + W - M.r) / 2} y={H - 24} textAnchor="middle">
                matched ambulatory depth (bone age), mm
              </text>
              <text x={(M.l + W - M.r) / 2} y={H - 8} textAnchor="middle" fill="#A9AFB7" fontSize="10.5">
                unloaded depth that maps there, mm
              </text>
              <text transform={`translate(16 ${(M.t + H - M.b) / 2}) rotate(-90)`} textAnchor="middle">
                unloaded / ambulatory (log scale)
              </text>
            </g>

            {/* series */}
            {series.map((s) => {
              const pts = shown[s.key];
              const k = draw[s.key];
              return (
                <g key={s.key}>
                  {/* per-rat dots behind */}
                  <g opacity={0.35 * k}>
                    {STRATA.map((st, i) => {
                      const r = cell(st);
                      const p = pts[i];
                      if (!r || Number.isNaN(p.x) || r[s.key].hlu_over_amb === null) return null;
                      const am = mean(r[s.key].amb_rats);
                      return r[s.key].hlu_rats.map((h, j) => <circle key={j} cx={p.x + (j - (r[s.key].hlu_rats.length - 1) / 2) * 2.2} cy={Y(Math.exp(h - am))} r={2.5} fill={s.color} />);
                    })}
                  </g>
                  <path d={path(pts)} fill="none" stroke={s.color} strokeWidth={s.width} pathLength={1} strokeDasharray={s.dash ? undefined : 1} strokeDashoffset={s.dash ? undefined : 1 - k} opacity={s.dash ? k : 1} style={s.dash ? { strokeDasharray: s.dash } : undefined} />
                  {pts.map((p, i) =>
                    Number.isNaN(p.x) ? null : (
                      <circle
                        key={i}
                        cx={p.x}
                        cy={p.y}
                        r={4.5}
                        fill={i === 0 ? "white" : s.color}
                        stroke={s.color}
                        strokeWidth={1.6}
                        opacity={(i === 3 ? 0.5 : 1) * k}
                        onPointerEnter={() => setTip({ s: STRATA[i], key: s.key, x: p.x, y: p.y })}
                        onPointerLeave={() => setTip(null)}
                        style={{ cursor: "default" }}
                      />
                    )
                  )}
                </g>
              );
            })}

            {/* S3 callouts */}
            <g opacity={calloutOp} fontSize="12" fill="#1C1C1E">
              {!Number.isNaN(s3.tb.x) && (
                <text x={s3.tb.x + 10} y={s3.tb.y + 16} fontWeight="bold" fill="#C06A1C">
                  S₃: thinner by {Math.round((1 - v(3, "tbth")) * 100)}%
                </text>
              )}
              {!Number.isNaN(s3.rung.x) && (
                <text x={s3.rung.x + 10} y={s3.rung.y - 10} fontWeight="bold">
                  rungs mostly intact
                </text>
              )}
            </g>

          </svg>

          {tip && tipRow && (
            <div
              className="pointer-events-none absolute z-10 w-[250px] rounded-md border border-[#E8E8E8] bg-white/95 p-3 text-[12px] leading-snug shadow-lg"
              style={{ left: `${(tip.x / W) * 100}%`, top: `${(tip.y / H) * 100}%`, transform: tip.x > W * 0.6 ? "translate(calc(-100% - 12px), 12px)" : "translate(12px, 12px)" }}
            >
              <p className="font-bold">
                S{String.fromCharCode(0x2080 + tip.s)} · {SERIES.find((s) => s.key === tip.key)!.name}
              </p>
              <p className="text-[#76797E]">
                unloaded depth {tipRow.hlu_depth_mm.toFixed(2)} mm · matched ambulatory {tipRow.amb_depth_mm.toFixed(2)} mm
              </p>
              <p className="mt-1 num">
                {times(tipRow[tip.key].hlu_over_amb ?? NaN)} (g {tipRow[tip.key].g.toFixed(1)}) · n {tipRow[tip.key].n_hlu}/{tipRow[tip.key].n_amb}
              </p>
              <p className="num text-[#76797E]">tr/long {times(tipRow.tr_long.hlu_over_amb ?? NaN)}</p>
              {tip.s === 1 && <p className="mt-1 text-[#76797E]">S1 is primary spongiosa; everything is under-built here (columns ×0.47), so it isn't part of the comparison.</p>}
              {tip.s === 4 && <p className="mt-1 text-[#76797E]">Matched ambulatory bone this deep is sparse; read with caution.</p>}
            </div>
          )}
        </div>

        {/* controls */}
        <div className="mt-4 grid gap-4 border-t border-[#ecebe8] pt-4 md:grid-cols-[auto_1fr_1fr_auto] md:items-end">
          <Seg
            label="Diet"
            value={diet}
            onChange={(d) => {
              touch();
              setDiet(d);
            }}
            options={[
              { v: "all", t: "All" },
              { v: "HP", t: "High phosphate" },
              { v: "NP", t: "Normal phosphate" },
            ]}
          />
          <Slider
            label="Growth ratio"
            hint={`ambulatory tibiae grew ${ratio.toFixed(2)}× as much`}
            value={ratio}
            min={1.5}
            max={2.5}
            step={0.05}
            onChange={(r) => {
              touch();
              setRatio(Math.round(r * 20) / 20);
            }}
            format={(r) => r.toFixed(2)}
          />
          <Slider
            label="Proximal plate share f"
            hint="moves only the boundary"
            value={f}
            min={0.5}
            max={1}
            step={0.05}
            onChange={(x) => {
              touch();
              setF(Math.round(x * 20) / 20);
            }}
            format={(x) => x.toFixed(2)}
          />
          <Toggle
            on={bv}
            onChange={(b) => {
              touch();
              setBv(b);
            }}
          >
            show BV/TV
          </Toggle>
        </div>
        <p className="num mt-3 rounded-md bg-white px-3 py-2 text-[13px] text-[#1C1C1E] shadow-[inset_0_0_0_1px_#ecebe8]">
          S₂ rungs {times(v(2, "rung_length"))} · S₃ rungs {times(v(3, "rung_length"))} · S₃ Tb.Th {times(v(3, "tbth"))}
          <span className="ml-3 text-[#76797E]">
            {diet === "all" ? "all diets" : diet === "HP" ? "high phosphate" : "normal phosphate"}, ratio {ratio.toFixed(2)}; descriptive only, n = 5/5/5/4
          </span>
        </p>

        <figcaption>
          <b>Figure 8.</b> Each line is unloaded over ambulatory for bone of the same age. Thickness drops by a fifth on both sides of the line. Rungs are
          missing only in bone that was young when unloading began; a millimetre deeper, the bone kept its braces and just got thinner. Strut thinning and
          brace loss look like one thing at a fixed depth. They are two processes with different reach into the past. High phosphate extends both.
        </figcaption>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[11.5px] leading-relaxed text-[#76797E]">
          <li>Bone age assumes depth below the plate tracks time since formation at a constant growth rate per group. Ratio 1.93 is from whole-tibia length against baseline sacs.</li>
          <li>The proximal plate's share of growth (f) is unknown; it moves the boundary but not the S2 vs S3 contrast. Measurable from the day 11-14 in vivo scans registered to ex vivo.</li>
          <li>Static data can't fully separate "never built" from "built then resorbed". In vivo to ex vivo registration of the same right tibia would show whether S3 rungs present at day 12 are still there at sac (prediction: yes under NP, fewer under HP).</li>
          <li>n = 5 per group per diet (4 HLU-NP, V12 excluded).</li>
        </ul>
      </figure>
    </section>
  );
}
