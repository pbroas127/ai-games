/* BAIT — the room editor.
 *
 * OWNER: Chisel. Paired with src/ui/workshop.js (library, publish, import).
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE (SPEC §1, WORKSHOP):
 *   You cannot publish a room you have not cleared yourself. `proved` is set
 *   in exactly one place — a Play session with origin 'editor' that reached
 *   the real exit — and cleared in exactly one place, mutate(). Everything
 *   else in this file is convenience around that gate.
 *
 * The winning run's inputs are kept as the AUTHOR GHOST. It is proof the room
 * is solvable and it is the ghost other players race, which is why the proof
 * and the ghost are the same object rather than two things that can disagree.
 *
 * THE TEST BUTTON DOES NOT RUN ITS OWN SIM. It calls BAIT.Play.begin with
 * origin 'editor', the same path a stranger playing your published code
 * takes. A second play path would mean the thing you proved is not the thing
 * they play, which would make the gate a lie.
 *
 * NO HEX LITERALS (SPEC §3): overlay colours come from BAIT.Theme.c, chrome
 * is styled by Ink's class system in style.css.
 *
 * DOM CONTRACT: #ui is pointer-events:none and `#ui > *` gets them back, so
 * this file appends TWO direct children (a bar and a rail) rather than one
 * full-bleed wrapper. A wrapper spanning the viewport would swallow every
 * click meant for the grid. The gap between bar and rail is bare #ui, so
 * clicks fall through to the canvas exactly where they should.
 */
