/* BAIT — room <-> room code.
 *
 * OWNER: Forge (Engine).
 *
 * The code IS the room. There is no server to look anything up in, so the
 * whole level travels inside the string (SPEC §5.1). Target is under ~120
 * characters for a typical room, which we hit by writing a bit stream rather
 * than bytes: tile ids need 5 bits, not 8, and most of a room is long runs of
 * two or three tiles.
 *
 * decode() TAKES HOSTILE INPUT. Somebody will paste a code from Discord that
 * was mangled by a link shortener, or truncated, or written by hand to see
 * what breaks. It must return null on every one of those and it must never
 * throw, never loop unboundedly and never allocate on an attacker's say-so.
 * Every numeric field is bit-width bounded on read, every run is checked
 * against the remaining cell count, and every parameter goes through
 * Pieces.clampParam before it reaches a room.
 *
 * ZERO DOM REFERENCES. No atob/btoa: those are browser globals and this file
 * is loaded by tools/verify.cjs under plain Node, so base64url is done by
 * hand below.
 *
 * ------------------------------------------------------------------ layout --
 *   4  bits  version (1)
 *   5  bits  width           4..20
 *   4  bits  height          4..14
 *   runs, until width*height cells are filled:
 *     id:  1 bit  0 -> 1 bit, 0=floor 1=wall     (the two tiles most of a
 *                 1 -> 5 bits, any tile id        room is made of, at 2 bits)
 *     run: 1 bit  0 -> 3 bits  length - 1  (1..8)
 *                 1 -> 9 bits  length - 1  (1..512)
 *   parameters, with NO index and NO count: the tile stream already says
 *   exactly which cells carry parameters and in what order, so writing that
 *   again costs ten bits an entry to restate something the decoder knows.
 *   For each such cell, in index order, the tile's declared fields in the
 *   order pieces.js declares them:
 *     dir 2 (encoded N,E,S,W)  period 6  phase 6  link 4  len 3  mode 1
 *   1  bit   metadata present
 *     5 bits name length, 7 bits per character
 *     5 bits author length, 7 bits per character
 *     16 bits par time in ticks (the author's proven clear)
 *
 * After that the stream must be exhausted: fewer than 8 bits may remain and
 * every one of them must be zero. That is what makes a truncated or padded
 * code fail rather than quietly decoding to a room nobody authored.
 */
