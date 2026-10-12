/* =====================================================================
   Small parts shared by the three layout concepts: readout atoms, the
   section stack, and the published-figure SVGs used as context evidence.
   Everything here is plain SVG and DOM, no new dependencies.

   The SVG figures take the width they will be rendered at so their
   labels stay at their true size rather than scaling with the drawing.
   ===================================================================== */

import type { ReactNode } from "react";
import { cssRamp, type Stop } from "../bone/colormap";
import { SliceCanvas, type Raster } from "../ui";

/* ------------------------------- atoms ------------------------------- */

/** The one number a concept puts in front of everything else. */
export function Stat({ label, value, unit, accent = true, size = "md" }: { label?: ReactNode; value: string; unit?: string; accent?: boolean; size?: "md" | "lg" }) {
  return (
    <div className="lg-stat">
      {label && <p className="lg-stat-l">{label}</p>}
      <p className={`lg-stat-v ${size === "lg" ? "is-lg" : ""} ${accent ? "is-accent" : ""}`}>
        {value}
        {unit && <span>{unit}</span>}
      </p>
    </div>
  );
}

/** Label above value, for the sheets and rails. */
export function Field({ label, value, unit }: { label: ReactNode; value: string; unit?: string }) {
  return (
    <div className="lg-field">
      <span className="lg-field-l">{label}</span>
      <span className="lg-field-v">
        {value}
        {unit && <i>{unit}</i>}
      </span>
    </div>
  );
}

export function Swatch({ color, children, area = false }: { color: string; children: ReactNode; area?: boolean }) {
  return (
    <span className="lg-swatch">
      <i style={{ background: color }} className={area ? "is-area" : ""} />
      {children}
    </span>
  );
}

/** Colour bar with the value histogram and, while a sweep runs, the highlighted band. */
export function LegendBar({ stops, max, hist, label, sweep, band }: { stops: Stop[]; max: number; hist?: number[]; label: ReactNode; sweep: number | null; band: number }) {
  const pos = sweep === null ? 0 : (1 - sweep / max) * 100;
  const bh = (band / max) * 100;
  return (
    <div className="lg-legend">
      <div className="lg-legend-scale">
        <span className="lg-legend-max">{max.toFixed(1)}</span>
        <div className="lg-legend-bar" style={{ background: cssRamp(stops) }}>
          {sweep !== null && (
            <>
              <span className="lg-legend-band" style={{ top: `${Math.max(0, pos - bh)}%`, height: `${Math.min(100, bh * 2)}%` }} />
              <span className="lg-legend-tick" style={{ top: `${pos}%` }} />
            </>
          )}
        </div>
        <span className="lg-legend-min">0</span>
      </div>
      {hist && (
        <svg className="lg-legend-hist" viewBox={`0 0 26 ${hist.length}`} preserveAspectRatio="none" aria-hidden="true">
          {hist.map((h, i) => {
            const v = ((i + 0.5) / hist.length) * max;
            const lit = sweep === null || Math.abs(v - sweep) <= band;
            return <rect key={i} x={0} y={hist.length - 1 - i + 0.12} width={Math.max(0.4, h * 24)} height={0.76} fill={lit ? "#8c8c93" : "#e6e6e8"} />;
          })}
        </svg>
      )}
      <div className="lg-legend-l">{label}</div>
    </div>
  );
}

/* --------------------------- section stack --------------------------- */

