/* Colour maps matching the printed scale bars.
   position 0 = bottom of the bar (value 0), 1 = top (max value). */

export type Stop = [number, number, number, number];

export const TH_RAMP: Stop[] = [
  [0.0, 255, 255, 250],
  [0.08, 253, 238, 120],
  [0.22, 249, 190, 58],
  [0.38, 240, 128, 42],
  [0.54, 216, 74, 44],
  [0.68, 168, 52, 78],
  [0.82, 120, 46, 168],
  [1.0, 92, 40, 220],
];

export const SP_RAMP: Stop[] = [
  [0.0, 255, 255, 250],
  [0.1, 253, 226, 84],
  [0.26, 244, 156, 52],
  [0.42, 230, 98, 44],
  [0.56, 186, 64, 70],
  [0.7, 112, 46, 206],
  [0.86, 54, 22, 170],
  [1.0, 22, 8, 96],
];

export function ramp(stops: Stop[], v: number): [number, number, number] {
  const x = v < 0 ? 0 : v > 1 ? 1 : v;
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0] || i === stops.length - 1) {
      const a = stops[i - 1];
      const b = stops[i];
      const t = Math.min(1, Math.max(0, (x - a[0]) / (b[0] - a[0] || 1)));
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    }
  }
  const l = stops[stops.length - 1];
  return [l[1], l[2], l[3]];
}

/** Sample a ramp into `n` RGB triples (for GPU lookup textures). */
export function cssRampStops(stops: Stop[], n: number) {
  return Array.from({ length: n }, (_, i) => ramp(stops, i / (n - 1)));
}

/** Diverging map for EF: -1 oblate (plate, blue) .. 0 .. +1 prolate (rod, red). */
export const EF_RAMP: Stop[] = [
  [0.0, 46, 92, 168],
  [0.25, 120, 160, 210],
  [0.5, 242, 238, 230],
  [0.75, 226, 132, 120],
  [1.0, 184, 36, 64],
];

export function cssRamp(stops: Stop[]) {
  return `linear-gradient(to top,${stops
    .map(([p, r, g, b]) => `rgb(${r},${g},${b}) ${(p * 100).toFixed(1)}%`)
    .join(",")})`;
}
