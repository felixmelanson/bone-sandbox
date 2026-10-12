/* =====================================================================
   MIL and SVD, drawn the way they are measured, on the analysis section
   (x-z plane), each compared with the structure tensor of the same volume.
   Both sit in the DA figure, under the frontal views.
     MIL  parallel test lines at angle theta; every bone entry is counted;
          MIL(theta) = line length / entries. The sweep traces the rose.
     SVD  random points in bone; rays run until they leave the bone;
          SVD(theta) = mean cubed intercept length.
   ===================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderSlice, type QField } from "./bone/engine";
import { intercept, roseDA, type Rose } from "./bone/fabric";
import { mulberry32, type Dims } from "./bone/volume";
import { reducedMotion } from "./utils/tween";

export type FabricData = {
  q: QField;
  d: Dims;
  beta: number;
  inBone: (x: number, y: number, z: number) => boolean;
  gst: Rose;
};

const R = 220; // section raster
const GOLD: [number, number, number] = [227, 167, 59];
const NAVY: [number, number, number] = [12, 22, 48];
const mixC = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function useSection(f: FabricData | null, bone: [number, number, number], marrow: [number, number, number]) {
  const [img, setImg] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!f) return;
    const px = renderSlice(f.q, f.d, f.beta, f.d[1] / 2, R, (cov) => mixC(marrow, bone, cov));
    const c = document.createElement("canvas");
    c.width = c.height = R;
    const id = c.getContext("2d", { willReadFrequently: true })!.createImageData(R, R);
    id.data.set(px);
    c.getContext("2d", { willReadFrequently: true })!.putImageData(id, 0, 0);
    setImg(c);
  }, [f, bone, marrow]);
  return img;
}

/** Canvas sized to its box at device resolution; `paint` gets the 2-D context and pixel size. */
function useCanvas(paint: (ctx: CanvasRenderingContext2D, w: number) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const w = Math.round(c.clientWidth * Math.min(2, window.devicePixelRatio || 1));
    if (c.width !== w) c.width = c.height = w;
    paint(c.getContext("2d")!, w);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/** Play `fn(t in 0..1)` over `ms` the first time the element is on screen (and on replay). */
function usePlay(ms: number) {
  const box = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(reducedMotion() ? 1 : 0);
  const raf = useRef(0);
  const play = useCallback(() => {
    cancelAnimationFrame(raf.current);
    if (reducedMotion()) return setT(1);
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      setT(k);
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [ms]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let done = false;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !done) {
        done = true;
        play();
      }
    }, { threshold: 0.5 });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf.current);
    };
  }, [play]);
  return { box, t, play };
}

/* -------------------------------- MIL ------------------------------- */