(function (BAIT) {
  'use strict';

  var P = BAIT.Pieces, K = P.K, TILE = P.TILE;

  /* Resolved lazily: boot order puts us after these, but a module with a
   * syntax error registers nothing and we must not take the boot down. */
  function Room()   { return BAIT.Room; }
  function Codec()  { return BAIT.Codec; }
  function Theme()  { return BAIT.Theme; }
  function Play()   { return BAIT.Play; }
  function Modes()  { return BAIT.Modes; }
  function Replay() { return BAIT.Replay; }

  /* ------------------------------------------------------------- palette --
   * DATA-DRIVEN, per Boss: the rail is built from Pieces.LIST, so a piece
   * added to the table later appears here with no edit to this file. GROUP_OF
   * is only a presentation hint; anything the hint does not mention lands in
   * a trailing group automatically rather than vanishing.
   */
  var GROUP_ORDER = ['STRUCTURE', 'FLOW', 'ON A CLOCK', 'LOGIC', 'MARKS', 'MORE'];
  var GROUP_OF = {};
  GROUP_OF[TILE.WALL] = 'STRUCTURE';   GROUP_OF[TILE.PIT] = 'STRUCTURE';
  GROUP_OF[TILE.FALLER] = 'STRUCTURE';
  GROUP_OF[TILE.DEFLECT] = 'FLOW';     GROUP_OF[TILE.CONVEY] = 'FLOW';
  GROUP_OF[TILE.TELEPORT] = 'FLOW';
  GROUP_OF[TILE.TURRET] = 'ON A CLOCK';GROUP_OF[TILE.ROTOR] = 'ON A CLOCK';
  GROUP_OF[TILE.PHASE] = 'ON A CLOCK';
  GROUP_OF[TILE.GATE] = 'LOGIC';       GROUP_OF[TILE.PLATE] = 'LOGIC';
  GROUP_OF[TILE.KEY] = 'LOGIC';
  GROUP_OF[TILE.START] = 'MARKS';      GROUP_OF[TILE.EXIT] = 'MARKS';
  GROUP_OF[TILE.TOKEN] = 'MARKS';      GROUP_OF[TILE.MIMIC] = 'MARKS';

  /* Built fresh on every mount so a piece added to the table between mounts
   * still shows up. Returns [{name, ids:[]}] in GROUP_ORDER. */
  function paletteGroups() {
    var bucket = {}, order = [];
    for (var i = 0; i < P.LIST.length; i++) {
      var d = P.LIST[i];
      if (d.id === TILE.EMPTY) continue;          // that is the eraser
      var g = GROUP_OF[d.id] || 'MORE';
      if (!bucket[g]) { bucket[g] = []; order.push(g); }
      bucket[g].push(d.id);
    }
    var out = [];
    GROUP_ORDER.forEach(function (g) { if (bucket[g]) out.push({ name: g, ids: bucket[g] }); });
    order.forEach(function (g) {
      if (GROUP_ORDER.indexOf(g) < 0) out.push({ name: g, ids: bucket[g] });
    });
    return out;
  }

  /* Shortcuts are handed out in palette order, so they follow the table too. */
  var KEYS = ['1','2','3','4','5','6','7','8','9','0','q','w','e','r','t','y','u','i'];
  var ERASE_KEY = 'x';

  /* Pieces the room may hold exactly one of. Derived from the table's own
   * `unique` flag rather than a second list that could drift from it. */
  function isUnique(id) { var d = P.def(id); return !!(d && d.unique); }

  /* --------------------------------------------------------- dom helpers -- */

  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function text(tag, cls, str) {
    var n = el(tag, cls);
    n.textContent = str;
    return n;
  }

  function button(cls, label, fn) {
    var b = el('button', cls);
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }

  /* ---------------------------------------------------------------- state -- */

  var ed = null;

  function freshState(room) {
    return {
      room: room,
      tool: TILE.WALL,
      params: {},
      cursor: { cx: 0, cy: 0 },
      hover: null,
      selected: null,
      painting: 0,
      undo: [], redo: [],
      proved: false,
      rev: 0,
      ghostNote: '',         // why a stored proof was rejected, shown on the gate
      authorGhost: null,     // {rle, ticks, at} — the winning run, kept as proof
      dirtySinceSave: false,
      issues: [],
      entryId: null,         // workshop.mine id when editing a saved room
      host: null, els: {}, canvas: null, ctx: null,
      unsubModes: null,
      onExit: null, onTest: null, onPublish: null
    };
  }

  /* --------------------------------------------------------------- budget -- */

  function spend(room) {
    var total = 0;
    for (var i = 0; i < room.tiles.length; i++) {
      var d = P.def(room.tiles[i]);
      if (d) total += d.cost || 0;
    }
    return total;
  }

  function budgetLeft(room) { return K.EDITOR_BUDGET - spend(room); }

  function canAfford(room, id, replacingId) {
    var add = (P.def(id) && P.def(id).cost) || 0;
    var back = (P.def(replacingId) && P.def(replacingId).cost) || 0;
    return spend(room) - back + add <= K.EDITOR_BUDGET;
  }

  /* ----------------------------------------------------------------- undo --
   * The room is 280 cells, so a snapshot is cheaper in engineer-hours than a
   * command log and cannot drift out of sync with the model. */
  var UNDO_CAP = 100;

  function snapshot(room) {
    return {
      tiles: room.tiles.slice(0),
      params: JSON.parse(JSON.stringify(room.params || {})),
      name: room.name || '',
      start: room.start ? { x: room.start.x, y: room.start.y } : null
    };
  }

  function restore(room, snap) {
    room.tiles.set(snap.tiles);
    room.params = JSON.parse(JSON.stringify(snap.params));
    room.name = snap.name;
    room.start = snap.start ? { x: snap.start.x, y: snap.start.y } : room.start;
  }

  function sameSnap(a, b) {
    if (a.name !== b.name) return false;
    for (var i = 0; i < a.tiles.length; i++) if (a.tiles[i] !== b.tiles[i]) return false;
    return JSON.stringify(a.params) === JSON.stringify(b.params);
  }

  /* Every model mutation goes through here, because this is the only place
   * allowed to void the proof. */
  function mutate(fn) {
    var before = snapshot(ed.room);
    fn(ed.room);
    syncStart(ed.room);
    var after = snapshot(ed.room);
    if (sameSnap(before, after)) return false;

    ed.undo.push(before);
    if (ed.undo.length > UNDO_CAP) ed.undo.shift();
    ed.redo.length = 0;

    bumpRev();
    voidProof();
    ed.dirtySinceSave = true;
    revalidate();
    refresh();
    return true;
  }

  /* Ink's static-layer cache is keyed on room.rev, so an edit that does not
   * bump it paints the OLD room forever. */
  function bumpRev() {
    ed.room.rev = (ed.room.rev | 0) + 1;
    ed.rev = ed.room.rev;
  }

  /* The room changed, so the run that cleared it proved nothing about this
   * room. The ghost goes with it: a ghost recorded against a different layout
   * would walk through walls. */
  function voidProof() {
    ed.proved = false;
    ed.authorGhost = null;
    /* The note explained a ghost against the room as it was loaded. Once the
     * author edits, it is answering a question nobody is asking any more. */
    ed.ghostNote = '';
  }

  /* Room.start is a real field in Forge's shape, not derived, so it has to be
   * kept in step with wherever the START tile actually sits. */
  function syncStart(room) {
    for (var i = 0; i < room.tiles.length; i++) {
      if (room.tiles[i] === TILE.START) {
        room.start = { x: i % room.w, y: (i / room.w) | 0 };
        return;
      }
    }
  }

  function undo() {
    if (!ed.undo.length) return;
    ed.redo.push(snapshot(ed.room));
    restore(ed.room, ed.undo.pop());
    bumpRev();
    voidProof();
    revalidate(); refresh();
  }

  function redo() {
    if (!ed.redo.length) return;
    ed.undo.push(snapshot(ed.room));
    restore(ed.room, ed.redo.pop());
    bumpRev();
    voidProof();
    revalidate(); refresh();
  }

  /* ------------------------------------------------------------ placement -- */

  function idxOf(room, cx, cy) { return cy * room.w + cx; }

  function inBounds(room, cx, cy) {
    return cx >= 0 && cy >= 0 && cx < room.w && cy < room.h;
  }

  function tileAt(room, cx, cy) {
    return inBounds(room, cx, cy) ? room.tiles[idxOf(room, cx, cy)] : TILE.WALL;
  }

  function paramsAt(room, cx, cy) {
    return (room.params && room.params[idxOf(room, cx, cy)]) || null;
  }

  /* Sticky per-piece params: the difference between placing eight south
   * turrets and placing eight east turrets and fixing them one at a time. */
  function pendingParams(id) {
    if (!ed.params[id]) ed.params[id] = P.defaults(id);
    return ed.params[id];
  }

  function writeCell(room, cx, cy, id, params) {
    var i = idxOf(room, cx, cy);
    room.tiles[i] = id;
    if (!room.params) room.params = {};
    var def = P.def(id);
    if (def && def.params.length) {
      var out = {};
      for (var j = 0; j < def.params.length; j++) {
        var f = def.params[j];
        out[f] = P.clampParam(f, params && f in params ? params[f] : P.defaults(id)[f]);
      }
      room.params[i] = out;
    } else {
      delete room.params[i];
    }
  }

  function place(cx, cy, id) {
    if (!inBounds(ed.room, cx, cy)) return;
    var def = P.def(id);
    if (!def) return;
    var existing = tileAt(ed.room, cx, cy);
    var existingParams = paramsAt(ed.room, cx, cy);
    var want = pendingParams(id);

    /* Dragging across a cell you already painted must not stack a hundred
     * identical undo entries. */
    if (existing === id && !def.params.length) return;
    if (existing === id && existingParams && sameParams(existingParams, want)) return;

    /* Going over budget is impossible rather than an error (Boss). */
    if (!canAfford(ed.room, id, existing)) { denyBudget(def); return; }

    mutate(function (room) {
      if (isUnique(id)) clearAll(room, id);
      writeCell(room, cx, cy, id, want);
    });
    ed.selected = { cx: cx, cy: cy };
  }

  function erase(cx, cy) {
    if (!inBounds(ed.room, cx, cy)) return;
    if (tileAt(ed.room, cx, cy) === TILE.EMPTY) return;
    mutate(function (room) { writeCell(room, cx, cy, TILE.EMPTY, null); });
    if (ed.selected && ed.selected.cx === cx && ed.selected.cy === cy) ed.selected = null;
  }

  function clearAll(room, id) {
    for (var i = 0; i < room.tiles.length; i++) {
      if (room.tiles[i] === id) {
        room.tiles[i] = TILE.EMPTY;
        if (room.params) delete room.params[i];
      }
    }
  }

  function sameParams(a, b) {
    var k;
    for (k in a) if (a[k] !== b[k]) return false;
    for (k in b) if (a[k] !== b[k]) return false;
    return true;
  }

  function count(room, id) {
    var n = 0;
    for (var i = 0; i < room.tiles.length; i++) if (room.tiles[i] === id) n++;
    return n;
  }

  function findFirst(room, id) {
    for (var i = 0; i < room.tiles.length; i++) {
      if (room.tiles[i] === id) return { cx: i % room.w, cy: (i / room.w) | 0 };
    }
    return null;
  }

  function each(room, fn) {
    for (var i = 0; i < room.tiles.length; i++) {
      var id = room.tiles[i];
      if (id === TILE.EMPTY) continue;
      fn(i % room.w, (i / room.w) | 0, id, (room.params && room.params[i]) || {});
    }
  }

  /* ----------------------------------------------------------- validation --
   * Room.validate() is the engine's structural authority. On top of it sit the
   * authoring rules that only matter while building. Every note carries a cell
   * so clicking it takes you there.
   */
  function revalidate() {
    var room = ed.room, out = [];

    if (count(room, TILE.START) === 0) out.push(issue('no-start', 'No start. Place one.', null));
    var exits = count(room, TILE.EXIT);
    if (exits === 0) out.push(issue('no-exit', 'No exit. Place one.', null));

    var plateLinks = {}, gateLinks = {}, ports = {};
    each(room, function (cx, cy, id, prm) {
      var at = { cx: cx, cy: cy };
      if (id === TILE.PLATE) (plateLinks[prm.link] = plateLinks[prm.link] || []).push(at);
      if (id === TILE.GATE) (gateLinks[prm.link] = gateLinks[prm.link] || []).push(at);
      if (id === TILE.TELEPORT) (ports[prm.link] = ports[prm.link] || []).push(at);
    });

    Object.keys(gateLinks).forEach(function (link) {
      if (!plateLinks[link]) {
        out.push(issue('gate-orphan',
          'Gate ' + link + ' has no plate. It is just a wall.', gateLinks[link][0]));
      }
    });
    Object.keys(plateLinks).forEach(function (link) {
      if (!gateLinks[link]) {
        out.push(issue('plate-orphan', 'Plate ' + link + ' opens nothing.', plateLinks[link][0]));
      }
    });
    Object.keys(ports).forEach(function (link) {
      var n = ports[link].length;
      if (n !== 2) {
        out.push(issue('teleport-pair',
          'Teleport ' + link + ' has ' + n + ' end' + (n === 1 ? '' : 's') + '. It needs two.',
          ports[link][0]));
      }
    });

    if (count(room, TILE.MIMIC) > 0 && exits === 0) {
      out.push(issue('mimic-alone',
        'A mimic with no real exit is not a trap, it is a dead end.',
        findFirst(room, TILE.MIMIC)));
    }

    /* "Not trivially empty" from Boss's brief: a room with nothing in it
     * between start and exit is not a room. */
    if (spend(room) === 0 && exits > 0) {
      out.push(issue('empty', 'Nothing in the room yet.', null));
    }

    var over = spend(room) - K.EDITOR_BUDGET;
    if (over > 0) out.push(issue('over-budget', 'Over budget by ' + over + '.', null));

    var R = Room();
    if (R && typeof R.validate === 'function') {
      var v;
      try { v = R.validate(room); } catch (err) { v = null; }
      if (v && !v.ok && v.errors) {
        for (var i = 0; i < v.errors.length; i++) {
          var e = v.errors[i];
          /* Do not double-report what we already said in our own words. */
          if (dupe(out, e)) continue;
          out.push(issue(e.code || 'room', e.msg || String(e),
            (typeof e.cx === 'number') ? { cx: e.cx, cy: e.cy } : null));
        }
      }
    }

    ed.issues = out;
    return out;
  }

  function dupe(list, e) {
    for (var i = 0; i < list.length; i++) if (list[i].code === e.code) return true;
    return false;
  }

  function issue(code, msg, at) { return { code: code, msg: msg, at: at || null }; }

  /* Blocking notes stop a test run. Advisory ones do not: you are allowed to
   * test a work in progress. Publish demands a clean sheet AND the proof. */
  var BLOCKING = ['no-start', 'no-exit', 'over-budget', 'empty'];

  function blockers() {
    return ed.issues.filter(function (i) { return BLOCKING.indexOf(i.code) >= 0; });
  }

  function canTest()    { return blockers().length === 0; }
  function canPublish() { return ed.issues.length === 0 && ed.proved && !!ed.authorGhost; }

  /* ------------------------------------------------------------- test run --
   * One play path for the whole game. Play.begin runs the same Sim a stranger
   * runs; on a clear it pushes Modes to 'results' with origin 'editor', and
   * the subscription below is where the proof and the author ghost land.
   */
  function test() {
    if (!canTest()) { announce(blockers()[0].msg); return; }

    /* Test-only override, used by the headless harness. Production goes
     * through Play. */
    if (typeof ed.onTest === 'function') {
      ed.onTest(cloneRoom(ed.room), function (result) { takeResult(result); });
      return;
    }

    /* Play.begin does the Modes.go('playing') itself, so we must not do it
     * here as well. */
    var Pl = Play();
    if (!Pl || typeof Pl.begin !== 'function') { announce('Play is not wired up yet.'); return; }
    Pl.begin(cloneRoom(ed.room), { origin: 'editor' });
  }

  /* Replay a stored ghost against a room and say, in words, what happened.
   *
   * Replay.verify deliberately does not collapse to a boolean: a replay that
   * runs out of inputs with the dot still alive is a different failure from
   * one that died, and a corrupt string is different again. The author is
   * being told why their saved proof was rejected, so keep the distinction.
   *
   * Any failure to reach a verdict is treated as NOT proved. This gate only
   * ever fails closed. */
  function replayVerdict(room, rle) {
    var R = BAIT.Replay, S = BAIT.Sim;
    if (!R || typeof R.verify !== 'function' || !S) {
      return { cleared: false, why: 'could not be checked, the replay engine is not loaded' };
    }
    var res;
    try { res = R.verify(cloneRoom(room), rle); }
    catch (err) { return { cleared: false, why: 'could not be replayed' }; }
    if (!res) return { cleared: false, why: 'could not be replayed' };

    if (res.result === S.RESULT.CLEAR) return { cleared: true, why: '' };
    if (res.result === 'invalid')      return { cleared: false, why: 'is corrupt' };
    if (res.result === S.RESULT.DEAD) {
      return { cleared: false, why: 'no longer survives this room' +
               (res.deathCause ? ' (' + res.deathCause + ')' : '') };
    }
    return { cleared: false, why: 'no longer reaches the exit' };
  }

  /* The single place `proved` becomes true from a run the author just played.
   * mount() can also set it, but ONLY after replayVerdict confirms the stored
   * ghost still clears the room. Both routes require a real clear. */
  function takeResult(summary) {
    if (!ed) return;
    if (summary && (summary.cleared || (summary.medals && summary.medals.clear))) {
      ed.proved = true;
      ed.authorGhost = summary.replay
        ? { rle: summary.replay, ticks: summary.ticks | 0, at: now() }
        : null;
      if (!ed.authorGhost) {
        /* No recorded inputs means no proof we can hand to anyone else. */
        ed.proved = false;
        announce('Cleared, but the run was not recorded. Test it again.');
      } else {
        announce('Cleared in ' + clock(summary.ticks) + '. This room can be published.');
      }
    } else {
      announce('Not cleared. Publish stays locked.');
    }
    refresh();
  }

  /* THE EDITOR STAYS MOUNTED BEHIND A TEST RUN (boot.js routing), so that an
   * author's undo stack and unsaved work survive hitting Test. That is the
   * right call, and it means this file is live while somebody is playing.
   *
   * Two consequences, and both are bugs if unhandled:
   *   - the keydown handler is on window, so arrow keys would drive the
   *     editor cursor AND preventDefault the player's own input. The player
   *     would be unable to move during the test of their own room.
   *   - the canvas handlers would place pieces where the player clicked, and
   *     the overlay would draw an editing grid over the live game.
   *
   * So every input path and the overlay ask editing() first, and the chrome
   * hides itself whenever the mode is not 'editor'. Self-contained: boot.js
   * does not have to know.
   */
  function editing() {
    var M = Modes();
    return !M || typeof M.state !== 'function' || M.state() === 'editor';
  }

  function applyVisibility() {
    if (!ed || !ed.els.rail) return;
    var show = editing();
    ed.els.rail.hidden = !show;
    if (ed.els.bar) ed.els.bar.hidden = !show;
  }

  function watchModes() {
    var M = Modes();
    if (!M || typeof M.subscribe !== 'function') return null;
    return M.subscribe(function (snap) {
      if (!ed) return;
      if (snap.state === 'results' && snap.ctx && snap.ctx.origin === 'editor') {
        takeResult(snap.ctx.summary);
      }
      applyVisibility();
      if (snap.state === 'editor') redraw();
    });
  }

  function now() {
    /* Date.now is banned in src/core only; this is UI and save.js stamps the
     * same way. */
    return Date.now();
  }

  function clock(ticks) {
    var total = Math.round((ticks || 0) / K.TICK_HZ);
    var m = (total / 60) | 0, s = total % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function cloneRoom(room) {
    var R = Room();
    if (R && typeof R.clone === 'function') return R.clone(room);
    var out = { v: 1, w: room.w, h: room.h,
      tiles: room.tiles.slice(0), params: JSON.parse(JSON.stringify(room.params || {})),
      start: room.start ? { x: room.start.x, y: room.start.y } : null,
      name: room.name || '', author: room.author || '', par: room.par || null };
    return out;
  }

  /* -------------------------------------------------------------- publish -- */

  function publish() {
    if (!ed.proved || !ed.authorGhost) {
      announce('You have to clear this room yourself before you can publish it.');
      return;
    }
    if (ed.issues.length) { announce(ed.issues[0].msg); return; }
    var C = Codec();
    if (!C || typeof C.encode !== 'function') { announce('Codec is not ready yet.'); return; }
    var code;
    try { code = C.encode(ed.room); }
    catch (err) { announce('That room could not be encoded.'); return; }
    if (!code) { announce('That room could not be encoded.'); return; }

    /* THE SAVE IS NOT SKIPPABLE. onPublish is a completion hook, not a
     * replacement: a host that only wants to navigate afterwards (boot.js
     * does exactly that) must not be able to accidentally swallow the write.
     * An earlier version returned early when onPublish existed, which meant
     * PUBLISH quietly left the editor and stored nothing at all.
     *
     * And nothing navigates on failure — leaving the editor with an error
     * nobody read is how work gets lost. */
    var W = BAIT.Workshop;
    if (!W || typeof W.publish !== 'function') { announce('Workshop is not ready yet.'); return; }

    var res = W.publish(ed.room, code, ed.authorGhost, ed.entryId);
    if (!res || !res.ok) {
      announce((res && res.error) || 'Publish failed.');
      refresh();
      return;
    }

    ed.entryId = res.entry.id;
    ed.dirtySinceSave = false;
    announce('Published as ' + res.entry.name + '. The code is on the workshop panel.');
    if (typeof ed.onPublish === 'function') ed.onPublish(ed.room, code, res.entry);
    refresh();
  }

  /* ---------------------------------------------------------------- mount -- */

  function mount(host, opts) {
    opts = opts || {};
    var R = Room();
    var room = opts.room || (R && R.create ? R.create(K.GRID_W, K.GRID_H) : null);
    if (!room) return null;

    resetComplaints();
    ed = freshState(room);
    ed.host = host;
    ed.onExit = opts.onExit || null;
    ed.onTest = opts.onTest || null;
    ed.onPublish = opts.onPublish || null;
    ed.entryId = opts.entryId || null;
    ed.canvas = opts.canvas || document.getElementById('stage');
    ed.ctx = ed.canvas && ed.canvas.getContext ? ed.canvas.getContext('2d') : null;

    /* A room reopened from the library was proved when it was published, and
     * its author ghost is that proof, so asking the author to clear it again
     * would be theatre.
     *
     * But a ghost is only proof if it actually clears THIS room, and mount()
     * is a public entry point. Trusting opts.authorGhost on sight meant any
     * caller could hand over {rle:'x'} and unlock publish having cleared
     * nothing, which is the exact thing this file exists to prevent. So the
     * ghost is REPLAYED against the room through Forge's Replay.verify, which
     * he wrote for this caller and which distinguishes a corrupt replay from
     * one that simply did not clear.
     *
     * If it does not clear, publish stays locked and the gate line says why
     * rather than leaving the author to guess (Boss's standing rule: if
     * something does not happen, something has to say so). */
    ed.ghostNote = '';
    if (opts.authorGhost && opts.authorGhost.rle) {
      var vr = replayVerdict(room, opts.authorGhost.rle);
      if (vr.cleared) {
        ed.authorGhost = opts.authorGhost;
        ed.proved = true;
      } else {
        ed.ghostNote = 'The saved proof for this room ' + vr.why +
                       ', so publish is locked until you clear it again.';
      }
    } else if (opts.authorGhost) {
      ed.ghostNote = 'The saved proof for this room has no recorded run, ' +
                     'so publish is locked until you clear it again.';
    }

    syncStart(room);
    buildDom(host);
    bindPointer();
    bindKeys();
    ed.unsubModes = watchModes();
    revalidate();
    applyVisibility();
    refresh();
    return ed;
  }

  function unmount() {
    if (!ed) return;
    unbindPointer();
    unbindKeys();
    if (ed.unsubModes) ed.unsubModes();
    if (ed.host) ed.host.innerHTML = '';
    ed = null;
  }

  /* ------------------------------------------------------------------ dom --
   * Ink's class system does the visual work (.panel .rail .btn .label .h2
   * .kbd .code .stack .row .dim). `ed-` classes mark only the structures Ink's
   * vocabulary has no word for: the swatch grid, the compass, the tether
   * legend. The handful of inline styles here are LAYOUT ONLY, never colour,
   * and exist because #ui centres its children and the editor needs a bar on
   * top and a rail down the side. Ink: happy to drop these the moment
   * .ed-bar / .ed-rail have real rules in style.css.
   */
  function buildDom(host) {
    host.innerHTML = '';

    /* Two fixed surfaces, both positioned by Ink: a bar across the top and a
     * rail down the left. The board sits in the bare gap between them, so
     * clicks reach the canvas. No inline layout in this file. */
    var bar = el('header', 'ed-bar');
    bar.appendChild(text('span', 'ed-bar__title', 'WORKSHOP'));

    var nameInput = el('input', 'ed-name field__input mono');
    nameInput.type = 'text';
    nameInput.maxLength = 24;
    nameInput.placeholder = 'UNTITLED ROOM';
    nameInput.setAttribute('aria-label', 'Room name');
    nameInput.value = ed.room.name || '';
    nameInput.addEventListener('input', function () {
      var v = nameInput.value;
      mutate(function (room) { room.name = v; });
    });
    bar.appendChild(nameInput);
    bar.appendChild(el('div', 'ed-bar__spacer'));

    var bUndo = button('btn btn--ghost ed-undo', 'UNDO', undo);
    var bRedo = button('btn btn--ghost ed-redo', 'REDO', redo);
    var bExit = button('btn btn--ghost ed-exit', 'CLOSE', closeEditor);
    [bUndo, bRedo, bExit].forEach(function (b) { bar.appendChild(b); });
    host.appendChild(bar);

    var rail = el('aside', 'ed-rail');
    rail.setAttribute('aria-label', 'Room editor');

    var budget = el('div', 'ed-budget');
    budget.setAttribute('role', 'status');
    budget.appendChild(text('span', '', 'BUDGET'));
    var budgetVal = text('span', '', '');
    budget.appendChild(budgetVal);
    rail.appendChild(budget);

    var palette = el('div', 'ed-palette');
    palette.setAttribute('role', 'toolbar');
    palette.setAttribute('aria-label', 'Pieces');

    var slot = 0, swatches = {};
    paletteGroups().forEach(function (g) {
      g.ids.forEach(function (id) {
        var d = P.def(id);
        if (!d) return;
        var key = KEYS[slot++] || '';
        var b = el('button', 'ed-piece');
        b.type = 'button';
        b.dataset.id = String(id);
        /* The swatch is a glyph; the words live where a screen reader and a
         * hover tooltip can reach them without crowding a 24px cell. */
        b.setAttribute('aria-label', g.name.toLowerCase() + ': ' + d.name +
          ', cost ' + d.cost + (key ? ', shortcut ' + key : ''));
        b.title = d.name.toUpperCase() + (d.cost ? '  (' + d.cost + ')' : '') +
          (key ? '  [' + key.toUpperCase() + ']' : '') +
          (d.blurb ? '\n' + d.blurb : '');
        b.appendChild(swatchCanvas(id));
        /* .ed-piece-lies is Ink's brass corner tick. It marks the PALETTE
         * only — a faller or mimic marked on the board would end the game. */
        if (d.lies) b.classList.add('ed-piece-lies');
        b.addEventListener('click', function () { selectTool(id); });
        swatches[id] = b;
        palette.appendChild(b);
      });
    });

    var eraser = el('button', 'ed-piece ed-eraser');
    eraser.type = 'button';
    eraser.dataset.id = '-1';
    eraser.setAttribute('aria-label', 'Eraser, shortcut X');
    eraser.title = 'ERASE  [X]';
    eraser.appendChild(text('span', '', 'X'));
    eraser.addEventListener('click', function () { selectTool(-1); });
    swatches[-1] = eraser;
    palette.appendChild(eraser);
    rail.appendChild(palette);

    var inspector = el('div', 'ed-inspector');
    inspector.setAttribute('aria-label', 'Piece settings');
    rail.appendChild(inspector);

    var issues = el('div', 'ed-errors');
    issues.setAttribute('role', 'status');
    rail.appendChild(issues);

    /* The prove-gate, stated rather than implied. A disabled PUBLISH that
     * does not explain itself reads as broken, so the panel says what is
     * missing and turns green the moment the room is proved. */
    var gate = el('div', 'ed-gate stack gap-s');
    var gateMsg = text('p', 'small', '');
    gate.appendChild(gateMsg);
    var gateRow = el('div', 'row gap-s');
    var bTest = button('btn ed-test', 'TEST', test);
    var bPub  = button('btn btn--primary ed-publish', 'PUBLISH', publish);
    gateRow.appendChild(bTest);
    gateRow.appendChild(bPub);
    gate.appendChild(gateRow);
    rail.appendChild(gate);

    host.appendChild(rail);

    var live = el('div', 'visually-hidden');
    live.setAttribute('aria-live', 'polite');
    host.appendChild(live);

    ed.els = {
      bar: bar, rail: rail, budget: budget, budgetVal: budgetVal,
      inspector: inspector, issues: issues, gate: gate, gateMsg: gateMsg,
      swatches: swatches, name: nameInput, live: live,
      test: bTest, publish: bPub, undo: bUndo, redo: bRedo
    };
  }

  function closeEditor() {
    if (typeof ed.onExit === 'function') { ed.onExit(ed.room, ed.dirtySinceSave); return; }
    var M = Modes();
    if (M) M.go('workshop');
  }

  /* A swatch is the piece DRAWN, by Ink's renderer, not a letter.
   *
   * Authoring characters are Atlas's source-file vocabulary and they are the
   * wrong thing to show a player: nobody knows what "%" is before clicking
   * it. Draw.piece is the same code that paints the board, so what you pick
   * always looks like what you place and a second set of piece drawings can
   * never drift into existence.
   *
   * The canvas carries a dpr-scaled backing store with its presented size in
   * CSS px. That pair is the only way to land a 2px chalk stroke on a whole
   * pixel, which is Ink's stated failure mode for this whole aesthetic.
   */
  var SWATCH_PX = 28;

  function swatchCanvas(id) {
    var c = el('canvas', 'ed-swatch');
    var dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    c.width = Math.round(SWATCH_PX * dpr);
    c.height = Math.round(SWATCH_PX * dpr);
    c.style.width = SWATCH_PX + 'px';
    c.style.height = SWATCH_PX + 'px';
    paintSwatch(c, id);
    return c;
  }

  function paintSwatch(c, id) {
    var g = c.getContext && c.getContext('2d');
    var D = BAIT.Draw;
    if (!g || !D || typeof D.piece !== 'function') return;
    var dpr = c.width / SWATCH_PX;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, SWATCH_PX, SWATCH_PX);
    try { D.piece(g, id, pendingParams(id), 0, 0, SWATCH_PX); }
    catch (err) {
      /* A blank swatch is survivable, but the author is looking at a piece
       * they cannot identify and nothing else would ever tell them why. */
      complain('swatch-' + id, 'Piece ' + id + ' has no picture: ' +
               ((err && err.message) || err));
    }
  }


  function selectTool(id) {
    ed.tool = id;
    if (id >= 0 && P.def(id) && P.def(id).params.length) ed.selected = null;
    refresh();
  }

  /* ------------------------------------------------------------- refresh -- */

  function refresh() {
    if (!ed || !ed.els.rail) return;
    var els = ed.els, left = budgetLeft(ed.room);

    els.budgetVal.textContent = spend(ed.room) + ' / ' + K.EDITOR_BUDGET;
    els.budget.classList.toggle('is-full', left <= 0);

    Object.keys(els.swatches).forEach(function (id) {
      var b = els.swatches[id], on = String(ed.tool) === String(id);
      b.classList.toggle('ed-piece-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      var numeric = +id;
      if (numeric >= 0) {
        var cost = (P.def(numeric) && P.def(numeric).cost) || 0;
        var broke = cost > 0 && cost > left;
        b.classList.toggle('ed-piece-broke', broke);
        b.disabled = broke;
      }
    });

    if (els.name.value !== (ed.room.name || '')) els.name.value = ed.room.name || '';

    renderInspector();
    renderIssues();

    els.test.disabled = !canTest();
    els.publish.disabled = !canPublish();
    els.publish.title = ed.proved
      ? 'Publish and get a room code.'
      : 'Locked until you clear this room yourself.';
    els.undo.disabled = !ed.undo.length;
    els.redo.disabled = !ed.redo.length;

    /* The gate explains itself in the order the author has to fix things. */
    els.gate.classList.toggle('is-proven', canPublish());
    els.gateMsg.textContent = gateLine();

    /* Dialling a turret round repaints its swatch, so the rail always shows
     * the piece you are actually about to place. */
    if (ed.tool >= 0 && els.swatches[ed.tool]) {
      var glyph = els.swatches[ed.tool].children[0];
      if (glyph && glyph.getContext) paintSwatch(glyph, ed.tool);
    }

    redraw();
  }

  /* ------------------------------------------- why there is no solve hint --
   * There WAS an advisory "this room may have no route" line here, driven by
   * BAIT.Solve while the author drew. It is gone on purpose. Do not put it
   * back without reading this, because the reason is measured, not a hunch.
   *
   * Solve has no wall clock by design (Sieve's call, and the right one: a
   * node budget makes the verdict a pure function of the room, so CI and a
   * laptop agree). But that means a search cannot be capped in TIME, only in
   * nodes, and search() is one synchronous call that cannot be sliced across
   * idle callbacks. Workers are blocked on file://, so there is no thread to
   * put it on. Whatever it costs, it costs with the UI frozen.
   *
   * Measured against the real solver, on the rooms this would fire on:
   *
   *   empty room, solvable       ~46 ms   solved
   *   busy room, solvable       ~130 ms   solved
   *   sealed exit, UNSOLVABLE   ~158 ms   BUDGET  (says nothing about the room)
   *   sealed exit, UNSOLVABLE  ~1500 ms   EXHAUSTED (the only honest verdict)
   *
   * The cost runs backwards to the usefulness. A room that is fine answers
   * quickly and has nothing to tell the author. A room that is broken is the
   * expensive one, and the only status worth showing is EXHAUSTED, which on
   * that room costs a second and a half of frozen editor. Cut the budget to
   * where the freeze is tolerable and every answer comes back BUDGET, which
   * by the solver's own contract means NOTHING about the room — so the line
   * would be a claim we are never entitled to make, bought with dropped
   * frames while somebody is dragging out a wall.
   *
   * There is no setting of that dial that is both honest and smooth. The
   * prove-gate never depended on this: an author cannot publish without
   * clearing the room themselves, which is a stronger check than any hint.
   * If this comes back it belongs on an explicit "CHECK THIS ROOM" button
   * where the author has asked for the wait, not on the edit path.
   */

  function gateLine() {
    /* A renderer that will not paint outranks anything about publishing. */
    var broken = complaintLine();
    if (broken) return broken;
    var b = blockers();
    if (b.length) return b[0].msg;
    if (ed.issues.length) return ed.issues[0].msg;
    /* A rejected saved proof outranks the generic prompt: "clear this room"
     * does not explain why a room you already published came back locked. */
    if (!ed.proved && ed.ghostNote) return ed.ghostNote;
    if (!ed.proved) return 'Clear this room yourself to unlock publish.';
    if (!ed.authorGhost) return 'That run was not recorded. Test it again.';
    return 'Proved. Ready to publish.';
  }

  function renderInspector() {
    var box = ed.els.inspector;
    box.innerHTML = '';

    var targetId, values, onChange, heading;

    if (ed.selected && tileAt(ed.room, ed.selected.cx, ed.selected.cy) !== TILE.EMPTY) {
      var sc = ed.selected;
      targetId = tileAt(ed.room, sc.cx, sc.cy);
      values = paramsAt(ed.room, sc.cx, sc.cy) || P.defaults(targetId);
      heading = P.def(targetId).name.toUpperCase() + '  ' + cellLabel(sc.cx, sc.cy);
      onChange = function (field, v) {
        mutate(function (room) {
          var i = idxOf(room, sc.cx, sc.cy);
          room.params[i] = room.params[i] || P.defaults(targetId);
          room.params[i][field] = P.clampParam(field, v);
        });
      };
    } else if (ed.tool >= 0 && P.def(ed.tool)) {
      targetId = ed.tool;
      values = pendingParams(targetId);
      heading = P.def(targetId).name.toUpperCase();
      onChange = function (field, v) { values[field] = P.clampParam(field, v); refresh(); };
    } else {
      box.appendChild(text('p', 'small dim', 'Eraser. Click or drag to clear cells.'));
      return;
    }

    var def = P.def(targetId);
    box.appendChild(text('h2', 'label dim', heading));
    if (def.blurb) box.appendChild(text('p', 'small dim', def.blurb));
    if (def.lies) box.appendChild(text('p', 'small danger', 'This piece lies. Use it once, and late.'));

    def.params.forEach(function (field) {
      box.appendChild(paramWidget(field, values[field], onChange));
    });

    if (ed.selected) {
      box.appendChild(button('btn btn--danger btn--wide ed-remove', 'REMOVE', function () {
        erase(ed.selected.cx, ed.selected.cy);
      }));
    }
  }

  /* Direction is a compass of four buttons, not a dropdown of numbers.
   * Everything else is a labelled slider showing its value, because a period
   * you cannot read is a period you cannot reason about. */
  function paramWidget(field, value, onChange) {
    var row = el('div', 'ed-param stack gap-s');

    if (field === 'dir') {
      row.appendChild(text('span', 'label dim', 'FACING'));
      /* A four-cardinal plus, not a dropdown of numbers: faster to hit, and it
       * mirrors the arrow actually drawn on the piece, so the inspector and
       * the room say the same thing. Ink lays the grid out from the __n/e/s/w
       * classes and reads the pressed state off aria-pressed. */
      var pad = el('div', 'ed-dir');
      var WORD = { n: 'north', e: 'east', s: 'south', w: 'west' };
      [[1, 'n'], [3, 'e'], [5, 's'], [7, 'w']].forEach(function (pair) {
        var b = el('button', 'ed-dir__' + pair[1]);
        b.type = 'button';
        b.textContent = pair[1].toUpperCase();
        b.setAttribute('aria-label', 'Face ' + WORD[pair[1]]);
        b.setAttribute('aria-pressed', value === pair[0] ? 'true' : 'false');
        b.addEventListener('click', function () { onChange('dir', pair[0]); });
        pad.appendChild(b);
      });
      row.appendChild(pad);
      return row;
    }

    if (field === 'mode') {
      row.appendChild(text('span', 'label dim', 'PLATE'));
      var toggle = el('button', 'btn ed-toggle');
      toggle.type = 'button';
      toggle.textContent = value ? 'LATCH' : 'HOLD';
      toggle.setAttribute('aria-pressed', value ? 'true' : 'false');
      toggle.title = value
        ? 'Toggles the gate and stays that way.'
        : 'Gate is open only while you stand here.';
      toggle.addEventListener('click', function () { onChange('mode', value ? 0 : 1); });
      row.appendChild(toggle);
      return row;
    }

    var LABEL = { period: 'PERIOD', phase: 'PHASE', link: 'LINK', len: 'LENGTH' };
    var RANGE = {
      period: [1, K.MAX_PERIOD], phase: [0, K.MAX_PHASE],
      link: [0, K.MAX_LINK], len: [1, K.MAX_ROTOR_LEN]
    };
    var r = RANGE[field] || [0, 63];

    var head = el('div', 'row spread');
    head.appendChild(text('span', 'label dim', LABEL[field] || field.toUpperCase()));
    var read = text('output', 'small mono', paramReadout(field, value));
    head.appendChild(read);
    row.appendChild(head);

    var input = el('input', 'slider ed-range');
    input.type = 'range';
    input.min = String(r[0]); input.max = String(r[1]); input.step = '1';
    input.value = String(value);
    input.setAttribute('aria-label', LABEL[field] || field);
    input.addEventListener('input', function () {
      read.textContent = paramReadout(field, +input.value);
    });
    input.addEventListener('change', function () { onChange(field, +input.value); });
    row.appendChild(input);
    return row;
  }

  /* Periods are authored in units of 10 ticks. "12" is meaningless; "12
   * (1.00s)" lets an author sync two hazards in their head. */
  function paramReadout(field, v) {
    if (field === 'period' || field === 'phase') {
      return v + '  (' + ((v * K.PERIOD_UNIT) / K.TICK_HZ).toFixed(2) + 's)';
    }
    return String(v);
  }

  function cellLabel(cx, cy) {
    return String.fromCharCode(65 + (cx % 26)) + (cy + 1);
  }

  function renderIssues() {
    var box = ed.els.issues;
    box.innerHTML = '';
    if (!ed.issues.length) {
      box.appendChild(text('p', 'ed-ok', 'Sheet clean.'));
      return;
    }
    /* Every note that knows a cell is a real button, so the keyboard can walk
     * the notes and each one focuses the cell it is complaining about. */
    ed.issues.forEach(function (it) {
      if (it.at) {
        var b = el('button', 'ed-error');
        b.type = 'button';
        b.textContent = it.msg + '  ' + cellLabel(it.at.cx, it.at.cy);
        b.addEventListener('click', function () {
          ed.cursor = { cx: it.at.cx, cy: it.at.cy };
          ed.selected = { cx: it.at.cx, cy: it.at.cy };
          refresh();
        });
        box.appendChild(b);
      } else {
        box.appendChild(text('p', 'ed-error', it.msg));
      }
    });
  }

  function announce(msg) {
    if (ed && ed.els.live) ed.els.live.textContent = msg;
    if (ed && ed.els.budget) ed.lastMsg = msg;
  }

  /* No animation: SPEC §3 says motion is still or instant, and Ink's
   * stylesheet ships zero transitions on purpose. Say it instead. */
  function denyBudget(def) {
    announce('Not enough budget for a ' + def.name + '. It costs ' + def.cost + '.');
  }

  /* ---------------------------------------------------------------- input -- */

  var onDown, onMove, onUp, onLeave, onCtx, onKey;

  /* Ink owns the px<->cell mapping. style.css presents the 1000x700 board at
   * whatever size the window allows, so a click in CSS pixels is not a click
   * in board pixels until it is divided by that scale. Theme.hitCell does the
   * whole conversion; doing the arithmetic here would drift by exactly the
   * pixel this indirection exists to prevent. */
  function layout() {
    var T = Theme();
    if (T && typeof T.layout === 'function') return T.layout(ed.canvas);
    if (T && T.m) return { ox: T.m.ROOM_X, oy: T.m.ROOM_Y, cell: T.m.CELL };
    var w = K.GRID_W * K.CELL, h = K.GRID_H * K.CELL;
    return {
      ox: ((ed.canvas.width - w) / 2) | 0,
      oy: ((ed.canvas.height - h) / 2) | 0,
      cell: K.CELL
    };
  }

  /* Returns a cell, or an out-of-bounds one that inBounds() will reject. */
  function cellFromEvent(e) {
    var T = Theme();
    if (T && typeof T.hitCell === 'function') {
      var hit = T.hitCell(ed.canvas, e.clientX, e.clientY);
      return hit ? { cx: hit.cx, cy: hit.cy } : { cx: -1, cy: -1 };
    }
    var rect = ed.canvas.getBoundingClientRect();
    var sx = ed.canvas.width / rect.width, sy = ed.canvas.height / rect.height;
    var px = (e.clientX - rect.left) * sx, py = (e.clientY - rect.top) * sy;
    var L = layout();
    return { cx: Math.floor((px - L.ox) / L.cell), cy: Math.floor((py - L.oy) / L.cell) };
  }

  function bindPointer() {
    if (!ed.canvas || !ed.canvas.addEventListener) return;
    var c = ed.canvas;

    onDown = function (e) {
      if (!editing()) return;
      var p = cellFromEvent(e);
      if (!inBounds(ed.room, p.cx, p.cy)) return;
      if (c.setPointerCapture && e.pointerId != null) c.setPointerCapture(e.pointerId);
      ed.cursor = p;
      if (e.altKey) { pick(p.cx, p.cy); return; }
      if (e.button === 2 || ed.tool < 0) { ed.painting = 2; erase(p.cx, p.cy); }
      else { ed.painting = 1; place(p.cx, p.cy, ed.tool); }
      if (e.preventDefault) e.preventDefault();
    };

    onMove = function (e) {
      if (!editing()) return;
      var p = cellFromEvent(e);
      var changed = !ed.hover || ed.hover.cx !== p.cx || ed.hover.cy !== p.cy;
      ed.hover = inBounds(ed.room, p.cx, p.cy) ? p : null;
      if (ed.painting && ed.hover && changed) {
        ed.cursor = p;
        /* Unique pieces do not drag-paint: dragging a start across the room
         * would just teleport it under the cursor, which is nonsense. */
        if (ed.painting === 2) erase(p.cx, p.cy);
        else if (!isUnique(ed.tool)) place(p.cx, p.cy, ed.tool);
      } else if (changed) {
        redraw();
      }
    };

    onUp = function () { ed.painting = 0; };
    onLeave = function () { ed.hover = null; ed.painting = 0; redraw(); };
    onCtx = function (e) { if (e.preventDefault) e.preventDefault(); };

    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    c.addEventListener('pointerleave', onLeave);
    c.addEventListener('contextmenu', onCtx);
  }

  function unbindPointer() {
    if (!ed.canvas || !ed.canvas.removeEventListener) return;
    var c = ed.canvas;
    c.removeEventListener('pointerdown', onDown);
    c.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    c.removeEventListener('pointerleave', onLeave);
    c.removeEventListener('contextmenu', onCtx);
  }

  function pick(cx, cy) {
    var id = tileAt(ed.room, cx, cy);
    if (id === TILE.EMPTY) return;
    ed.tool = id;
    var prm = paramsAt(ed.room, cx, cy);
    if (prm) ed.params[id] = JSON.parse(JSON.stringify(prm));
    ed.selected = { cx: cx, cy: cy };
    refresh();
  }

  /* Full keyboard authoring, not a courtesy pass: arrows move a cursor, Enter
   * places, Backspace erases, shortcuts pick pieces (SPEC §8). */
  function bindKeys() {
    onKey = function (e) {
      if (!ed) return;
      if (!editing()) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && t.type !== 'range') return;

      var k = String(e.key || '').toLowerCase(), handled = true;

      if ((e.ctrlKey || e.metaKey) && k === 'z') { if (e.shiftKey) redo(); else undo(); }
      else if ((e.ctrlKey || e.metaKey) && k === 'y') { redo(); }
      else if (e.ctrlKey || e.metaKey) { handled = false; }
      else if (k === 'arrowup')    { moveCursor(0, -1); }
      else if (k === 'arrowdown')  { moveCursor(0, 1); }
      else if (k === 'arrowleft')  { moveCursor(-1, 0); }
      else if (k === 'arrowright') { moveCursor(1, 0); }
      else if (k === 'enter' || k === ' ') {
        if (ed.tool < 0) erase(ed.cursor.cx, ed.cursor.cy);
        else place(ed.cursor.cx, ed.cursor.cy, ed.tool);
      }
      else if (k === 'backspace' || k === 'delete') { erase(ed.cursor.cx, ed.cursor.cy); }
      else if (k === ERASE_KEY) { selectTool(-1); }
      else if (k === 'escape') {
        if (ed.selected) { ed.selected = null; refresh(); }
        else handled = false;          // let Modes.back take it
      }
      else if (KEYS.indexOf(k) >= 0) {
        var id = idForSlot(KEYS.indexOf(k));
        if (id != null) selectTool(id); else handled = false;
      }
      else handled = false;

      if (handled && e.preventDefault) { e.preventDefault(); redraw(); }
    };
    window.addEventListener('keydown', onKey);
  }

  function unbindKeys() { window.removeEventListener('keydown', onKey); }

  function idForSlot(n) {
    var groups = paletteGroups(), i = 0;
    for (var g = 0; g < groups.length; g++) {
      for (var j = 0; j < groups[g].ids.length; j++, i++) {
        if (i === n) return groups[g].ids[j];
      }
    }
    return null;
  }

  function moveCursor(dx, dy) {
    ed.cursor.cx = Math.max(0, Math.min(ed.room.w - 1, ed.cursor.cx + dx));
    ed.cursor.cy = Math.max(0, Math.min(ed.room.h - 1, ed.cursor.cy + dy));
    ed.selected = tileAt(ed.room, ed.cursor.cx, ed.cursor.cy) !== TILE.EMPTY
      ? { cx: ed.cursor.cx, cy: ed.cursor.cy } : null;
    refresh();
  }

  /* -------------------------------------------------------------- overlay --
   * Drawn on top of Draw's room, never instead of it. Grid, cursor, hover
   * ghost and link tethers only. Colours come from Ink's plate so they follow
   * the colourblind-safe mode for free.
   */
  /* THE ONE PAINT FUNCTION.
   *
   * The engine's rAF loop only paints during 'playing' and 'results' — in
   * editor mode nothing upstream ever touches the canvas, which is correct
   * (a static grid has no business being repainted 120 times a second) but it
   * means the board is black unless this runs. So redraw() paints BOTH the
   * room, through Ink's renderer in editor mode so the two liars are shown
   * for what they are, and then the authoring overlay on top.
   *
   * Every mutation funnels through refresh(), and refresh() ends here. That
   * is deliberate: scattering redraw calls across handlers is how half of
   * them get forgotten and the editor shows stale pixels.
   */
  function redraw() {
    if (!ed) return;
    if (!editing()) return;      /* a test run is on screen, not the editor */
    var D = BAIT.Draw;
    if (!D || typeof D.render !== 'function') {
      complain('draw-missing', 'The renderer is not loaded, so the board cannot paint.');
    } else {
      try {
        D.render({ room: ed.room, sim: null, alpha: 0, mode: 'editor' });
        clearComplaint('draw-missing');
        clearComplaint('draw-threw');
      } catch (err) {
        /* A paint failure must not take the editor down, but it must not be
         * invisible either. Swallowing this is how the board went black for
         * hours with nothing anywhere saying the renderer had thrown. */
        complain('draw-threw', 'The board could not be drawn: ' +
                 ((err && err.message) || err) + '. Your room is safe, the picture is not.');
      }
    }
    drawOverlay();
  }

  /* ------------------------------------------------------ saying so out loud --
   * Boss's standing rule: if something does not happen, something must say so.
   * A throw that scrolls past the console is not something saying so, and a
   * message repeated every repaint is noise nobody reads. So each distinct
   * problem is reported ONCE to the console and held on screen until it stops
   * being true. */
  var complaints = {};

  /* Module-level, so without this a complaint raised by one editor session
   * outlives it and is shown against the next room, which is its own kind of
   * lie. mount() calls this before anything can paint. */
  function resetComplaints() { complaints = {}; }

  function complain(key, msg) {
    if (complaints[key] === msg) return;      /* already saying exactly this */
    complaints[key] = msg;
    if (typeof console !== 'undefined' && console.warn) console.warn('BAIT editor: ' + msg);
    showComplaints();
  }

  function clearComplaint(key) {
    if (!(key in complaints)) return;
    delete complaints[key];
    showComplaints();
  }

  /* Writes straight to the element rather than calling refresh(). refresh()
   * ends in redraw(), and redraw() is what raises these, so routing a
   * complaint through it would recurse. */
  function showComplaints() {
    if (!ed || !ed.els || !ed.els.gateMsg) return;
    var line = complaintLine();
    if (line) ed.els.gateMsg.textContent = line;
  }

  function complaintLine() {
    for (var k in complaints) if (complaints.hasOwnProperty(k)) return complaints[k];
    return '';
  }

  function drawOverlay() {
    if (!ed || !ed.ctx) return;
    if (!editing()) return;
    var T = Theme();
    if (!T || !T.c) return;
    var c = T.c, ctx = ed.ctx, L = layout(), room = ed.room;

    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.editorGrid;
    ctx.beginPath();
    for (var x = 0; x <= room.w; x++) {
      ctx.moveTo(L.ox + x * L.cell + 0.5, L.oy);
      ctx.lineTo(L.ox + x * L.cell + 0.5, L.oy + room.h * L.cell);
    }
    for (var y = 0; y <= room.h; y++) {
      ctx.moveTo(L.ox, L.oy + y * L.cell + 0.5);
      ctx.lineTo(L.ox + room.w * L.cell, L.oy + y * L.cell + 0.5);
    }
    ctx.stroke();

    /* Link tethers: plate to the gates it opens, and teleport to its twin.
     * Links are the one relationship the room art cannot show, and an
     * unpaired one is the most common way a room becomes unplayable. */
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = c.editorLink;
    tethers(room).forEach(function (t) {
      ctx.beginPath();
      ctx.moveTo(L.ox + (t.a.cx + 0.5) * L.cell, L.oy + (t.a.cy + 0.5) * L.cell);
      ctx.lineTo(L.ox + (t.b.cx + 0.5) * L.cell, L.oy + (t.b.cy + 0.5) * L.cell);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    if (ed.hover && ed.tool >= 0) {
      ctx.strokeStyle = c.editorGhost;
      ctx.lineWidth = 2;
      cellRect(ctx, L, ed.hover.cx, ed.hover.cy);
    }

    ctx.strokeStyle = c.editorCursor;
    ctx.lineWidth = 2;
    cellRect(ctx, L, ed.cursor.cx, ed.cursor.cy);

    if (ed.selected) {
      ctx.strokeStyle = c.editorSelect;
      ctx.setLineDash([2, 3]);
      cellRect(ctx, L, ed.selected.cx, ed.selected.cy);
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function cellRect(ctx, L, cx, cy) {
    ctx.strokeRect(L.ox + cx * L.cell + 1, L.oy + cy * L.cell + 1, L.cell - 2, L.cell - 2);
  }

  function tethers(room) {
    var plates = {}, gates = {}, ports = {}, out = [];
    each(room, function (cx, cy, id, prm) {
      var at = { cx: cx, cy: cy };
      if (id === TILE.PLATE) (plates[prm.link] = plates[prm.link] || []).push(at);
      if (id === TILE.GATE) (gates[prm.link] = gates[prm.link] || []).push(at);
      if (id === TILE.TELEPORT) (ports[prm.link] = ports[prm.link] || []).push(at);
    });
    Object.keys(plates).forEach(function (link) {
      (gates[link] || []).forEach(function (g) {
        plates[link].forEach(function (p) { out.push({ a: p, b: g }); });
      });
    });
    Object.keys(ports).forEach(function (link) {
      if (ports[link].length === 2) out.push({ a: ports[link][0], b: ports[link][1] });
    });
    return out;
  }

  /* ----------------------------------------------------------------- api -- */

  BAIT.Editor = {
    mount: mount,
    unmount: unmount,
    room: function () { return ed ? ed.room : null; },
    isProved: function () { return !!(ed && ed.proved && ed.authorGhost); },
    authorGhost: function () { return ed ? ed.authorGhost : null; },
    isDirty: function () { return !!(ed && ed.dirtySinceSave); },
    markSaved: function () { if (ed) { ed.dirtySinceSave = false; refresh(); } },
    redraw: redraw,
    /* Play calls this on a cleared editor test; the Modes subscription is the
     * normal route, this is the direct one for boot.js/Play if it prefers. */
    noteResult: takeResult,
    /* workshop.js refuses to publish a room with notes on it, and
     * tools/verify.cjs can lint an authored room with the same rules. */
    audit: function (room) {
      var prev = ed;
      ed = freshState(room);
      var found = revalidate();
      ed = prev;
      return found;
    },
    cost: spend
  };

})(window.BAIT = window.BAIT || {});
