/* BAIT — the daily gauntlet generator.
 *
 * OWNER: Relay.
 *
 * BAIT.Daily.generate(dateSeed) -> Room[5], pure and deterministic from a
 * YYYYMMDD integer. Everyone on earth gets the identical five rooms with
 * no server involved — that is the entire trick (SPEC §4.2).
 *
 * Verification model (Boss's ruling in #bait-build):
 *   THE DAILY DOES NOT SOLVE AT BOOT. generate() is a pure function of
 *   the seed — no solver, no environment branches — so the rooms the
 *   browser builds are byte-identical to the rooms tools/verify.cjs
 *   builds in Node. verify.cjs walks every daily seed through
 *   VERIFIED_UNTIL and proves each day solvable with the real solver;
 *   if any day fails, the BUILD fails and we do not ship. A day proven
 *   in Node is the identical day in the browser, which is a stronger
 *   guarantee than a runtime check and costs the player nothing.
 *
 * Hard rules:
 *   - Seeded PRNG only (BAIT.Rng). Math.random does not exist here.
 *   - generate() must depend on NOTHING but the seed. If it ever reads
 *     the solver, the clock, or a feature flag, browser and Node drift
 *     and the guarantee silently dies.
 *   - Candidates are filtered by cheap deterministic structure checks
 *     (flood fill), with a BOUNDED retry count and hand-authored
 *     fallback slots, so generation can never hang.
 *   - Seeds past VERIFIED_UNTIL use the fallback set outright: past the
 *     verified window we fall back rather than gamble (Boss's ruling).
 *   - Difficulty ramps across the five slots.
 *
 * Confirmed against Forge's files on disk:
 *   BAIT.Rng.create(seed)      -> { next(), int(n): 0..n-1, ... }
 *   BAIT.Room.fromText(lines, paramMap) -> room; paramMap keyed 'x,y'
 */
