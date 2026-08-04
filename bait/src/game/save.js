/* BAIT — save. ONE localStorage key, ONE versioned JSON document.
 *
 * OWNER: Relay.
 *
 * The three rules this file lives by (SPEC §4.3, and the assignment):
 *   1. A corrupt or absent save must NEVER break boot. Parse in try/catch,
 *      keep the corrupt blob under a backup key, start fresh.
 *   2. Writes are debounced, never per-frame. localStorage is synchronous
 *      and a per-tick write is a guaranteed stutter.
 *   3. A quota-exceeded write evicts ghosts first, imported rooms second,
 *      and never loses medals.
 *
 * Everyone reads through Save.get() and writes through Save.change() /
 * Save.patch(). Nobody else touches localStorage — one key, one owner.
 *
 * DOCUMENT SCHEMA v1
 * {
 *   v: 1,
 *   settings: {
 *     volume: 0..1, muted: bool, ghosts: bool, reducedMotion: bool,
 *     colorAssist: bool,          // colourblind-safe hazard hatching
 *     keys: {}                    // opaque; owned by BAIT.Input.rebind
 *   },
 *   campaign: {
 *     rooms: {                    // keyed by campaign room id from chapters.js
 *       [roomId]: {
 *         medals: { clear: bool, clean: bool, swift: bool, token: bool },
 *         bestTicks: int|null,    // best clear, in sim ticks (120/s)
 *         ghost: { rle: string, ticks: int, at: int }|null   // best-run ghost
 *       }
 *     }
 *   },
 *   daily: {
 *     history: {                  // keyed by 'YYYYMMDD' string
 *       [dateSeed]: { started: bool, done: bool, cleared: 0..5,
 *                     deaths: int, ticks: int, at: int }
 *     }
 *   },
 *   workshop: {                 // shape agreed with Chisel in #bait-build
 *     rooms: [ { id: string, name: string, code: string, cost: int,
 *                createdAt: int, updatedAt: int,
 *                ghost: { rle: string, ticks: int, at: int }|null,  // author ghost
 *                best: { ticks: int, deaths: int, at: int }|null } ],
 *     imported: [ { id: string, name: string, code: string,
 *                   importedAt: int,
 *                   ghost: { rle: string, ticks: int, at: int }|null, // best run
 *                   best: { ticks: int, deaths: int, at: int }|null } ]
 *   }
 * }
 *
 * In workshop.rooms the ghost IS the prove-gate author ghost; in imported
 * it is your best run on that room. Same shape, different meaning, and
 * eviction treats the author ghost as the most precious (it is the proof
 * the room is solvable and the ghost other players race).
 */
