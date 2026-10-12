/* =====================================================================
   Liquid-glass slider (after Felix's CodePen "Liquid Glass Slider").
   At rest the thumb is a white pill. While dragged it springs larger and
   turns into a frosted glass lens over the track. The original SVG
   displacement backdrop-filter was dropped: it re-rendered the backdrop
   every frame and glitched in Chrome; a CSS blur/saturate lens with an
   inset specular rim gives the same read at a fraction of the cost.
   ===================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";

class Spring {
  value: number;
  target: number;
  velocity = 0;
  constructor(v: number, private stiffness = 300, private damping = 20) {
    this.value = v;
    this.target = v;
  }
  update(dt: number) {
    this.velocity += ((this.target - this.value) * this.stiffness - this.velocity * this.damping) * dt;
    this.value += this.velocity * dt;
    return this.value;
  }
  settled() {
    return Math.abs(this.target - this.value) < 0.001 && Math.abs(this.velocity) < 0.001;
  }
}

/** Thumb geometry (px): full size while dragged, scaled to `REST` otherwise. */
const W = 56;
const H = 36;
const TRACK = 8;
const REST = 0.62;
const FILL = "linear-gradient(90deg, #57534e, #1c1917)";

export function GlassSlider({
  value,
  min,
  max,
  step,
  onChange,
  labelledBy,
  valueText,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  labelledBy?: string;
  valueText?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  const [tw, setTw] = useState(240);
  const pressed = useRef(false);
  const springs = useRef({ sc: new Spring(REST, 900, 45), glass: new Spring(0, 900, 45) });
  const raf = useRef(0);

  const frac = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const left = (W * REST) / 2 + frac * (tw - W * REST) - W / 2;

  // spring loop runs only while the thumb is changing state
  const loop = useCallback(() => {
    const S = springs.current;
    S.sc.target = pressed.current ? 1 : REST;
    S.glass.target = pressed.current ? 1 : 0;
    const sc = S.sc.update(1 / 60);
    const g = Math.min(1, Math.max(0, S.glass.update(1 / 60)));
    const t = thumb.current;
    if (t) {
      t.style.transform = `scale(${sc})`;
      t.style.backgroundColor = `rgba(255,255,255,${1 - 0.82 * g})`;
      t.style.setProperty("--g", String(g));
    }
    raf.current = S.sc.settled() && S.glass.settled() ? 0 : requestAnimationFrame(loop);
  }, []);
  const kick = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(loop);
  }, [loop]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTw(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const setFromX = useCallback(
    (clientX: number) => {
      const b = box.current!.getBoundingClientRect();
      const w = W * REST;
      const f = Math.min(1, Math.max(0, (clientX - b.left - w / 2) / (b.width - w)));
      const v = Math.round((min + f * (max - min)) / step) * step;
      onChange(+Math.min(max, Math.max(min, v)).toFixed(6));
    },
    [min, max, step, onChange]
  );

  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    pressed.current = true;
    thumb.current?.focus({ preventScroll: true });
    setFromX(e.clientX);
    kick();
    const move = (ev: PointerEvent) => setFromX(ev.clientX);
    const up = () => {
      pressed.current = false;
      kick();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const key = (e: React.KeyboardEvent) => {
    const big = (max - min) / 10;
    const d = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: big, PageDown: -big }[e.key];
    if (d !== undefined) onChange(+Math.min(max, Math.max(min, value + d)).toFixed(6));
    else if (e.key === "Home") onChange(min);
    else if (e.key === "End") onChange(max);
    else return;
    e.preventDefault();
  };

  const top = (H - TRACK) / 2;
  return (
    <div ref={box} className="relative w-full touch-none select-none" style={{ height: H }} onPointerDown={down}>
      <div className="absolute inset-x-0 cursor-pointer overflow-hidden rounded-full bg-stone-200 shadow-[inset_0_1px_2px_rgba(0,0,0,0.18)]" style={{ top, height: TRACK }}>
        <div className="h-full rounded-full" style={{ width: `${frac * 100}%`, background: FILL }} />
      </div>
      <div
        ref={thumb}
        role="slider"
        tabIndex={0}
        aria-labelledby={labelledBy}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText}
        onKeyDown={key}
        className="glass-thumb absolute top-0 cursor-grab outline-none active:cursor-grabbing"
        style={{ left, width: W, height: H, borderRadius: H / 2 }}
      />
    </div>
  );
}
