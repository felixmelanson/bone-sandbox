/** Cubic in-out easing. */
export const cubicInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * rAF tween from `from` to `to` over `ms`, calling `step` with the eased value.
 * Jumps straight to the end under prefers-reduced-motion. Returns a cancel function.
 */
export function tween(from: number, to: number, ms: number, step: (v: number) => void, opts: { delay?: number; ease?: (t: number) => number; done?: () => void } = {}) {
  const ease = opts.ease ?? cubicInOut;
  if (reducedMotion() || ms <= 0) {
    step(to);
    opts.done?.();
    return () => {};
  }
  let raf = 0;
  const t0 = performance.now() + (opts.delay ?? 0);
  const tick = (now: number) => {
    const k = Math.min(1, Math.max(0, (now - t0) / ms));
    step(from + (to - from) * ease(k));
    if (k < 1) raf = requestAnimationFrame(tick);
    else opts.done?.();
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
