/* BAIT — Q16.16 fixed-point maths.
 *
 * OWNER: Forge (Engine).
 *
 * Every number in the simulation is an int32 holding a value scaled by 65536.
 * This is not an optimisation, it is the determinism guarantee: two machines
 * that agree on int32 arithmetic agree on the whole game, forever. Floats do
 * not have that property once you involve a compiler, and SPEC §0.4 is built
 * on it.
 *
 * ZERO DOM REFERENCES. tools/verify.cjs loads this file under plain Node.
 */
(function (BAIT) {
  'use strict';

  var ONE = 65536;          // 1.0
  var SHIFT = 16;
  var HALF = ONE >> 1;

  /* Multiply two Q16.16 values.
   *
   * The naive `(a * b) >> 16` silently loses precision the moment a*b passes
   * 2^53, and worse, `>>` first coerces the double to int32, so it is wrong
   * long before that. We split both operands into high and low 16-bit halves
   * and recombine, which keeps every partial product inside a double's exact
   * integer range:
   *
   *   a = ah*2^16 + al,  b = bh*2^16 + bl
   *   (a*b) >> 16 = ah*bh*2^16 + ah*bl + al*bh + ((al*bl) >>> 16)
   *
   * The decomposition holds for negative values too, because `a >> 16` is an
   * arithmetic shift and `a & 0xffff` is the unsigned low half — exactly the
   * two's-complement split. Overflow past int32 wraps, which is defined and
   * therefore still deterministic.
   */
  function mul(a, b) {
    var ah = a >> SHIFT, al = a & 0xffff;
    var bh = b >> SHIFT, bl = b & 0xffff;
    return ((((ah * bh) << SHIFT) + (ah * bl) + (al * bh) +
             ((al * bl) >>> SHIFT)) | 0);
  }

  /* Divide two Q16.16 values. a * 2^16 tops out around 2^47 for any int32 a,
   * so the intermediate is exact in a double and the IEEE-754 division that
   * follows is correctly rounded on every conforming engine. Truncation is
   * toward zero.
   *
   * Division by zero returns 0 rather than throwing: this runs inside the sim
   * loop and a thrown exception mid-tick would corrupt state. No caller in
   * BAIT divides by a value that can legitimately be zero.
   */
  function div(a, b) {
    if (b === 0) return 0;
    return ((a * ONE) / b) | 0;
  }

  function fromInt(n) { return (n * ONE) | 0; }

  /* toInt and floor both round toward negative infinity, because every use in
   * this codebase is "which cell is this pixel in" and that must not flip sign
   * behaviour at the origin. toInt returns a plain integer, floor returns a
   * fixed-point value with the fraction cleared.
   */
  function toInt(a) { return a >> SHIFT; }
  function floor(a) { return a & ~0xffff; }
  function ceil(a) { return (a + 0xffff) & ~0xffff; }
  function round(a) { return (a + HALF) & ~0xffff; }

  function abs(a) { return a < 0 ? -a : a; }
  function sign(a) { return a < 0 ? -1 : (a > 0 ? 1 : 0); }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function min(a, b) { return a < b ? a : b; }
  function max(a, b) { return a > b ? a : b; }

  BAIT.Fixed = {
    ONE: ONE, SHIFT: SHIFT, HALF: HALF,
    mul: mul, div: div,
    fromInt: fromInt, toInt: toInt,
    floor: floor, ceil: ceil, round: round,
    abs: abs, sign: sign, clamp: clamp, min: min, max: max
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BAIT.Fixed;

})(typeof window !== 'undefined'
  ? (window.BAIT = window.BAIT || {})
  : (global.BAIT = global.BAIT || {}));