(function (BAIT) {
  'use strict';

  var P = BAIT.Pieces, RoomLib = BAIT.Room;
  var K = P.K;

  var VERSION = 1;

  /* A code longer than this is refused before we do any work at all. The
   * largest legal room cannot come close: 280 cells of alternating tiles is
   * about 700 bytes encoded. */
  var MAX_CODE_CHARS = 4096;
  var MAX_NAME = 24, MAX_AUTHOR = 16;

  var DIR_CODE = { 1: 0, 3: 1, 5: 2, 7: 3 };
  var DIR_FROM = [1, 3, 5, 7];

  var FIELD_BITS = { dir: 2, period: 6, phase: 6, link: 4, len: 3, mode: 1 };

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var B64_INV = (function () {
    var m = {};
    for (var i = 0; i < B64.length; i++) m[B64.charAt(i)] = i;
    return m;
  })();

  /* ------------------------------------------------------------- bit i/o -- */

  function Writer() { this.bytes = []; this.bit = 0; }
  Writer.prototype.write = function (value, bits) {
    value = value | 0;
    for (var i = bits - 1; i >= 0; i--) {
      var b = (value >>> i) & 1;
      var byteIndex = this.bit >> 3;
      if (this.bytes.length <= byteIndex) this.bytes.push(0);
      if (b) this.bytes[byteIndex] |= (1 << (7 - (this.bit & 7)));
      this.bit++;
    }
  };

  function Reader(bytes) { this.bytes = bytes; this.bit = 0; this.over = false; }
  Reader.prototype.read = function (bits) {
    var v = 0;
    for (var i = 0; i < bits; i++) {
      var byteIndex = this.bit >> 3;
      if (byteIndex >= this.bytes.length) { this.over = true; return 0; }
      var b = (this.bytes[byteIndex] >>> (7 - (this.bit & 7))) & 1;
      v = (v << 1) | b;
      this.bit++;
    }
    return v >>> 0;
  };

  /* ------------------------------------------------------------- base64url -- */

  function toBase64url(bytes) {
    var out = '', i;
    for (i = 0; i + 2 < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64.charAt((n >>> 18) & 63) + B64.charAt((n >>> 12) & 63) +
             B64.charAt((n >>> 6) & 63) + B64.charAt(n & 63);
    }
    var rem = bytes.length - i;
    if (rem === 1) {
      var a = bytes[i] << 16;
      out += B64.charAt((a >>> 18) & 63) + B64.charAt((a >>> 12) & 63);
    } else if (rem === 2) {
      var c = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += B64.charAt((c >>> 18) & 63) + B64.charAt((c >>> 12) & 63) +
             B64.charAt((c >>> 6) & 63);
    }
    return out;
  }

  /* Returns null on any character outside the alphabet, rather than skipping
   * it. Silently repairing a corrupt code would hand the parser a room that
   * is not the one the author published. */
  function fromBase64url(str) {
    var bits = 0, acc = 0, out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charAt(i);
      var v = B64_INV[c];
      if (v === undefined) return null;
      acc = (acc << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push((acc >>> bits) & 0xff);
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------- encode -- */

  function encode(room) {
    if (!room || !room.tiles) return '';
    var w = room.w, h = room.h, n = w * h;
    var W = new Writer();

    W.write(VERSION, 4);
    W.write(w, 5);
    W.write(h, 4);

    /* tile runs */
    var i = 0;
    while (i < n) {
      var id = room.tiles[i], run = 1;
      while (i + run < n && room.tiles[i + run] === id && run < 512) run++;
      if (id === P.TILE.EMPTY) { W.write(0, 1); W.write(0, 1); }
      else if (id === P.TILE.WALL) { W.write(0, 1); W.write(1, 1); }
      else { W.write(1, 1); W.write(id, 5); }
      if (run <= 8) { W.write(0, 1); W.write(run - 1, 3); }
      else { W.write(1, 1); W.write(run - 1, 9); }
      i += run;
    }

    /* parameters, in cell order, for every tile that declares any */
    for (i = 0; i < n; i++) {
      var d = P.def(room.tiles[i]);
      if (!d || !d.params.length) continue;
      var p = room.params[i] || P.defaults(room.tiles[i]);
      for (var f = 0; f < d.params.length; f++) {
        var field = d.params[f];
        var val = P.clampParam(field, p[field]);
        if (field === 'dir') val = DIR_CODE[val] === undefined ? 1 : DIR_CODE[val];
        W.write(val, FIELD_BITS[field]);
      }
    }

    /* metadata: only workshop rooms carry it, campaign rooms skip the bytes */
    var name = String(room.name || '').slice(0, MAX_NAME);
    var author = String(room.author || '').slice(0, MAX_AUTHOR);
    var par = room.par && room.par.time ? room.par.time : 0;
    if (name || author || par) {
      W.write(1, 1);
      writeText(W, name, MAX_NAME);
      writeText(W, author, MAX_AUTHOR);
      W.write(Math.min(65535, par | 0), 16);
    } else {
      W.write(0, 1);
    }

    return toBase64url(W.bytes);
  }

  /* 7-bit printable ASCII only. Anything else is dropped at the door, which
   * keeps a room name from carrying control characters into somebody's DOM. */
  function writeText(W, s, cap) {
    var clean = [];
    for (var i = 0; i < s.length && clean.length < cap; i++) {
      var c = s.charCodeAt(i);
      if (c >= 32 && c <= 126) clean.push(c);
    }
    W.write(clean.length, 5);
    for (i = 0; i < clean.length; i++) W.write(clean[i], 7);
  }

  function readText(R, cap) {
    var len = R.read(5);
    if (len > cap) return null;
    var s = '';
    for (var i = 0; i < len; i++) {
      var c = R.read(7);
      if (R.over) return null;
      if (c < 32 || c > 126) return null;
      s += String.fromCharCode(c);
    }
    return s;
  }

  /* ---------------------------------------------------------------- decode --
   * Returns a validated, playable room, or null. Never throws.
   */
  function decode(str) {
    try {
      if (typeof str !== 'string') return null;
      str = str.trim();
      if (!str.length || str.length > MAX_CODE_CHARS) return null;

      var bytes = fromBase64url(str);
      if (!bytes) return null;

      var R = new Reader(bytes);

      if (R.read(4) !== VERSION) return null;
      var w = R.read(5), h = R.read(4);
      if (R.over) return null;
      if (w < 4 || w > K.GRID_W || h < 4 || h > K.GRID_H) return null;

      var n = w * h;
      var tiles = new Uint8Array(n);
      var filled = 0, guard = 0;

      while (filled < n) {
        /* Every run consumes at least one cell, so n iterations is a hard
         * ceiling. The guard is belt and braces against a future edit. */
        if (++guard > n + 1) return null;

        var id = R.read(1) ? R.read(5) : (R.read(1) ? P.TILE.WALL : P.TILE.EMPTY);
        var long = R.read(1);
        var run = (long ? R.read(9) : R.read(3)) + 1;
        if (R.over) return null;
        if (!P.def(id)) return null;                 // unknown tile id
        if (run > n - filled) return null;           // run overruns the room

        for (var q = 0; q < run; q++) tiles[filled + q] = id;
        filled += run;
      }

      var room = RoomLib.create(w, h);
      room.tiles = tiles;

      /* parameters, driven off the tile stream in the same order encode wrote
       * them — there is no index to disagree with, and therefore no index to
       * point somewhere it should not */
      var params = {}, i;
      for (i = 0; i < n; i++) {
        var def = P.def(tiles[i]);
        if (!def || !def.params.length) continue;
        var p = {};
        for (var f = 0; f < def.params.length; f++) {
          var field = def.params[f];
          var raw = R.read(FIELD_BITS[field]);
          if (R.over) return null;
          if (field === 'dir') raw = DIR_FROM[raw & 3];
          p[field] = P.clampParam(field, raw);
        }
        params[i] = p;
      }
      room.params = params;

      if (R.read(1) === 1) {
        var name = readText(R, MAX_NAME); if (name === null) return null;
        var author = readText(R, MAX_AUTHOR); if (author === null) return null;
        var par = R.read(16);
        if (R.over) return null;
        room.name = name;
        room.author = author;
        room.par.time = Math.min(K.MAX_TICKS, par);
      }
      if (R.over) return null;

      /* The stream must now be exhausted. base64url can leave up to 7 bits of
       * padding and every one of them must be zero. Without this check a code
       * with extra characters glued on the end, or one truncated at a lucky
       * boundary, decodes to a room nobody published. */
      var leftover = bytes.length * 8 - R.bit;
      if (leftover < 0 || leftover >= 8) return null;
      while (R.bit < bytes.length * 8) { if (R.read(1) !== 0) return null; }

      /* start comes from the START tile, never from the wire */
      var found = -1;
      for (i = 0; i < n; i++) {
        if (tiles[i] === P.TILE.START) { found = i; break; }
      }
      if (found < 0) return null;
      room.start = { x: found % w, y: (found / w) | 0 };

      /* Structural checks a clamp cannot see: a lone teleport, a gate with no
       * plate, two exits. A code that fails these is not playable, so it is
       * not a code. */
      if (!RoomLib.validate(room).ok) return null;

      return room;
    } catch (err) {
      return null;
    }
  }

  /* Round-trip check used by tools/verify.cjs and by the workshop before it
   * hands a player a code to share. */
  function equal(a, b) {
    if (!a || !b) return false;
    if (a.w !== b.w || a.h !== b.h) return false;
    if (a.start.x !== b.start.x || a.start.y !== b.start.y) return false;
    for (var i = 0; i < a.tiles.length; i++) {
      if (a.tiles[i] !== b.tiles[i]) return false;
      var pa = a.params[i], pb = b.params[i];
      if (!pa !== !pb) return false;
      if (pa) {
        var def = P.def(a.tiles[i]);
        for (var f = 0; f < def.params.length; f++) {
          var k = def.params[f];
          if (P.clampParam(k, pa[k]) !== P.clampParam(k, pb[k])) return false;
        }
      }
    }
    return true;
  }

  BAIT.Codec = {
    VERSION: VERSION,
    MAX_CODE_CHARS: MAX_CODE_CHARS,
    encode: encode, decode: decode, equal: equal
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BAIT.Codec;

})(typeof window !== 'undefined'
  ? (window.BAIT = window.BAIT || {})
  : (global.BAIT = global.BAIT || {}));
