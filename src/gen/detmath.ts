/**
 * Deterministic trigonometry for world generation.
 *
 * `Math.sin` / `Math.cos` are implementation-approximated: ECMAScript only requires "an
 * implementation-approximated value", so two engines (or two versions of one engine) may differ in
 * the last bit. A last-bit difference is enough to move a worm-carver step across a block boundary
 * and change generated terrain. These functions use only `+`, `-`, `*` and `Math.floor`, which
 * ECMAScript defines exactly (IEEE-754 double arithmetic, round-to-nearest-even), so every engine
 * returns bit-identical results.
 *
 * Accuracy is about 1e-9 absolute, far more than generation needs.
 */

const PI = 3.141592653589793;
const HALF_PI = 1.5707963267948966;
const INV_TWO_PI = 0.15915494309189535;
const TWO_PI = 6.283185307179586;

// Taylor coefficients of sin(x) on [-π/2, π/2]: x − x³/3! + x⁵/5! − …; the truncation error of the
// x¹³ term is below 7e-10 at the interval edge.
const C3 = -1 / 6;
const C5 = 1 / 120;
const C7 = -1 / 5040;
const C9 = 1 / 362880;
const C11 = -1 / 39916800;
const C13 = 1 / 6227020800;

export function detSin(x: number): number {
  // Reduce to [-π, π], then fold into [-π/2, π/2] using sin(π − r) = sin(r).
  let r = x - Math.floor(x * INV_TWO_PI + 0.5) * TWO_PI;
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  const r2 = r * r;
  return r * (1 + r2 * (C3 + r2 * (C5 + r2 * (C7 + r2 * (C9 + r2 * (C11 + r2 * C13))))));
}

export function detCos(x: number): number {
  return detSin(x + HALF_PI);
}
