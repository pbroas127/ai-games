/* BAIT — input recording, playback and verification.
 *
 * OWNER: Forge (Engine).
 *
 * Deterministic simulation makes replays almost free: a run is fully described
 * by the room plus the direction held on each tick, so a ghost is a string of
 * digits and nothing else. The same three lines of data drive the workshop
 * prove-gate, both ghosts (SPEC §4.4) and the solver's determinism regression.
 *
 * Wire format is run-length encoded and deliberately human-legible, because a
 * ghost that has been mangled in localStorage should be obviously mangled:
 *
 *   a120d47a3f200      letter = direction 0..8 as 'a'..'i', digits = tick count
 *
 * save.js caps ghost size (SPEC §4.3); RLE is what keeps a three-minute run
 * inside a few dozen characters.
 *
 * ZERO DOM REFERENCES. tools/verify.cjs loads this file under plain Node.
 */
(function (BAIT) {
  'use strict';

  var P = BAIT.Pieces, Sim = BAIT.Sim;
  var K = P.K;

  /* A replay can never legitimately exceed the sim's own tick ceiling, so
   * anything claiming to is refused before we allocate for it. */
  var MAX_TICKS = K.MAX_TICKS;
  var MAX_STRING = 8192;

  function isDir(d) { return d >= 0 && d <= 8; }

  /* ------------------------------------------------------------- recorder -- */

  function record() {
    var dirs = [];
    var rec = {
      push: function (d) {
        d = d | 0;
        if (!isDir(d)) d = 0;
        if (dirs.length < MAX_TICKS) dirs.push(d);
        return d;
      },
      dirs: function () { return dirs; },
      clear: function () { dirs.length = 0; },
      toString: function () { return toString(dirs); }
    };
    /* `length` is a property, not a call — boot.js reads rec.length. */
    Object.defineProperty(rec, 'length', {
      enumerable: true,
      get: function () { return dirs.length; }
    });
    return rec;
  }

  /* ---------------------------------------------------------------- codec -- */

  function toString(dirs) {
    if (!dirs || !dirs.length) return '';
    var out = '', i = 0, n = Math.min(dirs.length, MAX_TICKS);
    while (i < n) {
      var d = dirs[i] | 0;
      if (!isDir(d)) d = 0;
      var run = 1;
      while (i + run < n && (dirs[i + run] | 0) === d) run++;
      out += String.fromCharCode(97 + d) + run;
      i += run;
    }
    return out;
  }

  /* Boss's contract: fromString ALWAYS returns an array and never throws, so a
   * corrupted ghost degrades to "no ghost" instead of taking a screen down.
   * Callers that must tell a corrupt replay from an empty one — the prove-gate
   * cares, a ghost does not — use parse() below and read its `ok`. */
  function fromString(s) {
    var r = parse(s);
    return r.ok ? r.dirs : [];
  }

  /* Returns { dirs, ok }. Hostile input: a ghost can come out of a corrupted
   * save or a hand-edited localStorage blob, so the total tick count is
   * bounded before anything is allocated. */
  function parse(s) {
    var FAIL = { dirs: [], ok: false };
    if (typeof s !== 'string') return FAIL;
    s = s.trim();
    if (!s.length) return { dirs: [], ok: true };
    if (s.length > MAX_STRING) return FAIL;

    var dirs = [], re = /([a-i])(\d{1,6})/g, m, consumed = 0;
    while ((m = re.exec(s)) !== null) {
      if (m.index !== consumed) return FAIL;        // no gaps, no junk between runs
      consumed = re.lastIndex;

      var d = m[1].charCodeAt(0) - 97;
      var run = parseInt(m[2], 10);
      if (!run || run < 0) return FAIL;
      if (dirs.length + run > MAX_TICKS) return FAIL;
      for (var i = 0; i < run; i++) dirs.push(d);
    }
    if (consumed !== s.length) return FAIL;         // trailing junk
    return { dirs: dirs, ok: true };
  }

  /* ----------------------------------------------------------------- run --
   * Runs `inputs` against `room` and reports what happened. This is the single
   * entry point for the prove-gate ("did the author really clear it?"), the
   * solver's par timing, and the determinism regression — all three must agree
   * on the answer, so all three call this.
   *
   * inputs may be a string or an array of directions.
   *
   * The result is deliberately not "did it clear": a replay that runs out of
   * inputs while the dot is still alive comes back as 'run', which is a
   * different failure from dying and should read differently to the caller.
   */
  function verify(room, inputs) {
    var dirs;
    if (typeof inputs === 'string') {
      var p = parse(inputs);
      /* The prove-gate must not accept a corrupt replay as "cleared nothing".
       * This is the one caller that needs the difference. */
      if (!p.ok) {
        return { result: 'invalid', ticks: 0, hash: 0, deathCause: '',
                 deathX: 0, deathY: 0, keys: 0, token: false, state: null };
      }
      dirs = p.dirs;
    } else {
      dirs = inputs;
    }
    if (!dirs || typeof dirs.length !== 'number') {
      return { result: 'invalid', ticks: 0, hash: 0, deathCause: '',
               deathX: 0, deathY: 0, keys: 0, token: false, state: null };
    }

    var st = Sim.create(room);
    for (var i = 0; i < dirs.length; i++) {
      Sim.step(st, dirs[i]);
      if (st.result !== Sim.RESULT.RUN) break;
    }
    return {
      result: st.result,
      ticks: st.t,
      hash: Sim.hash(st),
      deathCause: st.deathCause,
      deathX: st.deathX, deathY: st.deathY,
      keys: st.keys, token: st.token,
      state: st
    };
  }

  /* Convenience for the prove-gate: cleared, and how fast. */
  function clears(room, inputs) {
    var r = verify(room, inputs);
    return r.result === Sim.RESULT.CLEAR;
  }

  BAIT.Replay = {
    MAX_TICKS: MAX_TICKS,
    record: record,
    toString: toString,
    fromString: fromString,
    parse: parse,
    verify: verify,
    clears: clears
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BAIT.Replay;

})(typeof window !== 'undefined'
  ? (window.BAIT = window.BAIT || {})
  : (global.BAIT = global.BAIT || {}));
