/* BAIT — piece table and simulation constants.
 *
 * OWNER: Boss. Nobody else edits this file. It is the shared vocabulary that
 * the sim, the renderer, the editor, the codec and the campaign all agree on.
 * If you need a piece changed or added, raise it in #bait-build.
 *
 * ZERO DOM REFERENCES. This file is loaded by tools/verify.cjs under plain
 * Node, so `window`, `document` and `performance` do not exist here.
 */
(function (BAIT) {
  'use strict';

  /* ---------------------------------------------------------------- units --
   * All simulation state is Q16.16 fixed point. ONE = 1.0.
   * Positions are in fixed-point PIXELS, not cells, so a 20x14 room is
   * 800x560 px and the dot's radius is a whole number of pixels.
   */
  var ONE = 65536;

  var K = {
    ONE: ONE,

    /* geometry */
    CELL: 40,               // px per cell
    GRID_W: 20,             // cells — one screen, never scrolls
    GRID_H: 14,
    RADIUS: 7,              // dot radius in px (of a 40px cell)

    /* time */
    TICK_HZ: 120,           // fixed simulation rate
    MAX_CATCHUP: 8,         // accumulator cap; a throttled tab must not spiral

    /* motion — constant speed, no acceleration, ever (see SPEC §2) */
    SPEED: 2 * ONE,         // 2 px/tick = 240 px/s = 6 cells/s
    DIAG: 92682,            // round(2 * ONE * sqrt(1/2)) — diagonals match speed

    /* Conveyor drift, deliberately half of SPEED. At 1px/tick a conveyor can
     * slow a player walking into it but can never out-push them, so a
     * conveyor is always a tax on your route and never a loss of control.
     * Raising this above SPEED would make conveyors able to trap a player
     * with no counterplay, which is a different and much worse piece. */
    CONVEY_SPEED: ONE,

    /* hazards */
    BULLET_SPEED: 3 * ONE,  // turret bullets outrun the player, deliberately
    BULLET_R: 3,
    ROTOR_R: 4,             // half-thickness of a rotor beam
    PERIOD_UNIT: 10,        // periods are authored in units of 10 ticks (12/s)

    /* limits — also the validation bounds for untrusted room codes */
    MAX_LINK: 15,
    MAX_PERIOD: 63,         // in PERIOD_UNITs
    MAX_PHASE: 63,
    MAX_ROTOR_LEN: 6,
    MAX_TICKS: 120 * 180,   // 3 minutes: a room that runs longer is a loss
    EDITOR_BUDGET: 24       // pieces the player may place in the workshop
  };

  /* Direction table. Index 0 is "no input". 1..8 walk clockwise from North.
   * Values are already multiplied by speed, so the sim just adds them. */
  var S = K.SPEED, D = K.DIAG;
  K.DIRS = [
    [0, 0],                 // 0 none
    [0, -S],                // 1 N
    [D, -D],                // 2 NE
    [S, 0],                 // 3 E
    [D, D],                 // 4 SE
    [0, S],                 // 5 S
    [-D, D],                // 6 SW
    [-S, 0],                // 7 W
    [-D, -D]                // 8 NW
  ];

  /* Cardinal-only unit steps, for turrets/conveyors/deflectors which never
   * act on a diagonal. Index by the same 1..8 direction ids (cardinals only). */
  K.CARD = { 1: [0, -1], 3: [1, 0], 5: [0, 1], 7: [-1, 0] };

  /* ---------------------------------------------------------------- tiles --
   * `id`      numeric tile id, stable forever — the codec writes these.
   * `ch`      authoring character used in src/data/chapters.js.
   * `params`  which fields this tile reads. The codec writes exactly these,
   *           in this order. Adding a param to a shipped tile breaks old codes.
   * `solid`   blocks movement unconditionally.
   * `lethal`  contact kills unconditionally.
   * `cost`    editor budget cost. 0 = free / structural.
   * `lies`    this piece can misrepresent itself. There are exactly two, and
   *           that ratio is the design (SPEC §4.1).
   */
  var TILE = {
    EMPTY: 0, WALL: 1, START: 2, EXIT: 3, FALLER: 4, PIT: 5, DEFLECT: 6,
    TURRET: 7, ROTOR: 8, GATE: 9, PLATE: 10, PHASE: 11, CONVEY: 12,
    KEY: 13, TOKEN: 14, TELEPORT: 15, MIMIC: 16
  };

  var LIST = [
    { id: TILE.EMPTY, ch: '.', name: 'floor', params: [], cost: 0 },

    { id: TILE.WALL, ch: '#', name: 'wall', params: [], solid: true, cost: 1,
      blurb: 'Solid. Honest.' },

    { id: TILE.START, ch: 'S', name: 'start', params: [], cost: 0, unique: true },

    { id: TILE.EXIT, ch: 'E', name: 'exit', params: [], cost: 0, unique: true,
      blurb: 'Opens once every key is collected.' },

    /* THE LIAR. Walkable the first time. The instant the dot leaves it, it
     * becomes a pit. Second touch kills. This is what lets a runner learn a
     * route and then be betrayed by the exact line they came to trust. */
    { id: TILE.FALLER, ch: 'f', name: 'faller', params: [], cost: 2, lies: true,
      blurb: 'Looks like floor. Holds you once.' },

    { id: TILE.PIT, ch: 'x', name: 'pit', params: [], lethal: true, cost: 1,
      blurb: 'A hole. Visibly a hole.' },

    /* dir is cardinal only: 1 N, 3 E, 5 S, 7 W */
    { id: TILE.DEFLECT, ch: '>', name: 'deflector', params: ['dir'], cost: 2,
      blurb: 'Slams your heading to its arrow. You keep moving.' },

    { id: TILE.TURRET, ch: 'T', name: 'turret', params: ['dir', 'period', 'phase'],
      solid: true, cost: 3,
      blurb: 'Fires down its lane on a fixed cadence. Never varies.' },

    { id: TILE.ROTOR, ch: 'R', name: 'rotor', params: ['period', 'phase', 'len'],
      solid: true, cost: 3,
      blurb: 'A beam that sweeps a quarter turn per period.' },

    { id: TILE.GATE, ch: 'G', name: 'gate', params: ['link'], cost: 2,
      blurb: 'Solid until its plate says otherwise.' },

    /* mode 0 = hold (open only while stood on), 1 = latch (toggles, stays) */
    { id: TILE.PLATE, ch: '_', name: 'plate', params: ['link', 'mode'], cost: 2,
      blurb: 'Opens every gate wearing its number.' },

    { id: TILE.PHASE, ch: '%', name: 'phase block', params: ['period', 'phase'],
      cost: 2, blurb: 'Solid, then not. Telegraphed, always.' },

    { id: TILE.CONVEY, ch: 'C', name: 'conveyor', params: ['dir'], cost: 2,
      blurb: 'Adds its drift while you stand on it.' },

    { id: TILE.KEY, ch: 'k', name: 'key', params: [], cost: 1,
      blurb: 'The exit stays shut until you have them all.' },

    { id: TILE.TOKEN, ch: 'o', name: 'token', params: [], cost: 0, unique: true,
      blurb: 'Optional. Always on the worse line.' },

    { id: TILE.TELEPORT, ch: 'W', name: 'teleport', params: ['link'], cost: 2,
      blurb: 'Paired. You come out of its twin, heading intact.' },

    /* THE SECOND LIAR. Renders pixel-identical to the exit. Fatal. Use it
     * sparingly and late — a room where anything might be a lie is not a
     * trap, it is noise. */
    { id: TILE.MIMIC, ch: 'M', name: 'mimic exit', params: [], lethal: true,
      cost: 4, lies: true, blurb: 'It is not the exit.' }
  ];

  /* Deflector and conveyor get one authoring char per direction, so a room
   * reads correctly in the source file. All four map to the same tile id. */
  var DIR_CHARS = {
    DEFLECT: { '^': 1, '>': 3, 'v': 5, '<': 7 },
    CONVEY: { 'I': 1, 'C': 3, '!': 5, 'J': 7 }
  };

  var BY_ID = {}, BY_CHAR = {};
  for (var i = 0; i < LIST.length; i++) {
    var d = LIST[i];
    d.params = d.params || [];
    d.solid = !!d.solid; d.lethal = !!d.lethal; d.lies = !!d.lies;
    BY_ID[d.id] = d;
    BY_CHAR[d.ch] = { id: d.id, p: null };
  }
  Object.keys(DIR_CHARS.DEFLECT).forEach(function (c) {
    BY_CHAR[c] = { id: TILE.DEFLECT, p: { dir: DIR_CHARS.DEFLECT[c] } };
  });
  Object.keys(DIR_CHARS.CONVEY).forEach(function (c) {
    BY_CHAR[c] = { id: TILE.CONVEY, p: { dir: DIR_CHARS.CONVEY[c] } };
  });

  /* Clamp any param read out of an untrusted room code into legal range.
   * The codec MUST run every param through this. A pasted code is hostile
   * input and must not be able to allocate or loop unboundedly. */
  function clampParam(field, v) {
    v = v | 0;
    switch (field) {
      case 'dir': return (v === 1 || v === 3 || v === 5 || v === 7) ? v : 3;
      case 'period': return Math.min(K.MAX_PERIOD, Math.max(1, v));
      case 'phase': return Math.min(K.MAX_PHASE, Math.max(0, v));
      case 'link': return Math.min(K.MAX_LINK, Math.max(0, v));
      case 'len': return Math.min(K.MAX_ROTOR_LEN, Math.max(1, v));
      case 'mode': return v ? 1 : 0;
      default: return 0;
    }
  }

  /* Default params for a freshly placed piece, so the editor and the room
   * parser agree without either one inventing values. */
  function defaults(id) {
    var d = BY_ID[id], out = {};
    if (!d) return out;
    for (var j = 0; j < d.params.length; j++) {
      var f = d.params[j];
      out[f] = f === 'period' ? 12 : f === 'len' ? 3 : f === 'dir' ? 3 : 0;
    }
    return out;
  }

  BAIT.Pieces = {
    K: K, TILE: TILE, LIST: LIST, BY_ID: BY_ID, BY_CHAR: BY_CHAR,
    DIR_CHARS: DIR_CHARS, clampParam: clampParam, defaults: defaults,
    def: function (id) { return BY_ID[id]; },
    isSolid: function (id) { var d = BY_ID[id]; return !!(d && d.solid); },
    isLethal: function (id) { var d = BY_ID[id]; return !!(d && d.lethal); }
  };

  /* Node (tools/verify.cjs) loads this file with a shim; browsers get the
   * global. Never reference `window` directly here. */
  if (typeof module !== 'undefined' && module.exports) module.exports = BAIT.Pieces;

})(typeof window !== 'undefined'
  ? (window.BAIT = window.BAIT || {})
  : (global.BAIT = global.BAIT || {}));
