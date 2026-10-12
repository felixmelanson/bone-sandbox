import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { GlassSlider } from "./glass";
import { cssRamp, type Stop } from "./bone/colormap";
import { METRICS } from "./text";

/* ----------------------------- scheduling --------------------------- */

const queue: (() => void)[] = [];
let busy = false;
function pump() {
  if (busy) return;
  const fn = queue.shift();
  if (!fn) return;
  busy = true;
  setTimeout(() => {
    try {
      fn();
    } finally {
      busy = false;
      pump();
    }
  }, 16);
}
/** Run heavy builds one after another so the page never locks up. */
export function schedule(fn: () => void) {
  queue.push(fn);
  pump();
}

export function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          el.classList.add("is-visible");
          io.disconnect();
        }
      },
      { rootMargin: "300px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen] as const;
}

/** Debounced effect: runs `fn` `ms` after deps stop changing. */
export function useDebounced(fn: () => void, deps: unknown[], ms: number) {
  useEffect(() => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** rAF-coalesced effect for cheap-but-not-free work during drags. */
export function useFrame(fn: () => void, deps: unknown[]) {
  useEffect(() => {
    const id = requestAnimationFrame(fn);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/* ------------------------------- layout ----------------------------- */

/** Metric body as in the original layout: text on the left, figure and controls on the right. */
export function Panel({
  id,
  num,
  fig,
  className = "",
  wide = false,
  children,
}: {
  id: string;
  num?: string;
  fig: number;
  className?: string;
  /** rows with three or four views give the figure more of the width */
  wide?: boolean;
  children: ReactNode;
}) {
  const t = METRICS[id];
  return (
    <section id={id} aria-labelledby={`${id}-t`} className={`og-row ${wide ? "wide" : ""} ${className}`}>
      <div className="og-text">
        <h3 id={`${id}-t`} className="og-h">
          <span className="secnum">{num}</span>
          {t.title}
        </h3>
        <p className="og-abbr">{t.abbr}</p>
        <div className="prose">{t.body}</div>
      </div>
      <figure className="og-fig">
        {children}
        <figcaption>
          <b>Figure {fig}.</b> {t.caption}
        </figcaption>
      </figure>
    </section>
  );
}

export function Frame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`fig frame2d relative aspect-square w-full border border-stone-800 bg-white ${className}`}>
      {children}
    </div>
  );
}

export function Controls({ children }: { children: ReactNode }) {
  return <div className="controls mt-5 grid gap-3 border-t border-stone-200 pt-4">{children}</div>;
}

export function Readouts({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">{children}</dl>;
}

export function Readout({ label, value, unit, accent }: { label: ReactNode; value: string; unit?: ReactNode; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10.5px] uppercase tracking-[0.12em] text-stone-500">{label}</dt>
      <dd className={`num text-[17px] leading-tight ${accent ? "text-[#b3244f]" : "text-stone-900"}`}>
        {value}
        {unit && <span className="ml-1 text-[11px] text-stone-500">{unit}</span>}
      </dd>
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  hint,
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="block">
      <span className="flex items-baseline justify-between gap-3 text-[13px] text-stone-700">
        <span id={id}>
          {label}
          {hint && <span className="ml-1.5 text-[11px] text-stone-400">{hint}</span>}
        </span>
        <span className="num text-stone-900">{format(value)}</span>
      </span>
      <GlassSlider value={value} min={min} max={max} step={step} onChange={onChange} labelledBy={id} valueText={format(value)} />
    </div>
  );
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { v: T; t: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-fit flex-wrap rounded-full border border-stone-300 bg-white p-0.5 text-[12px]">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={`rounded-full px-3 py-1 transition-colors ${value === o.v ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"}`}
        >
          {o.t}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="inline-flex items-center gap-2 text-[12.5px] text-stone-700"
    >
      <span className={`relative h-[18px] w-[32px] rounded-full transition-colors ${on ? "bg-stone-900" : "bg-stone-300"}`}>
        <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all ${on ? "left-[16px]" : "left-[2px]"}`} />
      </span>
      {children}
    </button>
  );
}