export function MilPanel({ f, rose, compact = false }: { f: FabricData; rose: Rose; compact?: boolean }) {
  const sec = useSection(f, GOLD, NAVY);
  const { box, t, play } = usePlay(4200);
  const th = t * Math.PI;
  const toVox = (p: number, w: number) => (p / w) * f.d[0] - 0.5;
  const cv = useCanvas(
    (ctx, w) => {
      ctx.clearRect(0, 0, w, w);
      if (!sec) return;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(sec, 0, 0, w, w);
      const ux = Math.cos(th);
      const uz = Math.sin(th);
      const nx = -uz;
      const nz = ux;
      const gap = w / 9;
      const yv = f.d[1] / 2;
      ctx.lineWidth = Math.max(1, w / 260);
      let entries = 0;
      for (let k = -6; k <= 6; k++) {
        const cx = w / 2 + nx * gap * k;
        const cz = w / 2 + nz * gap * k;
        // clip the line to the square
        const L = w * 0.75;
        const ax = cx - ux * L;
        const az = cz - uz * L;
        ctx.strokeStyle = "rgba(255,255,255,0.92)";
        ctx.beginPath();
        ctx.moveTo(ax, az);
        ctx.lineTo(cx + ux * L, cz + uz * L);
        ctx.stroke();
        let prev: boolean | null = null;
        for (let s = 0; s <= 2 * L; s += w / 300) {
          const x = ax + ux * s;
          const z = az + uz * s;
          if (x < 0 || z < 0 || x > w || z > w) {
            prev = null;
            continue;
          }
          const b = f.inBone(toVox(x, w), yv, toVox(z, w));
          if (prev !== null && b && !prev) {
            entries++;
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(x, z, Math.max(2, w / 130), 0, Math.PI * 2);
            ctx.fill();
          }
          prev = b;
        }
      }
      // direction arrow
      ctx.save();
      ctx.translate(w * 0.86, w * 0.14);
      ctx.strokeStyle = "#fff";
      ctx.fillStyle = "#fff";
      ctx.lineWidth = Math.max(1.5, w / 160);
      ctx.beginPath();
      ctx.moveTo(-ux * w * 0.06, -uz * w * 0.06);
      ctx.lineTo(ux * w * 0.06, uz * w * 0.06);
      ctx.stroke();
      ctx.beginPath();
      const hx = ux * w * 0.06;
      const hz = uz * w * 0.06;
      const a = Math.atan2(uz, ux);
      ctx.moveTo(hx, hz);
      ctx.lineTo(hx - w * 0.025 * Math.cos(a - 0.5), hz - w * 0.025 * Math.sin(a - 0.5));
      ctx.lineTo(hx - w * 0.025 * Math.cos(a + 0.5), hz - w * 0.025 * Math.sin(a + 0.5));
      ctx.fill();
      ctx.restore();
      ctx.font = `500 ${Math.round(w * 0.042)}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = "#fff";
      ctx.fillText(`θ ${Math.round((th * 180) / Math.PI)}° · ${entries} entries`, w * 0.04, w * 0.95);
    },
    [sec, th]
  );
  return (
    <div ref={box}>
      <canvas ref={cv} className={`mx-auto block aspect-square ${compact ? "w-full" : "w-[86%]"} rounded-[3px]`} role="img" aria-label="Section with parallel MIL test lines; white dots mark where a line enters bone" />
      <div className={`mx-auto mt-1.5 flex ${compact ? "w-full" : "w-[86%]"} items-center justify-between text-[12px] text-stone-600`}>
        <span>{compact ? <span className="fig-l">MIL</span> : <><b className="text-stone-900">MIL</b> test lines, bone gold</>}</span>
        <button type="button" onClick={play} className="rounded-full border border-stone-300 px-2.5 py-0.5 text-[11.5px] hover:bg-stone-100">
          ▶ sweep
        </button>
      </div>
      {!compact && <RoseMini rose={rose} second={f.gst} upto={t} color="#B07A22" label="MIL(θ) solid, structure tensor dashed" />}
    </div>
  );
}

/* -------------------------------- SVD ------------------------------- */

const RAYS = 16;
// stable colour constants (inline arrays would re-run the section effect on every render)
const SVD_BONE: [number, number, number] = [150, 150, 152];
const SVD_MARROW: [number, number, number] = [14, 14, 16];

/** Marrow star volume: rays from points in marrow run until they hit bone (as in the classic star volume figure). */
export function SvdPanel({ f, a, b, compact = false }: { f: FabricData; a: Rose; b: Rose; compact?: boolean }) {
  const sec = useSection(f, SVD_BONE, SVD_MARROW);
  const [seed, setSeed] = useState(3);
  const { box, t, play } = usePlay(2200);
  const inMarrow = useCallback((x: number, y: number, z: number) => !f.inBone(x, y, z), [f]);
  // three marrow points with the most room around them, well apart
  const pts = useMemo(() => {
    const rnd = mulberry32(seed * 977 + 1);
    const yv = f.d[1] / 2;
    const cand: { x: number; z: number; room: number }[] = [];
    for (let k = 0; k < 260; k++) {
      const x = 5 + rnd() * (f.d[0] - 10);
      const z = 5 + rnd() * (f.d[2] - 10);
      if (!inMarrow(x, yv, z)) continue;
      let room = 0;
      for (let j = 0; j < 8; j++) {
        const [a, b] = intercept(inMarrow, x, yv, z, (j / 8) * Math.PI, f.d[0] / 2);
        room += Math.min(a, b);
      }
      cand.push({ x, z, room });
    }
    cand.sort((p, q) => q.room - p.room);
    const out: { x: number; z: number; rays: [number, number][] }[] = [];
    for (const c of cand) {
      if (out.length >= 3) break;
      if (out.every((o) => Math.hypot(o.x - c.x, o.z - c.z) > f.d[0] * 0.28))
        out.push({ ...c, rays: Array.from({ length: RAYS }, (_, j) => intercept(inMarrow, c.x, yv, c.z, (j / RAYS) * Math.PI, f.d[0] * 0.75)) });
    }
    return out;
  }, [f, seed, inMarrow]);
  const cv = useCanvas(
    (ctx, w) => {
      ctx.clearRect(0, 0, w, w);
      if (!sec) return;
      ctx.drawImage(sec, 0, 0, w, w);
      const s = w / f.d[0];
      ctx.lineCap = "round";
      pts.forEach((p, pi) => {
        // each star draws in after the previous one; its rays grow out from the centre
        const k = Math.min(1, Math.max(0, t * 3 - pi));
        if (k <= 0) return;
        const e = 1 - (1 - k) ** 3;
        ctx.strokeStyle = "#e0322b";
        ctx.lineWidth = Math.max(1.6, w / 170);
        const nr = compact ? RAYS / 2 : RAYS;
        for (let j = 0; j < nr; j++) {
          const th = (j / nr) * Math.PI;
          const [a, b] = p.rays[compact ? j * 2 : j];
          const ux = Math.cos(th);
          const uz = Math.sin(th);
          ctx.beginPath();
          ctx.moveTo((p.x + 0.5 - ux * b * e) * s, (p.z + 0.5 - uz * b * e) * s);
          ctx.lineTo((p.x + 0.5 + ux * a * e) * s, (p.z + 0.5 + uz * a * e) * s);
          ctx.stroke();
        }
        ctx.fillStyle = "#ff5a4f";
        ctx.beginPath();
        ctx.arc((p.x + 0.5) * s, (p.z + 0.5) * s, Math.max(2.5, w / 100), 0, Math.PI * 2);
        ctx.fill();
      });
    },
    [sec, t, pts]
  );
  return (
    <div ref={box}>
      <canvas ref={cv} className={`mx-auto block aspect-square ${compact ? "w-full" : "w-[86%]"} rounded-[3px]`} role="img" aria-label="Section with star volume rays from points in the marrow, each ray running until it meets bone" />
      <div className={`mx-auto mt-1.5 flex ${compact ? "w-full" : "w-[86%]"} items-center justify-between text-[12px] text-stone-600`}>
        <span>{compact ? <span className="fig-l">SVD</span> : <><b className="text-stone-900">SVD</b> stars in marrow (black)</>}</span>
        <button
          type="button"
          onClick={() => {
            setSeed((v) => v + 1);
            play();
          }}
          className="rounded-full border border-stone-300 px-2.5 py-0.5 text-[11.5px] hover:bg-stone-100"
        >
          ↻ new points
        </button>
      </div>
      {!compact && <RoseMini rose={a} second={b} upto={1} color="#5B5F66" label="SVD(θ), marrow, two point sets" />}
    </div>
  );
}

/* ------------------------------- roses ------------------------------ */

function RoseMini({ rose, second, upto, color, label }: { rose: Rose; second?: Rose; upto: number; color: string; label: string }) {
  const S = 100;
  const Rr = 42;
  const path = (r: Rose, k: number) => {
    const mx = Math.max(...r.r);
    const n = Math.max(1, Math.round(r.theta.length * k));
    const pts: string[] = [];
    for (const flip of [0, Math.PI])
      for (let i = 0; i < n; i++) {
        const a = r.theta[i] + flip;
        const rr = (r.r[i] / mx) * Rr;
        pts.push(`${(S / 2 + rr * Math.cos(a)).toFixed(1)},${(S / 2 + rr * Math.sin(a)).toFixed(1)}`);
      }
    return `M${pts.join("L")}${k >= 1 ? "Z" : ""}`;
  };
  return (
    <div className="mx-auto mt-2 flex w-[86%] items-center gap-2.5">
      <svg viewBox={`0 0 ${S} ${S}`} className="h-[60px] w-[60px] shrink-0" aria-hidden="true">
        <circle cx={S / 2} cy={S / 2} r={Rr} fill="none" stroke="#e7e5e4" />
        <path d={path(rose, upto)} fill={upto >= 1 ? color + "26" : "none"} stroke={color} strokeWidth={1.8} />
        {second && <path d={path(second, upto)} fill="none" stroke={color} strokeWidth={1.4} strokeDasharray="3 2" />}
      </svg>
      <div className="text-[11.5px] leading-snug text-stone-600">
        <p className="text-stone-900">{label}</p>
        <p className="num">
          1 − min/max {roseDA(rose).toFixed(2)}
          {second ? ` and ${roseDA(second).toFixed(2)}` : ""} · {rose.ms.toFixed(0)} ms
        </p>
      </div>
    </div>
  );
}

export const Placeholder = () => <div className="mx-auto aspect-square w-[86%] animate-pulse rounded-[3px] bg-stone-200/70" />;
