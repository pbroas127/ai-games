/* BAIT — the solver.
 *
 * OWNER: Sieve (QA).
 *
 * ONE implementation, used by two callers, which is the whole point of it
 * living here rather than in tools/: tools/verify.cjs proves every campaign
 * room clearable and computes par, and src/game/daily.js can sanity-check a
 * generated room before it ships it to a player. SPEC §4.2 says the daily is
 * verified "by the same solver the campaign uses" — two copies would agree
 * on the day they were written and never again.
 *
 * ZERO DOM REFERENCES, and no clock. The node budget is the ONLY bound, so
 * the verdict is a pure function of the room: a room that comes back UNKNOWN
 * on my machine comes back UNKNOWN on yours, and on CI. A wall-clock budget
 * would make this tool's answer depend on how busy the laptop was, which is
 * not a property you want in the thing that decides whether we ship.
 *
 * ------------------------------------------------------------- correctness --
 * Every node is produced by stepping the REAL sim. The search never reasons
 * about what the sim would do. So the approximations below — quantised
 * position, committed direction runs, a capped hazard cycle — can only ever
 * cause it to MISS a clearing line. They can never invent one.
 *
 * That asymmetry is deliberate and it is what makes the tool trustworthy:
 * a false "unsolvable" costs an author an argument, a false "solvable" ships
 * a dead room that nobody can finish.
 */
