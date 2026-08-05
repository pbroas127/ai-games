/* BAIT — the workshop: room library, publish, import by code.
 *
 * OWNER: Chisel. Paired with src/ui/editor.js.
 *
 * The authorship loop that surrounds the editor:
 *
 *   new -> edit -> test -> PROVE -> publish -> code -> someone pastes that
 *   code somewhere and plays the exact room, with no server involved because
 *   the code IS the room (SPEC §5.1).
 *
 * Two things here are load-bearing and the rest is chrome:
 *
 *   1. THE PROVE-GATE. publish() refuses any room the editor has not proved,
 *      and refuses one with no author ghost, because the ghost IS the proof.
 *      There is no override and no dev flag. A room in the wild that its own
 *      author never cleared would make the whole premise a lie.
 *   2. EVERY CODE IS HOSTILE INPUT (SPEC §0.6), including codes out of our
 *      own save file, which a user can hand-edit. Length-capped, charset
 *      checked, decoded in a try/catch, structurally re-checked against the
 *      piece table, then handed to Room.validate. Failure is a sentence on
 *      screen, never a throw and never a blank canvas.
 *
 * Persistence is entirely Relay's BAIT.Save (schema v1, workshop.rooms /
 * workshop.imported). This file never touches localStorage.
 *
 * NO HEX LITERALS (SPEC §3). Chrome uses Ink's class system.
 */
