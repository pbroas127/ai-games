/* BAIT — the deterministic simulation.
 *
 * OWNER: Forge (Engine).
 *
 * Same room + same input sequence = same outcome, on every machine, forever.
 * That single property is what makes replays, ghosts, the prove-gate, the
 * daily and the headless solver all possible, so everything in this file is
 * integer arithmetic on int32 values and nothing in it reads a clock, a
 * random number or the DOM.
 *
 * ZERO DOM REFERENCES. tools/verify.cjs loads this file under plain Node.
 *
 * ------------------------------------------------------------------ shapes --
 * Two hitbox rules, and the difference is deliberate:
 *
 *   SOLIDS are resolved against a SQUARE of half-extent K.RADIUS, one axis at
 *   a time. True circle-against-corner resolution needs a square root, which
 *   has no exact integer form, and every approximation of it either sticks in
 *   corners or lets you shave them. A square against an axis-aligned grid can
 *   do neither: you either slide cleanly along the face or you stop. That is
 *   the "hard right angles" read the art direction asks for and it is why
 *   cornering feels exact.
 *
 *   EVERYTHING ELSE — pits, mimics, fallers, keys, the token, the exit,
 *   conveyors, rotor beams, bullets — uses a TRUE CIRCLE of radius K.RADIUS.
 *   This is the forgiving test, and it is the forgiving one on purpose: it is
 *   what makes "brushing the corner of a faller must not consume it" true,
 *   and it means no hazard ever kills you for a pixel you could not see.
 *
 * ------------------------------------------------------------------- timing --
 * PHASE blocks and ROTORs count beats: beat = floor(t / (period*10)), and the
 * piece's `phase` is added to that beat count. TURRETs are offset in ticks by
 * phase*10, per the piece contract. Both are exact integer schedules with no
 * drift, which is what lets the solver quantise time by the LCM of periods.
 */