(function (BAIT) {
  'use strict';

  var Sim = BAIT.Sim, P = BAIT.Pieces, RoomLib = BAIT.Room;
  var K = P.K, TILE = P.TILE;

  /* Search outcomes. The middle one is the entire reason this enum exists. */
  var STATUS = {
    SOLVED: 'solved',
    /* Ran out of reachable states while still under budget: strong evidence
     * the room genuinely cannot be cleared. */
    EXHAUSTED: 'exhausted',
    /* Ran out of nodes with states still queued: says NOTHING about the
     * room, only about this search. Never report it as a room defect. */
    BUDGET: 'budget'
  };

  /* Weighted A*, as an integer fraction so there is no float in the compare.
   * W above 1 trades route quality for a large cut in nodes explored, which
   * is the right trade here: this has to PROVE clearable and estimate par,
   * not play optimally. */
  var LADDER = [
    { label: 'tight',  COMMIT: 6,  QUANT: 10, WN: 17, WD: 10, NODES: 200000 },
    { label: 'loose',  COMMIT: 8,  QUANT: 20, WN: 30, WD: 10, NODES: 350000 },
    { label: 'greedy', COMMIT: 10, QUANT: 20, WN: 60, WD: 10, NODES: 500000 },
    { label: 'last',   COMMIT: 12, QUANT: 40, WN: 120, WD: 10, NODES: 600000 }
  ];

  /* A cheap rung for a caller that needs an answer NOW rather than a good
   * one — daily.js sanity-checking a generated room at boot cannot spend
   * half a minute per room. */
  var QUICK = { label: 'quick', COMMIT: 8, QUANT: 20, WN: 40, WD: 10, NODES: 30000 };

  /* ---------------------------------------------------------------- heap -- */

  function Heap() { this.a = []; }
  Heap.prototype.push = function (node) {
    var a = this.a, i = a.length, t;
    a.push(node);
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      t = a[p]; a[p] = a[i]; a[i] = t; i = p;
    }
  };
  Heap.prototype.pop = function () {
    var a = this.a, t;
    if (!a.length) return null;
    var top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      var i = 0, n = a.length;
      for (;;) {
        var l = 2 * i + 1, r = l + 1, m = i;
        if (l < n && a[l].f < a[m].f) m = l;
        if (r < n && a[r].f < a[m].f) m = r;
        if (m === i) break;
        t = a[m]; a[m] = a[i]; a[i] = t; i = m;
      }
    }
    return top;
  };

  /* ------------------------------------------------------- state copying -- *
   * Only the fields Sim.reset touches are per-run. Everything else on a sim
   * state — the room, the precomputed piece lists, staticSolid, teleTwin — is
   * built once in create() and never mutated, so copies share it by
   * reference. faithful() proves that claim before the search relies on it.
   */

  function cloneState(st) {
    var c = {}, k;
    for (k in st) c[k] = st[k];
    c.fallen = new Uint8Array(st.fallen);
    c.taken = new Uint8Array(st.taken);
    c.latch = new Uint8Array(st.latch);
    c.hold = new Uint8Array(st.hold);
    c.solid = new Uint8Array(st.solid);
    var b = new Array(st.bullets.length);
    for (var i = 0; i < st.bullets.length; i++) {
      var s = st.bullets[i];
      b[i] = { x: s.x, y: s.y, vx: s.vx, vy: s.vy };
    }
    c.bullets = b;
    return c;
  }

  /* Overwrite dst with src, allocating nothing. The search tries up to nine
   * branches per expansion and discards most of them, so stepping a reused
   * scratch state and cloning only the survivors removes the large majority
   * of allocations. */
  function copyInto(dst, src) {
    dst.t = src.t; dst.x = src.x; dst.y = src.y;
    dst.heading = src.heading; dst.launched = src.launched; dst.inputDir = src.inputDir;
    dst.keys = src.keys; dst.token = src.token;
    dst.onFaller = src.onFaller; dst.teleLock = src.teleLock; dst.cell = src.cell;
    dst.result = src.result;
    dst.deathCause = src.deathCause; dst.deathX = src.deathX; dst.deathY = src.deathY;
    dst.fallen.set(src.fallen); dst.taken.set(src.taken);
    dst.latch.set(src.latch); dst.hold.set(src.hold); dst.solid.set(src.solid);
    var b = dst.bullets;
    b.length = 0;
    for (var i = 0; i < src.bullets.length; i++) {
      var s = src.bullets[i];
      b.push({ x: s.x, y: s.y, vx: s.vx, vy: s.vy });
    }
    return dst;
  }

  /* If the engine grows a mutable field and the two copiers above miss it,
   * the search quietly explores states that never existed. Rather than hope,
   * prove it: clone, step both copies in lockstep, compare Sim.hash. The
   * interleaving matters — it is what would expose a buffer accidentally
   * shared between two states. */
  function faithful(room) {
    var a = Sim.create(room);
    var seq = [3, 3, 5, 0, 7, 1, 4, 2, 3, 5, 6, 8], i, d;
    for (i = 0; i < 5; i++) Sim.step(a, seq[i % seq.length]);

    var b = cloneState(a);
    if (Sim.hash(a) !== Sim.hash(b)) return 'cloneState: hash differs immediately after copy';
    for (i = 0; i < 60; i++) {
      d = seq[i % seq.length];
      Sim.step(a, d); Sim.step(b, d);
      if (Sim.hash(a) !== Sim.hash(b)) {
        return 'cloneState: diverged after ' + (i + 1) + ' steps, it is missing a mutable field';
      }
    }

    var c = Sim.create(room);
    copyInto(c, a);
    if (Sim.hash(c) !== Sim.hash(a)) return 'copyInto: does not reproduce the source state';
    for (i = 0; i < 30; i++) {
      d = seq[i % seq.length];
      Sim.step(a, d); Sim.step(c, d);
      if (Sim.hash(a) !== Sim.hash(c)) {
        return 'copyInto: diverged after ' + (i + 1) + ' steps, it is missing a mutable field';
      }
    }
    return null;
  }

  /* --------------------------------------------------------------- maths -- */

  function gcd(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }
  function lcm(a, b) { return a / gcd(a, b) * b; }

  /* The tick cycle every hazard in the room repeats on. Time enters the state
   * key only as t modulo this, which is what collapses an otherwise infinite
   * space. Capped, because coprime periods make the true LCM astronomical and
   * an uncapped modulus just means no two states ever merge. */
  function hazardCycle(st) {
    var PU = K.PERIOD_UNIT, cyc = 1, i;
    for (i = 0; i < st.turrets.length; i++) cyc = lcm(cyc, st.turrets[i].period);
    for (i = 0; i < st.phases.length; i++) cyc = lcm(cyc, st.phases[i].period * PU * 2);
    for (i = 0; i < st.rotors.length; i++) cyc = lcm(cyc, st.rotors[i].period * PU * 4);
    if (cyc > 3600 || cyc <= 0) cyc = 3600;
    return cyc;
  }

  function cellsOf(room, tileId) {
    var out = [];
    for (var i = 0; i < room.tiles.length; i++) if (room.tiles[i] === tileId) out.push(i);
    return out;
  }

  /* Dijkstra over cells, in TICKS, outward from a set of goals. Cardinal
   * costs 20 ticks (a 40px cell at 2px/tick), diagonal 28 — diagonal speed
   * equals cardinal speed, so crossing a cell corner to corner genuinely
   * takes longer. Optimistic about gates and phase blocks, which keeps the
   * value a true lower bound and therefore keeps A* honest. */
  function distanceField(room, goals) {
    var w = room.w, h = room.h, n = w * h;
    var dist = new Int32Array(n);
    for (var z = 0; z < n; z++) dist[z] = 0x7fffffff;
    if (!goals.length) return dist;

    var heap = new Heap();
    for (var g = 0; g < goals.length; g++) { dist[goals[g]] = 0; heap.push({ f: 0, i: goals[g] }); }

    var DX = [0, 1, 1, 1, 0, -1, -1, -1], DY = [-1, -1, 0, 1, 1, 1, 0, -1];
    var COST = [20, 28, 20, 28, 20, 28, 20, 28];

    while (heap.a.length) {
      var cur = heap.pop();
      if (cur.f > dist[cur.i]) continue;
      var cx = cur.i % w, cy = (cur.i / w) | 0;
      for (var d = 0; d < 8; d++) {
        var nx = cx + DX[d], ny = cy + DY[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        var ni = ny * w + nx, id = room.tiles[ni];
        if (P.isSolid(id) || P.isLethal(id)) continue;
        var nd = cur.f + COST[d];
        if (nd < dist[ni]) { dist[ni] = nd; heap.push({ f: nd, i: ni }); }
      }
    }
    return dist;
  }

  /* Optimistic 8-way flood from the start, treating gates and phase blocks as
   * open and ignoring every moving hazard, so it over-reports what can be
   * reached. That means it can never condemn a room that is actually fine,
   * and when it does condemn one the room is broken with no judgement call
   * involved. Teleports carry reachability to their twin. */
  function reachable(room) {
    var w = room.w, h = room.h, n = w * h;
    var seen = new Uint8Array(n);
    if (!room.start) return seen;

    var DX = [0, 1, 1, 1, 0, -1, -1, -1], DY = [-1, -1, 0, 1, 1, 1, 0, -1];
    function blocked(id) { return P.isSolid(id) || P.isLethal(id); }

    var stack = [room.start.y * w + room.start.x];
    seen[stack[0]] = 1;

    function flood() {
      while (stack.length) {
        var cur = stack.pop(), cx = cur % w, cy = (cur / w) | 0;
        for (var d = 0; d < 8; d++) {
          var nx = cx + DX[d], ny = cy + DY[d];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          var ni = ny * w + nx;
          if (seen[ni] || blocked(room.tiles[ni])) continue;
          seen[ni] = 1; stack.push(ni);
        }
      }
    }
    flood();

    /* A teleport can drop you in a pocket holding another teleport, so run to
     * a fixed point rather than a single pass. */
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = 0; i < n; i++) {
        if (room.tiles[i] !== TILE.TELEPORT || !seen[i]) continue;
        var twin = RoomLib.twinOf(room, i);
        if (twin < 0 || seen[twin]) continue;
        seen[twin] = 1; stack.push(twin); flood(); changed = true;
      }
    }
    return seen;
  }

  /* ---------------------------------------------------------------- search --
   * search(room, opts) -> { ok, status, ticks, inputs, nodes, rung }
   *
   *   opts.requireToken  the run must carry the token out through the exit
   *   opts.tune          a LADDER rung, or QUICK, or your own shape
   */
  function search(room, opts) {
    opts = opts || {};
    var T = opts.tune || LADDER[0];
    var requireToken = !!opts.requireToken;

    var bad = faithful(room);
    if (bad) return { ok: false, status: STATUS.BUDGET, fatal: true, reason: bad, nodes: 0 };

    var root = Sim.create(room);
    var cycle = hazardCycle(root);

    var exitCells = cellsOf(room, TILE.EXIT);
    var keyCells = cellsOf(room, TILE.KEY);
    var tokCells = cellsOf(room, TILE.TOKEN);
    if (!exitCells.length) return { ok: false, status: STATUS.EXHAUSTED, reason: 'the room has no exit', nodes: 0 };
    if (requireToken && !tokCells.length) return { ok: false, status: STATUS.EXHAUSTED, reason: 'the room has no token', nodes: 0 };

    var dExit = distanceField(room, exitCells);
    var dTok = tokCells.length ? distanceField(room, tokCells) : null;
    var dKeys = [];
    for (var ki = 0; ki < keyCells.length; ki++) {
      dKeys.push({ cell: keyCells[ki], d: distanceField(room, [keyCells[ki]]) });
    }

    var ONE = K.ONE, QUANT = T.QUANT;

    /* Only a handful of cells can ever change state: the fallers, the pickups
     * and the latch links. Scanning the whole grid here cost more than the
     * simulation did. */
    var fallerIdx = cellsOf(room, TILE.FALLER);
    var pickupIdx = keyCells.concat(tokCells);
    var latchN = K.MAX_LINK + 1;

    function flagsKey(st) {
      var h = 0x811c9dc5 | 0, i, v;
      for (i = 0; i < pickupIdx.length; i++) {
        if (st.taken[pickupIdx[i]]) { v = 0x2000 + pickupIdx[i]; h = Math.imul((h ^ v) | 0, 0x01000193) | 0; }
      }
      for (i = 0; i < fallerIdx.length; i++) {
        if (st.fallen[fallerIdx[i]]) { v = 0x1000 + fallerIdx[i]; h = Math.imul((h ^ v) | 0, 0x01000193) | 0; }
      }
      for (i = 0; i < latchN; i++) {
        if (st.latch[i]) { v = 0x3000 + i; h = Math.imul((h ^ v) | 0, 0x01000193) | 0; }
      }
      return h;
    }

    function stateKey(st) {
      var qx = ((st.x / ONE) / QUANT) | 0;
      var qy = ((st.y / ONE) / QUANT) | 0;
      /* Bullet COUNT rather than positions: positions fragment the space
       * badly, and count is enough to stop merging "a shot is inbound" with
       * "the lane is clear". Merging errs toward missing solutions, which is
       * the safe direction. */
      return qx + ':' + qy + ':' + st.heading + ':' + (st.launched ? 1 : 0) +
             ':' + (st.t % cycle) + ':' + st.bullets.length + ':' + flagsKey(st);
    }

    /* A real lower bound on the ticks still owed.
     *
     * MAX over the remaining keys, not min. Every clearing run must pass
     * through EVERY uncollected key, so for each one d(here,key) +
     * d(key,exit) is a lower bound on what is left, and the largest of those
     * is the tightest bound that is still admissible. Reading it as "distance
     * to the nearest key" instead throws almost all the information away and
     * leaves the search wandering an open room. */
    function heuristic(st) {
      var c = st.cell, best = 0, i;

      if (st.keys < st.keysTotal) {
        for (i = 0; i < dKeys.length; i++) {
          if (st.taken[dKeys[i].cell]) continue;
          var leg = dKeys[i].d[c], out = dExit[dKeys[i].cell];
          if (leg === 0x7fffffff || out === 0x7fffffff) continue;
          if (leg + out > best) best = leg + out;
        }
      }
      if (requireToken && !st.token && dTok) {
        var toTok = dTok[c], tokOut = dExit[tokCells[0]];
        if (toTok !== 0x7fffffff && tokOut !== 0x7fffffff && toTok + tokOut > best) best = toTok + tokOut;
      }
      var de = dExit[c];
      if (de !== 0x7fffffff && de > best) best = de;
      return best;
    }

    /* Integer weighted f, so the ordering has no float in it anywhere. */
    function fOf(st) {
      return st.t + (((heuristic(st) * T.WN) / T.WD) | 0);
    }

    /* Standing still is a real tactic against a turret cadence, a rotor
     * sweep, a phase block, to let a conveyor carry you, or to ride a
     * deflector launch — a launch survives only while no direction is held,
     * so riding one means pressing nothing.
     *
     * In a room with none of those, nothing changes while you wait, so dir 0
     * can only produce states the search already has. Dropping it there
     * removes a ninth of the branching in exactly the wide-open rooms that
     * search worst.
     *
     * Deflectors are in this list defensively rather than because a room
     * fails without them: a launched dot moves at exactly SPEED, the same as
     * a walking one, so under the current sim riding is never REQUIRED to
     * reach anywhere. It is here so that stays true if the deflector rule
     * changes, and because being wrong in this direction costs one branch
     * while being wrong the other way costs an author their afternoon. */
    var timeMatters = root.turrets.length > 0 || root.rotors.length > 0 ||
                      root.phases.length > 0 || root.conveys.length > 0 ||
                      cellsOf(room, TILE.DEFLECT).length > 0;
    var DIRS = timeMatters ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [1, 2, 3, 4, 5, 6, 7, 8];

    var seen = {};
    var open = new Heap();
    open.push({ st: root, f: fOf(root), parent: null, dir: 0 });
    seen[stateKey(root)] = 1;

    var nodes = 0;
    var scratch = cloneState(root);

    while (open.a.length) {
      if (nodes > T.NODES) {
        return { ok: false, status: STATUS.BUDGET, nodes: nodes, rung: T.label,
          reason: 'ran out of NODES (' + T.NODES + ') at rung "' + T.label +
                  '" with states still queued' };
      }

      var cur = open.pop();

      for (var di = 0; di < DIRS.length; di++) {
        var dir = DIRS[di];
        var ns = copyInto(scratch, cur.st);
        var died = false, cleared = false;

        for (var s = 0; s < T.COMMIT; s++) {
          Sim.step(ns, dir);
          if (ns.result === Sim.RESULT.DEAD) { died = true; break; }
          if (ns.result === Sim.RESULT.CLEAR) { cleared = true; break; }
        }
        if (died) continue;

        if (cleared) {
          /* SPEC: grabbing the token and dying earns nothing, so a token run
           * only counts if the token came out through the exit. */
          if (!requireToken || ns.token) {
            return finish({ st: cloneState(ns), parent: cur, dir: dir }, T, nodes);
          }
          continue;
        }

        var key = stateKey(ns);
        if (seen[key]) continue;
        seen[key] = 1;

        open.push({ st: cloneState(ns), f: fOf(ns), parent: cur, dir: dir });
        nodes++;
      }
    }

    /* The open list emptied while still inside budget: every state reachable
     * under this quantisation was tried and none cleared. */
    return { ok: false, status: STATUS.EXHAUSTED, nodes: nodes, rung: T.label,
      reason: 'searched every reachable state at rung "' + T.label +
              '" and none of them cleared the room' };

    function finish(node, tune, n) {
      var decisions = [];
      for (var x = node; x && x.parent; x = x.parent) decisions.push(x.dir);
      decisions.reverse();

      var flat = [];
      for (var i = 0; i < decisions.length; i++) {
        for (var j = 0; j < tune.COMMIT; j++) flat.push(decisions[i]);
      }
      return { ok: true, status: STATUS.SOLVED, ticks: node.st.t, token: node.st.token,
               inputs: flat, decisions: decisions, nodes: n, rung: tune.label };
    }
  }

  /* Walk the ladder. Returns the first success, tagged with the rung that
   * found it so a loose par can be reported as loose rather than trusted.
   *
   * A room is only ever called unsolvable when the final rung EXHAUSTED the
   * space rather than the budget. That distinction is the difference between
   * "this room is broken" and "my search is not clever enough", and the two
   * are indistinguishable from inside the search. */
  function escalate(room, opts) {
    opts = opts || {};
    var last = null;
    for (var i = 0; i < LADDER.length; i++) {
      var r = search(room, { requireToken: !!opts.requireToken, tune: LADDER[i] });
      if (r.ok) { r.rungIndex = i; return r; }
      if (r.fatal) return r;
      last = r;
      /* A greedier rung explores a strict subset of a space already searched
       * to exhaustion, so it cannot do better. */
      if (r.status === STATUS.EXHAUSTED) break;
    }
    return last;
  }

  /* Replay an input list on a fresh sim and confirm it still clears, twice,
   * with an identical state hash. Turns "the search found a line" into "the
   * room is provably clearable", and is the determinism regression test at
   * the same time (SPEC §7.5). */
  function proves(room, inputs) {
    var a = Sim.create(room), b = Sim.create(room), i;
    /* Peak live bullets and cap overflow, watched along the winning route.
     * Relay's ask: if the MAX_BULLETS cap ever swallows a shot in a GENERATED
     * room, that is not density to tune, it is the generator emitting
     * something he did not intend, and he wants it failed against his file.
     * Note what this window covers: the proven route, which is the ticks a
     * player who clears actually lives through, and nothing after it. */
    var peak = 0;
    for (i = 0; i < inputs.length && a.result === Sim.RESULT.RUN; i++) {
      Sim.step(a, inputs[i]);
      if (a.bullets.length > peak) peak = a.bullets.length;
    }
    for (i = 0; i < inputs.length && b.result === Sim.RESULT.RUN; i++) Sim.step(b, inputs[i]);

    if (a.result !== Sim.RESULT.CLEAR) {
      return { ok: false, why: 'replay did not clear, it ended "' + a.result + '"' +
        (a.deathCause ? ' (' + a.deathCause + ')' : '') };
    }
    if (Sim.hash(a) !== Sim.hash(b)) {
      return { ok: false, why: 'two identical replays produced different state hashes, determinism is broken' };
    }
    return { ok: true, ticks: a.t, hash: Sim.hash(a),
             peakBullets: peak, skipped: a.bulletsSkipped };
  }

  /* A room cleared by holding one direction from the start is not a room.
   * Nearly free to check and it catches more bad rooms than anything else.
   * Returns the offending direction id, or 0. */
  function trivialDirection(room) {
    for (var dir = 1; dir <= 8; dir++) {
      var st = Sim.create(room);
      for (var t = 0; t < K.MAX_TICKS && st.result === Sim.RESULT.RUN; t++) Sim.step(st, dir);
      if (st.result === Sim.RESULT.CLEAR) return dir;
    }
    return 0;
  }

  BAIT.Solve = {
    STATUS: STATUS, LADDER: LADDER, QUICK: QUICK,
    search: search, escalate: escalate,
    proves: proves, trivialDirection: trivialDirection,
    reachable: reachable, distanceField: distanceField, cellsOf: cellsOf,
    cloneState: cloneState, faithful: faithful
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BAIT.Solve;

})(typeof window !== 'undefined'
  ? (window.BAIT = window.BAIT || {})
  : (global.BAIT = global.BAIT || {}));