(function (BAIT) {
  'use strict';

  var P = BAIT.Pieces, K = P.K;

  function Codec()  { return BAIT.Codec; }
  function Room()   { return BAIT.Room; }
  function Save()   { return BAIT.Save; }
  function Share()  { return BAIT.Share; }
  function Editor() { return BAIT.Editor; }
  function Modes()  { return BAIT.Modes; }

  /* Anything longer than this is not a room, it is someone probing us, and we
   * reject it before the codec allocates. SPEC §5.1 targets ~120 chars for a
   * typical room, so this is generous and still bounded. */
  var MAX_CODE_LEN = 4096;
  var CODE_RE = /^[A-Za-z0-9_-]+$/;

  var ws = null;

  /* --------------------------------------------------------------- store --
   * Relay's schema v1. If save.js failed to register we degrade to a
   * session-only library rather than throwing on boot.
   */
  var sessionOnly = { rooms: [], imported: [] };

  function shelf() {
    var S = Save();
    if (S && typeof S.get === 'function') {
      var w = S.get('workshop');
      if (w && typeof w === 'object') {
        if (!isArray(w.rooms)) w.rooms = [];
        if (!isArray(w.imported)) w.imported = [];
        return w;
      }
    }
    return sessionOnly;
  }

  function commit(fn) {
    var S = Save();
    if (S && typeof S.change === 'function') {
      S.change(function (doc) {
        doc.workshop = doc.workshop || { rooms: [], imported: [] };
        if (!isArray(doc.workshop.rooms)) doc.workshop.rooms = [];
        if (!isArray(doc.workshop.imported)) doc.workshop.imported = [];
        fn(doc.workshop);
      }, 'workshop');
    } else {
      fn(sessionOnly);
    }
    render();
  }

  function isArray(a) { return Object.prototype.toString.call(a) === '[object Array]'; }

  function now() { return Date.now(); }

  /* Ids only need to be unique inside one save file. No Math.random: core
   * forbids it and there is no reason for the UI to differ. */
  function nextId(name, taken) {
    var base = 'r-' + String(name || 'untitled').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
    var id = base, n = 1;
    while (taken.indexOf(id) >= 0) { n++; id = base + '-' + n; }
    return id;
  }

  function idsIn(w) {
    return w.rooms.map(function (e) { return e.id; })
      .concat(w.imported.map(function (e) { return e.id; }));
  }

  /* -------------------------------------------------------------- publish --
   * Called by the editor's PUBLISH button and only ever with a proved room.
   * The check is repeated here rather than trusted: a gate you check once is
   * a door.
   */
  function publish(room, code, authorGhost, entryId) {
    var E = Editor();
    if (!E || !E.isProved()) {
      return fail('You have to clear this room yourself before you can publish it.');
    }
    if (!authorGhost || !authorGhost.rle) {
      return fail('That run was not recorded, so there is no proof to publish. Test it again.');
    }
    var notes = E.audit(room);
    if (notes.length) return fail(notes[0].msg);

    if (!code) {
      var C = Codec();
      if (!C || typeof C.encode !== 'function') return fail('Codec is not ready yet.');
      try { code = C.encode(room); } catch (err) { return fail('That room could not be encoded.'); }
    }
    if (!code) return fail('That room could not be encoded.');

    /* Round-trip before the code goes anywhere. If it does not decode back to
     * the same room, publishing it would send strangers a room the author
     * never built. Same assertion tools/verify.cjs makes (SPEC §7.4), made
     * once more at the moment it actually matters. */
    if (!roundTrips(room, code)) {
      return fail('That room did not survive a round-trip through the codec. Not published.');
    }

    var name = (room.name || '').trim() || 'UNTITLED ROOM';
    var entry = null;

    commit(function (w) {
      var i = entryId ? indexOfId(w.rooms, entryId) : -1;
      if (i < 0) i = indexOfCode(w.rooms, code);
      if (i >= 0) {
        /* Republishing an existing room updates it in place, keeping the best
         * time people have already set on it. */
        entry = w.rooms[i];
        entry.name = name;
        entry.code = code;
        entry.ghost = authorGhost;
        entry.cost = E.cost(room);
        entry.updatedAt = now();
        w.rooms.splice(i, 1);
        w.rooms.unshift(entry);
      } else {
        entry = {
          id: nextId(name, idsIn(w)),
          name: name,
          code: code,
          createdAt: now(),
          updatedAt: now(),
          cost: E.cost(room),
          ghost: authorGhost,
          best: null
        };
        w.rooms.unshift(entry);
      }
    });

    if (ws) { ws.justPublished = entry; ws.view = 'mine'; ws.error = ''; render(); }
    return { ok: true, entry: entry, code: code };
  }

  function roundTrips(room, code) {
    var C = Codec();
    if (!C || typeof C.decode !== 'function') return false;
    var back;
    try { back = C.decode(code); } catch (err) { return false; }
    if (!back || back.w !== room.w || back.h !== room.h) return false;
    if (!back.tiles || back.tiles.length !== room.tiles.length) return false;
    for (var i = 0; i < room.tiles.length; i++) {
      if (back.tiles[i] !== room.tiles[i]) return false;
    }
    /* Params compared field by field against the piece table, so a codec that
     * legitimately drops params a tile does not read still passes. */
    for (var j = 0; j < room.tiles.length; j++) {
      var def = P.def(room.tiles[j]);
      if (!def || !def.params.length) continue;
      var a = (room.params && room.params[j]) || P.defaults(room.tiles[j]);
      var b = (back.params && back.params[j]) || P.defaults(back.tiles[j]);
      for (var f = 0; f < def.params.length; f++) {
        var key = def.params[f];
        if (P.clampParam(key, a[key]) !== P.clampParam(key, b[key])) return false;
      }
    }
    return true;
  }

  function indexOfCode(list, code) {
    for (var i = 0; i < list.length; i++) if (list[i].code === code) return i;
    return -1;
  }

  function indexOfId(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return -1;
  }

  /* --------------------------------------------------------------- import --
   * The hostile path. Everything a stranger can hand us arrives here or via a
   * #r= link, and both funnel through this one function so there is a single
   * place to get the validation right.
   */
  function importCode(raw) {
    var code = normalise(raw);
    if (!code) return fail('Paste a room code first.');
    if (code.length > MAX_CODE_LEN) return fail('That code is too long to be a room.');
    if (!CODE_RE.test(code)) return fail('That code has characters a room code never contains.');

    var res = decodeSafely(code);
    if (!res.ok) return res;
    var room = res.room;

    var name = (room.name || '').trim() || 'IMPORTED ROOM';
    var entry = null, already = false;

    commit(function (w) {
      if (indexOfCode(w.imported, code) >= 0 || indexOfCode(w.rooms, code) >= 0) {
        already = true;
        return;
      }
      entry = {
        id: nextId(name, idsIn(w)),
        name: name,
        code: code,
        importedAt: now(),
        best: null
      };
      w.imported.unshift(entry);
    });

    if (ws) { ws.view = 'imported'; ws.error = ''; render(); }
    return { ok: true, already: already, entry: entry, room: room };
  }

  /* One decode path for every code in the game, ours or a stranger's. */
  function decodeSafely(code) {
    var C = Codec();
    if (!C || typeof C.decode !== 'function') return fail('Codec is not ready yet.');

    var room;
    try { room = C.decode(code); } catch (err) { return fail('That code is not valid.'); }
    if (!room) return fail('That code is not valid.');
    if (!shapeIsSane(room)) return fail('That code is not valid.');

    var R = Room();
    if (R && typeof R.validate === 'function') {
      var v;
      try { v = R.validate(room); } catch (err2) { return fail('That code is not valid.'); }
      if (v && !v.ok) {
        return fail('That room will not load: ' +
          ((v.errors && v.errors[0] && v.errors[0].msg) || 'invalid'));
      }
    }
    return { ok: true, room: room };
  }

  /* Accepts a bare code, a full share line, or an index.html#r=CODE link,
   * because those are the three things people actually paste. */
  function normalise(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    var hash = s.indexOf('#r=');
    if (hash >= 0) s = s.slice(hash + 3);
    if (/\s/.test(s)) {
      var parts = s.split(/\s+/).filter(function (p) {
        return CODE_RE.test(p) && p.length >= 4;
      });
      s = parts.length ? parts[parts.length - 1] : s;
    }
    return s.trim();
  }

  /* Structural sanity independent of the codec, so a codec bug cannot hand
   * the sim a room with a hostile shape. */
  function shapeIsSane(room) {
    if (!room || typeof room !== 'object') return false;
    if (room.w !== K.GRID_W || room.h !== K.GRID_H) return false;
    if (!room.tiles || typeof room.tiles.length !== 'number') return false;
    if (room.tiles.length !== room.w * room.h) return false;
    for (var i = 0; i < room.tiles.length; i++) {
      if (!P.def(room.tiles[i])) return false;
    }
    if (room.params && typeof room.params === 'object') {
      var keys = Object.keys(room.params);
      if (keys.length > room.tiles.length) return false;
      for (var j = 0; j < keys.length; j++) {
        var n = +keys[j];
        if (!(n >= 0 && n < room.tiles.length)) return false;
      }
    }
    return true;
  }

  function fail(msg) {
    if (ws) { ws.error = msg; ws.note = ''; render(); }
    return { ok: false, error: msg };
  }

  /* ------------------------------------------------------------ deep link -- */

  function codeFromLocation() {
    var h = (typeof location !== 'undefined' && location.hash) || '';
    var m = /[#&]r=([A-Za-z0-9_-]+)/.exec(h);
    return m ? m[1] : '';
  }

  function linkFor(code) {
    var base = (typeof location !== 'undefined' && location.href) || 'index.html';
    return base.split('#')[0] + '#r=' + code;
  }

  /* ------------------------------------------------------------- clipboard --
   * navigator.clipboard is missing or refused on file:// in several browsers,
   * so the textarea fallback is not optional. A copy button that silently
   * does nothing is worse than no copy button, which is why every path ends
   * in a visible confirmation.
   */
  function copy(str, thenSay) {
    function done(okFlag) {
      if (!ws) return;
      ws.note = okFlag ? (thenSay || 'Copied.') : 'Copy failed. Select it and copy by hand.';
      ws.error = '';
      render();
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(str).then(
          function () { done(true); },
          function () { done(legacyCopy(str)); }
        );
        return;
      }
    } catch (err) { /* fall through to the legacy path */ }
    done(legacyCopy(str));
  }

  function legacyCopy(str) {
    try {
      var ta = document.createElement('textarea');
      ta.value = str;
      ta.setAttribute('readonly', '');
      ta.className = 'visually-hidden';
      document.body.appendChild(ta);
      ta.select();
      var okFlag = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      return !!okFlag;
    } catch (err) { return false; }
  }

  /* ------------------------------------------------------------------ ui -- */

  function mount(host, opts) {
    opts = opts || {};
    ws = {
      host: host,
      view: opts.view || 'mine',
      error: '', note: '',
      justPublished: null,
      confirming: null,        // id awaiting a second click on DELETE
      renaming: null,          // id whose name field is open
      onPlay: opts.onPlay || null,
      onEdit: opts.onEdit || null,
      onNew: opts.onNew || null,
      onExit: opts.onExit || null,
      unsub: null
    };
    var S = Save();
    if (S && typeof S.subscribe === 'function') {
      ws.unsub = S.subscribe(function (hint) {
        if (!hint || hint === 'workshop') render();
      });
    }
    render();
    return ws;
  }

  function unmount() {
    if (!ws) return;
    if (ws.unsub) ws.unsub();
    if (ws.host) ws.host.innerHTML = '';
    ws = null;
  }

  function render() {
    if (!ws || !ws.host) return;
    ws.host.innerHTML = '';

    var panel = el('div', 'panel panel--wide stack gap-m');

    var bar = el('header', 'row spread gap-m');
    bar.appendChild(text('h1', 'h1', 'WORKSHOP'));
    var actions = el('div', 'row gap-s');
    actions.appendChild(button('btn btn--primary ws-new', 'NEW ROOM', function () {
      if (typeof ws.onNew === 'function') { ws.onNew(); return; }
      var M = Modes();
      if (M) M.go('editor');
    }));
    actions.appendChild(button('btn btn--ghost ws-close', 'CLOSE', function () {
      if (typeof ws.onExit === 'function') { ws.onExit(); return; }
      var M = Modes();
      if (M) M.back();
    }));
    bar.appendChild(actions);
    panel.appendChild(bar);

    var tabs = el('div', 'row gap-s');
    tabs.setAttribute('role', 'tablist');
    [['mine', 'MY ROOMS'], ['imported', 'IMPORTED'], ['import', 'PASTE A CODE']]
      .forEach(function (t) {
        var b = el('button', 'btn btn--ghost ws-tab' + (ws.view === t[0] ? ' is-active' : ''));
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', ws.view === t[0] ? 'true' : 'false');
        b.textContent = t[1];
        b.addEventListener('click', function () {
          ws.view = t[0]; ws.error = ''; ws.note = ''; ws.confirming = null; render();
        });
        tabs.appendChild(b);
      });
    panel.appendChild(tabs);

    if (ws.justPublished) panel.appendChild(publishedPanel(ws.justPublished));
    if (ws.error) panel.appendChild(text('p', 'note danger', ws.error));
    if (ws.note) panel.appendChild(text('p', 'ws-copied', ws.note));

    var w = shelf();
    if (ws.view === 'import') panel.appendChild(importPanel());
    else panel.appendChild(listOf(ws.view === 'mine' ? w.rooms : w.imported, ws.view));

    ws.host.appendChild(panel);
  }

  /* The moment after publish is the only moment the code matters, so it gets
   * a panel rather than being buried in a row. */
  function publishedPanel(entry) {
    var box = el('section', 'ws-published stack gap-s');
    box.appendChild(text('h2', 'label dim', 'PUBLISHED'));
    box.appendChild(text('p', 'h3', entry.name));

    var field = el('input', 'field__input code ws-code mono');
    field.type = 'text';
    field.readOnly = true;
    field.value = entry.code;
    field.setAttribute('aria-label', 'Room code');
    field.addEventListener('focus', function () { field.select(); });
    box.appendChild(field);

    var row = el('div', 'row gap-s wrap');
    row.appendChild(button('btn ws-copy', 'COPY CODE', function () {
      copy(entry.code, 'Room code copied.');
    }));
    row.appendChild(button('btn btn--ghost ws-copy-link', 'COPY LINK', function () {
      copy(linkFor(entry.code), 'Link copied.');
    }));
    box.appendChild(row);

    box.appendChild(text('p', 'small dim measure',
      'That string is the whole room. Anyone who pastes it plays exactly what you built.'));
    return box;
  }

  function importPanel() {
    var box = el('section', 'stack gap-s');
    box.appendChild(text('h2', 'label dim', 'PASTE A CODE'));
    box.appendChild(text('p', 'small dim measure',
      'A room code, or a link containing one. There is no server: the code is the room.'));

    var field = el('textarea', 'field__input ws-paste mono');
    field.rows = 3;
    field.setAttribute('aria-label', 'Room code to import');
    field.placeholder = 'k3f9x2m0qr7v';
    box.appendChild(field);

    var go = button('btn btn--primary ws-import-go', 'IMPORT', function () {
      ws.error = ''; ws.note = '';
      var res = importCode(field.value);
      if (res.ok) {
        ws.note = res.already
          ? 'You already had that room.'
          : 'Imported ' + (res.entry ? res.entry.name : 'the room') + '.';
      }
      render();
    });
    box.appendChild(go);
    field.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) go.click();
    });
    return box;
  }

  function listOf(entries, kind) {
    var box = el('section', 'stack gap-s');
    if (!entries.length) {
      box.appendChild(text('p', 'small dim measure', kind === 'mine'
        ? 'No rooms yet. Build one, clear it yourself, then publish it.'
        : 'Nothing imported yet. Paste a code and it lands here.'));
      return box;
    }
    var grid = el('div', 'ws-grid');
    entries.forEach(function (entry) { grid.appendChild(rowFor(entry, kind)); });
    box.appendChild(grid);
    return box;
  }

  function rowFor(entry, kind) {
    /* A card, not a row: Ink's .ws-grid reflows to the window, which is what
     * makes the library usable in mobile portrait. */
    var card = el('div', 'ws-card');

    if (ws.renaming === entry.id) {
      var input = el('input', 'field__input ws-rename');
      input.type = 'text';
      input.maxLength = 24;
      input.value = entry.name;
      input.setAttribute('aria-label', 'Rename room');
      card.appendChild(input);
      var renameRow = el('div', 'row gap-s');
      renameRow.appendChild(button('btn ws-rename-ok', 'SAVE', function () {
        rename(entry, input.value);
      }));
      renameRow.appendChild(button('btn btn--ghost', 'CANCEL', function () {
        ws.renaming = null; render();
      }));
      card.appendChild(renameRow);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') rename(entry, input.value);
        if (e.key === 'Escape') { ws.renaming = null; render(); }
      });
    } else {
      card.appendChild(text('span', 'ws-card__name', entry.name));
      var meta = el('div', 'ws-card__meta row gap-s wrap');
      meta.appendChild(text('span', '', bestLine(entry)));
      if (entry.cost != null) meta.appendChild(text('span', '', entry.cost + '/' + K.EDITOR_BUDGET));
      if (kind === 'mine' && entry.ghost) meta.appendChild(text('span', 'tag tag--brass', 'PROVED'));
      card.appendChild(meta);
      card.appendChild(text('span', 'ws-card__code', entry.code));
    }

    var acts = el('div', 'row gap-s wrap');
    acts.appendChild(button('btn ws-play', 'PLAY', function () { play(entry); }));
    if (kind === 'mine') {
      acts.appendChild(button('btn btn--ghost ws-edit', 'EDIT', function () { edit(entry); }));
      acts.appendChild(button('btn btn--ghost ws-duplicate', 'DUPLICATE', function () {
        duplicate(entry);
      }));
    }
    acts.appendChild(button('btn btn--ghost ws-renamebtn', 'RENAME', function () {
      ws.renaming = entry.id; ws.confirming = null; render();
    }));
    acts.appendChild(button('btn btn--ghost ws-share', 'COPY CODE', function () {
      copy(entry.code, 'Room code copied.');
    }));
    if (entry.best) {
      acts.appendChild(button('btn btn--ghost ws-result', 'COPY RESULT', function () {
        copy(resultLine(entry), 'Result copied.');
      }));
    }

    /* Delete asks twice rather than opening a dialog. The second click is the
     * confirmation, and clicking anything else cancels it. */
    if (ws.confirming === entry.id) {
      acts.appendChild(button('btn btn--danger ws-delete-confirm', 'DELETE, REALLY?', function () {
        remove(entry, kind);
      }));
      acts.appendChild(button('btn btn--ghost', 'KEEP IT', function () {
        ws.confirming = null; render();
      }));
    } else {
      acts.appendChild(button('btn btn--ghost ws-delete', 'DELETE', function () {
        ws.confirming = entry.id; render();
      }));
    }
    card.appendChild(acts);
    return card;
  }

  function rename(entry, raw) {
    var name = String(raw || '').trim().slice(0, 24) || entry.name;
    commit(function (w) {
      [w.rooms, w.imported].forEach(function (arr) {
        var i = indexOfId(arr, entry.id);
        if (i >= 0) { arr[i].name = name; arr[i].updatedAt = now(); }
      });
    });
    ws.renaming = null;
    render();
  }

  /* A duplicate is a fresh unproved draft. It carries the code so the editor
   * can open it, but NOT the author ghost: nobody has cleared this copy, and
   * the moment you change it the ghost would be a lie anyway. */
  function duplicate(entry) {
    var copyName = (entry.name + ' COPY').slice(0, 24);
    commit(function (w) {
      w.rooms.unshift({
        id: nextId(copyName, idsIn(w)),
        name: copyName,
        code: entry.code,
        createdAt: now(),
        updatedAt: now(),
        ghost: null,
        best: null
      });
    });
    if (ws) { ws.note = 'Duplicated. The copy is unproved until you clear it.'; render(); }
  }

  function bestLine(entry) {
    if (!entry.best) return 'not cleared';
    return 'best ' + clock(entry.best.ticks) + ' · ' + entry.best.deaths +
      (entry.best.deaths === 1 ? ' death' : ' deaths');
  }

  function clock(ticks) {
    var total = Math.round((ticks || 0) / K.TICK_HZ);
    var m = (total / 60) | 0, s = total % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* Result strings always carry a par denominator (SPEC §5.2). share.js owns
   * the wording when it is up; this is the fallback so the button is never
   * dead. */
  function resultLine(entry) {
    var S = Share();
    if (S && typeof S.roomLine === 'function') {
      try { return S.roomLine(entry); }
      catch (err) {
        /* The button still works, so the player sees nothing wrong. Say it
         * anyway: this is share.js failing, and silence here is how it stays
         * broken. */
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('BAIT workshop: Share.roomLine threw, using the fallback line. ' +
                       ((err && err.message) || err));
        }
      }
    }
    var b = entry.best;
    return 'BAIT room ' + entry.code +
      ' · cleared in ' + b.deaths + (b.deaths === 1 ? ' death' : ' deaths') +
      ' · ' + clock(b.ticks) +
      (entry.ghost ? ' (par ' + clock(entry.ghost.ticks) + ')' : '');
  }

  function play(entry) {
    var res = decodeEntry(entry);
    if (!res.ok) return;
    if (typeof ws.onPlay === 'function') { ws.onPlay(res.room, entry); return; }
    var Pl = BAIT.Play, M = Modes();
    if (!Pl || !M) return fail('Play is not wired up yet.');
    if (!M.go('playing', { origin: 'workshop' })) return fail('Cannot start from here.');
    Pl.begin(res.room, {
      origin: 'workshop', roomId: entry.id, code: entry.code,
      ghost: entry.ghost ? entry.ghost.rle : null
    });
  }

  function edit(entry) {
    var res = decodeEntry(entry);
    if (!res.ok) return;
    if (typeof ws.onEdit === 'function') { ws.onEdit(res.room, entry); return; }
    var M = Modes();
    if (M) M.go('editor', { room: res.room, entry: entry });
  }

  /* Even our own saved rooms are re-validated on the way out. A save file can
   * be hand-edited, so a room from localStorage is no more trusted than a
   * room from Discord. */
  function decodeEntry(entry) {
    var res = decodeSafely(entry.code);
    if (!res.ok) {
      return fail('That saved room will not load. Its code is damaged.');
    }
    res.room.name = entry.name || res.room.name;
    return res;
  }

  function remove(entry, kind) {
    commit(function (w) {
      var arr = kind === 'mine' ? w.rooms : w.imported;
      var i = indexOfId(arr, entry.id);
      if (i >= 0) arr.splice(i, 1);
    });
    if (ws) {
      ws.confirming = null;
      if (ws.justPublished && ws.justPublished.id === entry.id) ws.justPublished = null;
      ws.note = 'Deleted ' + entry.name + '.';
      render();
    }
  }

  /* Called when a run on a workshop room finishes, so the library shows a best
   * time. Keyed by CODE, per Relay: the code is the room's identity, and a
   * room played from a #r= link has no entry on either shelf. That is origin
   * 'link' and nothing persists, which is correct — we do not silently adopt
   * rooms the player never chose to keep.
   *
   * In workshop.rooms the ghost is the prove-gate author ghost and is never
   * overwritten by a play run. In imported it is your own best line, so a
   * strictly faster clear replaces it.
   */
  function recordRun(code, run) {
    if (!code || !run || !run.cleared) return false;
    var found = false;
    commit(function (w) {
      var i = indexOfCode(w.rooms, code);
      if (i >= 0) {
        found = true;
        bumpBest(w.rooms[i], run, false);
        return;
      }
      i = indexOfCode(w.imported, code);
      if (i >= 0) { found = true; bumpBest(w.imported[i], run, true); }
    });
    return found;
  }

  function bumpBest(entry, run, ghostIsBestRun) {
    var ticks = run.ticks | 0;
    if (entry.best && ticks >= entry.best.ticks) return;
    entry.best = { ticks: ticks, deaths: run.deaths | 0, at: now() };
    entry.updatedAt = now();
    /* Never clobber an author ghost: it is the proof this room was cleared by
     * the person who published it. */
    if (ghostIsBestRun && run.ghost) {
      entry.ghost = { rle: String(run.ghost), ticks: ticks, at: now() };
    }
  }

  /* ----------------------------------------------------------------- api -- */

  BAIT.Workshop = {
    mount: mount,
    unmount: unmount,
    publish: publish,
    importCode: importCode,
    recordRun: recordRun,
    codeFromLocation: codeFromLocation,
    linkFor: linkFor,
    copy: copy,
    /* boot.js calls this for an index.html#r=CODE deep link. Returns the room
     * or null, and never throws: a bad link shows a message, not a stack. */
    roomFromLink: function () {
      var code = codeFromLocation();
      if (!code) return null;
      var res = decodeSafely(code);
      return res.ok ? res.room : null;
    },
    list: function () { var w = shelf(); return { rooms: w.rooms, imported: w.imported }; }
  };

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

})(window.BAIT = window.BAIT || {});