(function (BAIT) {
  'use strict';

  var K = BAIT.Pieces.K;
  var W = K.GRID_W, H = K.GRID_H;

  /* Retry budget per slot. Generous enough that fallbacks are rare,
   * bounded so boot can never hang on a pathological seed. */
  var MAX_TRIES = 24;

  /* The last daily seed proven solvable by tools/verify.cjs. Seeds past
   * this date use the hand-authored fallback set instead of gambling on
   * unverified generation. BUMP THIS ONLY when verify.cjs has walked and
   * passed every day up to the new value — verify.cjs reads this
   * constant and checks exactly that window, so the constant and the
   * proof can never quietly disagree. */
  var VERIFIED_UNTIL = 20270731;

  /* Minimum flood-fill distance (in cells) from start to exit, per slot.
   * A cheap deterministic floor under the difficulty ramp: later slots
   * must at least be longer walks. The real ramp comes from the hazard
   * mix per tier; the real solvability proof is verify.cjs's. */
  var DIST_MIN = [12, 14, 16, 18, 20];

  /* ------------------------------------------------------------ date math */

  /* Local date -> YYYYMMDD integer. The daily is local-midnight by design:
   * simple, offline, and "everyone gets it on their calendar day". */
  function todaySeed() {
    var d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  /* Gauntlet #1 is EPOCH; the share string's "gauntlet 214" is this. */
  var EPOCH_UTC = Date.UTC(2026, 0, 1);

  function dayNumber(dateSeed) {
    var y = (dateSeed / 10000) | 0;
    var m = ((dateSeed / 100) | 0) % 100;
    var d = dateSeed % 100;
    var t = Date.UTC(y, m - 1, d);
    return Math.floor((t - EPOCH_UTC) / 86400000) + 1;
  }

  function validSeed(s) {
    s = s | 0;
    var y = (s / 10000) | 0, m = ((s / 100) | 0) % 100, d = s % 100;
    return y >= 2020 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
  }

  /* -------------------------------------------------------- grid plumbing */

  function makeGrid() {
    var g = [];
    for (var y = 0; y < H; y++) {
      var row = [];
      for (var x = 0; x < W; x++) {
        row.push((x === 0 || y === 0 || x === W - 1 || y === H - 1) ? '#' : '.');
      }
      g.push(row);
    }
    return g;
  }

  function inField(x, y) {
    return x >= 1 && x < W - 1 && y >= 1 && y < H - 1;
  }

  function put(g, x, y, ch) {
    if (inField(x, y)) g[y][x] = ch;
  }

  function at(g, x, y) {
    return inField(x, y) ? g[y][x] : '#';
  }

  /* Clear a plus-shaped pocket so start/exit are never walled in. */
  function pocket(g, x, y) {
    put(g, x, y, '.');
    put(g, x + 1, y, '.'); put(g, x - 1, y, '.');
    put(g, x, y + 1, '.'); put(g, x, y - 1, '.');
  }

  function toLines(g) {
    var lines = [];
    for (var y = 0; y < H; y++) lines.push(g[y].join(''));
    return lines;
  }

  /* -------------------------------------------------------- the generator */

  /* One candidate room for a difficulty slot. Pure function of the rng
   * stream. Structure: border walls, a handful of interior wall strokes,
   * start left, exit right, then hazards by tier. The solver is the
   * arbiter of whether the result is a room or a wall with opinions. */
  function buildCandidate(rng, tier) {
    var g = makeGrid();
    var params = {};
    var x, y, i, len, j;

    /* Interior wall strokes. */
    var strokes = 5 + tier * 2 + rng.int(3);
    for (i = 0; i < strokes; i++) {
      x = 2 + rng.int(W - 4);
      y = 2 + rng.int(H - 4);
      len = 2 + rng.int(4);
      var horiz = rng.int(2) === 0;
      for (j = 0; j < len; j++) {
        put(g, x + (horiz ? j : 0), y + (horiz ? 0 : j), '#');
      }
    }

    /* Start on the left, exit on the right, both in cleared pockets. */
    var sx = 1 + rng.int(2), sy = 2 + rng.int(H - 4);
    var ex = W - 2 - rng.int(2), ey = 2 + rng.int(H - 4);
    pocket(g, sx, sy); pocket(g, ex, ey);
    put(g, sx, sy, 'S'); put(g, ex, ey, 'E');

    /* Pits — honest holes on the floor. */
    var pits = 3 + tier * 2 + rng.int(3);
    for (i = 0; i < pits; i++) {
      x = 2 + rng.int(W - 4); y = 2 + rng.int(H - 4);
      if (at(g, x, y) === '.') put(g, x, y, 'x');
    }

    /* Tier 1+: cadence — turrets and phase blocks. */
    if (tier >= 1) {
      var turrets = 1 + ((tier + 1) >> 1);
      var dirs = [1, 3, 5, 7];
      for (i = 0; i < turrets; i++) {
        x = 3 + rng.int(W - 6); y = 3 + rng.int(H - 6);
        if (at(g, x, y) !== '.') continue;
        put(g, x, y, 'T');
        params[x + ',' + y] = {
          dir: dirs[rng.int(4)],
          period: 8 + rng.int(9),
          phase: rng.int(8)
        };
      }
      var phases = 1 + rng.int(2);
      for (i = 0; i < phases; i++) {
        x = 3 + rng.int(W - 6); y = 2 + rng.int(H - 4);
        if (at(g, x, y) !== '.') continue;
        put(g, x, y, '%');
        params[x + ',' + y] = { period: 10 + rng.int(7), phase: rng.int(8) };
      }
    }

    /* Tier 2+: linkage — a key, and a gate/plate pair guarding the exit
     * side. The gate wears link 1; its plate sits somewhere off-route. */
    if (tier >= 2) {
      var keys = 1 + (tier >= 3 ? rng.int(2) : 0);
      for (i = 0; i < keys; i++) {
        x = 2 + rng.int(W - 4); y = 2 + rng.int(H - 4);
        if (at(g, x, y) === '.') put(g, x, y, 'k');
      }
      var gx = ex - 2 - rng.int(3), gy = ey;
      if (at(g, gx, gy) === '.') {
        put(g, gx, gy, 'G');
        params[gx + ',' + gy] = { link: 1 };
        put(g, gx, gy - 1, '#'); put(g, gx, gy + 1, '#');
        var px = 2 + rng.int((W >> 1) - 2), py = 2 + rng.int(H - 4);
        if (at(g, px, py) === '.') {
          put(g, px, py, '_');
          params[px + ',' + py] = { link: 1, mode: rng.int(2) };
        } else {
          /* No legal plate spot this try: unlock the gate back to floor
           * rather than shipping an unopenable room. */
          put(g, gx, gy, '.');
          delete params[gx + ',' + gy];
        }
      }
    }

    /* Tier 3+: drift — a conveyor run, a deflector, a rotor. */
    if (tier >= 3) {
      var cx = 3 + rng.int(W - 8), cy = 2 + rng.int(H - 4);
      var cch = rng.int(2) === 0 ? 'C' : 'J';     // east or west drift
      len = 3 + rng.int(3);
      for (j = 0; j < len; j++) {
        if (at(g, cx + j, cy) === '.') put(g, cx + j, cy, cch);
      }
      x = 3 + rng.int(W - 6); y = 2 + rng.int(H - 4);
      if (at(g, x, y) === '.') {
        put(g, x, y, ['^', '>', 'v', '<'][rng.int(4)]);
      }
      x = 4 + rng.int(W - 8); y = 3 + rng.int(H - 6);
      if (at(g, x, y) === '.') {
        put(g, x, y, 'R');
        params[x + ',' + y] = {
          period: 12 + rng.int(9), phase: rng.int(8), len: 2 + rng.int(3)
        };
      }
    }

    /* Tier 4: the liars. Fallers scattered on open floor, and a mimic
     * placed in the same column band as the real exit so the two shapes
     * genuinely compete for trust. */
    if (tier >= 4) {
      var fallers = 2 + rng.int(2);
      for (i = 0; i < fallers; i++) {
        x = 3 + rng.int(W - 6); y = 2 + rng.int(H - 4);
        if (at(g, x, y) === '.') put(g, x, y, 'f');
      }
      var my = 2 + rng.int(H - 4);
      if (my !== ey && at(g, ex, my) === '.') {
        pocket(g, ex, my);
        put(g, ex, my, 'M');
      }
    }

    /* The token, always on a worse line: the far corner pocket most
     * distant from both start and exit. */
    var corners = [[2, 2], [W - 3, 2], [2, H - 3], [W - 3, H - 3]];
    var best = null, bestScore = -1;
    for (i = 0; i < corners.length; i++) {
      var c = corners[i];
      var score = Math.abs(c[0] - sx) + Math.abs(c[1] - sy) +
                  Math.abs(c[0] - ex) + Math.abs(c[1] - ey);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    pocket(g, best[0], best[1]);
    put(g, best[0], best[1], 'o');

    return { lines: toLines(g), params: params };
  }

  /* --------------------------------------------- fallback rooms, by slot --
   * Hand-authored, one per difficulty slot, used only when the retry
   * budget for that slot runs out. Static, so tools/verify.cjs proves
   * them solvable once and forever. Kept deliberately plain: a fallback
   * daily should be a fair day, not a strange one.
   */
  var FALLBACK = [
    {
      lines: [
        '####################',
        '#S.....#...........#',
        '#..##..#..######...#',
        '#..#...#.......#...#',
        '#..#..x#..####.#...#',
        '#..#...........#...#',
        '#..######..##..#...#',
        '#.......#..#...#...#',
        '#..x....#..#.x.#...#',
        '#..#########...##..#',
        '#..........#.......#',
        '#..######..#..###..#',
        '#o.#....x..#....E..#',
        '####################'
      ],
      params: {}
    },
    {
      lines: [
        '####################',
        '#S.....x...........#',
        '#..###..####..##...#',
        '#..#..........T....#',
        '#..#..#######..#...#',
        '#..#..#.....#..#...#',
        '#.....#..x..#..#...#',
        '#..#..#.....#......#',
        '#..#..###%###..##..#',
        '#..#........#..#...#',
        '#..##..###..#..#.x.#',
        '#...#..#o#..#..#...#',
        '#.x.#..#....#....E.#',
        '####################'
      ],
      params: {
        '14,3': { dir: 5, period: 12, phase: 0 },
        '9,8': { period: 12, phase: 6 }
      }
    },
    {
      lines: [
        '####################',
        '#S..#....k.........#',
        '#...#..####..###...#',
        '#.x.#..#........#..#',
        '#...#..#..###...#..#',
        '#......#..#.#...#..#',
        '#..#####..#.#..##..#',
        '#..#......#.#......#',
        '#..#..#####.####...#',
        '#..#..#......._.#..#',
        '#..#..#..###..#.#..#',
        '#.....#..#o#..#.#..#',
        '#..x..#..#....#GE..#',
        '####################'
      ],
      params: {
        '15,12': { link: 1 },
        '14,9': { link: 1, mode: 0 }
      }
    },
    {
      lines: [
        '####################',
        '#S.....CCCC........#',
        '#..##........###...#',
        '#..#...####..#.....#',
        '#..#.x.#..#..#..#..#',
        '#..#...#..#..#..#..#',
        '#......#..R..#..#..#',
        '#..##..#.....#..#..#',
        '#...#..#..#..#..#..#',
        '#.x.#..#..#..>..#..#',
        '#...#..#..#..#..#k.#',
        '#..##..#o.#..##.#..#',
        '#......#..#......E.#',
        '####################'
      ],
      params: {
        '10,6': { period: 14, phase: 0, len: 3 },
        '13,9': { dir: 1 }
      }
    },
    {
      lines: [
        '####################',
        '#S.....#...........#',
        '#..##..#..#####....#',
        '#..#...f..#...#..M.#',
        '#..#..##..#.x.#....#',
        '#..#...#..#...######',
        '#..#.x.#..#.f......#',
        '#......#..#...###..#',
        '#..#####..##..#....#',
        '#..#....T.....#..###',
        '#..#..######..#....#',
        '#..#..#....#..##...#',
        '#.....#o...f.....E.#',
        '####################'
      ],
      params: {
        '8,9': { dir: 3, period: 10, phase: 0 }
      }
    }
  ];

  /* --------------------------------------------------------------- build --
   * All construction funnels through here so a change in Forge's
   * Room.fromText signature is a one-line fix.
   */
  function buildRoom(spec, id, name) {
    var room = BAIT.Room.fromText(spec.lines, spec.params);
    room.id = id;
    room.name = name;
    return room;
  }

  /* ---------------------------------------------- structure check (pure) --
   * Cheap deterministic filter over a candidate's char grid, identical in
   * Node and the browser: 4-way flood fill from the start, treating
   * unconditionally-blocking or lethal-to-cross tiles as walls. It asks
   * "is there plausibly a route", not "is it solvable" — solvability is
   * verify.cjs's job. 4-way is deliberately conservative: it can reject a
   * diagonal-only squeeze, it can never accept an unreachable exit.
   *
   * Passable here: floor, start, exit, faller (walkable once), keys,
   * token, plates, gates (generator only emits paired ones), phase
   * blocks, conveyors, deflectors, teleports-as-floor. Blocked: walls,
   * turrets, rotors (solid bases), pits, mimic (lethal to cross).
   */
  var BLOCK_CH = { '#': 1, 'T': 1, 'R': 1, 'x': 1, 'M': 1 };

  /* Returns { exitDist, keys } with exitDist in cells, or null when the
   * exit, any key or the token is unreachable from the start. */
  function structureCheck(lines) {
    var sx = -1, sy = -1, x, y, ch, keys = 0;
    var need = [];                       // cells that must be reachable
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        ch = lines[y].charAt(x);
        if (ch === 'S') { sx = x; sy = y; }
        else if (ch === 'E' || ch === 'k' || ch === 'o') {
          need.push([x, y, ch]);
          if (ch === 'k') keys++;
        }
      }
    }
    if (sx < 0 || !need.length) return null;

    var dist = [], i;
    for (i = 0; i < W * H; i++) dist.push(-1);
    var q = [[sx, sy]];
    dist[sy * W + sx] = 0;
    var head = 0;
    var steps = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    while (head < q.length) {
      var c = q[head++];
      var d = dist[c[1] * W + c[0]];
      for (i = 0; i < 4; i++) {
        var nx = c[0] + steps[i][0], ny = c[1] + steps[i][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (dist[ny * W + nx] >= 0) continue;
        if (BLOCK_CH[lines[ny].charAt(nx)]) continue;
        dist[ny * W + nx] = d + 1;
        q.push([nx, ny]);
      }
    }

    var exitDist = -1;
    for (i = 0; i < need.length; i++) {
      var nd = dist[need[i][1] * W + need[i][0]];
      if (nd < 0) return null;           // exit, a key or the token is cut off
      if (need[i][2] === 'E') exitDist = nd;
    }
    return { exitDist: exitDist, keys: keys };
  }

  /* Deterministic par estimate from the real flood-fill distance: cells
   * to walk at 6 cells/s (20 ticks/cell), doubled for hazard timing and
   * detours, plus a beat per key. An ESTIMATE for the share-string
   * denominator only — campaign par comes from the real solver and this
   * never touches it. */
  function estimatePar(check) {
    return check.exitDist * 40 + check.keys * 240;   // ticks
  }

  /* ----------------------------------------------------------------- api */

  function generate(dateSeed) {
    if (!validSeed(dateSeed)) dateSeed = todaySeed();

    /* Past the verified window: fall back rather than gamble. The
     * fallback set is hand-authored and proven once by verify.cjs. */
    var verified = dateSeed <= VERIFIED_UNTIL;

    var rooms = [];
    for (var slot = 0; slot < 5; slot++) {
      var id = 'daily-' + dateSeed + '-' + (slot + 1);
      var name = 'Gauntlet ' + dayNumber(dateSeed) + ' · ' + (slot + 1) + '/5';
      var room = null;

      if (verified) {
        /* Independent stream per slot: a retry in slot 2 must not
         * reshuffle slots 3–5. */
        var rng = BAIT.Rng.create(mix(dateSeed, slot));
        var loose = null;    // reachable but short — still beats fallback
        for (var t = 0; t < MAX_TRIES && !room; t++) {
          var spec = buildCandidate(rng, slot);
          var check = structureCheck(spec.lines);
          if (!check) continue;                    // something is cut off
          var cand = buildRoom(spec, id, name);
          if (cand.parseErrors && cand.parseErrors.length) continue;
          cand.par = { ticks: estimatePar(check) };
          if (check.exitDist >= DIST_MIN[slot]) room = cand;
          else if (!loose) loose = cand;
        }
        if (!room) room = loose;
      }

      if (!room) {
        room = buildRoom(FALLBACK[slot], id, name);
        var fcheck = structureCheck(FALLBACK[slot].lines);
        room.par = { ticks: fcheck ? estimatePar(fcheck) : null };
      }
      rooms.push(room);
    }
    return rooms;
  }

  /* Deterministic seed mix — Math.imul keeps it exact 32-bit on every
   * platform. Not core/, but the determinism contract still applies. */
  function mix(seed, slot) {
    var h = (seed | 0) ^ 0x9e3779b9;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) ^ Math.imul(slot + 1, 0x27d4eb2f);
    return (h ^ (h >>> 16)) >>> 0 || 1;
  }

  /* ------------------------------------------------------ the run itself --
   * The gauntlet is ONE continuous session: five rooms in order, THREE
   * lives for the whole run. A death spends a life the moment it happens;
   * running out ends the run where it stands. Progress is persisted under
   * the seed in daily.history, so a reload on the same day RESUMES the
   * run — it cannot re-roll it, and it cannot refund a spent life
   * (deaths are written at death time and Save flushes on pagehide).
   * One run per seed: a finished day only shows its result. Tomorrow is
   * a new seed, so nothing ever needs clearing.
   *
   * Wiring (agreed with Boss and Frame in #bait build):
   *   - Each room starts via Play.begin(room, {origin:'gauntlet', ...}).
   *   - Clears arrive as the Modes 'results' transition; the slot only
   *     advances there.
   *   - Deaths arrive through opts.onDeath (deaths never cross Modes).
   *     Returning false tells play.js the run is out of lives: the death
   *     beat still plays, and the player's next input calls opts.onExit
   *     instead of retrying. onExit routes to the gauntlet screen.
   *
   * Everything here is browser-side runtime and is reached only through
   * play()/next(); generate() above stays a pure function of the seed.
   */

  var LIVES = 3;

  var runSeed = 0;      // seed of the session being played right now
  var runRooms = null;  // the five generated rooms, cached for the session
  var awaiting = -1;    // slot we expect the next 'results' transition for
  var subscribed = false;

  function dayRec(seed) {
    var h = BAIT.Save.get('daily.history') || {};
    return h[String(seed)] || null;
  }

  /* Whole-run par: the share string's denominator. Null if any room
   * lacks one — a partial par would lie. */
  function parTotal(rooms) {
    var t = 0;
    for (var i = 0; i < rooms.length; i++) {
      if (!rooms[i].par || rooms[i].par.ticks == null) return null;
      t += rooms[i].par.ticks;
    }
    return t;
  }

  /* The read view Frame's screens render from. Never hands out the live
   * save record. */
  function view(seed, day) {
    var st = !day || !day.started ? 'fresh' : (day.done ? 'done' : 'active');
    var v = {
      seed: seed,
      dayNumber: dayNumber(seed),
      state: st,
      room: day ? Math.min((day.slot | 0) + 1, 5) : 1,
      lives: day ? day.lives | 0 : LIVES,
      cleared: day ? day.cleared | 0 : 0,
      deaths: day ? day.deaths | 0 : 0,
      ticks: day ? day.ticks | 0 : 0,
      shareText: null
    };
    if (st === 'done' && BAIT.Share && BAIT.Share.gauntletString) {
      v.shareText = BAIT.Share.gauntletString({
        seed: seed, cleared: v.cleared, deaths: v.deaths,
        ticks: v.ticks, parTicks: day.par == null ? null : day.par
      });
    }
    return v;
  }

  function today() {
    var s = todaySeed();
    return view(s, dayRec(s));
  }

  function yesterday() {
    var d = new Date();
    d.setDate(d.getDate() - 1);
    var s = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    var day = dayRec(s);
    return day ? view(s, day) : null;
  }

  /* Start today's run, or resume the active one. The ONE entry point for
   * Frame's play button and the results screen's "Next room" alike —
   * both mean "put me in the room the run says is next". Returns false
   * when today is already done (one run per seed) or a room fails to
   * start; Frame shows a status line rather than a dead click. */
  function play() {
    var seed = todaySeed();
    var day = dayRec(seed);
    if (day && day.done) return false;

    if (runSeed !== seed || !runRooms) {
      runRooms = generate(seed);
      runSeed = seed;
    }

    if (!day) {
      var par = parTotal(runRooms);
      BAIT.Save.change(function (d) {
        d.daily.history[String(seed)] = {
          started: true, done: false, slot: 0, lives: LIVES,
          cleared: 0, deaths: 0, ticks: 0, par: par, at: Date.now()
        };
      }, 'daily.history.' + seed);
      day = dayRec(seed);
    }

    ensureSubscribed();
    return beginRoom(day.slot | 0);
  }

  function beginRoom(slot) {
    if (slot < 0 || slot > 4 || !runRooms) return false;
    awaiting = slot;
    return BAIT.Play.begin(runRooms[slot], {
      origin: 'gauntlet',
      roomId: runRooms[slot].id,
      originCtx: { seed: runSeed },
      onDeath: onRoomDeath,
      onExit: onRunOut
    });
  }

  /* Called synchronously by play.js the tick a death lands. Persist
   * immediately: the debounce plus the pagehide flush means a reload can
   * never refund the life. Returns false when the run is out — play.js
   * then blocks the retry and routes input to onExit. */
  function onRoomDeath() {
    var out = false;
    BAIT.Save.change(function (d) {
      var day = d.daily.history[String(runSeed)];
      if (!day || day.done) return;
      day.deaths = (day.deaths | 0) + 1;
      day.lives = Math.max(0, (day.lives | 0) - 1);
      if (day.lives === 0) {
        day.done = true;
        day.at = Date.now();
        out = true;
      }
    }, 'daily.history.' + runSeed);
    if (out) {
      awaiting = -1;
      BAIT.Save.flush();   // the result must survive an immediate close
    }
    return !out;
  }

  /* The player's first input after the final death: leave the corpse,
   * show the damage. */
  function onRunOut() {
    if (BAIT.Play && BAIT.Play.stop) BAIT.Play.stop();
    BAIT.Modes.go('gauntlet', {});
  }

  /* Clears arrive here. Subscribed lazily on first play() — daily.js
   * loads before modes.js, and a session that never plays the gauntlet
   * never needs the subscription. */
  function ensureSubscribed() {
    if (subscribed || !BAIT.Modes) return;
    subscribed = true;
    BAIT.Modes.subscribe(function (snap) {
      if (snap.state !== 'results' || awaiting < 0) return;
      var ctx = snap.ctx || {};
      if (ctx.origin !== 'gauntlet' || !ctx.summary) return;
      var slot = awaiting;
      awaiting = -1;   // one record per transition; overlay re-emits ignored
      var finished = false;
      BAIT.Save.change(function (d) {
        var day = d.daily.history[String(runSeed)];
        if (!day || day.done || (day.slot | 0) !== slot) return;
        day.cleared = (day.cleared | 0) + 1;
        day.ticks = (day.ticks | 0) + (ctx.summary.ticks | 0);
        day.slot = slot + 1;
        if (day.slot >= 5) {
          day.done = true;
          day.at = Date.now();
          finished = true;
        }
      }, 'daily.history.' + runSeed);
      if (finished) BAIT.Save.flush();
    });
  }

  /* Today's run state, read from the save. Kept for older callers; the
   * screens read today()/yesterday(). "One run per day" is client
   * honour-system only — there is no server to enforce it, so the UI's
   * job is to make that state obvious, not to pretend it is a wall. */
  function status(dateSeed) {
    if (!validSeed(dateSeed)) dateSeed = todaySeed();
    var day = dayRec(dateSeed);
    return {
      seed: dateSeed,
      dayNumber: dayNumber(dateSeed),
      started: !!(day && day.started),
      done: !!(day && day.done),
      result: day || null
    };
  }

  BAIT.Daily = {
    generate: generate,
    todaySeed: todaySeed,
    dayNumber: dayNumber,
    validSeed: validSeed,
    /* The run — contract agreed with Boss and Frame in #bait build. */
    today: today,
    yesterday: yesterday,
    play: play,
    next: play,     // the results screen's "Next room"; same resume logic
    status: status,
    LIVES: LIVES,
    /* verify.cjs reads this and walks every daily seed up to it; the
     * constant and the proof cannot quietly disagree. */
    VERIFIED_UNTIL: VERIFIED_UNTIL
  };

})(typeof window !== 'undefined'
  ? (window.BAIT = window.BAIT || {})
  : (global.BAIT = global.BAIT || {}));
