/* BAIT — the Room: shape, authoring, validation, helpers.
 *
 * OWNER: Forge (Engine).
 *
 * The room shape is FROZEN. The codec writes it, the sim reads it, the editor
 * builds it and src/data/chapters.js authors ~80 of them by hand. Anything
 * that changes this shape breaks all four at once.
 *
 *   {
 *     v: 1,
 *     w, h,                        // cells
 *     tiles: Uint8Array(w*h),      // tile ids, row-major, index = y*w + x
 *     params: { [cellIndex]: { dir, period, phase, link, len, mode } },
 *     start: { x, y },             // cell coords, mirrors the START tile
 *     name, author,
 *     par: { time, deaths }        // time in ticks; filled by the solver
 *   }
 *
 * ZERO DOM REFERENCES. tools/verify.cjs loads this file under plain Node.
 */
(function (BAIT) {
  'use strict';

  var P = BAIT.Pieces;
  var K = P.K, TILE = P.TILE;

  function idx(room, x, y) { return y * room.w + x; }
  function inBounds(room, x, y) {
    return x >= 0 && y >= 0 && x < room.w && y < room.h;
  }

  /* Every error is { code, msg, cx, cy }.
   *
   *   code  stable machine-readable slug, safe to switch on
   *   msg   the human sentence, already naming the cell
   *   cx,cy the offending cell, or -1,-1 when the problem is the whole room
   *         ("no exit" is not anywhere in particular)
   *
   * The cell coordinates are mandatory because the editor highlights the cell
   * it is complaining about, and an error that cannot say WHERE is close to
   * useless to somebody staring at a 20x14 grid.
   */
  function err(code, msg, cx, cy) {
    return {
      code: code, msg: msg,
      cx: cx === undefined ? -1 : cx,
      cy: cy === undefined ? -1 : cy
    };
  }

  function at(room, x, y) {
    if (!inBounds(room, x, y)) return TILE.WALL;   // outside is solid, always
    return room.tiles[y * room.w + x];
  }

  function paramsAt(room, x, y) {
    if (!inBounds(room, x, y)) return null;
    var p = room.params[y * room.w + x];
    return p || null;
  }

  function create(w, h) {
    w = w | 0; h = h | 0;
    if (w <= 0) w = K.GRID_W;
    if (h <= 0) h = K.GRID_H;
    return {
      v: 1,
      w: w, h: h,
      tiles: new Uint8Array(w * h),
      params: {},
      start: { x: 1, y: 1 },
      name: '',
      author: '',
      par: { time: 0, deaths: 0 },
      parseErrors: []
    };
  }

  function clone(room) {
    var r = create(room.w, room.h);
    r.v = room.v;
    r.tiles = new Uint8Array(room.tiles);
    r.params = {};
    for (var k in room.params) {
      if (Object.prototype.hasOwnProperty.call(room.params, k)) {
        var src = room.params[k], dst = {};
        for (var f in src) {
          if (Object.prototype.hasOwnProperty.call(src, f)) dst[f] = src[f];
        }
        r.params[k] = dst;
      }
    }
    r.start = { x: room.start.x, y: room.start.y };
    r.name = room.name;
    r.author = room.author;
    r.par = { time: room.par.time, deaths: room.par.deaths };
    r.parseErrors = room.parseErrors ? room.parseErrors.slice() : [];
    return r;
  }

  /* Write a tile and its params in one call, clamping every param. The editor
   * and the codec both go through here so neither can invent an illegal
   * value. */
  function setTile(room, x, y, id, p) {
    if (!inBounds(room, x, y)) return false;
    var def = P.def(id);
    if (!def) return false;
    var i = y * room.w + x;
    room.tiles[i] = id;
    if (def.params.length) {
      var base = P.defaults(id), out = {};
      for (var j = 0; j < def.params.length; j++) {
        var f = def.params[j];
        var v = (p && p[f] !== undefined) ? p[f] : base[f];
        out[f] = P.clampParam(f, v);
      }
      room.params[i] = out;
    } else {
      delete room.params[i];
    }
    if (id === TILE.START) { room.start.x = x; room.start.y = y; }
    return true;
  }

  /* ------------------------------------------------------------ authoring --
   * fromText(lines, paramMap)
   *
   *   lines    array of equal-length strings using the authoring characters
   *            in pieces.js. ' ' is accepted as floor alongside '.'.
   *   paramMap optional, keyed "x,y" — e.g. { "4,7": { period: 20, phase: 3 } }
   *            merged over the character's own params (the arrow characters
   *            already carry a direction).
   *
   * Never throws. Problems are collected onto room.parseErrors, each one
   * naming the offending cell, and validate() reports them alongside its own
   * checks so Atlas gets every complaint about a room in a single list.
   */
  function fromText(lines, paramMap) {
    var errs = [];

    if (!lines || !lines.length) {
      var empty = create(K.GRID_W, K.GRID_H);
      empty.parseErrors = [err('no-lines', 'fromText: no lines given')];
      return empty;
    }

    /* Tolerate stray carriage returns from a pasted block, but not ragged
     * rows — a room that is not rectangular is almost always a typo that
     * would otherwise silently shift every tile on the line. */
    var rows = [];
    for (var r = 0; r < lines.length; r++) {
      rows.push(String(lines[r]).replace(/[\r\n]+$/, ''));
    }
    var w = rows[0].length, h = rows.length;
    for (var q = 1; q < h; q++) {
      if (rows[q].length !== w) {
        errs.push(err('ragged-row',
          'row ' + q + ' is ' + rows[q].length + ' chars, expected ' + w +
          ' (rows must all be the same width)', 0, q));
      }
    }

    if (w > K.GRID_W || h > K.GRID_H) {
      errs.push(err('too-big',
        'room is ' + w + 'x' + h + ', maximum is ' + K.GRID_W + 'x' + K.GRID_H));
      w = Math.min(w, K.GRID_W); h = Math.min(h, K.GRID_H);
    }

    var room = create(w, h);
    var sawStart = false;

    for (var y = 0; y < h; y++) {
      var line = rows[y];
      for (var x = 0; x < w; x++) {
        var ch = x < line.length ? line.charAt(x) : '.';
        if (ch === ' ') ch = '.';

        var entry = P.BY_CHAR[ch];
        if (!entry) {
          errs.push(err('unknown-char',
            'unknown character "' + ch + '" at ' + x + ',' + y, x, y));
          continue;                                   // leaves floor
        }

        /* character params, then the paramMap override on top */
        var merged = null;
        if (entry.p) {
          merged = {};
          for (var f in entry.p) {
            if (Object.prototype.hasOwnProperty.call(entry.p, f)) {
              merged[f] = entry.p[f];
            }
          }
        }
        var over = paramMap && paramMap[x + ',' + y];
        if (over) {
          merged = merged || {};
          for (var g in over) {
            if (Object.prototype.hasOwnProperty.call(over, g)) merged[g] = over[g];
          }
        }

        /* Report a paramMap entry aimed at a piece that does not read it,
         * because that is silently-ignored authoring intent. */
        if (over) {
          var def = P.def(entry.id);
          for (var gf in over) {
            if (Object.prototype.hasOwnProperty.call(over, gf) &&
                def.params.indexOf(gf) === -1) {
              errs.push(err('bad-param-field',
                '"' + gf + '" at ' + x + ',' + y + ' is not a parameter of ' +
                def.name + ' (reads: ' + (def.params.join(', ') || 'nothing') + ')',
                x, y));
            }
          }
        }

        setTile(room, x, y, entry.id, merged);
        if (entry.id === TILE.START) sawStart = true;
      }
    }

    /* paramMap entries pointing at cells that do not exist are a typo we can
     * catch cheaply and would otherwise be invisible. */
    if (paramMap) {
      for (var key in paramMap) {
        if (!Object.prototype.hasOwnProperty.call(paramMap, key)) continue;
        var m = /^(\d+),(\d+)$/.exec(key);
        if (!m) {
          errs.push(err('bad-parammap-key', 'paramMap key "' + key + '" is not "x,y"'));
          continue;
        }
        if (!inBounds(room, +m[1], +m[2])) {
          errs.push(err('parammap-outside',
            'paramMap key "' + key + '" is outside the ' + room.w + 'x' + room.h +
            ' room', +m[1], +m[2]));
        }
      }
    }

    if (!sawStart) errs.push(err('no-start', 'no start "S" anywhere in the room'));

    room.parseErrors = errs;
    return room;
  }

  /* ----------------------------------------------------------- validation --
   * Returns { ok, errors: [] }. Every message names the cell it is about,
   * because "invalid room" with 280 cells to search is not a bug report.
   *
   * This is the gate for authored content AND the second line of defence for
   * a decoded room code. The codec clamps params; this catches the structural
   * lies a clamp cannot see, like a gate whose plate does not exist.
   */
  function validate(room) {
    var errors = [];

    function cx(i) { return i % room.w; }
    function cy(i) { return (i / room.w) | 0; }
    function bad(code, msg, i) {
      errors.push(i === undefined ? err(code, msg) : err(code, msg, cx(i), cy(i)));
    }
    function cellName(i) { return '(' + cx(i) + ',' + cy(i) + ')'; }

    if (!room || !room.tiles) {
      return { ok: false, errors: [err('no-room', 'room is missing')] };
    }
    if (room.v !== 1) bad('version', 'room version ' + room.v + ', expected 1');

    if (room.w < 4 || room.h < 4 || room.w > K.GRID_W || room.h > K.GRID_H) {
      bad('size', 'room is ' + room.w + 'x' + room.h + ', must be between 4x4 and ' +
          K.GRID_W + 'x' + K.GRID_H);
      return { ok: false, errors: errors };
    }
    if (room.tiles.length !== room.w * room.h) {
      bad('tiles-length', 'tiles array is ' + room.tiles.length +
          ' long, expected ' + (room.w * room.h));
      return { ok: false, errors: errors };
    }

    if (room.parseErrors && room.parseErrors.length) {
      errors = room.parseErrors.slice();
    }

    var counts = {}, first = {}, i, id, n = room.tiles.length;
    var plateLinks = {}, gateLinks = {}, teleLinks = {};

    for (i = 0; i < n; i++) {
      id = room.tiles[i];
      var def = P.def(id);
      if (!def) { bad('unknown-tile', 'unknown tile id ' + id + ' at ' + cellName(i), i); continue; }
      counts[id] = (counts[id] || 0) + 1;
      if (first[id] === undefined) first[id] = i;

      var p = room.params[i];
      if (def.params.length) {
        if (!p) {
          bad('missing-params', def.name + ' at ' + cellName(i) + ' has no parameters', i);
          continue;
        }
        for (var j = 0; j < def.params.length; j++) {
          var f = def.params[j];
          var v = p[f];
          if (v === undefined) {
            bad('missing-param',
                def.name + ' at ' + cellName(i) + ' is missing "' + f + '"', i);
          } else if (P.clampParam(f, v) !== (v | 0)) {
            bad('param-range', def.name + ' at ' + cellName(i) + ' has ' + f + '=' +
                v + ', out of legal range', i);
          }
        }
        if (p.link !== undefined) {
          if (id === TILE.PLATE) (plateLinks[p.link] = plateLinks[p.link] || []).push(i);
          if (id === TILE.GATE) (gateLinks[p.link] = gateLinks[p.link] || []).push(i);
          if (id === TILE.TELEPORT) (teleLinks[p.link] = teleLinks[p.link] || []).push(i);
        }
      }
    }

    /* uniqueness, driven off the piece table so a new unique piece is covered
     * automatically */
    for (var u = 0; u < P.LIST.length; u++) {
      var d = P.LIST[u];
      if (!d.unique) continue;
      var c = counts[d.id] || 0;
      if (c > 1) {
        bad('duplicate', 'there are ' + c + ' ' + d.name + 's, there may only be one',
            first[d.id]);
      }
    }
    if (!counts[TILE.START]) bad('no-start', 'no start');
    if (!counts[TILE.EXIT]) bad('no-exit', 'no exit');

    /* the start must exist, sit inside the room, agree with the START tile,
     * and not be standing in something that kills you on tick zero */
    var s = room.start;
    if (!s || !inBounds(room, s.x, s.y)) {
      bad('start-outside', 'start is outside the room');
    } else {
      var sIdx = s.y * room.w + s.x;
      if (room.tiles[sIdx] !== TILE.START) {
        bad('start-mismatch',
            'room.start ' + cellName(sIdx) + ' does not hold the START tile', sIdx);
      }
      if (P.isSolid(room.tiles[sIdx]) || P.isLethal(room.tiles[sIdx])) {
        bad('start-blocked',
            'start ' + cellName(sIdx) + ' is inside a solid or lethal tile', sIdx);
      }
    }

    /* A gate with no plate is a wall wearing a costume, and a plate with no
     * gate is a promise the room does not keep. Both read as bugs to a
     * player, so both are errors rather than warnings. */
    var lk;
    for (lk in gateLinks) {
      if (!plateLinks[lk]) {
        bad('gate-no-plate',
            'gates on link ' + lk + ' have no plate, nothing can open them',
            gateLinks[lk][0]);
      }
    }
    for (lk in plateLinks) {
      if (!gateLinks[lk]) {
        bad('plate-no-gate', 'plate on link ' + lk + ' opens no gate', plateLinks[lk][0]);
      }
    }

    /* Teleports are strictly paired. One is a dead end, three is ambiguous. */
    for (lk in teleLinks) {
      var list = teleLinks[lk];
      if (list.length !== 2) {
        bad('teleport-unpaired',
            'link ' + lk + ' has ' + list.length + ' teleport' +
            (list.length === 1 ? '' : 's') + ' (' + list.map(cellName).join(' ') +
            '), teleports come in pairs', list[0]);
      }
    }

    return { ok: errors.length === 0, errors: errors };
  }

  /* Number of keys in the room. The exit refuses to open below this. */
  function keyCount(room) {
    var c = 0;
    for (var i = 0; i < room.tiles.length; i++) {
      if (room.tiles[i] === TILE.KEY) c++;
    }
    return c;
  }

  /* Cell index of the other end of a linked pair, or -1. */
  function twinOf(room, cellIndex) {
    var p = room.params[cellIndex];
    if (!p || p.link === undefined) return -1;
    var id = room.tiles[cellIndex];
    for (var i = 0; i < room.tiles.length; i++) {
      if (i === cellIndex) continue;
      if (room.tiles[i] !== id) continue;
      var q = room.params[i];
      if (q && q.link === p.link) return i;
    }
    return -1;
  }

  /* Flatten a validate() result to plain lines, for a console, a test failure
   * or Atlas's build log. The editor should use the objects and their cx,cy. */
  function errorText(errors) {
    return (errors || []).map(function (e) {
      return (e.cx >= 0 ? '(' + e.cx + ',' + e.cy + ') ' : '') + e.msg +
             '  [' + e.code + ']';
    });
  }

  BAIT.Room = {
    create: create, clone: clone, fromText: fromText, validate: validate,
    at: at, paramsAt: paramsAt, setTile: setTile,
    idx: idx, inBounds: inBounds, keyCount: keyCount, twinOf: twinOf,
    err: err, errorText: errorText
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BAIT.Room;

})(typeof window !== 'undefined'
  ? (window.BAIT = window.BAIT || {})
  : (global.BAIT = global.BAIT || {}));
