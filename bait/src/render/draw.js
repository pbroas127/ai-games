/* BAIT — the room renderer.
 *
 * OWNER: Ink (Art).
 *
 * Draws one room, one screen, locked camera, in blueprint: chalk line work on
 * flat slate, hard right angles, 45-degree hatching, stencil labels. Reads
 * BAIT.Theme for every colour and metric and BAIT.Pieces for the tile table.
 *
 * TWO RULES THAT ARE ACTUALLY DESIGN, NOT CODE — do not "fix" either of them:
 *
 *   1. The FALLER draws as nothing. It is floor. That is the whole piece.
 *      It only becomes visible after it has eaten you, at which point it
 *      draws as the pit it always was.
 *   2. The MIMIC draws through the exact same function as the EXIT, with the
 *      same colour and the same glyph. There is no tell. If you ever find
 *      yourself adding one, you have removed the game.
 *
 * Both are revealed in editor mode, because an author has to be able to see
 * what they are placing. Only in editor mode.
 *
 * PERFORMANCE: the static half of the room (plate, floor, grid, walls, pits,
 * turret bodies, rotor hubs, conveyors, paper grain) is rendered once into an
 * offscreen canvas and blitted. Only pieces that can change state, the
 * hazards in motion, the ghosts and the dot are drawn per frame. Call
 * Draw.invalidate() if you mutate the room — the editor does this constantly.
 */
