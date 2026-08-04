/* BAIT — headless verifier. OWNER: Sieve (QA).
 *
 * Plain Node, zero dependencies, no build step, no npm install. This script
 * is the definition of "internally reviewed and checked off" (SPEC §7, §8).
 *
 *   node tools/verify.cjs              full run
 *   node tools/verify.cjs --lint       source hygiene only
 *   node tools/verify.cjs --file P     lint one file, for use before handover
 *   node tools/verify.cjs --chapter 3  restrict room checks to one chapter
 *   node tools/verify.cjs --help
 *
 * Exit 0 means shippable. Anything else means it is not.
 *
 * PENDING is reported separately from FAIL throughout. "Not written yet" and
 * "written and wrong" are different problems and collapsing them would make
 * this tool useless during the build. Both still exit non-zero, so a pending
 * run can never be mistaken for a green one.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');

/* Core load order is the contract in SPEC §6. This script loads these exact
 * files under plain Node, which is WHY they must be DOM-free and integer
 * only. Order matters: each attaches a namespace the next one reads. */
var CORE = [
  'src/core/fixed.js',
  'src/core/rng.js',
  'src/core/pieces.js',
  'src/core/room.js',
  'src/core/sim.js',
  'src/core/codec.js',
  'src/core/replay.js',
  'src/core/solve.js'
];

/* The campaign, plus the daily generator. daily.js lives under src/game/ and
 * is not held to the DOM-free core rule, but it must still load under Node or
 * its 1825 generated rooms can never be proven solvable. */
var CONTENT = ['src/data/chapters.js', 'src/game/daily.js'];

/* ============================================================= reporting == */

var R = { pass: 0, fail: 0, pending: 0, warn: 0 };
var failures = [], pendings = [];

var C = process.stdout.isTTY
  ? { r: '[31m', g: '[32m', y: '[33m', d: '[90m', B: '[1m', x: '[0m' }
  : { r: '', g: '', y: '', d: '', B: '', x: '' };

function pass(what) { R.pass++; console.log('  ' + C.g + 'PASS' + C.x + '  ' + what); }
function fail(what, detail) {
  R.fail++; failures.push({ what: what, detail: detail });
  console.log('  ' + C.r + 'FAIL' + C.x + '  ' + what +
    (detail ? '\n        ' + C.d + String(detail).replace(/\n/g, '\n        ') + C.x : ''));
}
function pending(what, detail) {
  R.pending++; pendings.push({ what: what, detail: detail });
  console.log('  ' + C.y + 'PEND' + C.x + '  ' + what +
    (detail ? '\n        ' + C.d + String(detail).replace(/\n/g, '\n        ') + C.x : ''));
}
function warn(what, detail) {
  R.warn++;
  console.log('  ' + C.y + 'WARN' + C.x + '  ' + what +
    (detail ? '\n        ' + C.d + String(detail).replace(/\n/g, '\n        ') + C.x : ''));
}
function section(title) {
  console.log('\n' + C.B + title + C.x + '\n' + '-'.repeat(Math.min(74, title.length)));
}

/* ticks -> m:ss.s, since every duration the player sees is in ticks */
function fmtTicks(t, hz) {
  if (t === null || t === undefined) return '  -  ';
  var s = t / (hz || 120);
  var m = Math.floor(s / 60);
  var rem = s - m * 60;
  return m + ':' + (rem < 10 ? '0' : '') + rem.toFixed(1);
}
function padR(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : ' '.repeat(n - s.length) + s; }

/* Colour a table cell by verdict. Anything that is not a clean pass or a
 * clean failure is amber, so a half-finished run never reads as green. */
function mark(s, width) {
  var txt = width ? padR(s, width) : String(s);
  if (s === 'ok' || (typeof s === 'string' && s.charAt(0) === '+')) return C.g + txt + C.x;
  if (s === 'FAIL' || s === 'FREE' || s === 'triv') return C.r + txt + C.x;
  if (s === '-' || s === 'none') return C.d + txt + C.x;
  return C.y + txt + C.x;
}

/* ====================================================== source hygiene ==== *
 * SPEC §0.4 and Boss's rule 2: src/core/* is integer-only and DOM-free,
 * because this script loads those exact files under Node where `window` and
 * `document` do not exist. One stray `document.` in core turns the solver,
 * the par computation and the determinism test into a crash.
 *
 * This check depends on nobody's API, and it catches the class of mistake
 * that never shows up in a browser and only ever explodes here.
 */

/* Blank comments and string bodies so we scan code, not prose. Newlines are
 * preserved so reported line numbers stay true to the original file. */
function stripNonCode(src) {
  var out = '', i = 0, n = src.length, state = 'code';
  while (i < n) {
    var c = src[i], d = i + 1 < n ? src[i + 1] : '';
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && d === '*') { state = 'block'; out += '  '; i += 2; continue; }
      if (c === "'") { state = 'sq'; out += ' '; i++; continue; }
      if (c === '"') { state = 'dq'; out += ' '; i++; continue; }
      if (c === '`') { state = 'tpl'; out += ' '; i++; continue; }
      out += c; i++; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += '\n'; } else out += ' ';
      i++; continue;
    }
    if (state === 'block') {
      if (c === '*' && d === '/') { state = 'code'; out += '  '; i += 2; continue; }
      out += (c === '\n' ? '\n' : ' '); i++; continue;
    }
    if (c === '\\') { out += '  '; i += 2; continue; }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) {
      state = 'code'; out += ' '; i++; continue;
    }
    out += (c === '\n' ? '\n' : ' '); i++; continue;
  }
  return out;
}

/* The ONE sanctioned way a core file may name `window` is the module footer
 * every core file must end with (SPEC §6). Deleting exactly those two forms
 * before scanning makes the footer legal and any OTHER mention of window a
 * real error. It also quietly enforces that everyone uses the same footer
 * rather than inventing their own. */