/* ------------------- colour bar with histogram and sweep ------------- */

/** Static colour bar with the value histogram. While `sweep` is set, a band marks the values being highlighted on the 3-D view. */
export function ColorBar({
  stops,
  max,
  hist,
  label,
  sweep,
  band,
}: {
  stops: Stop[];
  max: number;
  hist?: number[];
  label: ReactNode;
  sweep: number | null;
  band: number;
}) {
  const pos = sweep === null ? 0 : (1 - sweep / max) * 100;
  const bh = (band / max) * 100;
  return (
    <div className="flex h-full select-none items-stretch gap-1.5">
      <div className="flex w-[44px] flex-col items-end justify-between py-0 text-[15px] leading-none text-stone-900">
        <span className="num">{max.toFixed(1)}</span>
        <span className="text-right text-[14px] leading-[1.25]">{label}</span>
        <span className="num">0</span>
      </div>
      <div className="relative w-[18px] rounded-[2px] shadow-[0_0_0_1px_rgba(0,0,0,0.08)]" style={{ background: cssRamp(stops) }}>
        {sweep !== null && (
          <>
            <span
              className="pointer-events-none absolute -left-[3px] -right-[3px] border-y border-white bg-white/30"
              style={{ top: `${Math.max(0, pos - bh)}%`, height: `${Math.min(100, bh * 2)}%` }}
            />
            <span className="pointer-events-none absolute -left-[7px] -right-[7px] h-0 border-t-2 border-stone-900" style={{ top: `${pos}%` }} />
          </>
        )}
      </div>
      {hist && (
        <svg className="h-full w-[28px]" viewBox={`0 0 28 ${hist.length}`} preserveAspectRatio="none" aria-hidden="true">
          {hist.map((h, i) => {
            const v = ((i + 0.5) / hist.length) * max;
            const lit = sweep === null || Math.abs(v - sweep) <= band;
            return <rect key={i} x={0} y={hist.length - 1 - i + 0.12} width={Math.max(0.4, h * 26)} height={0.76} fill={lit ? "#a8a29e" : "#e7e5e4"} />;
          })}
        </svg>
      )}
    </div>
  );
}

/* ------------------------- pixel section canvas --------------------- */

/**
 * Section raster: an R x R canvas filled with putImageData and scaled by CSS.
 * No offscreen copy and no per-frame resizing (both made Firefox keep a new
 * surface every frame while a slider moved).
 */
/**
 * Section pixels travel through a ref plus a version number, never as a prop or state value:
 * React 19 development builds record changed props into the performance timeline, and a
 * 200 kB pixel array per frame grew Firefox to several GB while a slider moved.
 */
export type Raster = { ref: React.MutableRefObject<Uint8ClampedArray | null>; v: number };
export function useRaster() {
  const ref = useRef<Uint8ClampedArray | null>(null);
  const [v, setV] = useState(0);
  const set = useCallback((a: Uint8ClampedArray) => {
    ref.current = a;
    setV((n) => n + 1);
  }, []);
  return [{ ref, v } as Raster, set] as const;
}

export function SliceCanvas({ pixels: raster, R, alt }: { pixels: Raster; R: number; alt: string }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const img = useRef<ImageData | null>(null);
  const pixels = raster.v > 0 ? raster.ref.current : null;
  useEffect(() => {
    const c = cv.current;
    const pixels = raster.ref.current;
    if (!c || !pixels) return;
    if (c.width !== R) c.width = c.height = R;
    const ctx = c.getContext("2d", { willReadFrequently: true })!; // CPU-backed: Firefox's GPU canvas re-uploaded through new shared memory on every putImageData
    if (!img.current || img.current.width !== R) img.current = ctx.createImageData(R, R);
    img.current.data.set(pixels);
    ctx.putImageData(img.current, 0, 0);
  }, [raster.v, raster.ref, R]);
  return (
    <canvas
      ref={cv}
      width={R}
      height={R}
      role="img"
      aria-label={alt}
      className={`block h-full w-full transition-opacity duration-500 ${pixels ? "opacity-100" : "opacity-0"}`}
    />
  );
}

export const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "-");
