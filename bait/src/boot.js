/* BAIT — boot and wire-up.
 *
 * OWNER: Boss. This is the only file that knows about every other module,
 * which is deliberate: it keeps the wiring in one reviewable place instead of
 * letting each module reach into three others.
 *
 * Responsibilities, and nothing else:
 *   1. Report missing modules readably instead of white-screening.
 *   2. Load the save.
 *   3. Decide the first screen: a #r= room code beats the title screen.
 *   4. Start the one rAF loop and route ticks/frames to the active mode.
 *   5. Catch anything thrown anywhere and put it on screen.
 */
(function (BAIT) {
  'use strict';

  var REQUIRED = [
    ['Fixed', 'src/core/fixed.js'], ['Rng', 'src/core/rng.js'],
    ['Pieces', 'src/core/pieces.js'], ['Room', 'src/core/room.js'],
    ['Sim', 'src/core/sim.js'], ['Codec', 'src/core/codec.js'],
    ['Replay', 'src/core/replay.js'], ['Theme', 'src/render/theme.js'],
    ['Draw', 'src/render/draw.js'], ['Fx', 'src/render/fx.js'],
    ['Audio', 'src/render/audio.js'], ['Input', 'src/game/input.js'],
    ['Loop', 'src/game/loop.js'], ['Save', 'src/game/save.js'],
    ['Daily', 'src/game/daily.js'], ['Share', 'src/game/share.js'],
    ['Modes', 'src/game/modes.js'], ['Play', 'src/game/play.js'],
    ['Screens', 'src/ui/screens.js'], ['Hud', 'src/ui/hud.js'],
    ['Editor', 'src/ui/editor.js'], ['Workshop', 'src/ui/workshop.js'],
    ['Chapters', 'src/data/chapters.js']
  ];

  /* OPTIONAL modules degrade instead of blocking. Solve is the room solver:
   * the campaign and the daily are both verified at BUILD time by
   * tools/verify.cjs, so at runtime it powers only the editor's advisory
   * "no solution found" hint. An advisory feature must never be able to stop
   * the game from starting — but a missing file must not be silent either,
   * so it warns. */
  var OPTIONAL = [['Solve', 'src/core/solve.js']];

  /* A bare <pre> of what is wrong beats a blank page every time. This is the
   * one place in the game allowed to write its own styles, because it has to
   * work when the stylesheet itself is what failed. */
  function fatal(title, detail) {
    try {
      var el = document.createElement('pre');
      el.setAttribute('role', 'alert');
      el.style.cssText = 'position:fixed;inset:0;z-index:99999;margin:0;' +
        'padding:32px;background:#141821;color:#e8e4d9;font:13px/1.6 ' +
        'ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;' +
        'overflow:auto';
      el.textContent = 'BAIT failed to start\n\n' + title +
        (detail ? '\n\n' + detail : '');
      document.body.appendChild(el);
    } catch (e) { /* nothing left to try */ }
  }

  function missingModules() {
    var out = [];
    for (var i = 0; i < REQUIRED.length; i++) {
      if (!BAIT[REQUIRED[i][0]]) out.push(REQUIRED[i][1]);
    }
    return out;
  }

  function readRoomCode() {
    var h = String(location.hash || '');
    var m = /[#&]r=([A-Za-z0-9_\-]+)/.exec(h);
    return m ? m[1] : null;
  }

  /* ------------------------------------------------------------- routing --
   * The one place that maps "which mode are we in" onto "what is on screen".
   * Relay's Modes owns the state; Frame's Screens, Chisel's Editor and
   * Workshop own the pixels; this function is the only thing that knows both.
   * Without it the mode machine emits into the void, which is exactly what it
   * was doing before this was written.
   *
   * Editor and Workshop are MOUNTED rather than shown, and mounting is
   * expensive, so we only do it on a genuine change of state.
   */
  var mounted = null;

  function unmountAll(except) {
    if (mounted && mounted !== except) {
      if (mounted === 'editor' && BAIT.Editor.unmount) BAIT.Editor.unmount();
      if (mounted === 'workshop' && BAIT.Workshop.unmount) BAIT.Workshop.unmount();
      mounted = null;
    }
  }

  function mountEditor(ui, ctx) {
    if (mounted === 'editor') return;
    unmountAll('editor');
    mounted = 'editor';
    BAIT.Editor.mount(ui, {
      room: ctx && ctx.room,
      entryId: ctx && ctx.entryId,
      authorGhost: ctx && ctx.authorGhost,
      onExit: function () { BAIT.Modes.go('workshop'); },
      onTest: function (room) { BAIT.Play.begin(room, { origin: 'editor' }); },
      onPublish: function () { BAIT.Modes.go('workshop'); }
    });
    /* The main loop only paints during 'playing'/'results', so nothing would
     * ever draw the editor's board. It redraws on demand instead, which is
     * cheaper than a per-frame repaint of a static grid — but it has to be
     * kicked once on mount or the board stays black. */
    if (BAIT.Editor.redraw) BAIT.Editor.redraw();
  }

  function mountWorkshop(ui) {
    if (mounted === 'workshop') return;
    unmountAll('workshop');
    mounted = 'workshop';
    BAIT.Workshop.mount(ui, {
      /* Carry the library entry through. Without entryId the editor cannot
       * tell "republish of an existing room" from "brand new room", so
       * reopening a published room and republishing it silently created a
       * SECOND library row instead of updating the first. */
      onEdit: function (room, entry) {
        BAIT.Modes.go('editor', {
          room: room,
          entryId: entry && entry.id,
          authorGhost: entry && entry.ghost
        });
      },
      onPlay: function (room, entry) {
        BAIT.Play.begin(room, {
          origin: 'workshop', roomId: entry && entry.id,
          code: entry && entry.code,
          ghost: entry && entry.ghost && entry.ghost.rle
        });
      },
      onExit: function () { BAIT.Modes.go('title'); }
    });
  }

  function route(snap) {
    var ui = document.getElementById('ui');
    var S = BAIT.Screens, H = BAIT.Hud;

    /* An overlay wins the screen without disturbing what is under it — that
     * is the whole reason Modes keeps a stack rather than a single state. */
    if (snap.overlay === 'paused')   { S.show('pause', snap.overlayCtx); return; }
    if (snap.overlay === 'settings') { S.show('settings', snap.overlayCtx); return; }

    switch (snap.state) {
      case 'title':
        unmountAll(); H.hide(); S.show('title', snap.ctx); break;
      case 'chapters':
        unmountAll(); H.hide(); S.show('chapters', snap.ctx); break;
      case 'gauntlet':
        unmountAll(); H.hide(); S.show('gauntlet', snap.ctx); break;
      case 'workshop':
        H.hide(); S.hide(); mountWorkshop(ui); break;
      case 'editor':
        H.hide(); S.hide(); mountEditor(ui, snap.ctx); break;
      case 'playing':
        /* The editor stays MOUNTED behind a test run so returning to it keeps
         * the author's undo stack and their unsaved work. */
        if (snap.ctx && snap.ctx.origin !== 'editor') unmountAll();
        S.hide(); H.show(); break;
      case 'results':
        H.hide(); S.show('results', snap.ctx && snap.ctx.summary); break;
    }
  }

  function start() {
    var missing = missingModules();
    if (missing.length) {
      return fatal(
        missing.length + ' module(s) did not load or did not register:',
        missing.join('\n') +
        '\n\nEach file must attach its namespace to the global BAIT object.' +
        '\nIf you opened this over file://, check for a syntax error in the' +
        '\nfiles above — a parse error registers nothing and is silent.');
    }

    for (var o = 0; o < OPTIONAL.length; o++) {
      if (!BAIT[OPTIONAL[o][0]]) {
        console.warn('BAIT: optional module ' + OPTIONAL[o][1] +
          ' did not register. The game runs; editor solve hints are off.');
      }
    }

    var canvas = document.getElementById('stage');
    var ui = document.getElementById('ui');
    if (!canvas || !ui) return fatal('index.html is missing #stage or #ui.');

    /* Order matters: theme paints the CSS custom properties the whole DOM
     * layer reads, so it goes before any screen is built. Audio deliberately
     * does NOT start here — Chrome blocks an AudioContext created before a
     * user gesture, so Audio.init() is called on the first real input. */
    BAIT.Theme.install();
    BAIT.Save.load();
    /* Stamp solver-computed par times onto the rooms. Without this every
     * room's par is null and the Swift medal is unwinnable — the numbers are
     * generated, never hand-typed, so they cannot drift from the sim. */
    if (BAIT.Chapters.applyPar) BAIT.Chapters.applyPar();
    BAIT.Draw.init(canvas);
    BAIT.Input.init(window, canvas);
    /* Screens and Hud find #ui themselves and build lazily, so they need no
     * init. The router below is what actually drives them. */
    route(BAIT.Modes.snapshot());
    BAIT.Modes.subscribe(route);

    /* A room code in the URL is an explicit request to play that room, so it
     * outranks the title screen. An invalid code must land on the title with
     * a message rather than a dead screen — a bad link is the most common way
     * a stranger meets this game. */
    var code = readRoomCode();
    if (code) {
      var room = BAIT.Codec.decode(code);
      if (room) BAIT.Play.begin(room, { origin: 'link', code: code });
      else BAIT.Modes.go('title', { notice: "That room code isn't valid." });
    } else {
      BAIT.Modes.go('title', {});
    }

    /* One loop for the whole game. Modules never start their own rAF —
     * two loops means two clocks and the interpolation stops matching. */
    BAIT.Loop.start(
      function onTick() { BAIT.Play.tick(); },
      function onRender(alpha, nowMs) { BAIT.Play.render(alpha, nowMs); }
    );
  }

  /* Anything that escapes anywhere lands here. A game that dies silently
   * mid-session is unreportable, and Sieve has to be able to report it. */
  window.addEventListener('error', function (e) {
    fatal('Uncaught error: ' + (e.message || e.type),
      e.filename ? e.filename + ':' + e.lineno : '');
  });
  window.addEventListener('unhandledrejection', function (e) {
    fatal('Unhandled promise rejection', String(e.reason && e.reason.stack ||
      e.reason || ''));
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      try { start(); } catch (e) { fatal(String(e && e.stack || e)); }
    });
  } else {
    try { start(); } catch (e) { fatal(String(e && e.stack || e)); }
  }

})(window.BAIT = window.BAIT || {});