(function (BAIT) {
  'use strict';

  var P = BAIT.Pieces, K = P.K, T = P.TILE;
  var Theme = BAIT.Theme, M = Theme.m;
  var ONE = K.ONE;

  var canvas = null, ctx = null, dpr = 1;
  var statik = null, sctx = null;      /* cached static layer */
  var grain = null;                    /* paper grain tile pattern */
  var hatches = {};                    /* colour -> CanvasPattern */
  var staticKey = '';                  /* cheap dirty check */
  var keyTotal = 0;                    /* keys in the current room */
  var current = { room: null, label: '', sublabel: '' };

  /* INTERPOLATION SOURCE.
   *
   * Forge's state does not carry a previous position, so there are three
   * ways to get one and we support all three, best first:
   *
   *   1. state.px / state.py, if Forge adds them. Exact.
   *   2. Draw.tick(state) called once per SIM TICK by Play.tick. Also exact,
   *      and costs two assignments.
   *   3. Neither, in which case we render at alpha = 1 with no interpolation.
   *
   * Option 3 is genuinely fine at 60 Hz: the sim runs at 120 Hz, so a 60 Hz
   * display consumes exactly two ticks per frame and the dot advances an
   * identical 4 px every frame. It is only 144 Hz and other non-multiples
   * where the uneven 1.2 ticks per frame shows up as judder. Said plainly in
   * the thread rather than papered over with a guessed velocity.
   */
  var prevT = -1, prevX = 0, prevY = 0, curX = 0, curY = 0;
  var tickFed = false, hasInterp = false;
  var injected = {};

  /* Called once per sim tick by Play.tick, if Boss wires it. */
  function feedTick(state) {
    if (!state) return;
    prevX = curX; prevY = curY;
    curX = state.x; curY = state.y;
    prevT = state.t;
    tickFed = true;
    /* One hook, two jobs: this is also the death-replay trail in fx.js, so
     * Boss only has to wire a single call in Play.tick. Resolved lazily
     * because draw.js loads before fx.js. */
    if (BAIT.Fx && BAIT.Fx.record) BAIT.Fx.record(state);
  }

  function trackTick(state) {
    if (!state) { hasInterp = false; return; }
    hasInterp = state.px !== undefined || tickFed;
  }

  /* Give render() a state that carries px/py, without ever writing into the
   * sim's live object. Reuses one object so this allocates nothing. */
  function withPrev(state) {
    if (!state || state.px !== undefined || !tickFed) return state;
    for (var k in state) {
      if (Object.prototype.hasOwnProperty.call(state, k)) injected[k] = state[k];
    }
    injected.px = prevX; injected.py = prevY;
    injected.x = curX; injected.y = curY;
    return injected;
  }

  /* ------------------------------------------------------------------ util */

  function lerp(a, b, t) { return a + (b - a) * t; }

  /* SIM SPACE IS ROOM SPACE, NOT CANVAS SPACE.
   *
   * Sim positions run 0..800 x 0..560 — the room's own coordinates, with the
   * origin at the room's top-left corner. The canvas is 1000x700 and the room
   * is inset at ROOM_X=100, ROOM_Y=70. So EVERY position that comes out of
   * the sim has to have the origin added before it is drawn.
   *
   * I originally documented these as arriving pre-offset and they do not.
   * The dot landed at canvas (99,301) instead of (200,370), which put it
   * exactly on the plate's left border and read as a start-position bug
   * rather than a render bug. Anything sim-derived goes through ix/iy below —
   * the dot, the ghost, bullets, rotor beam extents, the death point. Things
   * derived from a CELL INDEX use cellX/cellY and are already correct; do not
   * offset those twice.
   */
  function ix(prev, cur, alpha) { return lerp(prev / ONE, cur / ONE, alpha) + M.ROOM_X; }
  function iy(prev, cur, alpha) { return lerp(prev / ONE, cur / ONE, alpha) + M.ROOM_Y; }

  /* Crisp 1px stroke: canvas puts a 1px line half on each side of the path,
   * so an integer coordinate blurs it across two pixels. 2px and 4px do not
   * need this, which is why the scale has no 3px hairlines in it. */
  function h(v) { return Math.round(v) + 0.5; }

  function line(c, x1, y1, x2, y2, colour, w) {
    c.strokeStyle = colour;
    c.lineWidth = w || M.LINE;
    c.beginPath();
    if ((c.lineWidth & 1) === 1) { c.moveTo(h(x1), h(y1)); c.lineTo(h(x2), h(y2)); }
    else { c.moveTo(Math.round(x1), Math.round(y1)); c.lineTo(Math.round(x2), Math.round(y2)); }
    c.stroke();
  }

  function box(c, x, y, w, hh, colour, lw) {
    c.strokeStyle = colour;
    c.lineWidth = lw || M.LINE;
    if ((c.lineWidth & 1) === 1) c.strokeRect(h(x), h(y), Math.round(w), Math.round(hh));
    else c.strokeRect(Math.round(x), Math.round(y), Math.round(w), Math.round(hh));
  }

  function fillBox(c, x, y, w, hh, colour) {
    c.fillStyle = colour;
    c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(hh));
  }

  /* 45-degree hatch, cached per colour. This is the non-colour channel that
   * makes hazards readable without relying on hue — SPEC §8. Every lethal
   * piece in the game is hatched; nothing safe ever is. */
  function hatch(colour, c) {
    if (hatches[colour]) return hatches[colour];
    /* `c` lets the editor build swatches before Draw.init has ever run — its
     * own offscreen context is a perfectly good pattern factory. */
    var host = ctx || c;
    if (!host) return colour;
    var g = M.HATCH_GAP;
    var tile = document.createElement('canvas');
    tile.width = tile.height = g;
    var tc = tile.getContext('2d');
    tc.strokeStyle = colour;
    tc.lineWidth = M.HATCH_W;
    tc.beginPath();
    tc.moveTo(-1, g + 1); tc.lineTo(g + 1, -1);
    tc.stroke();
    var pat = host.createPattern(tile, 'repeat');
    if (ctx) hatches[colour] = pat;   /* only cache the real context's */
    return pat;
  }

  function hatchBox(c, x, y, w, hh, colour) {
    c.save();
    c.beginPath();
    c.rect(Math.round(x), Math.round(y), Math.round(w), Math.round(hh));
    c.clip();
    c.fillStyle = hatch(colour, c);
    c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(hh));
    c.restore();
  }

  /* Stencil label: uppercase, tracked, tiny. Canvas has no letter-spacing, so
   * we place each glyph. Worth it — untracked uppercase looks like a debug
   * overlay and this game is a designed object. */
  function stencil(c, text, x, y, colour, size, align) {
    size = size || Theme.t.label;
    c.fillStyle = colour;
    c.font = Theme.font(size, 600);
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    var track = size * Theme.t.trackLabel;
    var s = String(text).toUpperCase(), total = 0, i;
    for (i = 0; i < s.length; i++) total += c.measureText(s.charAt(i)).width + track;
    total -= track;
    var cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    for (i = 0; i < s.length; i++) {
      c.fillText(s.charAt(i), cx, y);
      cx += c.measureText(s.charAt(i)).width + track;
    }
    return total;
  }

  /* --------------------------------------------------------------- geometry */

  function cx(i) { return M.ROOM_X + (i % K.GRID_W) * M.CELL; }
  function cy(i) { return M.ROOM_Y + ((i / K.GRID_W) | 0) * M.CELL; }

  function tileAt(room, i) { return room.tiles[i] | 0; }
  function paramsAt(room, i) {
    return (room.params && room.params[i]) || P.defaults(tileAt(room, i));
  }

  /* Rotor orientation. FORGE'S FORMULA, corrected from mine:
   *
   *   orientation = (floor(t / (period*10)) + phase) & 3   ->  [N, E, S, W]
   *
   * Two things I had wrong. It SNAPS to a quarter turn per beat, it does not
   * sweep continuously — "nothing eases" applies to the hazard as much as to
   * the camera. And phase is a beat offset, not a tick offset; folding it in
   * as ticks put the beam somewhere else entirely whenever phase was nonzero,
   * which is the "kills where it is not drawn" case.
   *
   * This is only the fallback for the editor. In play, Sim.rotorBeams gives
   * the real extent and we draw that.
   */
  var ORIENT = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];   /* N, E, S, W */

  function rotorAngle(tick, period, phase) {
    var span = period * K.PERIOD_UNIT;
    var o = (Math.floor(tick / span) + phase) & 3;
    return ORIENT[o];
  }

  /* Phase blocks. Boss's ruling to Forge, verbatim: "solid when
   * ((t/(period*10)) + phase) is even, open when odd". Integer divide, so a
   * block holds each state for a whole period. Rendering uses the identical
   * rule, and the fractional part below drives the telegraph. */
  function phaseSolid(tick, period, phase) {
    var span = period * K.PERIOD_UNIT;
    return ((Math.floor(tick / span) + phase) & 1) === 0;
  }

  /* 0 at the start of the current state, 1 the instant before it flips. */
  function phaseFrac(tick, period, phase) {
    var span = period * K.PERIOD_UNIT;
    return (((tick % span) + span) % span) / span;
  }

  /* ------------------------------------------------------------ paper grain */

  /* Sparse static speckle over the whole plate. Generated once. It is the
   * difference between "flat slate" and "a #1e262d rectangle", and it costs
   * one blit. Math.random is fine here: this is rendering, it never touches
   * simulation state, and the tile is generated a single time at init. */
  function buildGrain() {
    var n = M.GRAIN_TILE;
    var tile = document.createElement('canvas');
    tile.width = tile.height = n;
    var tc = tile.getContext('2d');
    tc.fillStyle = Theme.alpha(Theme.c.grain, M.GRAIN_ALPHA * 3);
    for (var i = 0; i < M.GRAIN_DOTS; i++) {
      tc.fillRect((Math.random() * n) | 0, (Math.random() * n) | 0, 1, 1);
    }
    grain = ctx.createPattern(tile, 'repeat');
  }

  /* ------------------------------------------------------------ plate frame */

  function drawPlate(c, view) {
    var C = Theme.c;
    fillBox(c, 0, 0, M.CANVAS_W, M.CANVAS_H, C.void);

    var p = M.PLATE_PAD;
    fillBox(c, p, p, M.CANVAS_W - p * 2, M.CANVAS_H - p * 2, C.plate);
    box(c, p, p, M.CANVAS_W - p * 2, M.CANVAS_H - p * 2, C.chalkFaint, M.LINE);

    /* Registration crosses, one per corner. Printer's furniture: it says
     * "this is a plate that was drawn and reproduced", which is the fiction
     * the whole art direction is selling. */
    var r = M.REG_SIZE, o = M.REG_INSET, C2 = C.registration;
    [[o, o], [M.CANVAS_W - o, o], [o, M.CANVAS_H - o], [M.CANVAS_W - o, M.CANVAS_H - o]]
      .forEach(function (pt) {
        line(c, pt[0] - r, pt[1], pt[0] + r, pt[1], C2, M.HAIR);
        line(c, pt[0], pt[1] - r, pt[0], pt[1] + r, C2, M.HAIR);
      });

    /* Title block, bottom margin. Patent-diagram convention: the drawing is
     * always labelled. Frame owns the HUD; this is plate furniture only. */
    var by = M.CANVAS_H - M.PLATE_PAD - 26;
    if (view.label) stencil(c, view.label, M.ROOM_X, by, C.chalkDim, Theme.t.label);
    if (view.sublabel) {
      stencil(c, view.sublabel, M.CANVAS_W - M.ROOM_X, by, C.chalkFaint,
              Theme.t.micro, 'right');
    }
  }

  /* -------------------------------------------------------------- the floor */

  function drawFloor(c) {
    var C = Theme.c;
    fillBox(c, M.ROOM_X, M.ROOM_Y, M.ROOM_W, M.ROOM_H, C.floor);

    /* drafting grid: hairline per cell, a heavier rule every 5 */
    var i;
    for (i = 1; i < K.GRID_W; i++) {
      line(c, M.ROOM_X + i * M.CELL, M.ROOM_Y, M.ROOM_X + i * M.CELL,
           M.ROOM_Y + M.ROOM_H, i % 5 === 0 ? C.ruleStrong : C.rule, M.HAIR);
    }
    for (i = 1; i < K.GRID_H; i++) {
      line(c, M.ROOM_X, M.ROOM_Y + i * M.CELL, M.ROOM_X + M.ROOM_W,
           M.ROOM_Y + i * M.CELL, i % 5 === 0 ? C.ruleStrong : C.rule, M.HAIR);
    }
    box(c, M.ROOM_X, M.ROOM_Y, M.ROOM_W, M.ROOM_H, C.chalkDim, M.LINE);
  }

  /* --------------------------------------------------------- static pieces */

  function drawWall(c, x, y) {
    var C = Theme.c;
    fillBox(c, x, y, M.CELL, M.CELL, C.plate);
    hatchBox(c, x + 2, y + 2, M.CELL - 4, M.CELL - 4, C.ruleStrong);
    box(c, x + 1, y + 1, M.CELL - 2, M.CELL - 2, C.chalkDim, M.LINE);
  }

  /* A hole. Visibly a hole — this piece is honest and must read as lethal at
   * a glance and in greyscale. Void fill, hatch, hard danger border. */
  function drawPit(c, x, y) {
    var C = Theme.c;
    fillBox(c, x + 1, y + 1, M.CELL - 2, M.CELL - 2, C.void);
    hatchBox(c, x + 1, y + 1, M.CELL - 2, M.CELL - 2, C.dangerDim);
    box(c, x + 1, y + 1, M.CELL - 2, M.CELL - 2, C.danger, M.LINE);
  }

  /* PIT FIELDS.
   *
   * A pit is an absence, so a 12x5 block of them is ONE hole, not sixty
   * outlined boxes. Drawing each cell with its own border turns a large pit
   * region into a red lattice that shouts, competes with the line work, and
   * reads as sixty objects the player has to parse instead of one shape they
   * can see the edge of. Atlas's 1-10 is most of a room of pit and it is
   * what made this obvious.
   *
   * So: flood the whole region flat, then stroke ONLY the edges where a pit
   * cell meets something that is not a pit. Walls stay per-cell on purpose —
   * a wall is built out of blocks and should read that way; a hole is not.
   */
  function isPitCell(room, gx, gy) {
    if (gx < 0 || gy < 0 || gx >= K.GRID_W || gy >= K.GRID_H) return false;
    return tileAt(room, gy * K.GRID_W + gx) === T.PIT;
  }

  function drawPitField(c, room) {
    var C = Theme.c, gx, gy, x, y;

    /* pass 1: the hole itself, flat and continuous, no internal edges */
    for (gy = 0; gy < K.GRID_H; gy++) {
      for (gx = 0; gx < K.GRID_W; gx++) {
        if (!isPitCell(room, gx, gy)) continue;
        x = M.ROOM_X + gx * M.CELL; y = M.ROOM_Y + gy * M.CELL;
        fillBox(c, x, y, M.CELL, M.CELL, C.void);
      }
    }

    /* pass 2: one hatch clip over the union, so the 45-degree lines run
     * unbroken across the whole region instead of restarting every 40px */
    c.save();
    c.beginPath();
    for (gy = 0; gy < K.GRID_H; gy++) {
      for (gx = 0; gx < K.GRID_W; gx++) {
        if (!isPitCell(room, gx, gy)) continue;
        c.rect(M.ROOM_X + gx * M.CELL, M.ROOM_Y + gy * M.CELL, M.CELL, M.CELL);
      }
    }
    c.clip();
    c.fillStyle = hatch(C.dangerDim, c);
    c.fillRect(M.ROOM_X, M.ROOM_Y, M.ROOM_W, M.ROOM_H);
    c.restore();

    /* pass 3: the silhouette. Only edges facing out of the region. */
    for (gy = 0; gy < K.GRID_H; gy++) {
      for (gx = 0; gx < K.GRID_W; gx++) {
        if (!isPitCell(room, gx, gy)) continue;
        x = M.ROOM_X + gx * M.CELL; y = M.ROOM_Y + gy * M.CELL;
        if (!isPitCell(room, gx, gy - 1)) line(c, x, y, x + M.CELL, y, C.danger, M.LINE);
        if (!isPitCell(room, gx, gy + 1)) line(c, x, y + M.CELL, x + M.CELL, y + M.CELL, C.danger, M.LINE);
        if (!isPitCell(room, gx - 1, gy)) line(c, x, y, x, y + M.CELL, C.danger, M.LINE);
        if (!isPitCell(room, gx + 1, gy)) line(c, x + M.CELL, y, x + M.CELL, y + M.CELL, C.danger, M.LINE);
      }
    }
  }

  function drawStart(c, x, y) {
    var C = Theme.c, m = 9, n = 11;
    /* four corner brackets, understated. The start is not a prize. */
    line(c, x + m, y + m, x + m + n, y + m, C.chalkFaint, M.HAIR);
    line(c, x + m, y + m, x + m, y + m + n, C.chalkFaint, M.HAIR);
    line(c, x + M.CELL - m, y + m, x + M.CELL - m - n, y + m, C.chalkFaint, M.HAIR);
    line(c, x + M.CELL - m, y + m, x + M.CELL - m, y + m + n, C.chalkFaint, M.HAIR);
    line(c, x + m, y + M.CELL - m, x + m + n, y + M.CELL - m, C.chalkFaint, M.HAIR);
    line(c, x + m, y + M.CELL - m, x + m, y + M.CELL - m - n, C.chalkFaint, M.HAIR);
    line(c, x + M.CELL - m, y + M.CELL - m, x + M.CELL - m - n, y + M.CELL - m, C.chalkFaint, M.HAIR);
    line(c, x + M.CELL - m, y + M.CELL - m, x + M.CELL - m, y + M.CELL - m - n, C.chalkFaint, M.HAIR);
  }

  var ARROW = { 1: [0, -1], 3: [1, 0], 5: [0, 1], 7: [-1, 0] };

  function drawArrowGlyph(c, x, y, dir, colour, scale) {
    var d = ARROW[dir] || ARROW[3];
    var cxp = x + M.CELL / 2, cyp = y + M.CELL / 2;
    var len = (scale || 11);
    var tipx = cxp + d[0] * len, tipy = cyp + d[1] * len;
    var bx = cxp - d[0] * len, by = cyp - d[1] * len;
    line(c, bx, by, tipx, tipy, colour, M.LINE);
    /* barbs, at hard right angles to the shaft — no arc, no curve */
    var px = -d[1], py = d[0], b = 6;
    line(c, tipx, tipy, tipx - d[0] * b + px * b, tipy - d[1] * b + py * b, colour, M.LINE);
    line(c, tipx, tipy, tipx - d[0] * b - px * b, tipy - d[1] * b - py * b, colour, M.LINE);
  }

  function drawDeflect(c, x, y, prm) {
    var C = Theme.c;
    box(c, x + 4, y + 4, M.CELL - 8, M.CELL - 8, C.chalkFaint, M.HAIR);
    drawArrowGlyph(c, x, y, prm.dir, C.chalk, 11);
  }

  function drawConvey(c, x, y, prm) {
    var C = Theme.c, d = ARROW[prm.dir] || ARROW[3];
    /* three chevrons along the drift direction: reads as motion while being
     * perfectly still, which is the only kind of motion this game allows. */
    for (var i = -1; i <= 1; i++) {
      var ox = x + M.CELL / 2 + d[0] * i * 11;
      var oy = y + M.CELL / 2 + d[1] * i * 11;
      var px = -d[1], py = d[0], b = 6;
      line(c, ox - d[0] * b + px * b, oy - d[1] * b + py * b, ox, oy, C.chalkFaint, M.LINE);
      line(c, ox - d[0] * b - px * b, oy - d[1] * b - py * b, ox, oy, C.chalkFaint, M.LINE);
    }
  }

  function drawTurretBody(c, x, y, prm, room, i) {
    var C = Theme.c, d = ARROW[prm.dir] || ARROW[3];
    fillBox(c, x + 1, y + 1, M.CELL - 2, M.CELL - 2, C.plate);
    hatchBox(c, x + 3, y + 3, M.CELL - 6, M.CELL - 6, C.dangerDim);
    box(c, x + 1, y + 1, M.CELL - 2, M.CELL - 2, C.danger, M.LINE);
    /* muzzle */
    var cxp = x + M.CELL / 2, cyp = y + M.CELL / 2;
    fillBox(c, cxp + d[0] * 12 - 4, cyp + d[1] * 12 - 4, 8, 8, C.danger);

    /* Telegraph the lane. This piece is honest — SPEC §4.1 — so the player is
     * told exactly where it fires, and dies to timing rather than to a
     * surprise. Dotted centre line down the lane until it hits something. */
    var gx = i % K.GRID_W, gy = (i / K.GRID_W) | 0;
    var sx = gx + d[0], sy = gy + d[1], steps = 0;
    while (sx >= 0 && sy >= 0 && sx < K.GRID_W && sy < K.GRID_H && steps < 24) {
      var t = tileAt(room, sy * K.GRID_W + sx);
      if (P.isSolid(t)) break;
      sx += d[0]; sy += d[1]; steps++;
    }
    if (steps > 0) {
      /* The lane has to be legible from across the room — this piece is
       * honest and the telegraph IS the honesty. At a hairline in dangerDim
       * it was invisible at real size, which quietly turned a fair piece into
       * an ambush. 2px, longer dashes, full danger. */
      c.save();
      c.setLineDash([5, 7]);
      line(c, cxp + d[0] * 20, cyp + d[1] * 20,
              cxp + d[0] * (20 + steps * M.CELL), cyp + d[1] * (20 + steps * M.CELL),
              C.dangerDim, M.LINE);
      c.restore();

      /* a tick at the far end so the lane has a stated stop, like a dimension
       * line on the drawing this is pretending to be */
      var ex = cxp + d[0] * (20 + steps * M.CELL);
      var ey = cyp + d[1] * (20 + steps * M.CELL);
      line(c, ex - (-d[1]) * 6, ey - d[0] * 6, ex + (-d[1]) * 6, ey + d[0] * 6,
           C.dangerDim, M.HAIR);
    }
  }

  /* Swatch variants: the board versions of these need a room to read (the
   * turret walks its lane) or a live tick (the phase block). In isolation
   * they draw their resting state. */
  function drawTurretSwatch(c, x, y, prm) {
    var C = Theme.c, d = ARROW[prm.dir] || ARROW[3];
    fillBox(c, x + 1, y + 1, M.CELL - 2, M.CELL - 2, C.plate);
    hatchBox(c, x + 3, y + 3, M.CELL - 6, M.CELL - 6, C.dangerDim);
    box(c, x + 1, y + 1, M.CELL - 2, M.CELL - 2, C.danger, M.LINE);
    fillBox(c, x + M.CELL / 2 + d[0] * 12 - 4, y + M.CELL / 2 + d[1] * 12 - 4, 8, 8, C.danger);
  }

  function drawPhaseSwatch(c, x, y) {
    var C = Theme.c;
    fillBox(c, x + 1, y + 1, M.CELL - 2, M.CELL - 2, C.plate);
    hatchBox(c, x + 3, y + 3, M.CELL - 6, M.CELL - 6, C.ruleStrong);
    box(c, x + 1, y + 1, M.CELL - 2, M.CELL - 2, C.chalk, M.LINE);
    c.save();
    c.setLineDash([4, 4]);
    box(c, x + 6, y + 6, M.CELL - 12, M.CELL - 12, C.chalkFaint, M.HAIR);
    c.restore();
  }

  function drawRotorHub(c, x, y) {
    var C = Theme.c;
    fillBox(c, x + 1, y + 1, M.CELL - 2, M.CELL - 2, C.plate);
    box(c, x + 1, y + 1, M.CELL - 2, M.CELL - 2, C.danger, M.LINE);
    fillBox(c, x + M.CELL / 2 - 3, y + M.CELL / 2 - 3, 6, 6, C.danger);
  }

  function drawTeleport(c, x, y, prm) {
    var C = Theme.c;
    box(c, x + 4, y + 4, M.CELL - 8, M.CELL - 8, C.chalk, M.LINE);
    box(c, x + 9, y + 9, M.CELL - 18, M.CELL - 18, C.chalkDim, M.HAIR);
    stencil(c, String(prm.link), x + M.CELL / 2, y + M.CELL / 2, C.chalkDim,
            Theme.t.micro, 'center');
  }

  /* -------------------------------------------------------- dynamic pieces */

  /* THE EXIT — and the MIMIC, through this same function, deliberately.
   * Do not add a parameter that distinguishes them. */
  function drawExit(c, x, y, locked) {
    var C = Theme.c;
    var col = locked ? C.verifyDim : C.verify;
    box(c, x + 3, y + 3, M.CELL - 6, M.CELL - 6, col, M.LINE);
    box(c, x + 7, y + 7, M.CELL - 14, M.CELL - 14, col, M.HAIR);
    /* chevron pointing in: a way through, not a thing to avoid */
    var m = x + M.CELL / 2, n = y + M.CELL / 2;
    line(c, m - 6, n - 6, m, n, col, M.LINE);
    line(c, m - 6, n + 6, m, n, col, M.LINE);
    line(c, m + 1, n - 6, m + 7, n, col, M.LINE);
    line(c, m + 1, n + 6, m + 7, n, col, M.LINE);
    if (locked) {
      /* a bar across it, so "shut" is legible without colour */
      line(c, x + 8, y + M.CELL - 8, x + M.CELL - 8, y + 8, C.chalkFaint, M.LINE);
    }
  }

  function drawGate(c, x, y, prm, open) {
    var C = Theme.c;
    if (open) {
      /* open: only the jambs remain */
      line(c, x + 2, y + 2, x + 2, y + M.CELL - 2, C.chalkFaint, M.LINE);
      line(c, x + M.CELL - 2, y + 2, x + M.CELL - 2, y + M.CELL - 2, C.chalkFaint, M.LINE);
    } else {
      fillBox(c, x + 1, y + 1, M.CELL - 2, M.CELL - 2, C.plate);
      hatchBox(c, x + 3, y + 3, M.CELL - 6, M.CELL - 6, C.ruleStrong);
      box(c, x + 1, y + 1, M.CELL - 2, M.CELL - 2, C.chalk, M.LINE);
    }
    stencil(c, String(prm.link), x + M.CELL - 6, y + 8,
            open ? C.chalkFaint : C.chalkDim, Theme.t.micro, 'right');
  }

  function drawPlateTile(c, x, y, prm, pressed) {
    var C = Theme.c;
    var col = pressed ? C.chalk : C.chalkDim;
    box(c, x + 6, y + 6, M.CELL - 12, M.CELL - 12, col, M.LINE);
    if (pressed) fillBox(c, x + 11, y + 11, M.CELL - 22, M.CELL - 22, col);
    /* hold = one bar, latch = two. Readable without colour. */
    line(c, x + 12, y + M.CELL - 9, x + M.CELL - 12, y + M.CELL - 9, col, M.HAIR);
    if (prm.mode) line(c, x + 12, y + M.CELL - 6, x + M.CELL - 12, y + M.CELL - 6, col, M.HAIR);
    stencil(c, String(prm.link), x + M.CELL - 6, y + 8, C.chalkFaint,
            Theme.t.micro, 'right');
  }

  /* THE TELEGRAPH. Forge's Sim.phaseInfo(state, cell) -> {solid, ticksToFlip,
   * period} is authoritative, and his instruction is to flash while
   * ticksToFlip <= 24. That is a fifth of a second of warning: enough to
   * commit or not, never enough to dither. The flash is a hard alternation
   * on a 4-tick square wave, not a fade — this piece is honest, and honesty
   * here means legible, not gentle. */
  var TELEGRAPH_TICKS = 24;

  function drawPhase(c, x, y, prm, tick, info) {
    var C = Theme.c;
    var solid = info ? info.solid : phaseSolid(tick, prm.period, prm.phase);
    var f = info && info.period
      ? 1 - (info.ticksToFlip / (info.period * K.PERIOD_UNIT))
      : phaseFrac(tick, prm.period, prm.phase);

    if (info && info.ticksToFlip <= TELEGRAPH_TICKS) {
      var on = (Math.floor(tick / 4) & 1) === 0;
      if (on) {
        box(c, x - 1, y - 1, M.CELL + 2, M.CELL + 2,
            solid ? C.chalk : C.danger, M.LINE);
      }
    }

    if (solid) {
      fillBox(c, x + 1, y + 1, M.CELL - 2, M.CELL - 2, C.plate);
      hatchBox(c, x + 3, y + 3, M.CELL - 6, M.CELL - 6, C.ruleStrong);
      box(c, x + 1, y + 1, M.CELL - 2, M.CELL - 2, C.chalk, M.LINE);
    } else {
      c.save();
      c.setLineDash([4, 4]);
      box(c, x + 1, y + 1, M.CELL - 2, M.CELL - 2, C.chalkFaint, M.HAIR);
      c.restore();
    }
    /* countdown rule along the bottom edge: this piece is honest and it
     * shows you exactly when it flips. Telegraphed, always. */
    var w = (M.CELL - 8) * (1 - f);
    line(c, x + 4, y + M.CELL - 4, x + 4 + w, y + M.CELL - 4,
         solid ? C.chalkDim : C.chalkFaint, M.LINE);
  }

  function drawKey(c, x, y) {
    var C = Theme.c, m = x + M.CELL / 2, n = y + M.CELL / 2;
    box(c, m - 8, n - 8, 16, 16, C.brass, M.LINE);
    fillBox(c, m - 3, n - 3, 6, 6, C.brass);
    /* the bit of the key, so it is not just "a brass square" */
    line(c, m + 8, n, m + 13, n, C.brass, M.LINE);
    line(c, m + 13, n, m + 13, n + 5, C.brass, M.LINE);
  }

  function drawToken(c, x, y) {
    var C = Theme.c, m = x + M.CELL / 2, n = y + M.CELL / 2;
    c.save();
    c.translate(m, n);
    c.rotate(Math.PI / 4);
    box(c, -9, -9, 18, 18, C.brass, M.LINE);
    box(c, -4, -4, 8, 8, C.brass, M.HAIR);
    c.restore();
  }

  /* Editor-only reveal of the two liars. In play this never runs. */
  function drawLieMark(c, x, y, ch) {
    var C = Theme.c;
    c.save();
    c.setLineDash([3, 3]);
    box(c, x + 3, y + 3, M.CELL - 6, M.CELL - 6, C.brassDim, M.HAIR);
    c.restore();
    stencil(c, ch, x + M.CELL / 2, y + M.CELL / 2 + 1, C.brass, Theme.t.label, 'center');
  }

  /* ------------------------------------------------------------ static pass */

  function keyFor(room, mode) {
    return (room.id || '') + ':' + room.rev + ':' + mode + ':' + Theme.state.plate;
  }

  function buildStatic(view) {
    var room = view.room;
    if (!statik) {
      statik = document.createElement('canvas');
      statik.width = M.CANVAS_W;
      statik.height = M.CANVAS_H;
      sctx = statik.getContext('2d');
    }
    var c = sctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, M.CANVAS_W, M.CANVAS_H);

    drawPlate(c, view);
    drawFloor(c);

    /* Holes go down before anything else, so every piece sits on top of the
     * floor plan rather than being interrupted by it. */
    drawPitField(c, room);

    var n = K.GRID_W * K.GRID_H;
    keyTotal = 0;
    for (var i = 0; i < n; i++) {
      var id = tileAt(room, i);
      if (id === T.KEY) keyTotal++;
      if (id === T.EMPTY) continue;
      var x = cx(i), y = cy(i), prm = paramsAt(room, i);
      switch (id) {
        case T.WALL: drawWall(c, x, y); break;
        case T.PIT: break;              /* drawn as a field, above */
        case T.START: drawStart(c, x, y); break;
        case T.DEFLECT: drawDeflect(c, x, y, prm); break;
        case T.CONVEY: drawConvey(c, x, y, prm); break;
        case T.TURRET: drawTurretBody(c, x, y, prm, room, i); break;
        case T.ROTOR: drawRotorHub(c, x, y); break;
        case T.TELEPORT: drawTeleport(c, x, y, prm); break;
        default: break;   /* everything else is dynamic */
      }
    }

    /* grain over the whole plate, inside the border */
    if (Theme.state.grain && grain) {
      c.save();
      c.fillStyle = grain;
      c.fillRect(M.PLATE_PAD, M.PLATE_PAD,
                 M.CANVAS_W - M.PLATE_PAD * 2, M.CANVAS_H - M.PLATE_PAD * 2);
      c.restore();
    }
  }

  /* ----------------------------------------------------------- dynamic pass */

  function drawDynamic(view) {
    var room = view.room, s = view.sim || {};
    /* Forge's state calls the tick `t`; `tick` is accepted as an alias so a
     * rename upstream cannot silently freeze every hazard on screen. */
    var tick = (s.t === undefined ? s.tick : s.t) || 0;
    var editor = view.mode === 'editor';
    var n = K.GRID_W * K.GRID_H;
    /* The exit is shut until every key is collected. We count the keys in the
     * room ourselves rather than asking the sim for a "keysLeft" it does not
     * carry — s.keys is the collected count. */
    var keysLeft = Math.max(0, (s.keysTotal === undefined ? keyTotal : s.keysTotal)
                               - (s.keys || 0));

    /* Draw the real lethal extents once, up front, if the sim can give them. */
    var beamsDrawn = drawSimBeams(ctx, s);

    for (var i = 0; i < n; i++) {
      var id = tileAt(room, i);
      if (id === T.EMPTY) continue;
      var x = cx(i), y = cy(i), prm = paramsAt(room, i);

      switch (id) {
        case T.FALLER:
          /* NOTHING. It is floor until it has taken someone. See header. */
          if (s.fallen && s.fallen[i]) drawPit(ctx, x, y);
          else if (editor) drawLieMark(ctx, x, y, 'f');
          break;

        case T.MIMIC:
          /* Identical to the exit, by design. Same call, same arguments. */
          drawExit(ctx, x, y, keysLeft > 0);
          if (editor) drawLieMark(ctx, x, y, 'm');
          break;

        case T.EXIT:
          drawExit(ctx, x, y, keysLeft > 0);
          break;

        case T.GATE:
          drawGate(ctx, x, y, prm, !!(s.gates && s.gates[prm.link]));
          break;

        case T.PLATE:
          drawPlateTile(ctx, x, y, prm, !!(s.gates && s.gates[prm.link]));
          break;

        case T.PHASE:
          drawPhase(ctx, x, y, prm, tick, phaseInfo(s, i));
          break;

        case T.KEY:
          /* `taken` is cell-indexed: we need to know WHICH key went, not how
           * many. Absent it, keys simply never disappear — degrades, does not
           * crash. Asked of Forge in #bait build. */
          if (!(s.taken && s.taken[i])) drawKey(ctx, x, y);
          break;

        case T.TOKEN:
          if (!s.token) drawToken(ctx, x, y);
          break;

        case T.ROTOR:
          /* only when the sim could not tell us the real extent */
          if (!beamsDrawn) drawRotorBeam(ctx, x, y, prm, tick + (view.alpha || 0));
          break;

        default: break;
      }
    }
  }

  /* Ask the sim for the authoritative phase state of one cell. Returns null
   * in the editor, or if Forge's helper is not there yet, in which case the
   * local formula takes over. */
  function phaseInfo(state, cell) {
    var Sim = BAIT.Sim;
    if (!Sim || !Sim.phaseInfo || !state || state.t === undefined) return null;
    try { return Sim.phaseInfo(state, cell); } catch (e) { return null; }
  }

  /* Forge exposes Sim.rotorBeams(state) -> [{x0,y0,x1,y1,dir,reach,cell}],
   * the EXACT lethal extent. When it is available we draw that and nothing
   * else, so the beam that kills is provably the beam we showed. The local
   * formula below is only the fallback for the editor, where there is no
   * live sim to ask. */
  function drawBeamSegment(c, x0, y0, x1, y1) {
    var C = Theme.c;
    var dx = x1 - x0, dy = y1 - y0;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.5) return;
    var ux = dx / len, uy = dy / len;
    var px = -uy, py = ux;              /* unit normal */
    var r = K.ROTOR_R;

    c.save();
    c.lineCap = 'butt';           /* nothing here is round except the dot */
    c.strokeStyle = C.danger;
    c.lineWidth = r * 2;
    c.beginPath();
    c.moveTo(x0, y0); c.lineTo(x1, y1);
    c.stroke();

    /* Rungs across the beam every 7px. This is the beam's non-colour channel:
     * every lethal thing in the game carries hatching, and without these the
     * rotor was the one hazard that read as a plain bar in greyscale. It also
     * makes the sweep legible, because the rungs turn with it. */
    c.strokeStyle = C.dangerDim;
    c.lineWidth = M.HAIR;
    c.beginPath();
    for (var d = 4; d < len; d += 7) {
      var mx = x0 + ux * d, my = y0 + uy * d;
      c.moveTo(mx - px * r, my - py * r);
      c.lineTo(mx + px * r, my + py * r);
    }
    c.stroke();
    c.restore();
  }

  function drawSimBeams(c, state) {
    var Sim = BAIT.Sim;
    if (!Sim || !Sim.rotorBeams || !state) return false;
    var beams;
    try { beams = Sim.rotorBeams(state); } catch (e) { return false; }
    if (!beams) return false;
    for (var i = 0; i < beams.length; i++) {
      var b = beams[i];
      /* extents arrive in Q16.16 ROOM pixels, same space as x,y — offset */
      drawBeamSegment(c,
        b.x0 / ONE + M.ROOM_X, b.y0 / ONE + M.ROOM_Y,
        b.x1 / ONE + M.ROOM_X, b.y1 / ONE + M.ROOM_Y);
    }
    return true;
  }

  function drawRotorBeam(c, x, y, prm, tick) {
    var C = Theme.c;
    var a = rotorAngle(tick, prm.period, prm.phase);
    var len = prm.len * M.CELL;
    var m = x + M.CELL / 2, n = y + M.CELL / 2;
    c.save();
    c.translate(m, n);
    c.rotate(a);
    /* butt caps: nothing in this drawing is round except the dot */
    c.lineCap = 'butt';
    c.strokeStyle = C.danger;
    c.lineWidth = K.ROTOR_R * 2;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(len, 0);
    c.stroke();
    /* hatch stripe along it so lethality survives greyscale */
    c.strokeStyle = C.dangerDim;
    c.lineWidth = M.HAIR;
    c.beginPath();
    c.moveTo(0, 0); c.lineTo(len, 0);
    c.stroke();
    c.restore();
  }

  function drawBullets(view) {
    var s = view.sim;
    if (!s || !s.bullets) return;
    var C = Theme.c, a = view.alpha || 0;
    for (var i = 0; i < s.bullets.length; i++) {
      var b = s.bullets[i];
      var bx = ix(b.px === undefined ? b.x : b.px, b.x, a);
      var by = iy(b.py === undefined ? b.y : b.py, b.y, a);
      fillBox(ctx, bx - K.BULLET_R, by - K.BULLET_R, K.BULLET_R * 2, K.BULLET_R * 2, C.danger);
    }
  }

  /* ----------------------------------------------------------------- actors */

  function drawGhost(g, alpha) {
    if (!g) return;
    var C = Theme.c;
    var x = ix(g.px === undefined ? g.x : g.px, g.x, alpha);
    var y = iy(g.py === undefined ? g.y : g.py, g.y, alpha);
    ctx.save();
    ctx.strokeStyle = C.dotGhost;
    ctx.lineWidth = M.LINE;
    ctx.beginPath();
    ctx.arc(x, y, K.RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /* The dot. The only circle in the entire game, which is exactly why it
   * reads as "you" against a drawing made of right angles. */
  function drawDot(view) {
    var s = view.sim;
    if (!s || s.dead) return;
    var C = Theme.c, a = view.alpha || 0;
    var x = ix(s.px === undefined ? s.x : s.px, s.x, a);
    var y = iy(s.py === undefined ? s.y : s.py, s.y, a);
    ctx.fillStyle = C.dot;
    ctx.beginPath();
    ctx.arc(x, y, K.RADIUS, 0, Math.PI * 2);
    ctx.fill();
    /* a hairline ring keeps it crisp on the floor tone at every scale */
    ctx.strokeStyle = C.plate;
    ctx.lineWidth = M.HAIR;
    ctx.stroke();
  }

  /* -------------------------------------------------------------- public API */

  var Draw = {
    /* Called once by boot.js with the #stage canvas. */
    init: function (el) {
      canvas = el;
      ctx = canvas.getContext('2d', { alpha: false });
      Draw.resize();
      buildGrain();
      window.addEventListener('resize', Draw.resize, { passive: true });
      return Draw;
    },

    /* Backing store follows devicePixelRatio so the line work is sharp on a
     * retina display. CSS owns the presented size; this owns the resolution.
     * Capped at 2 — beyond that we are paying for pixels nobody can see. */
    resize: function () {
      if (!canvas) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      var w = Math.round(M.CANVAS_W * dpr), hh = Math.round(M.CANVAS_H * dpr);
      if (canvas.width !== w || canvas.height !== hh) {
        canvas.width = w; canvas.height = hh;
        hatches = {};            /* patterns are tied to the context state */
        staticKey = '';
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textBaseline = 'middle';
    },

    /* Force the static layer to rebuild. The editor calls this on every edit. */
    invalidate: function () { staticKey = ''; },

    /* ---------------------------------------------------------------------
     * BOSS'S FIXED CONTRACT. play.js calls these exact names. Everything
     * below delegates to render() above, which stays the internal shape.
     * ------------------------------------------------------------------ */

    /* Called once per room. The static pre-render happens here rather than
     * being discovered on the first frame, so the first frame of a room costs
     * the same as every other frame. */
    setRoom: function (room, label, sublabel) {
      current.room = room;
      current.label = label || (room && room.name) || '';
      current.sublabel = sublabel || '';
      staticKey = '';
      prevT = -1; prevX = prevY = 0; curX = curY = 0;
      if (room) buildStatic({ room: room, label: current.label,
                              sublabel: current.sublabel, mode: 'play' });
      staticKey = keyFor(room, 'play');
    },

    /* THE per-frame call from Play.render.
     *   opts = { ghost: simState|null, phase: 'run'|'dead'|'clear',
     *            dead: bool, mode: 'play'|'editor', camera: {x,y,scale} }
     */
    draw: function (room, state, alpha, opts) {
      opts = opts || {};
      trackTick(state);
      Draw.render({
        room: room || current.room,
        sim: withPrev(state),
        alpha: hasInterp ? (alpha === undefined ? 0 : alpha) : 1,
        ghosts: opts.ghost ? [opts.ghost] : null,
        mode: opts.mode || 'play',
        camera: opts.camera || null,
        label: current.label,
        sublabel: current.sublabel
      });
    },

    /* THE per-frame entry point.
     *
     *   view = {
     *     room,            required. { tiles: Uint8Array(280), params: Array(280),
     *                                  rev: number bumped on any mutation }
     *     sim,             required in play. see the contract posted in #bait build:
     *                      { tick, x, y, px, py, dead, keysLeft,
     *                        fallen: Uint8Array, taken: Uint8Array,
     *                        gates: {link:bool}, bullets: [{x,y,px,py}] }
     *     alpha,           0..1 interpolation between px,py and x,y
     *     ghosts,          optional [{x,y,px,py}]
     *     mode,            'play' | 'editor' | 'replay'
     *     label, sublabel  optional plate title-block strings
     *   }
     *
     * All positions in `sim` are Q16.16 fixed point, in pixels, room-space
     * already offset by ROOM_X/ROOM_Y by the sim. Floats appear here and
     * nowhere upstream.
     */
    render: function (view) {
      if (!ctx || !view || !view.room) return;
      var k = keyFor(view.room, view.mode || 'play');
      if (k !== staticKey) { buildStatic(view); staticKey = k; }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      /* The camera is locked at identity for the entire game with exactly one
       * exception: the push-in on the death replay, which fx.js drives by
       * setting view.camera. SPEC §3 — this is the only camera move that
       * exists, and there is no second caller. */
      var cam = view.camera;
      if (cam && cam.scale !== 1) {
        ctx.translate(cam.x, cam.y);
        ctx.scale(cam.scale, cam.scale);
        ctx.translate(-cam.x, -cam.y);
      }

      ctx.drawImage(statik, 0, 0);

      drawDynamic(view);
      drawBullets(view);

      if (view.ghosts) {
        for (var i = 0; i < view.ghosts.length; i++) drawGhost(view.ghosts[i], view.alpha || 0);
      }
      drawDot(view);
    },

    /* ONE PIECE, IN ISOLATION, AT ANY SIZE.
     *
     * For Chisel's palette swatches, and for any legend a settings or pause
     * screen ever wants. It exists so there is exactly ONE set of piece
     * drawings in this project: what you pick in the palette is drawn by the
     * same code as what you place on the board, so the two can never drift.
     *
     *   Draw.piece(ctx, id, params, x, y, size)
     *
     * `ctx` may be any 2D context, including a tiny offscreen canvas per
     * swatch. `size` is in px; everything scales from the 40px cell.
     *
     * The palette is the one place the two liars are shown for what they are,
     * because an author has to know what they are placing. The faller draws
     * as bare floor plus its mark, and the mimic draws as the exit plus its
     * mark — which is exactly the lesson: in the room, that is all you get.
     */
    piece: function (c, id, params, x, y, size) {
      if (!c) return;
      var s = (size || M.CELL) / M.CELL;
      var prm = params || P.defaults(id);
      c.save();
      c.translate(x || 0, y || 0);
      c.scale(s, s);
      c.textBaseline = 'middle';

      switch (id) {
        case T.WALL: drawWall(c, 0, 0); break;
        case T.PIT: drawPit(c, 0, 0); break;
        case T.START: drawStart(c, 0, 0); break;
        case T.EXIT: drawExit(c, 0, 0, false); break;
        case T.DEFLECT: drawDeflect(c, 0, 0, prm); break;
        case T.CONVEY: drawConvey(c, 0, 0, prm); break;
        case T.TELEPORT: drawTeleport(c, 0, 0, prm); break;
        case T.ROTOR:
          drawRotorHub(c, 0, 0);
          /* a stub of beam, so the swatch says "this sweeps" */
          drawBeamSegment(c, M.CELL / 2, M.CELL / 2, M.CELL - 2, M.CELL / 2);
          break;
        case T.TURRET: drawTurretSwatch(c, 0, 0, prm); break;
        case T.GATE: drawGate(c, 0, 0, prm, false); break;
        case T.PLATE: drawPlateTile(c, 0, 0, prm, false); break;
        case T.PHASE: drawPhaseSwatch(c, 0, 0); break;
        case T.KEY: drawKey(c, 0, 0); break;
        case T.TOKEN: drawToken(c, 0, 0); break;
        case T.FALLER: drawLieMark(c, 0, 0, 'f'); break;
        case T.MIMIC: drawExit(c, 0, 0, false); drawLieMark(c, 0, 0, 'm'); break;
        default: break;
      }
      c.restore();
    },

    /* Optional per-SIM-TICK hook. If Play.tick calls this, interpolation is
     * exact at every refresh rate. If it does not, we fall back as described
     * at the top of this file. Two assignments, no allocation. */
    tick: feedTick,

    /* Exposed so fx.js can compose over the same context, and so the editor
     * can draw its own overlay furniture without re-deriving the geometry. */
    ctx: function () { return ctx; },
    dpr: function () { return dpr; },
    cellX: function (i) { return cx(i); },
    cellY: function (i) { return cy(i); },
    stencil: stencil,
    box: box,
    line: line,
    fillBox: fillBox,
    hatchBox: hatchBox,
    rotorAngle: rotorAngle,
    phaseSolid: phaseSolid
  };

  BAIT.Draw = Draw;

})(window.BAIT = window.BAIT || {});