(function (BAIT) {
  'use strict';

  var KEY = 'bait.save';
  var BACKUP_KEY = 'bait.save.corrupt';
  var VERSION = 1;
  var DEBOUNCE_MS = 400;

  /* Cap on the combined size of every stored ghost string. Ghosts are the
   * only unbounded thing in the document; without this cap a long-lived
   * profile eats the ~5MB quota and takes the medals down with it. */
  var GHOST_CHAR_CAP = 150000;

  function fresh() {
    return {
      v: VERSION,
      settings: {
        volume: 0.8,
        muted: false,
        ghosts: true,
        reducedMotion: false,
        colorAssist: false,
        keys: {}
      },
      campaign: { rooms: {} },
      daily: { history: {} },
      workshop: { rooms: [], imported: [] }
    };
  }

  /* MIGRATIONS[n] lifts a document from version n to n+1. There are none
   * yet; the loop and the shape are here so v2 is a one-entry change. */
  var MIGRATIONS = {};

  function migrate(doc) {
    while (doc.v < VERSION) {
      var step = MIGRATIONS[doc.v];
      if (!step) return fresh();       // unknown gap: safer to start over
      doc = step(doc);
    }
    return doc;
  }

  /* Fill any hole in an old or hand-edited document with defaults, so
   * consumers never null-check structure, only leaves. */
  function heal(doc) {
    var base = fresh();
    if (!doc || typeof doc !== 'object') return base;
    doc.settings = merge(base.settings, doc.settings);
    doc.campaign = doc.campaign && typeof doc.campaign === 'object'
      ? doc.campaign : base.campaign;
    if (!doc.campaign.rooms || typeof doc.campaign.rooms !== 'object') {
      doc.campaign.rooms = {};
    }
    doc.daily = doc.daily && typeof doc.daily === 'object'
      ? doc.daily : base.daily;
    if (!doc.daily.history || typeof doc.daily.history !== 'object') {
      doc.daily.history = {};
    }
    doc.workshop = doc.workshop && typeof doc.workshop === 'object'
      ? doc.workshop : base.workshop;
    if (!isArray(doc.workshop.rooms)) doc.workshop.rooms = [];
    if (!isArray(doc.workshop.imported)) doc.workshop.imported = [];
    return doc;
  }

  function merge(defaults, got) {
    if (!got || typeof got !== 'object') return defaults;
    for (var k in defaults) {
      if (!(k in got)) got[k] = defaults[k];
    }
    return got;
  }

  function isArray(a) {
    return Object.prototype.toString.call(a) === '[object Array]';
  }

  /* localStorage can throw on access (privacy modes, disabled storage).
   * Every touch goes through these two. */
  function storeRead(key) {
    try { return window.localStorage.getItem(key); }
    catch (e) { return null; }
  }
  function storeWrite(key, value) {
    try { window.localStorage.setItem(key, value); return true; }
    catch (e) { return false; }
  }

  var doc = null;
  var subs = [];
  var timer = null;
  var warned = false;

  function load() {
    if (doc) return doc;
    var raw = storeRead(KEY);
    if (raw === null) {
      doc = fresh();
      return doc;
    }
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' ||
          typeof parsed.v !== 'number') throw new Error('bad shape');
      doc = heal(migrate(parsed));
    } catch (e) {
      /* Rule 1: never break boot, never destroy evidence. */
      storeWrite(BACKUP_KEY, raw);
      doc = fresh();
      if (typeof console !== 'undefined') {
        console.warn('BAIT.Save: save was unreadable; started fresh. ' +
                     'The old blob is under "' + BACKUP_KEY + '".');
      }
    }
    return doc;
  }

  /* ------------------------------------------------------------ eviction --
   * Called only when a write hits quota. Order is the contract: ghosts
   * first (recomputable by playing), imported rooms second (recoverable
   * by re-pasting the code), medals never.
   */
  function collectGhosts(d) {
    var out = [];
    var rooms = d.campaign.rooms;
    for (var id in rooms) {
      if (rooms[id] && rooms[id].ghost) {
        out.push({ holder: rooms[id], field: 'ghost',
                   at: rooms[id].ghost.at | 0,
                   size: (rooms[id].ghost.rle || '').length });
      }
    }
    var i, m;
    for (i = 0; i < d.workshop.imported.length; i++) {
      m = d.workshop.imported[i];
      if (m.ghost) {
        out.push({ holder: m, field: 'ghost',
                   at: m.ghost.at | 0,
                   size: (m.ghost.rle || '').length });
      }
    }
    for (i = 0; i < d.workshop.rooms.length; i++) {
      m = d.workshop.rooms[i];
      /* The author ghost is the prove-gate's proof and the published
       * ghost — it is last in line, after every best-run ghost. The
       * epoch offset keeps it sorted behind everything datable. */
      if (m.ghost) {
        out.push({ holder: m, field: 'ghost',
                   at: 2000000000000 + (m.ghost.at | 0),
                   size: (m.ghost.rle || '').length });
      }
    }
    return out;
  }

  function ghostChars(d) {
    var list = collectGhosts(d), n = 0;
    for (var i = 0; i < list.length; i++) n += list[i].size;
    return n;
  }

  /* Drop oldest ghosts until total ghost storage fits the cap (or the
   * given target). Returns true if anything was dropped. */
  function evictGhosts(d, targetChars) {
    var list = collectGhosts(d);
    list.sort(function (a, b) { return a.at - b.at; });   // oldest first
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += list[i].size;
    var dropped = false;
    for (i = 0; i < list.length && total > targetChars; i++) {
      total -= list[i].size;
      list[i].holder[list[i].field] = null;
      dropped = true;
    }
    return dropped;
  }

  function evictImported(d) {
    if (!d.workshop.imported.length) return false;
    /* Oldest import goes first. */
    d.workshop.imported.sort(function (a, b) {
      return (a.importedAt | 0) - (b.importedAt | 0);
    });
    d.workshop.imported.shift();
    return true;
  }

  /* -------------------------------------------------------------- persist */
  function persist() {
    timer = null;
    if (!doc) return;
    /* Keep the ghost store inside its cap even when quota is nowhere
     * near — the cap is policy, not just an emergency valve. */
    if (ghostChars(doc) > GHOST_CHAR_CAP) evictGhosts(doc, GHOST_CHAR_CAP);

    if (storeWrite(KEY, JSON.stringify(doc))) return;

    /* Quota (or storage failure). Evict in contract order, bounded. */
    for (var attempt = 0; attempt < 40; attempt++) {
      var changed = evictGhosts(doc, attempt === 0 ? GHOST_CHAR_CAP / 2 : 0) ||
                    evictImported(doc);
      if (!changed) break;
      if (storeWrite(KEY, JSON.stringify(doc))) return;
    }
    /* Storage is genuinely unavailable. The in-memory document stays
     * authoritative for this session; say so once, quietly. */
    if (!warned && typeof console !== 'undefined') {
      warned = true;
      console.warn('BAIT.Save: localStorage unavailable or full; ' +
                   'progress will not survive this session.');
    }
  }

  function schedule() {
    if (timer !== null) return;
    timer = setTimeout(persist, DEBOUNCE_MS);
  }

  function flush() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    persist();
  }

  /* ------------------------------------------------------------------ api */
  function notify(hint) {
    for (var i = 0; i < subs.length; i++) {
      try { subs[i](doc, hint || null); }
      catch (e) {
        if (typeof console !== 'undefined') {
          console.error('BAIT.Save: subscriber threw', e);
        }
      }
    }
  }

  /* Read access. Treat the result as read-only — mutations that bypass
   * change()/patch() are never persisted and never notified. */
  function get(path) {
    var d = load();
    if (!path) return d;
    var parts = path.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (d == null || typeof d !== 'object') return undefined;
      d = d[parts[i]];
    }
    return d;
  }

  /* Set one dot-path leaf: Save.patch('settings.volume', 0.5). Creates
   * intermediate objects. Debounce-persists and notifies. */
  function patch(path, value) {
    var d = load();
    var parts = path.split('.');
    var target = d;
    for (var i = 0; i < parts.length - 1; i++) {
      var k = parts[i];
      if (target[k] == null || typeof target[k] !== 'object') target[k] = {};
      target = target[k];
    }
    target[parts[parts.length - 1]] = value;
    schedule();
    notify(path);
    return value;
  }

  /* Multi-field updates in one transaction: Save.change(function (doc) {
   * ...mutate... }). One persist, one notification. */
  function change(fn, hint) {
    var d = load();
    fn(d);
    schedule();
    notify(hint || null);
    return d;
  }

  function subscribe(fn) {
    subs.push(fn);
    return function unsubscribe() {
      var i = subs.indexOf(fn);
      if (i >= 0) subs.splice(i, 1);
    };
  }

  /* THE single write path for campaign medals, best times and the
   * best-run ghost. Called by play.js with the run summary:
   *   { medals: {clear,clean,swift,token}, ticks, deaths, replay, ... }
   * Medals only ever accrue — a bad later run can never un-earn one.
   * The ghost is replaced only by a strictly faster clear. */
  function recordRun(roomId, summary) {
    if (!roomId || !summary) return null;
    return change(function (d) {
      var rooms = d.campaign.rooms;
      var r = rooms[roomId];
      if (!r) {
        r = rooms[roomId] = {
          medals: { clear: false, clean: false, swift: false, token: false },
          bestTicks: null,
          ghost: null
        };
      }
      var m = summary.medals || {};
      r.medals.clear = r.medals.clear || !!m.clear;
      r.medals.clean = r.medals.clean || !!m.clean;
      r.medals.swift = r.medals.swift || !!m.swift;
      r.medals.token = r.medals.token || !!m.token;
      if (m.clear) {
        var t = summary.ticks | 0;
        if (r.bestTicks == null || t < r.bestTicks) {
          r.bestTicks = t;
          if (typeof summary.replay === 'string' && summary.replay) {
            r.ghost = { rle: summary.replay, ticks: t, at: Date.now() };
          }
        }
      }
    }, 'campaign.rooms.' + roomId);
  }

  /* Wipe everything, deliberately (settings screen "reset progress").
   * Keeps the corrupt-backup key: it is evidence, not progress. */
  function reset() {
    doc = fresh();
    flush();
    notify(null);
    return doc;
  }

  BAIT.Save = {
    load: load,
    get: get,
    patch: patch,
    change: change,
    /* Aliases agreed with Chisel in #bait-build: read() is get() with no
     * path, update(fn) is change(fn). Same code paths, second spelling. */
    read: function () { return load(); },
    update: change,
    recordRun: recordRun,
    subscribe: subscribe,
    flush: flush,
    reset: reset,
    fresh: fresh,          // exposed for tests
    KEY: KEY,
    VERSION: VERSION
  };

  /* The debounce means a tab closed inside the window would drop the last
   * write. pagehide is the reliable end-of-life signal (unload is not,
   * on mobile); visibilitychange->hidden covers task-switching. */
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('pagehide', flush);
    window.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });
  }

})(typeof window !== 'undefined'
  ? (window.BAIT = window.BAIT || {})
  : (global.BAIT = global.BAIT || {}));
