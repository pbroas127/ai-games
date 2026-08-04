/* BAIT — seeded pseudo-random number generator (xorshift32).
 *
 * OWNER: Forge (Engine).
 *
 * The simulation itself never calls this — the sim is fully deterministic
 * without randomness (SPEC §0.4). This exists for the daily generator
 * (src/game/daily.js), which must produce the identical five rooms for
 * everybody on earth from nothing but a YYYYMMDD integer, with no server.
 *
 * ZERO DOM REFERENCES. tools/verify.cjs loads this file under plain Node.
 */
(function (BAIT) {
  'use strict';

  /* xorshift32 has one degenerate state: zero maps to zero forever. Any seed
   * that lands there is remapped to the golden-ratio constant, which is a
   * well-distributed non-zero starting point. Callers may legitimately pass 0
   * (a date seed can be masked down to it), so this is not a caller error to
   * report — it is a case to absorb.
   */
  var GOLDEN = 0x9E3779B9 | 0;

  function scramble(seed) {
    var s = seed | 0;
    if (s === 0) return GOLDEN;
    return s;
  }

  function create(seed) {
    var s = scramble(seed);

    /* One raw step. Returns an unsigned 32-bit integer. */
    function next() {
      s ^= s << 13; s |= 0;
      s ^= s >>> 17;
      s ^= s << 5;  s |= 0;
      return s >>> 0;
    }

    /* Uniform-ish integer in [0, n). Modulo carries a bias of at most
     * n / 2^32, which for every n this game uses (room dimensions, piece
     * counts, small tables) is far below anything observable. It is chosen
     * over a rejection loop because it is bounded-time: the daily generator
     * runs inside a retry loop and must never be able to hang.
     */
    function int(n) {
      n = n | 0;
      if (n <= 0) return 0;
      return (next() % n) | 0;
    }

    /* INCLUSIVE at both ends: range(1, 6) yields 1,2,3,4,5 or 6.
     * int(n) already covers the half-open case, so this covers the other one.
     */
    function range(lo, hi) {
      lo = lo | 0; hi = hi | 0;
      if (hi < lo) { var t = lo; lo = hi; hi = t; }
      return lo + int(hi - lo + 1);
    }

    function pick(arr) {
      if (!arr || !arr.length) return undefined;
      return arr[int(arr.length)];
    }

    /* Fisher-Yates, in place, returns the same array. Deterministic given the
     * generator state, which is what the daily needs. */
    function shuffle(arr) {
      if (!arr) return arr;
      for (var i = arr.length - 1; i > 0; i--) {
        var j = int(i + 1);
        var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    }

    return {
      next: next, int: int, range: range, pick: pick, shuffle: shuffle,
      /* Independent stream derived from this one. Lets the daily generator
       * give each of its five rooms its own generator without the rooms
       * influencing each other's sequence length. */
      fork: function () { return create(next() | 0); },
      /* Exposed so a generator can be rewound or resumed. Read-only usage:
       * state() to save, create(saved) to restore. */
      state: function () { return s | 0; }
    };
  }

  BAIT.Rng = { create: create };

  if (typeof module !== 'undefined' && module.exports) module.exports = BAIT.Rng;

})(typeof window !== 'undefined'
  ? (window.BAIT = window.BAIT || {})
  : (global.BAIT = global.BAIT || {}));