(function (BAIT) {
  'use strict';

  var F = BAIT.Fixed, P = BAIT.Pieces, RoomLib = BAIT.Room;
  var K = P.K, TILE = P.TILE;

  var ONE = K.ONE;
  var CELL = K.CELL;
  var PU = K.PERIOD_UNIT;
  var RAD = K.RADIUS * ONE;            // player half-extent / radius, fixed px
  var BR = K.BULLET_R * ONE;
  var RR = K.ROTOR_R * ONE;
  var CELL_FX = CELL * ONE;
  var HALF_CELL = CELL_FX >> 1;

  /* Conveyor drift, now in the shared table where it belongs. Half of SPEED,
   * so a conveyor taxes your route but can never out-push a player walking
   * into it. */
  var CONVEY_DRIFT = K.CONVEY_SPEED;

  /* Hard cap on live bullets. A room cannot author its way past this, and a
   * decoded room code certainly cannot: a turret wall must not be able to
   * allocate without bound (SPEC §0.6). At the cap, spawns are skipped, which
   * is deterministic and therefore safe for the solver. */
  var MAX_BULLETS = 64;

  var RESULT = { RUN: 'run', DEAD: 'dead', CLEAR: 'clear' };

  var QUARTER = [1, 3, 5, 7];          // rotor orientations, clockwise from N

  /* ------------------------------------------------------------ geometry -- */

  function cellOf(fx) { return ((fx >> 16) / CELL) | 0; }
  function centerFx(c) { return (c * CELL) * ONE + HALF_CELL; }

  /* Circle against an axis-aligned rectangle, all in fixed-point px. The >>8
   * keeps the squared distance inside int32 (a full-room delta squared would
   * not fit) and costs 1/256 px of precision, which is deterministic and two
   * orders of magnitude below anything a player can perceive.
   *
   * Strictly `<`: touching exactly is not overlapping. That is what stops a
   * faller being consumed by a dot that grazes its corner. */
  function circleRect(x, y, L, T, R2, B2, rad) {
    var nx = x < L ? L : (x > R2 ? R2 : x);
    var ny = y < T ? T : (y > B2 ? B2 : y);
    var dx = (x - nx) >> 8, dy = (y - ny) >> 8, r = rad >> 8;
    return dx * dx + dy * dy < r * r;
  }

  function circleCell(x, y, cx, cy) {
    var L = (cx * CELL) * ONE, T = (cy * CELL) * ONE;
    return circleRect(x, y, L, T, L + CELL_FX, T + CELL_FX, RAD);
  }

  /* ---------------------------------------------------------------- setup -- */

  function create(room) {
    var w = room.w, h = room.h, n = w * h;

    var st = {
      room: room, w: w, h: h,

      t: 0,
      x: 0, y: 0,                      // Q16.16 px, centre of the dot
      px: 0, py: 0,                    // where it was last tick, for render lerp
      heading: 0,                      // 0..8, last committed direction
      launched: false,                 // moving without input (deflector)
      inputDir: 0,                     // what the player asked for this tick

      keys: 0, keysTotal: RoomLib.keyCount(room),
      token: false,

      fallen: new Uint8Array(n),       // fallers that have become pits
      taken: new Uint8Array(n),        // keys / token already collected
      solid: new Uint8Array(n),        // recomputed per tick for gates+phase
      latch: new Uint8Array(K.MAX_LINK + 1),
      hold: new Uint8Array(K.MAX_LINK + 1),
      gates: new Uint8Array(K.MAX_LINK + 1),   // gates[link] truthy when open

      onFaller: -1,                    // faller currently stood on, or -1
      teleLock: -1,                    // teleport we just arrived at
      cell: 0,                         // centre cell index

      bullets: [],                     // {x,y,vx,vy} fixed px, insertion order

      result: RESULT.RUN,
      deathCause: '', deathX: 0, deathY: 0,

      /* precomputed piece lists: step() must not rescan 280 cells per tick */
      turrets: [], rotors: [], phases: [], gateList: [], plates: [], conveys: [],
      teleTwin: null,
      staticSolid: new Uint8Array(n),
      staticLethal: new Uint8Array(n)
    };

    var teleTwin = {};
    for (var i = 0; i < n; i++) {
      var id = room.tiles[i], p = room.params[i] || null;
      var cx = i % w, cy = (i / w) | 0;

      if (P.isSolid(id)) st.staticSolid[i] = 1;
      if (P.isLethal(id)) st.staticLethal[i] = 1;

      switch (id) {
        case TILE.TURRET:
          st.turrets.push({ i: i, cx: cx, cy: cy, dir: p.dir,
                            period: p.period * PU, phase: p.phase * PU });
          break;
        case TILE.ROTOR:
          st.rotors.push({ i: i, cx: cx, cy: cy,
                           period: p.period, phase: p.phase, len: p.len });
          break;
        case TILE.PHASE:
          st.phases.push({ i: i, cx: cx, cy: cy, period: p.period, phase: p.phase });
          break;
        case TILE.GATE:
          st.gateList.push({ i: i, cx: cx, cy: cy, link: p.link });
          break;
        case TILE.PLATE:
          st.plates.push({ i: i, cx: cx, cy: cy, link: p.link, mode: p.mode });
          break;
        case TILE.CONVEY:
          st.conveys.push({ i: i, cx: cx, cy: cy, dir: p.dir });
          break;
        case TILE.TELEPORT:
          (teleTwin[p.link] = teleTwin[p.link] || []).push(i);
          break;
      }
    }

    /* Flatten teleport pairs to a direct cell -> cell lookup. Anything not
     * exactly paired (validate() rejects it, but a decoded code reaches here
     * too) becomes inert rather than ambiguous. */
    st.teleTwin = new Int32Array(n);
    for (var q = 0; q < n; q++) st.teleTwin[q] = -1;
    for (var lk in teleTwin) {
      if (!Object.prototype.hasOwnProperty.call(teleTwin, lk)) continue;
      var pair = teleTwin[lk];
      if (pair.length === 2) {
        st.teleTwin[pair[0]] = pair[1];
        st.teleTwin[pair[1]] = pair[0];
      }
    }

    reset(st);
    return st;
  }

  /* Restart in place. SPEC §2 wants retry available on the next frame, so
   * this reuses every buffer instead of reallocating a state. */
  function reset(st) {
    var n = st.w * st.h;

    st.t = 0;
    st.x = centerFx(st.room.start.x);
    st.y = centerFx(st.room.start.y);
    st.px = st.x; st.py = st.y;
    st.heading = 0;
    st.launched = false;
    st.inputDir = 0;
    st.keys = 0;
    st.token = false;
    st.onFaller = -1;
    st.teleLock = -1;
    st.cell = st.room.start.y * st.w + st.room.start.x;
    st.bullets.length = 0;
    st.result = RESULT.RUN;
    st.deathCause = ''; st.deathX = 0; st.deathY = 0;

    st.fallen.fill(0);
    st.taken.fill(0);
    st.latch.fill(0);
    st.hold.fill(0);
    st.gates.fill(0);

    /* If the dot starts on a faller, it is stood on it from tick zero. */
    if (st.room.tiles[st.cell] === TILE.FALLER) st.onFaller = st.cell;

    updatePlates(st);
    updateSolid(st);
    return st;
  }

  /* -------------------------------------------------------- dynamic state -- */

  function phaseSolidAt(t, period, phase) {
    /* solid when beat + phase is even (SPEC / Boss's formula, verbatim) */
    var beat = (t / (period * PU)) | 0;
    return ((beat + phase) & 1) === 0;
  }

  function gateOpen(st, link) {
    return st.latch[link] !== 0 || st.hold[link] !== 0;
  }

  function updateSolid(st) {
    st.solid.set(st.staticSolid);
    var i, g;
    /* gates[link] is the renderer's view: one flag per link, open or shut.
     * It drives the gate AND its plate, so both always agree on screen. */
    for (i = 0; i < st.gates.length; i++) st.gates[i] = gateOpen(st, i) ? 1 : 0;
    for (i = 0; i < st.gateList.length; i++) {
      g = st.gateList[i];
      st.solid[g.i] = st.gates[g.link] ? 0 : 1;
    }
    for (i = 0; i < st.phases.length; i++) {
      g = st.phases[i];
      st.solid[g.i] = phaseSolidAt(st.t, g.period, g.phase) ? 1 : 0;
    }
  }

  /* Plates read the CENTRE CELL, not the circle. A plate you are merely
   * brushing should not fire a gate on the far side of the room, and "am I
   * stood on it" is the reading a player already has. */
  function updatePlates(st) {
    st.hold.fill(0);
    for (var i = 0; i < st.plates.length; i++) {
      var pl = st.plates[i];
      if (pl.mode === 0 && pl.i === st.cell) st.hold[pl.link] = 1;
    }
  }

  function isSolid(st, cx, cy) {
    if (cx < 0 || cy < 0 || cx >= st.w || cy >= st.h) return true;
    return st.solid[cy * st.w + cx] !== 0;
  }

  /* --------------------------------------------------------------- motion -- */

  function moveX(st, vx) {
    if (!vx) return;
    var lo = RAD, hi = (st.w * CELL) * ONE - RAD;
    var x = st.x + vx;
    if (x < lo) x = lo; else if (x > hi) x = hi;

    var cy0 = cellOf(st.y - RAD), cy1 = cellOf(st.y + RAD - 1), cy, cx;
    if (vx > 0) {
      cx = cellOf(x + RAD - 1);
      for (cy = cy0; cy <= cy1; cy++) {
        if (isSolid(st, cx, cy)) { x = (cx * CELL) * ONE - RAD; break; }
      }
    } else {
      cx = cellOf(x - RAD);
      for (cy = cy0; cy <= cy1; cy++) {
        if (isSolid(st, cx, cy)) { x = ((cx + 1) * CELL) * ONE + RAD; break; }
      }
    }
    st.x = x;
  }

  function moveY(st, vy) {
    if (!vy) return;
    var lo = RAD, hi = (st.h * CELL) * ONE - RAD;
    var y = st.y + vy;
    if (y < lo) y = lo; else if (y > hi) y = hi;

    var cx0 = cellOf(st.x - RAD), cx1 = cellOf(st.x + RAD - 1), cx, cy;
    if (vy > 0) {
      cy = cellOf(y + RAD - 1);
      for (cx = cx0; cx <= cx1; cx++) {
        if (isSolid(st, cx, cy)) { y = (cy * CELL) * ONE - RAD; break; }
      }
    } else {
      cy = cellOf(y - RAD);
      for (cx = cx0; cx <= cx1; cx++) {
        if (isSolid(st, cx, cy)) { y = ((cy + 1) * CELL) * ONE + RAD; break; }
      }
    }
    st.y = y;
  }

  /* Square hitbox against solids — used only to detect a gate or phase block
   * closing on top of the player. */
  function insideSolid(st) {
    var cx0 = cellOf(st.x - RAD), cx1 = cellOf(st.x + RAD - 1);
    var cy0 = cellOf(st.y - RAD), cy1 = cellOf(st.y + RAD - 1);
    for (var cy = cy0; cy <= cy1; cy++) {
      for (var cx = cx0; cx <= cx1; cx++) {
        if (isSolid(st, cx, cy)) return true;
      }
    }
    return false;
  }

  /* At most one conveyor may push, ever. Overlapping two would otherwise
   * double the drift, which is both unfair and a determinism trap for the
   * solver. Lowest cell index wins — arbitrary, but fixed forever. */
  function conveyorUnder(st) {
    for (var i = 0; i < st.conveys.length; i++) {
      var c = st.conveys[i];
      if (circleCell(st.x, st.y, c.cx, c.cy)) return K.CARD[c.dir];
    }
    return null;
  }

  /* -------------------------------------------------------------- hazards -- */

  function spawnBullets(st) {
    for (var i = 0; i < st.turrets.length; i++) {
      var tr = st.turrets[i];
      if (st.bullets.length >= MAX_BULLETS) return;
      if ((st.t % tr.period) !== (tr.phase % tr.period)) continue;

      var d = K.CARD[tr.dir];
      var mx = tr.cx + d[0], my = tr.cy + d[1];
      if (isSolid(st, mx, my)) continue;          // muzzle blocked, no shot

      var bx = centerFx(mx), by = centerFx(my);
      st.bullets.push({
        x: bx, y: by, px: bx, py: by,
        vx: d[0] * K.BULLET_SPEED, vy: d[1] * K.BULLET_SPEED
      });
    }
  }

  function advanceBullets(st) {
    var out = [];
    for (var i = 0; i < st.bullets.length; i++) {
      var b = st.bullets[i];
      b.px = b.x; b.py = b.y;
      b.x += b.vx; b.y += b.vy;
      var cx = cellOf(b.x), cy = cellOf(b.y);
      if (cx < 0 || cy < 0 || cx >= st.w || cy >= st.h) continue;
      if (isSolid(st, cx, cy)) continue;           // absorbed
      out.push(b);
    }
    st.bullets = out;
  }

  /* The live extent of a rotor beam, in fixed px, as {x0,y0,x1,y1} plus the
   * cardinal it points down. Ink draws exactly this, so the beam that kills
   * you is provably the beam you were shown. */
  function rotorBeam(st, rot) {
    var beat = (st.t / (rot.period * PU)) | 0;
    var dirId = QUARTER[(beat + rot.phase) & 3];
    var d = K.CARD[dirId];

    var reach = 0;
    for (var s = 1; s <= rot.len; s++) {
      var cx = rot.cx + d[0] * s, cy = rot.cy + d[1] * s;
      if (isSolid(st, cx, cy)) break;
      reach = s;
    }

    var hx = centerFx(rot.cx), hy = centerFx(rot.cy);
    var ex = hx + d[0] * reach * CELL_FX, ey = hy + d[1] * reach * CELL_FX;
    return {
      dir: dirId, reach: reach,
      x0: Math.min(hx, ex), y0: Math.min(hy, ey),
      x1: Math.max(hx, ex), y1: Math.max(hy, ey)
    };
  }

  function rotorHits(st, rot) {
    var b = rotorBeam(st, rot);
    if (b.reach === 0) return false;
    return circleRect(st.x, st.y, b.x0 - RR, b.y0 - RR, b.x1 + RR, b.y1 + RR, RAD);
  }

  /* ----------------------------------------------------------------- step -- */

  function die(st, cause) {
    st.result = RESULT.DEAD;
    st.deathCause = cause;
    st.deathX = st.x;
    st.deathY = st.y;
  }

  /* One simulation tick. `dir` is 0..8, sampled from the CURRENT held keys at
   * the top of the tick and applied in the same tick — no buffer, no easing,
   * no coyote time (SPEC §2). Mutates and returns state. */
  function step(st, dir) {
    if (st.result !== RESULT.RUN) return st;

    var room = st.room, w = st.w;

    /* 1. st.solid already describes tick st.t — reset() seeds it and every
     *    step leaves it correct for the tick that is about to run. That is
     *    deliberate: between ticks the renderer reads cellSolid() and must see
     *    the same world the player is standing in, not the previous beat.
     *
     *    A block that closed on the player kills here, before anything moves,
     *    rather than resolving them out through a wall. It is telegraphed a
     *    full beat ahead (see phaseInfo), which is what earns it. */
    if (insideSolid(st)) { die(st, 'crushed'); return st; }

    /* 1b. remember where everything was, so the renderer can interpolate
     *     between the last tick and this one instead of juddering at any
     *     refresh rate that is not an exact multiple of 120. */
    st.px = st.x; st.py = st.y;

    /* 2. hazards for this tick */
    spawnBullets(st);
    advanceBullets(st);

    /* 3. input.
     *
     * A LAUNCH IS NOT CANCELLED BY INPUT. This looks like it contradicts
     * "keeps that heading until they input a new direction", and it is the
     * fix for that reading being unimplementable: a player crossing a
     * deflector is already holding a direction, so treating held input as "a
     * new direction" cancelled every launch on the very next tick and made
     * the piece inert for everyone who was not walking with their hands off
     * the keyboard. Lathe caught it against chapter 4.
     *
     * So a deflector puts you on rails. You get control back when the rails
     * run out, which is the block check after the move below. */
    dir = dir | 0;
    if (dir < 0 || dir > 8) dir = 0;
    st.inputDir = dir;
    if (!st.launched && dir !== 0) st.heading = dir;
    var moveDir = st.launched ? st.heading : dir;

    /* 4. velocity: constant speed, plus at most one conveyor's drift */
    var v = K.DIRS[moveDir];
    var vx = v[0], vy = v[1];
    var conv = conveyorUnder(st);
    if (conv) { vx += conv[0] * CONVEY_DRIFT; vy += conv[1] * CONVEY_DRIFT; }

    /* 5. move, one axis at a time, so a diagonal into a wall slides */
    moveX(st, vx);
    moveY(st, vy);

    /* 5b. A launch ends the instant the dot is fully blocked. Without this a
     *     player launched into a wall rests against it with the rails still
     *     on and is stuck there until the three minute timeout, which is not
     *     a trap, it is a freeze. Position is compared against st.px/st.py,
     *     captured at 1b before anything moved. */
    if (st.launched && st.x === st.px && st.y === st.py) st.launched = false;

    var prevCell = st.cell;
    var c = cellOf(st.y) * w + cellOf(st.x);
    st.cell = c;

    /* 6. teleport, before anything else reads the cell, so the rest of the
     *    tick happens where the player actually ended up */
    if (st.teleLock >= 0 && c !== st.teleLock) st.teleLock = -1;
    if (room.tiles[c] === TILE.TELEPORT && c !== st.teleLock) {
      var twin = st.teleTwin[c];
      if (twin >= 0) {
        st.x = centerFx(twin % w);
        st.y = centerFx((twin / w) | 0);
        /* Collapse the previous position onto the new one. A teleport is the
         * one discontinuity in the whole game, and interpolating across it
         * would draw the dot smeared through every wall in between. */
        st.px = st.x; st.py = st.y;
        st.teleLock = twin;
        c = twin;
        st.cell = c;
        /* heading and launch survive the trip, deliberately */
      }
    }

    /* 7. deflector: entering the cell slams the heading and keeps you moving */
    if (c !== prevCell && room.tiles[c] === TILE.DEFLECT) {
      var dp = room.params[c];
      if (dp) { st.heading = dp.dir; st.launched = true; }
    }

    /* 8. plates. Latch toggles once, on entry. Hold is recomputed. */
    if (c !== prevCell && room.tiles[c] === TILE.PLATE) {
      var pp = room.params[c];
      if (pp && pp.mode === 1) st.latch[pp.link] = st.latch[pp.link] ? 0 : 1;
    }
    updatePlates(st);

    /* 9. the faller.
     *    Occupancy is CENTRE CELL: brushing a corner never marks it, so it can
     *    never be consumed by a graze. It drops the moment the dot both leaves
     *    the cell and stops overlapping it at all — so stepping half off and
     *    back on is safe, exactly as it looks. */
    if (st.onFaller >= 0 && c !== st.onFaller) {
      var fx = st.onFaller % w, fy = (st.onFaller / w) | 0;
      if (!circleCell(st.x, st.y, fx, fy)) {
        st.fallen[st.onFaller] = 1;
        st.onFaller = -1;
      }
    }
    if (st.onFaller < 0 && room.tiles[c] === TILE.FALLER && !st.fallen[c]) {
      st.onFaller = c;
    }

    /* 10. lethal overlaps. Cells first, then bullets, then rotors. */
    var cx0 = cellOf(st.x - RAD), cx1 = cellOf(st.x + RAD - 1);
    var cy0 = cellOf(st.y - RAD), cy1 = cellOf(st.y + RAD - 1);
    var cx, cy, i, ci;
    for (cy = cy0; cy <= cy1; cy++) {
      if (cy < 0 || cy >= st.h) continue;
      for (cx = cx0; cx <= cx1; cx++) {
        if (cx < 0 || cx >= st.w) continue;
        ci = cy * w + cx;
        var lethal = st.staticLethal[ci] !== 0;
        var fell = st.fallen[ci] !== 0;
        if (!lethal && !fell) continue;
        if (!circleCell(st.x, st.y, cx, cy)) continue;
        die(st, fell ? 'faller' : (room.tiles[ci] === TILE.MIMIC ? 'mimic' : 'pit'));
        return st;
      }
    }

    for (i = 0; i < st.bullets.length; i++) {
      var b = st.bullets[i];
      var dx = (st.x - b.x) >> 8, dy = (st.y - b.y) >> 8, rr = (RAD + BR) >> 8;
      if (dx * dx + dy * dy < rr * rr) { die(st, 'bullet'); return st; }
    }

    for (i = 0; i < st.rotors.length; i++) {
      if (rotorHits(st, st.rotors[i])) { die(st, 'rotor'); return st; }
    }

    /* 11. pickups, then the exit. Order matters: the last key and the exit on
     *     the same tick should clear, not lock you out. */
    for (cy = cy0; cy <= cy1; cy++) {
      if (cy < 0 || cy >= st.h) continue;
      for (cx = cx0; cx <= cx1; cx++) {
        if (cx < 0 || cx >= st.w) continue;
        ci = cy * w + cx;
        if (st.taken[ci]) continue;
        var tid = room.tiles[ci];
        if (tid !== TILE.KEY && tid !== TILE.TOKEN) continue;
        if (!circleCell(st.x, st.y, cx, cy)) continue;
        st.taken[ci] = 1;
        if (tid === TILE.KEY) st.keys++; else st.token = true;
      }
    }

    if (st.keys >= st.keysTotal) {
      for (cy = cy0; cy <= cy1; cy++) {
        if (cy < 0 || cy >= st.h) continue;
        for (cx = cx0; cx <= cx1; cx++) {
          if (cx < 0 || cx >= st.w) continue;
          ci = cy * w + cx;
          if (room.tiles[ci] !== TILE.EXIT) continue;
          if (!circleCell(st.x, st.y, cx, cy)) continue;
          st.result = RESULT.CLEAR;
          st.t++;
          return st;
        }
      }
    }

    /* 12. clock. A room that runs past MAX_TICKS is a loss, not a hang — the
     *     solver depends on every run terminating. */
    st.t++;
    if (st.t >= K.MAX_TICKS) { die(st, 'timeout'); return st; }

    /* 13. settle gates and phase blocks for the tick that comes next, so the
     *     state handed back is internally consistent with its own st.t. */
    updateSolid(st);
    return st;
  }

  /* ----------------------------------------------------------------- hash --
   * FNV-1a over every field that can affect a future tick. This is the
   * determinism regression test: tools/verify.cjs replays a solution and
   * asserts the hash is identical. Anything left out of here is a field that
   * can drift without being caught, so err toward including it. */
  function hash(st) {
    var h = 0x811c9dc5 | 0, i;
    function mix(v) { h = (h ^ (v | 0)) | 0; h = Math.imul(h, 0x01000193) | 0; }

    mix(st.t); mix(st.x); mix(st.y);
    mix(st.heading); mix(st.launched ? 1 : 0); mix(st.inputDir);
    mix(st.keys); mix(st.token ? 1 : 0);
    mix(st.onFaller); mix(st.teleLock); mix(st.cell);
    mix(st.result === RESULT.RUN ? 1 : st.result === RESULT.DEAD ? 2 : 3);

    for (i = 0; i < st.fallen.length; i++) if (st.fallen[i]) mix(0x1000 + i);
    for (i = 0; i < st.taken.length; i++) if (st.taken[i]) mix(0x2000 + i);
    for (i = 0; i < st.latch.length; i++) if (st.latch[i]) mix(0x3000 + i);
    for (i = 0; i < st.bullets.length; i++) {
      mix(st.bullets[i].x); mix(st.bullets[i].y);
      mix(st.bullets[i].vx); mix(st.bullets[i].vy);
    }
    return h | 0;
  }

  /* ------------------------------------------------------------ read-only --
   * Everything below is for the renderer and the editor. None of it mutates.
   */

  /* Is this cell solid right now, gates and phase blocks included? */
  function cellSolid(st, cx, cy) { return isSolid(st, cx, cy); }

  /* For Ink's telegraph: a phase block's current state and how many ticks
   * until it flips. Flash it while ticksToFlip <= 24 (one fifth of a second)
   * and the player is warned a full beat before it matters. */
  function phaseInfo(st, cellIndex) {
    for (var i = 0; i < st.phases.length; i++) {
      var ph = st.phases[i];
      if (ph.i !== cellIndex) continue;
      var span = ph.period * PU;
      var beat = (st.t / span) | 0;
      return {
        solid: phaseSolidAt(st.t, ph.period, ph.phase),
        ticksToFlip: (beat + 1) * span - st.t,
        period: span
      };
    }
    return null;
  }

  /* Every live rotor beam this tick, ready to draw. */
  function rotorBeams(st) {
    var out = [];
    for (var i = 0; i < st.rotors.length; i++) {
      var b = rotorBeam(st, st.rotors[i]);
      b.cell = st.rotors[i].i;
      out.push(b);
    }
    return out;
  }

  BAIT.Sim = {
    RESULT: RESULT,
    CONVEY_DRIFT: CONVEY_DRIFT,
    MAX_BULLETS: MAX_BULLETS,

    create: create, reset: reset, step: step, hash: hash,

    cellSolid: cellSolid, gateOpen: gateOpen,
    phaseInfo: phaseInfo, rotorBeams: rotorBeams,
    circleCell: circleCell, cellOf: cellOf, centerFx: centerFx
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BAIT.Sim;

})(typeof window !== 'undefined'
  ? (window.BAIT = window.BAIT || {})
  : (global.BAIT = global.BAIT || {}));