/** Raster sections stacked with hairlines, as one figure. */
export function SectionStack({ items, R }: { items: { raster: Raster; label: string; note?: string }[]; R: number }) {
  return (
    <div className="lg-stack">
      {items.map((it) => (
        <figure className="lg-stack-i" key={it.label}>
          <div className="lg-stack-c">
            <SliceCanvas pixels={it.raster} R={R} alt={it.label} />
          </div>
          <figcaption>
            <span>{it.label}</span>
            {it.note && <i>{it.note}</i>}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/* ------------------------- context figures (SVG) --------------------- */

const jitter = (i: number) => {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Two groups of measurements on one shared axis, with their means: the
 * shape of the thinning result, and honest about how few rats it is.
 */
export function DotCompare({
  groups,
  lo,
  hi,
  unit,
  label,
  w = 300,
  digits = 0,
}: {
  groups: { name: string; values: number[]; tone?: "ink" | "accent" }[];
  lo: number;
  hi: number;
  unit: string;
  label: string;
  w?: number;
  digits?: number;
}) {
  const L = 78;
  const Rp = 16;
  const H = 24 + groups.length * 30;
  const x = (v: number) => L + ((v - lo) / (hi - lo)) * (w - L - Rp);
  const rows = groups.map((g) => ({ ...g, mean: g.values.reduce((s, v) => s + v, 0) / (g.values.length || 1) }));
  const ticks = [lo, (lo + hi) / 2, hi];
  return (
    <figure className="lg-fig">
      <svg viewBox={`0 0 ${w} ${H}`} role="img" aria-label={label} className="lg-fig-svg" style={{ height: H }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={14} y2={H - 22} stroke="#ececee" strokeWidth={1} />
            <text x={x(t)} y={H - 8} textAnchor="middle" className="lg-fig-t">
              {t.toFixed(0)}
            </text>
          </g>
        ))}
        {rows.map((g, gi) => {
          const y = 28 + gi * 30;
          const accent = g.tone === "accent";
          return (
            <g key={g.name}>
              <text x={L - 10} y={y + 4} textAnchor="end" className="lg-fig-t is-name">
                {g.name}
              </text>
              <line x1={L} x2={w - Rp} y1={y} y2={y} stroke="#f2f2f4" strokeWidth={1} />
              {g.values.map((v, i) => (
                <circle key={i} cx={x(v)} cy={y + (jitter(i + gi * 7) - 0.5) * 13} r={2.6} fill={accent ? "#b3244f" : "#2c2c31"} opacity={0.72} />
              ))}
              <line x1={x(g.mean)} x2={x(g.mean)} y1={y - 10} y2={y + 10} stroke={accent ? "#b3244f" : "#2c2c31"} strokeWidth={2} />
              <text x={x(g.mean) + (accent ? -8 : 8)} y={y - 12} textAnchor={accent ? "end" : "start"} className="lg-fig-t is-mean">
                {g.mean.toFixed(digits)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="lg-fig-cap">
        {label} · {unit}
      </figcaption>
    </figure>
  );
}

/** Thinning, stratum by stratum: one hairline row per 0.5 mm of depth. */
export function ThinRows({ rows, lo = 0.6, hi = 1.05, w = 300 }: { rows: { label: string; value: number }[]; lo?: number; hi?: number; w?: number }) {
  const L = 34;
  const Rp = 40;
  const H = 22 + rows.length * 16;
  const x = (v: number) => L + ((v - lo) / (hi - lo)) * (w - L - Rp);
  return (
    <figure className="lg-fig">
      <svg viewBox={`0 0 ${w} ${H}`} role="img" aria-label="Trabecular thickness ratio between unloaded and ambulatory bone, by depth stratum" className="lg-fig-svg" style={{ height: H }}>
        <line x1={x(1)} x2={x(1)} y1={6} y2={H - 14} stroke="#d7d7db" strokeWidth={1} />
        <text x={x(1)} y={H - 2} textAnchor="middle" className="lg-fig-t">
          1.00
        </text>
        {rows.map((r, i) => {
          const y = 16 + i * 16;
          const end = x(r.value);
          const ref = x(1);
          return (
            <g key={r.label}>
              <text x={L - 8} y={y + 4} textAnchor="end" className="lg-fig-t is-name">
                {r.label}
              </text>
              <line x1={L} x2={w - Rp} y1={y} y2={y} stroke="#f4f4f6" />
              <rect x={end} y={y - 3} width={Math.max(1, ref - end)} height={6} fill="#b3244f" opacity={0.15} />
              <circle cx={end} cy={y} r={3.2} fill="#b3244f" />
              <text x={w - 2} y={y + 4} textAnchor="end" className="lg-fig-t is-val">
                {r.value.toFixed(2)}×
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="lg-fig-cap">Trabecular thickness, unloaded over ambulatory, by stratum (1.00 is no difference).</figcaption>
    </figure>
  );
}

/** Where the bone went: loss split into struts vanishing and struts thinning. */
export function SplitRows({ rows, w = 300 }: { rows: { label: string; length: number; thin: number }[]; w?: number }) {
  const L = 34;
  const Rw = 62;
  const H = 30 + rows.length * 18;
  const total = Math.max(...rows.map((r) => r.length + r.thin));
  const bw = (v: number) => (v / total) * (w - L - Rw);
  return (
    <figure className="lg-fig">
      <svg viewBox={`0 0 ${w} ${H}`} role="img" aria-label="Bone volume lost, split into missing struts and thinner struts, by stratum" className="lg-fig-svg" style={{ height: H }}>
        <text x={L} y={9} className="lg-fig-t is-name">
          missing struts
        </text>
        <text x={L + bw(rows[0].length) + 8} y={9} className="lg-fig-t is-name is-accent">
          thinner struts
        </text>
        {rows.map((r, i) => {
          const y = 22 + i * 18;
          return (
            <g key={r.label}>
              <text x={L - 8} y={y + 4} textAnchor="end" className="lg-fig-t is-name">
                {r.label}
              </text>
              <rect x={L} y={y - 4.5} width={bw(r.length)} height={9} fill="#2c2c31" />
              <rect x={L + bw(r.length)} y={y - 4.5} width={bw(r.thin)} height={9} fill="#b3244f" opacity={0.75} />
              <text x={w - 2} y={y + 4} textAnchor="end" className="lg-fig-t is-val">
                {(r.length * 100).toFixed(0)} / {(r.thin * 100).toFixed(0)} %
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="lg-fig-cap">Share of the volume lost to each mechanism, by stratum.</figcaption>
    </figure>
  );
}

/** One claim, one number, one line of context. */
export function Finding({ children, num: n, unit }: { children: ReactNode; num: string; unit?: string }) {
  return (
    <div className="lg-finding">
      <p className="lg-finding-n">
        {n}
        {unit && <span>{unit}</span>}
      </p>
      <p className="lg-finding-t">{children}</p>
    </div>
  );
}