function removeSanctionedFooter(src) {
  return src
    .replace(/typeof\s+window\s*!==\s*['"]undefined['"]/g, ' ')
    .replace(/window\.BAIT\s*=\s*window\.BAIT\s*\|\|\s*\{\s*\}/g, ' ');
}

var BANNED = [
  { re: /\bwindow\b/,                why: 'DOM reference; core is loaded under Node' },
  { re: /\bdocument\b/,              why: 'DOM reference; core is loaded under Node' },
  { re: /\bnavigator\b/,             why: 'DOM reference; core is loaded under Node' },
  { re: /\blocalStorage\b/,          why: 'DOM reference; persistence belongs in game/save.js' },
  { re: /\bperformance\b/,           why: 'wall-clock; breaks determinism' },
  { re: /\brequestAnimationFrame\b/, why: 'render concern; core must not know about frames' },
  { re: /\bMath\s*\.\s*random\b/,    why: 'non-deterministic; use the seeded PRNG in core/rng.js' },
  { re: /\bDate\s*\.\s*now\b/,       why: 'wall-clock; breaks determinism' },
  { re: /\bnew\s+Date\b/,            why: 'wall-clock; breaks determinism' },
  { re: /\bcanvas\b/i,               why: 'render concern; core must not know about drawing' }
];

/* Floats are legal in rendering and illegal in simulation state. A literal
 * like 0.5 in core is not automatically a bug, so these warn rather than
 * fail, but every one of them deserves a human look. */
var FLOATY = [
  { re: /(^|[^.\w])\d+\.\d+/, why: 'float literal in core; sim state must be Q16.16 integers' },
  { re: /\bMath\s*\.\s*(sqrt|sin|cos|tan|pow|atan2|hypot|log|exp)\b/,
    why: 'float maths in core; use a precomputed fixed-point table' }
];

function lintFile(rel) {
  var abs = path.resolve(ROOT, rel);
  if (!fs.existsSync(abs)) { pending(rel, 'not written yet'); return; }

  var raw = fs.readFileSync(abs, 'utf8');
  var code = stripNonCode(removeSanctionedFooter(raw));
  var lines = code.split('\n'), rawLines = raw.split('\n');
  var hits = [], soft = [];

  for (var i = 0; i < lines.length; i++) {
    for (var b = 0; b < BANNED.length; b++) {
      if (BANNED[b].re.test(lines[i])) {
        hits.push('line ' + (i + 1) + ': ' + BANNED[b].why + '\n  ' + rawLines[i].trim().slice(0, 88));
      }
    }
    for (var f = 0; f < FLOATY.length; f++) {
      if (FLOATY[f].re.test(lines[i])) {
        soft.push('line ' + (i + 1) + ': ' + FLOATY[f].why + '\n  ' + rawLines[i].trim().slice(0, 88));
      }
    }
  }

  /* Without the Node footer this script cannot load the file at all, and the
   * entire verification story collapses with it. */
  var hasFooter = /global\.BAIT\s*=\s*global\.BAIT\s*\|\|/.test(raw);

  if (hits.length) fail(rel, hits.join('\n'));
  else if (!hasFooter) {
    fail(rel, 'missing the Node global footer required by SPEC §6:\n' +
      "  })(typeof window !== 'undefined' ? (window.BAIT = window.BAIT || {}) : (global.BAIT = global.BAIT || {}));");
  } else pass(rel + '  ' + C.d + 'DOM-free, deterministic, Node-loadable' + C.x);

  if (soft.length) warn(rel + ' — floats in core, worth a look', soft.join('\n'));
}

/* =========================================================== module load == */

function loadAll(list, label) {
  var ok = true;
  for (var i = 0; i < list.length; i++) {
    var rel = list[i], abs = path.resolve(ROOT, rel);
    if (!fs.existsSync(abs)) { pending(rel, 'not written yet'); ok = false; continue; }
    try {
      require(abs);
      pass(rel + ' loaded');
    } catch (e) {
      fail(rel + ' threw on load',
        e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
      ok = false;
    }
  }
  return ok;
}

/* ======================================================== room lint ======= *
 * Room.validate (Forge) already covers structure: one start, one exit, param
 * ranges, gates have plates, teleports come in pairs. There is no value in
 * duplicating it, so this adds only what it cannot see.
 *
 * REACHABILITY. Flood fill from the start and confirm the exit, every key and
 * the token can actually be got to.
 *
 * The fill is deliberately OPTIMISTIC: it walks 8-way, treats gates and phase
 * blocks as open, and ignores every moving hazard. So it over-reports what is
 * reachable, on purpose. That means it can never fail a room that is actually
 * fine, and when it does fail one the room is definitively broken with no
 * judgement call involved. Proving the harder direction is the solver's job.
 */
function reachability(room) {
  var P = global.BAIT.Pieces, TILE = P.TILE;
  var w = room.w, h = room.h, n = w * h;
  var seen = new Uint8Array(n);

  /* Permanently impassable: solid pieces that never open (wall, turret,
   * rotor) and lethal pieces you cannot survive standing on (pit, mimic).
   * Gates and phase blocks are NOT here: both open, so an optimistic fill
   * must pass through them. */
  function blocked(id) { return P.isSolid(id) || P.isLethal(id); }

  var s = room.start;
  if (!s) return null;
  var startIdx = s.y * w + s.x;
  var queue = [startIdx];
  seen[startIdx] = 1;

  var DX = [0, 1, 1, 1, 0, -1, -1, -1];
  var DY = [-1, -1, 0, 1, 1, 1, 0, -1];

  while (queue.length) {
    var cur = queue.pop();
    var cx = cur % w, cy = (cur / w) | 0;
    for (var d = 0; d < 8; d++) {
      var nx = cx + DX[d], ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      var ni = ny * w + nx;
      if (seen[ni]) continue;
      if (blocked(room.tiles[ni])) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }

  /* A teleport carries you to its twin, so reaching one reaches the other.
   * Iterate to a fixed point because a teleport can land you in a pocket
   * containing another teleport. */
  var Room = global.BAIT.Room, changed = true;
  while (changed) {
    changed = false;
    for (var i = 0; i < n; i++) {
      if (room.tiles[i] !== TILE.TELEPORT || !seen[i]) continue;
      var twin = Room.twinOf(room, i);
      if (twin < 0 || seen[twin]) continue;
      seen[twin] = 1;
      /* flood onward from the exit side of the twin */
      var q2 = [twin];
      while (q2.length) {
        var c2 = q2.pop(), x2 = c2 % w, y2 = (c2 / w) | 0;
        for (var e = 0; e < 8; e++) {
          var ax = x2 + DX[e], ay = y2 + DY[e];
          if (ax < 0 || ay < 0 || ax >= w || ay >= h) continue;
          var ai = ay * w + ax;
          if (seen[ai] || blocked(room.tiles[ai])) continue;
          seen[ai] = 1; q2.push(ai);
        }
      }
      changed = true;
    }
  }

  var problems = [];
  function cellName(i) { return '(' + (i % w) + ',' + ((i / w) | 0) + ')'; }

  var keysTotal = 0, keysReachable = 0;
  for (var t = 0; t < n; t++) {
    var id = room.tiles[t];
    if (id === TILE.EXIT && !seen[t]) problems.push('the exit at ' + cellName(t) + ' cannot be reached from the start');
    if (id === TILE.TOKEN && !seen[t]) problems.push('the token at ' + cellName(t) + ' cannot be reached from the start');
    if (id === TILE.KEY) {
      keysTotal++;
      if (seen[t]) keysReachable++;
      else problems.push('the key at ' + cellName(t) + ' cannot be reached, so the exit can never open');
    }
    if (id === TILE.PLATE && !seen[t]) problems.push('the plate at ' + cellName(t) + ' cannot be reached, so its gate never opens');
  }

  return { ok: problems.length === 0, problems: problems, seen: seen, keys: keysTotal, keysReachable: keysReachable };
}

/* Pull the authored grid off a chapter room entry. Atlas's entry shape is not
 * frozen yet, so accept the obvious spellings rather than hard-failing on a
 * field name. Reported clearly if none match. */
function gridOf(entry) {
  return entry.grid || entry.lines || entry.rows || null;
}

/* ============================================================== solver ==== *
 * The search itself lives in src/core/solve.js so the campaign and the daily
 * provably use the SAME solver (SPEC §4.2, §7). This file only drives it and
 * reports what it says.
 */
function solve(room, opts) { return global.BAIT.Solve.search(room, opts); }
function solveEscalating(room, opts) { return global.BAIT.Solve.escalate(room, opts); }
function replayProves(room, inputs) { return global.BAIT.Solve.proves(room, inputs); }
function trivialDirection(room) { return global.BAIT.Solve.trivialDirection(room); }
function cellsOf(room, id) { return global.BAIT.Solve.cellsOf(room, id); }
function tokenCells(room) { return cellsOf(room, global.BAIT.Pieces.TILE.TOKEN); }
var SOLVER = { PAR_MARGIN: 1.10 };

var DIR_NAME = ['none', 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/* ============================================================ room checks = */

function checkRooms(onlyChapter) {
  var B = global.BAIT;
  var Chapters = B.Chapters, Room = B.Room;
  var haveCodec = !!B.Codec, haveSim = !!B.Sim, haveReplay = !!B.Replay;

  var table = [];
  var totalAuthored = 0, totalPlanned = Chapters.plannedTotal();
  var seenIds = {};
  var parTable = {};
  var unknowns = [];

  for (var ci = 0; ci < Chapters.list.length; ci++) {
    var ch = Chapters.list[ci];
    if (onlyChapter && ch.n !== onlyChapter) continue;

    var planned = Chapters.PLANNED[ci] || 0;
    var rooms = ch.rooms || [];
    totalAuthored += rooms.length;

    section('CHAPTER ' + ch.n + ' — ' + ch.title +
      '   ' + rooms.length + '/' + planned + ' rooms');

    if (!rooms.length) {
      pending('chapter ' + ch.n + ' has no rooms yet', planned + ' planned');
      continue;
    }
    if (rooms.length !== planned) {
      fail('chapter ' + ch.n + ' has ' + rooms.length + ' rooms, planned ' + planned,
        'a quietly short campaign is the failure mode this check exists to stop');
    }

    for (var ri = 0; ri < rooms.length; ri++) {
      var entry = rooms[ri];
      var id = entry.id || (ch.n + '-' + padL(ri + 1, 2).replace(/ /g, '0'));
      var row = { id: id, name: entry.name || '', valid: '-', reach: '-',
                  codec: '-', solve: '-', par: null, token: '-' };

      if (seenIds[id]) fail('duplicate room id ' + id, 'room ids must be unique across the campaign');
      seenIds[id] = 1;

      var grid = gridOf(entry);
      if (!grid) {
        fail(id + ': no grid', 'expected entry.grid (or .lines/.rows) as an array of strings');
        row.valid = 'FAIL'; table.push(row); continue;
      }

      var room = Room.fromText(grid, entry.params || null);
      room.name = entry.name || id;

      var v = Room.validate(room);
      if (!v.ok) {
        fail(id + ': invalid room', v.errors.join('\n'));
        row.valid = 'FAIL'; table.push(row); continue;
      }
      row.valid = 'ok';

      var reach = reachability(room);
      if (!reach) {
        fail(id + ': no start', 'reachability cannot run');
        row.reach = 'FAIL'; table.push(row); continue;
      }
      if (!reach.ok) {
        fail(id + ': unreachable content', reach.problems.join('\n'));
        row.reach = 'FAIL';
      } else row.reach = 'ok';

      /* SPEC §7.4 — a shipped room code must still decode to the same room
       * next month, so encode/decode/deep-equal every authored room. */
      if (haveCodec) {
        var rt = codecRoundTrip(room);
        if (rt.ok) row.codec = 'ok';
        else { fail(id + ': codec round-trip', rt.why); row.codec = 'FAIL'; }
      } else row.codec = 'pend';

      /* ---- solver-dependent checks (SPEC §7.1-7.3, §7.5-7.6) ---- */
      if (haveSim) {
        var triv = trivialDirection(room);
        if (triv) {
          fail(id + ': trivially cleared', 'holding ' + DIR_NAME[triv] +
            ' from the start clears this room without a single decision');
          row.reach = row.reach === 'ok' ? 'triv' : row.reach;
        }

        var sol = solveEscalating(room, {});
        if (!sol.ok && sol.status === 'budget') {
          /* MY limit, not the author's room. Never phrased as a defect. */
          warn(id + ': solvability UNKNOWN', sol.reason +
            '\nThis is a limit of my solver, NOT a fault in the room. Do not rewrite it on\n' +
            'account of this line. Par is unset for it and I will come back to it.');
          row.par = null; row.solve = 'unkn';
          unknowns.push(id);
        } else if (!sol.ok) {
          fail(id + ': NOT SOLVABLE', sol.reason +
            (sol.nodes ? '  [' + sol.nodes + ' nodes, ' + sol.ms + 'ms]' : ''));
          row.par = null; row.solve = 'FAIL';
        } else {
          var proof = replayProves(room, sol.inputs);
          if (!proof.ok) {
            fail(id + ': solution does not replay', proof.why);
            row.solve = 'FAIL';
          } else {
            /* A par found on a later rung came from a scrappier search, so it
             * is looser than it looks. Say so rather than let Atlas tune a
             * Swift medal against a number I do not fully trust. */
            row.solve = sol.rungIndex === 0 ? 'ok' : sol.rung;
            row.par = Math.round(sol.ticks * SOLVER.PAR_MARGIN);
            row.raw = sol.ticks;
            row.nodes = sol.nodes;
            parTable[id] = { time: row.par, deaths: 0, rung: sol.rung };
            if (sol.rungIndex > 0) {
              warn(id + ': par is loose', 'solved only at rung "' + sol.rung +
                '", so ' + fmtTicks(row.par) + ' is an upper bound rather than a tight par');
            }

            /* SPEC §7.3 — the token must cost something. Boss's rule to
             * Atlas is "if the token is on the way, the room is wrong", and
             * that is machine-checkable rather than a review-by-eye. */
            if (tokenCells(room).length) {
              var tokRun = solveEscalating(room, { requireToken: true });
              if (!tokRun.ok && tokRun.status === 'budget') {
                warn(id + ': token line UNKNOWN', 'solver limit, not a room fault');
                row.token = 'unkn';
              } else if (!tokRun.ok) {
                fail(id + ': token unreachable on a legal line', tokRun.reason);
                row.token = 'FAIL';
              } else {
                /* A token run also clears the room, so its time is a valid
                 * clear time too. If it came back FASTER than the clear run,
                 * that is proof my clear search was suboptimal, not that the
                 * token is free — a constrained optimum can never beat an
                 * unconstrained one. So take the better of the two as the
                 * clear estimate, which sharpens par as a side effect. */
                var bestClear = Math.min(sol.ticks, tokRun.ticks);
                var cost = tokRun.ticks - bestClear;

                if (bestClear < sol.ticks) {
                  row.par = Math.round(bestClear * SOLVER.PAR_MARGIN);
                  parTable[id] = { time: row.par, deaths: 0, rung: sol.rung };
                }

                if (cost <= 0) {
                  /* Deliberately a warning and not a failure. Both numbers
                   * come from an approximate search, so a zero margin means
                   * "I cannot tell them apart", not "the room is wrong".
                   * Failing here would send an author rewriting a room on
                   * the strength of my search noise. */
                  warn(id + ': token may be on the fast route',
                    'clear ' + fmtTicks(bestClear) + ', with token ' + fmtTicks(tokRun.ticks) +
                    ' — no measurable detour. SPEC §7.3 wants the token on a strictly worse\n' +
                    'line. This needs a human eye: my two searches are approximate and cannot\n' +
                    'resolve a margin this small. Not counted as a failure.');
                  row.token = 'free?';
                } else {
                  row.token = '+' + (cost / 120).toFixed(1) + 's';
                }
              }
            } else {
              row.token = 'none';
            }
          }
        }
      } else {
        row.solve = 'pend';
      }

      table.push(row);
    }
  }

  if (!haveSim) {
    section('SOLVER');
    pending('solvability, par and the token check', 'blocked on BAIT.Sim (Forge)');
  }
  if (!haveReplay) {
    section('REPLAY MODULE');
    pending('ghost round-trip', 'blocked on BAIT.Replay (Forge). Solution replay and the\n' +
      'determinism hash comparison already run inside the solver.');
  }

  /* ------------------------------------------------------------- table --- */
  if (table.length) {
    section('CAMPAIGN TABLE');
    console.log('  ' + C.d + padR('room', 7) + padR('name', 24) + padR('valid', 7) +
      padR('reach', 7) + padR('codec', 7) + padR('solve', 7) + padR('par', 8) + 'token' + C.x);
    for (var t = 0; t < table.length; t++) {
      var r = table[t];
      console.log('  ' + padR(r.id, 7) + padR(r.name, 24) + mark(r.valid, 7) +
        mark(r.reach, 7) + mark(r.codec, 7) + mark(r.solve, 7) +
        padR(fmtTicks(r.par), 8) + mark(r.token, 0));
    }
  }

  /* Par is computed here but lives in Atlas's chapters.js, which is his file
   * and not mine to edit (SPEC §6). So it is written out as data for him to
   * take, rather than patched in behind his back. */
  /* Say this loudly and in one place. An author scanning the table sees
   * "unkn" next to their room and needs to know instantly that it is not a
   * job for them. */
  if (unknowns.length) {
    console.log('\n  ' + C.y + unknowns.length + ' room(s) UNKNOWN, not failed: ' +
      unknowns.join(', ') + C.x);
    console.log('  ' + C.d + 'My solver ran out of budget on these. Nothing is wrong with them.' +
      '\n  Authors: do not touch these on account of this run. They are mine.' + C.x);
  }

  var parKeys = Object.keys(parTable);
  if (parKeys.length) {
    var parPath = path.join(__dirname, 'par.generated.json');
    fs.writeFileSync(parPath, JSON.stringify(parTable, null, 2) + '\n', 'utf8');
    console.log('\n  ' + C.d + 'par for ' + parKeys.length + ' room(s) written to tools/par.generated.json' + C.x);
  }

  section('CAMPAIGN TOTAL');
  if (totalAuthored !== totalPlanned) {
    pending(totalAuthored + ' of ' + totalPlanned + ' rooms authored',
      'SPEC §8 requires all ' + totalPlanned + ' before ship');
  } else {
    pass('all ' + totalPlanned + ' rooms authored');
  }
}

/* Encode, decode, and compare every field that makes a room what it is. A
 * shallow compare here would let a params drift through and only surface
 * months later as a room code that opens the wrong room. */
function codecRoundTrip(room) {
  var Codec = global.BAIT.Codec;
  var code, back;
  try { code = Codec.encode(room); } catch (e) { return { ok: false, why: 'encode threw: ' + e.message }; }
  if (typeof code !== 'string' || !code.length) return { ok: false, why: 'encode did not return a string' };
  try { back = Codec.decode(code); } catch (e) { return { ok: false, why: 'decode threw: ' + e.message }; }
  if (!back) return { ok: false, why: 'decode returned null for a code we just produced' };

  if (back.w !== room.w || back.h !== room.h) {
    return { ok: false, why: 'size changed: ' + room.w + 'x' + room.h + ' -> ' + back.w + 'x' + back.h };
  }
  for (var i = 0; i < room.tiles.length; i++) {
    if (back.tiles[i] !== room.tiles[i]) {
      return { ok: false, why: 'tile ' + i + ' (' + (i % room.w) + ',' + ((i / room.w) | 0) + ') ' +
        room.tiles[i] + ' -> ' + back.tiles[i] };
    }
  }
  for (var k in room.params) {
    if (!Object.prototype.hasOwnProperty.call(room.params, k)) continue;
    var a = room.params[k], b = back.params[k];
    if (!b) return { ok: false, why: 'params at cell ' + k + ' lost in round-trip' };
    for (var f in a) {
      if (Object.prototype.hasOwnProperty.call(a, f) && a[f] !== b[f]) {
        return { ok: false, why: 'param ' + f + ' at cell ' + k + ': ' + a[f] + ' -> ' + b[f] };
      }
    }
  }
  if (back.start.x !== room.start.x || back.start.y !== room.start.y) {
    return { ok: false, why: 'start moved' };
  }
  /* SPEC §5.1 targets a typical room under ~120 characters. */
  if (code.length > 200) return { ok: false, why: 'code is ' + code.length + ' chars, target is ~120 (SPEC §5.1)' };
  return { ok: true, len: code.length };
}

/* ============================================================= self-test == *
 * A verifier nobody has tested is just an opinion. These are hand-built rooms
 * with known answers, so a regression in the solver shows up as a failing
 * self-test rather than as eighty rooms quietly mis-parred.
 *
 * Run it with --selftest, and it also runs as part of a full pass.
 */
var SELFTEST = [
  {
    name: 'straight corridor is trivial',
    grid: ['############',
           '#S........E#',
           '#..........#',
           '############'],
    expect: { trivial: true }
  },
  {
    name: 'key detour is solvable and not trivial',
    grid: ['############',
           '#S........k#',
           '#.##########',
           '#..........#',
           '##########.#',
           '#E.........#',
           '############'],
    expect: { trivial: false, solvable: true }
  },
  {
    name: 'walled-off exit is unreachable',
    grid: ['############',
           '#S.........#',
           '#..........#',
           '#....####..#',
           '#....#E#...#',
           '#....####..#',
           '############'],
    expect: { reachable: false }
  },
  {
    name: 'token on the through-route is rejected',
    grid: ['############',
           '#S........k#',
           '#.##########',
           '#....o.....#',
           '##########.#',
           '#E.........#',
           '############'],
    expect: { trivial: false, solvable: true, tokenFree: true }
  },
  {
    /* The token hangs two cells below the through-corridor in a capped spur,
     * so taking it costs a there-and-back that the clear route never pays. */
    name: 'token in a dead-end alcove costs time',
    grid: ['##############',
           '#S..........k#',
           '############.#',
           '#............#',
           '#.####.#######',
           '#E####o#######',
           '##############'],
    expect: { trivial: false, solvable: true, tokenFree: false }
  }
];

function runSelfTest() {
  section('SELF-TEST — the verifier checked against known answers');
  var Room = global.BAIT.Room;

  for (var i = 0; i < SELFTEST.length; i++) {
    var c = SELFTEST[i];
    var room = Room.fromText(c.grid, c.params || null);
    var v = Room.validate(room);
    if (!v.ok) { fail('selftest "' + c.name + '": room does not validate', v.errors.join('\n')); continue; }

    /* Every self-test room is also a codec fixture. This exercises encode /
     * decode / deep-equal today, without waiting on authored content. */
    if (global.BAIT.Codec) {
      var crt = codecRoundTrip(room);
      if (!crt.ok) fail('selftest "' + c.name + '": codec round-trip', crt.why);
      else pass('selftest codec: ' + c.name + '  ' + C.d + '(' + crt.len + ' chars)' + C.x);
    }

    var reach = reachability(room);
    if (c.expect.reachable === false) {
      if (reach.ok) fail('selftest "' + c.name + '"', 'expected unreachable content, fill said everything is reachable');
      else pass('selftest: ' + c.name + '  ' + C.d + '(' + reach.problems[0] + ')' + C.x);
      continue;
    }
    if (!reach.ok) { fail('selftest "' + c.name + '": unexpected unreachable content', reach.problems.join('\n')); continue; }

    if (c.expect.trivial !== undefined) {
      var triv = trivialDirection(room);
      if (c.expect.trivial && !triv) { fail('selftest "' + c.name + '"', 'expected a trivial hold-one-direction clear, found none'); continue; }
      if (!c.expect.trivial && triv) { fail('selftest "' + c.name + '"', 'unexpectedly cleared by holding ' + DIR_NAME[triv]); continue; }
      if (c.expect.trivial) { pass('selftest: ' + c.name + '  ' + C.d + '(holding ' + DIR_NAME[triv] + ')' + C.x); continue; }
    }

    if (c.expect.solvable) {
      var sol = solve(room, {});
      if (!sol.ok) { fail('selftest "' + c.name + '": solver failed a room that is solvable by hand', sol.reason); continue; }
      var proof = replayProves(room, sol.inputs);
      if (!proof.ok) { fail('selftest "' + c.name + '": solution does not replay', proof.why); continue; }

      if (c.expect.tokenFree !== undefined) {
        var tok = solve(room, { requireToken: true });
        if (!tok.ok) { fail('selftest "' + c.name + '": token run failed', tok.reason); continue; }
        var free = tok.ticks <= sol.ticks;
        if (free !== c.expect.tokenFree) {
          fail('selftest "' + c.name + '"', 'expected tokenFree=' + c.expect.tokenFree +
            ', got clear ' + fmtTicks(sol.ticks) + ' vs token ' + fmtTicks(tok.ticks));
          continue;
        }
        pass('selftest: ' + c.name + '  ' + C.d + '(clear ' + fmtTicks(sol.ticks) +
          ', token ' + fmtTicks(tok.ticks) + ', ' + sol.nodes + ' nodes)' + C.x);
        continue;
      }
      pass('selftest: ' + c.name + '  ' + C.d + '(' + fmtTicks(sol.ticks) + ', ' +
        sol.nodes + ' nodes)' + C.x);
    }
  }
}

/* ================================================================ replay == *
 * SPEC §4.4 and §7.5. Ghosts and the workshop prove-gate both rest on an
 * input list surviving a round-trip through the RLE string form and still
 * producing the identical run. A ghost that decodes to a slightly different
 * input list is worse than no ghost: it desyncs from the run it claims to be.
 */
function checkReplay() {
  section('REPLAY — ghost strings round-trip and still clear (SPEC §4.4)');
  var Replay = global.BAIT.Replay, Room = global.BAIT.Room;
  if (!Replay) { pending('replay round-trip', 'needs BAIT.Replay'); return; }

  /* A real solved room gives a real input list, which is a far better fixture
   * than a synthetic one: it has long runs, direction changes and a clear. */
  var room = Room.fromText(SELFTEST[1].grid, null);
  var sol = solve(room, {});
  if (!sol.ok) { fail('replay fixture', 'could not solve the fixture room: ' + sol.reason); return; }

  var s = Replay.toString(sol.inputs);
  var back = Replay.fromString(s);

  if (back.length !== sol.inputs.length) {
    fail('replay round-trip changed length', sol.inputs.length + ' dirs in, ' + back.length + ' out');
  } else {
    var drift = -1;
    for (var i = 0; i < back.length; i++) if (back[i] !== sol.inputs[i]) { drift = i; break; }
    if (drift >= 0) fail('replay round-trip changed input', 'first difference at tick ' + drift);
    else pass('ghost round-trips exactly  ' + C.d + '(' + sol.inputs.length + ' ticks -> ' +
      s.length + ' chars, ' + (s.length / sol.inputs.length).toFixed(2) + ' chars/tick)' + C.x);
  }

  if (!Replay.clears(room, s)) {
    fail('replay does not clear', 'the RLE string of a winning run must still clear the room');
  } else pass('the round-tripped ghost still clears the room');

  /* Ghosts arrive from a corrupted save or a hand-edited localStorage blob,
   * so the parser is hostile-input surface too. */
  var threw = [];
  var junk = ['', ' ', 'zzzz', '999999999999', ' ', s + s, s.slice(0, 3),
              'x'.repeat(100000), null, undefined, 0, {}, []];
  for (var j = 0; j < junk.length; j++) {
    try { Replay.parse(junk[j]); Replay.fromString(junk[j]); }
    catch (e) { threw.push(String(junk[j]).slice(0, 20) + ' -> ' + e.message); }
  }
  if (threw.length) fail('replay parser threw on corrupt input', threw.slice(0, 4).join('\n'));
  else pass('replay parser survives corrupt ghosts');
}

/* ================================================================= daily == *
 * SPEC §4.2 and §7. Everyone on earth gets the same five rooms with no
 * server, so a single unsolvable generated room is a global outage with no
 * way to hotfix it. Relay exposes VERIFIED_UNTIL for exactly this, so the
 * constant the game trusts and the proof behind it cannot drift apart.
 */
function checkDaily(days) {
  section('DAILY — generated gauntlets are solvable (SPEC §4.2)');
  var Daily = global.BAIT.Daily;
  if (!Daily) { pending('daily verification', 'needs BAIT.Daily (Relay)'); return; }

  var seed = Daily.todaySeed();
  var checked = 0, roomsChecked = 0, broken = 0;
  var started = Date.now();

  for (var d = 0; d < days; d++) {
    var s = seedPlusDays(seed, d);
    if (s > Daily.VERIFIED_UNTIL) {
      pass('reached VERIFIED_UNTIL ' + Daily.VERIFIED_UNTIL + ' after ' + checked + ' days');
      break;
    }
    var rooms;
    try { rooms = Daily.generate(s); }
    catch (e) { fail('daily ' + s + ' threw during generation', e.message); broken++; continue; }

    if (!rooms || rooms.length !== 5) {
      fail('daily ' + s + ' produced ' + (rooms ? rooms.length : 0) + ' rooms, expected 5');
      broken++; continue;
    }

    for (var r = 0; r < rooms.length; r++) {
      roomsChecked++;
      var room = rooms[r];
      var v = global.BAIT.Room.validate(room);
      if (!v.ok) { fail('daily ' + s + ' room ' + (r + 1) + ' invalid', v.errors.slice(0, 3).join('\n')); broken++; continue; }

      var reach = reachability(room);
      if (reach && !reach.ok) { fail('daily ' + s + ' room ' + (r + 1) + ' unreachable', reach.problems[0]); broken++; continue; }

      var sol = solveEscalating(room, {});
      if (!sol.ok && sol.status === 'budget') {
        warn('daily ' + s + ' room ' + (r + 1) + ' UNKNOWN', 'solver limit, not a generator fault');
        continue;
      }
      if (!sol.ok) { fail('daily ' + s + ' room ' + (r + 1) + ' NOT SOLVABLE', sol.reason); broken++; continue; }
      var proof = replayProves(room, sol.inputs);
      if (!proof.ok) { fail('daily ' + s + ' room ' + (r + 1) + ' does not replay', proof.why); broken++; }
    }
    checked++;
  }

  var secs = ((Date.now() - started) / 1000).toFixed(1);
  if (!broken) {
    pass(checked + ' daily gauntlet(s), ' + roomsChecked + ' rooms, all solvable  ' +
      C.d + '(' + secs + 's)' + C.x);
  }
  if (days < 365) {
    console.log('  ' + C.d + 'checked ' + checked + ' days. --days 365 for the full window, ' +
      'which is the SPEC §7 requirement and takes considerably longer.' + C.x);
  }
}

/* YYYYMMDD + n days, via UTC so it cannot drift on a DST boundary. */
function seedPlusDays(seed, n) {
  var y = (seed / 10000) | 0, m = ((seed / 100) | 0) % 100, d = seed % 100;
  var t = new Date(Date.UTC(y, m - 1, d + n));
  return t.getUTCFullYear() * 10000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate();
}

/* ========================================================== hostile input = *
 * SPEC §0.6 and §5.1. A room code arrives by being pasted out of Discord by a
 * stranger. It must not be able to throw past the parser, hang the loop, or
 * hand the sim a room that is not a room.
 *
 * Seeded from BAIT.Rng, so this fuzz is deterministic: a failure reported
 * here reproduces exactly on someone else's machine.
 */
function fuzzCodec() {
  section('HOSTILE INPUT — pasted room codes are untrusted (SPEC §0.6)');
  var Codec = global.BAIT.Codec, Rng = global.BAIT.Rng, P = global.BAIT.Pieces;
  var K = P.K;
  if (!Codec || !Rng) { pending('codec fuzz', 'needs BAIT.Codec and BAIT.Rng'); return; }

  var rng = Rng.create(0x5EEDBA17);
  var ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var threw = [], hung = [], monsters = [];
  var checked = 0, nulls = 0, rooms = 0;

  function attempt(label, value) {
    checked++;
    var t0 = Date.now(), out;
    try {
      out = Codec.decode(value);
    } catch (e) {
      threw.push(label + ' -> ' + (e && e.message ? e.message : String(e)));
      return;
    }
    var ms = Date.now() - t0;
    if (ms > 250) hung.push(label + ' took ' + ms + 'ms');

    if (out === null || out === undefined) { nulls++; return; }
    rooms++;

    /* If it did decode, the result must be a room the sim can survive being
     * handed. A decoder that returns a 900x900 grid is as bad as one that
     * throws — worse, because it fails later and somewhere else. */
    if (typeof out !== 'object' || !out.tiles) { monsters.push(label + ' -> not a room object'); return; }
    if (!(out.w >= 4 && out.h >= 4 && out.w <= K.GRID_W && out.h <= K.GRID_H)) {
      monsters.push(label + ' -> ' + out.w + 'x' + out.h + ' is outside legal bounds'); return;
    }
    if (out.tiles.length !== out.w * out.h) {
      monsters.push(label + ' -> tiles length ' + out.tiles.length + ' != ' + out.w + '*' + out.h); return;
    }
    for (var i = 0; i < out.tiles.length; i++) {
      if (!P.def(out.tiles[i])) { monsters.push(label + ' -> unknown tile id ' + out.tiles[i]); return; }
    }
    if (!out.start || !(out.start.x >= 0 && out.start.x < out.w && out.start.y >= 0 && out.start.y < out.h)) {
      monsters.push(label + ' -> start outside the room'); return;
    }
  }

  /* 1. things that are not strings at all */
  [null, undefined, 0, 1, -1, NaN, true, false, {}, [], function () {}].forEach(function (v, i) {
    attempt('non-string #' + i, v);
  });

  /* 2. empty and whitespace */
  ['', ' ', '\n', '\t\t', '   '].forEach(function (v, i) { attempt('blank #' + i, v); });

  /* 3. random garbage, including characters outside the base64url alphabet */
  for (var g = 0; g < 1500; g++) {
    var len = rng.int(200) + 1, s = '';
    for (var j = 0; j < len; j++) s += String.fromCharCode(rng.int(126 - 32) + 32);
    attempt('garbage len ' + len, s);
  }

  /* 4. strings drawn only from the real alphabet, which get much further into
   *    the parser than random punctuation does */
  for (var a = 0; a < 1500; a++) {
    var alen = rng.int(180) + 1, as = '';
    for (var b = 0; b < alen; b++) as += ALPHABET.charAt(rng.int(ALPHABET.length));
    attempt('alphabet len ' + alen, as);
  }

  /* 5. real codes, mutated and truncated — the highest-yield class, because
   *    they pass every early sanity check and fail deep in the parser */
  var Room = global.BAIT.Room;
  var seedRoom = Room.fromText(SELFTEST[1].grid, null);
  var good;
  try { good = Codec.encode(seedRoom); } catch (e) { good = null; }
  if (good) {
    for (var t = 0; t <= good.length; t++) attempt('truncated to ' + t, good.slice(0, t));
    for (var m = 0; m < 1200; m++) {
      var pos = rng.int(good.length);
      var ch = ALPHABET.charAt(rng.int(ALPHABET.length));
      attempt('mutated at ' + pos, good.slice(0, pos) + ch + good.slice(pos + 1));
    }
    /* duplicated and concatenated codes */
    attempt('doubled', good + good);
    attempt('prefixed', 'xx' + good);
    attempt('with url fragment', 'index.html#r=' + good);
  }

  /* 6. absurd length — must be rejected on sight, not parsed */
  attempt('100k chars', new Array(100001).join('A'));
  attempt('1M chars', new Array(1000001).join('B'));

  if (threw.length) {
    fail('decode threw on hostile input (' + threw.length + ' of ' + checked + ')',
      threw.slice(0, 5).join('\n') + (threw.length > 5 ? '\n... and ' + (threw.length - 5) + ' more' : ''));
  } else {
    pass('decode never threw across ' + checked + ' hostile inputs');
  }
  if (hung.length) {
    fail('decode was slow on hostile input', hung.slice(0, 5).join('\n'));
  }
  if (monsters.length) {
    fail('decode returned a structurally illegal room (' + monsters.length + ')',
      monsters.slice(0, 5).join('\n'));
  } else if (rooms) {
    pass(rooms + ' hostile input(s) decoded, every one structurally legal');
  }
  console.log('  ' + C.d + checked + ' inputs: ' + nulls + ' rejected as invalid, ' +
    rooms + ' decoded to a legal room' + C.x);
}

/* =================================================================== main = */

function main() {
  var args = process.argv.slice(2);

  if (args.indexOf('--help') !== -1) {
    console.log([
      'node tools/verify.cjs [options]',
      '',
      '  --lint            source hygiene only',
      '  --file <path>     lint one file (implies --lint). Check your own core',
      '                    file before you hand it over.',
      '  --chapter <n>     restrict room checks to one chapter',
      '  --days <n>        daily gauntlets to verify from today (default 14)',
      '  --release         verify the full 365-day window (SPEC §7). Slow.',
      '',
      'exit 0 shippable, 1 real failure, 2 incomplete'
    ].join('\n'));
    return 0;
  }

  var only = [], onlyChapter = 0, days = 14;
  for (var a = 0; a < args.length; a++) {
    if (args[a] === '--file' && args[a + 1]) only.push(args[++a].replace(/\\/g, '/'));
    if (args[a] === '--chapter' && args[a + 1]) onlyChapter = parseInt(args[++a], 10) || 0;
    if (args[a] === '--days' && args[a + 1]) days = parseInt(args[++a], 10) || 0;
    if (args[a] === '--release') days = 365;
  }
  var lintOnly = args.indexOf('--lint') !== -1 || only.length > 0;

  console.log(C.B + 'BAIT verifier' + C.x + '  ' + C.d + ROOT + C.x);

  section('SOURCE HYGIENE — src/core must load under plain Node (SPEC §0.4)');
  (only.length ? only : CORE).forEach(lintFile);

  if (lintOnly) {
    section('SUMMARY');
    console.log('  ' + R.pass + ' pass, ' + R.fail + ' fail, ' + R.pending + ' pending, ' + R.warn + ' warn');
    if (R.fail) { console.log('\n' + C.r + 'HYGIENE FAILED' + C.x); return 1; }
    console.log('\n' + C.g + 'HYGIENE CLEAN' + C.x + ' on everything written so far.');
    return 0;
  }

  global.BAIT = global.BAIT || {};

  section('CORE LOAD — the same files the browser ships');
  var coreOk = loadAll(CORE, 'core');

  section('CONTENT LOAD');
  var contentOk = loadAll(CONTENT, 'content');

  if (global.BAIT.Room && global.BAIT.Sim) runSelfTest();
  if (global.BAIT.Codec) fuzzCodec();
  if (global.BAIT.Replay && global.BAIT.Sim) checkReplay();

  if (args.indexOf('--selftest') !== -1) {
    section('SUMMARY');
    console.log('  ' + R.pass + ' pass, ' + R.fail + ' fail, ' + R.pending + ' pending');
    return R.fail ? 1 : 0;
  }

  if (coreOk === false && !global.BAIT.Room) {
    section('ROOMS');
    pending('every room check', 'core is not loadable yet');
  } else if (!contentOk || !global.BAIT.Chapters) {
    section('ROOMS');
    pending('every room check', 'src/data/chapters.js is not loadable yet');
  } else {
    checkRooms(onlyChapter);
  }

  if (global.BAIT.Daily && global.BAIT.Sim && !onlyChapter) checkDaily(days);

  /* -------------------------------------------------------------- summary */
  section('SUMMARY');
  console.log('  ' + R.pass + ' pass, ' + C.r + R.fail + ' fail' + C.x + ', ' +
    R.pending + ' pending, ' + R.warn + ' warn');

  if (R.fail) {
    console.log('\n' + C.r + C.B + 'NOT SHIPPABLE' + C.x + ' — ' + R.fail + ' failure(s):');
    failures.forEach(function (f) { console.log('  ' + C.r + '-' + C.x + ' ' + f.what); });
    return 1;
  }
  if (R.pending) {
    console.log('\n' + C.y + C.B + 'INCOMPLETE' + C.x + ' — ' + R.pending +
      ' check(s) pending. Nothing is broken; it is not finished.');
    pendings.slice(0, 12).forEach(function (p) { console.log('  ' + C.y + '-' + C.x + ' ' + p.what); });
    if (pendings.length > 12) console.log('  ' + C.d + '... and ' + (pendings.length - 12) + ' more' + C.x);
    return 2;
  }
  console.log('\n' + C.g + C.B + 'ALL GREEN' + C.x +
    ' — every room solvable, par computed, token on a worse line, codec round-trips, determinism holds.');
  return 0;
}

process.exit(main());
