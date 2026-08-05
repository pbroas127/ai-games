/* BAIT — the play session.
 *
 * OWNER: Boss. The seam between Forge's sim, Ink's renderer, Frame's HUD and
 * Relay's mode machine. It owns the live run and nothing else owns any part
 * of it: one sim instance, one recorder, one death/clear lifecycle.
 *
 * The rule this file exists to protect: DEATH IS CHEAP. Retry is available on
 * the very next frame, with no transition, no fade and no confirmation. The
 * death replay is an OPTIONAL flourish that an impatient player never sees —
 * the moment they press a direction we are already running again. If retry
 * ever costs more than one frame, the whole design collapses (SPEC §2).
 */
(function (BAIT) {
  'use strict';

  var Sim, Replay, Modes, Input, Draw, Fx, Audio, Hud;

  /* Resolved lazily: boot.js has already proven every module registered, but
   * this file is loaded before some of them and must not capture undefined. */
  function wire() {
    Sim = BAIT.Sim; Replay = BAIT.Replay; Modes = BAIT.Modes;
    Input = BAIT.Input; Draw = BAIT.Draw; Fx = BAIT.Fx;
    Audio = BAIT.Audio; Hud = BAIT.Hud;
  }

  var s = null;          // the live session, or null when not playing
  var DEATH_HOLD = 30;   // ticks of stillness before the replay offers itself

  function fresh(room, opts) {
    return {
      room: room,
      opts: opts || {},
      origin: (opts && opts.origin) || 'campaign',
      roomId: (opts && opts.roomId) || null,

      /* create() already positions the dot on the start tile; the reset is
       * belt-and-braces so begin() and retry() provably produce byte-identical
       * starting states. Determinism is worth one redundant call. */
      state: (function () { var st = Sim.create(room); Sim.reset(st); return st; })(),
      rec: Replay.record(),

      deaths: 0,          // this ATTEMPT — a fresh attempt resets it to 0,
                          // which is what makes the Clean medal mean something
      ticks: 0,
      phase: 'run',       // 'run' | 'dead' | 'clear'
      deadFor: 0,

      ghost: null,        // {state, inputs, i} replayed alongside, or null
      audioStarted: false,
      lastX: 0, lastY: 0  // previous frame's sim position, for footstep cadence
    };
  }

  function attachGhost(sess, inputs) {
    if (!inputs || !inputs.length) return null;
    var st = Sim.create(sess.room);
    Sim.reset(st);                     // same guarantee as the player's state
    return { state: st, inputs: inputs, i: 0 };
  }

  /* ------------------------------------------------------------- lifecycle -- */

  function begin(room, opts) {
    wire();
    if (!room) return false;

    s = fresh(room, opts);

    var g = opts && opts.ghost;
    if (g) {
      try { s.ghost = attachGhost(s, Replay.fromString(g)); }
      catch (e) { s.ghost = null; }   // a corrupt ghost must never block play
    }

    if (Draw.setRoom) Draw.setRoom(room);
    Modes.go('playing', {
      origin: s.origin, roomId: s.roomId,
      code: opts && opts.code, originCtx: opts && opts.originCtx
    });
    return true;
  }

  /* Start a CAMPAIGN room by id ("2-07"). Chapter select hands us an id and
   * nothing else, so the id-to-playable-room step has to live somewhere; it
   * lives here rather than in the screen, because parsing the grid, stamping
   * par and finding the saved ghost are all facts about a play session and
   * none of them are facts about a menu. Every caller that wants to play a
   * campaign room calls THIS — there is no second path that could disagree
   * about which ghost or which par a room gets.
   *
   * Returns false rather than throwing on an unknown or unparseable id: a
   * broken room must lose you one menu click, not the whole game. */
  function beginCampaign(roomId) {
    wire();
    var C = BAIT.Chapters;
    var entry = C && C.byId && C.byId(roomId);
    if (!entry) return false;

    var room;
    try { room = BAIT.Room.fromText(entry.lines, entry.params); }
    catch (e) { return false; }
    if (!room || (room.parseErrors && room.parseErrors.length)) return false;

    room.id = entry.id;
    room.name = entry.name || entry.id;
    /* par is stamped onto the ENTRY at boot by Chapters.applyPar, so read it
     * from there — a room freshly parsed from text has none. */
    room.par = entry.par || null;

    /* Your own best line, raced as a ghost, unless you have turned ghosts off. */
    var ghost = null;
    try {
      var doc = BAIT.Save.read && BAIT.Save.read();
      /* doc.campaign.rooms, NOT doc.rooms — Relay caught this reading the
       * schema rather than the code. Wrong by one level is silent here: the
       * lookup just yields undefined, no ghost attaches, and the feature is
       * simply missing with nothing to grep for. */
      var camp = doc && doc.campaign;
      var rec = camp && camp.rooms && camp.rooms[roomId];
      if (rec && rec.ghost && rec.ghost.rle &&
          !(doc.settings && doc.settings.ghosts === false)) ghost = rec.ghost.rle;
    } catch (e) { ghost = null; }

    return begin(room, { origin: 'campaign', roomId: roomId, ghost: ghost });
  }

  /* A fresh ATTEMPT: deaths back to zero, so Clean is on the table again.
   * This is what Results' "Restart" and Pause' "Restart" call. */
  function restart() {
    if (!s) return false;
    Sim.reset(s.state);
    s.rec = Replay.record();
    s.deaths = 0; s.ticks = 0; s.phase = 'run'; s.deadFor = 0;
    if (s.ghost) { Sim.reset(s.ghost.state); s.ghost.i = 0; }
    if (Fx.clear) Fx.clear();
    return true;
  }

  /* Retry after a death: same attempt, so the death counter SURVIVES. That is
   * the only difference from restart(), and it is the whole Clean medal. */
  function retry() {
    if (!s) return false;
    Sim.reset(s.state);
    s.rec = Replay.record();
    s.ticks = 0; s.phase = 'run'; s.deadFor = 0;
    if (s.ghost) { Sim.reset(s.ghost.state); s.ghost.i = 0; }
    if (Fx.clear) Fx.clear();
    return true;
  }

  function stop() {
    s = null;
    if (Fx.clear) Fx.clear();
  }

  /* ----------------------------------------------------------------- medals -- */

  function medals(sess) {
    var par = sess.room.par && sess.room.par.time;
    return {
      clear: true,
      clean: sess.deaths === 0,
      swift: par != null && sess.ticks <= par,
      /* Token requires carrying it to the EXIT — grab-then-die earns nothing.
       * state.token is only true here because we reached 'clear' with it. */
      token: !!sess.state.token
    };
  }

  function onClear() {
    s.phase = 'clear';
    if (Audio.play) Audio.play('clear');

    var summary = {
      roomId: s.roomId, origin: s.origin, room: s.room,
      medals: medals(s), ticks: s.ticks, deaths: s.deaths,
      par: s.room.par ? s.room.par.time : null,
      replay: s.rec.toString()
    };

    if (BAIT.Save && s.roomId) BAIT.Save.recordRun(s.roomId, summary);
    Modes.go('results', {
      origin: s.origin, originCtx: s.opts.originCtx, summary: summary
    });
  }

  function onDeath() {
    s.phase = 'dead';
    s.deaths++;
    s.deadFor = 0;

    /* The gauntlet is the one mode where a death can be FINAL, and it owns
     * that rule rather than this file: three lives are a property of the run,
     * not of dying. So a caller may pass onDeath, and returning false means
     * "that was the last one". The phase becomes 'out', which plays the exact
     * same death beat and differs only in what the next input does — see the
     * dead branch in tick(). Both hooks are absent everywhere else, so death
     * in the campaign and the workshop costs one undefined check. */
    if (s.opts.onDeath && s.opts.onDeath(s.deaths) === false) s.phase = 'out';
    if (Audio.play) Audio.play('death', s.state.deathCause);
    /* Hand Fx the cause and the place. It runs the hard cut, the half second
     * of real silence and the push-in — all of which any input cancels. */
    if (Fx.death) Fx.death(s.state, s.rec);
  }

  /* ------------------------------------------------------------------ tick -- */

  function tick() {
    if (!s || Modes.state() !== 'playing') return;
    if (Modes.overlay()) return;          // paused: the sim genuinely stops

    var dir = Input.dir();

    /* The first real input of a session is our user gesture, and it is the
     * only legal moment to build an AudioContext (Chrome blocks it earlier). */
    if (dir && !s.audioStarted) { s.audioStarted = true; if (Audio.init) Audio.init(); }

    if (s.phase === 'dead' || s.phase === 'out') {
      s.deadFor++;
      /* Any direction retries instantly. This is deliberately checked BEFORE
       * the hold expires: an impatient player never waits for the replay.
       * Fx.abort() kills the push-in mid-frame so the beat is watchable but
       * never sit-through-able.
       *
       * 'out' is the same beat with a different door at the end of it: the
       * run is over, so the input that would have retried leaves instead.
       * The player still gets to see what killed them, which is the whole
       * point of the beat and is most needed on the death that ended a run. */
      if (dir) {
        if (Fx.abort) Fx.abort();
        if (s.phase === 'out') {
          /* retry() self-limits by putting the phase back to 'run'; 'out' has
           * no such reset, so without this latch onExit fires on EVERY tick
           * the player is still holding the key — measured, ~170 calls before
           * the caller tears the session down. Whether that is harmless
           * depends entirely on what the caller's handler does, which is not
           * a thing this file gets to assume. Fire once. */
          if (!s.exited) { s.exited = true; if (s.opts.onExit) s.opts.onExit(); }
        } else retry();
      }
      return;
    }
    if (s.phase !== 'run') return;

    s.rec.push(dir);
    Sim.step(s.state, dir);
    s.ticks++;
    /* Two array writes into Fx's ring buffer. This is what the death replay
     * plays back, so it must happen on the SIM tick and never on the frame —
     * a 144Hz monitor must not record a different replay from a 60Hz one. */
    if (Fx.record) Fx.record(s.state);

    if (s.ghost) {
      var g = s.ghost;
      if (g.i < g.inputs.length && g.state.result === Sim.RESULT.RUN) {
        Sim.step(g.state, g.inputs[g.i++]);
      }
    }

    var r = s.state.result;
    if (r === Sim.RESULT.DEAD) onDeath();
    else if (r === Sim.RESULT.CLEAR) onClear();
    else if (s.ticks > BAIT.Pieces.K.MAX_TICKS) onDeath();  // 3 min = a loss
  }

  /* ---------------------------------------------------------------- render -- */

  /* Fx owns the composite because it owns the camera — the death push-in is
   * the one camera move in the game, and a renderer that does not know about
   * it would have to be told twice. When nothing is happening Fx delegates
   * straight through to Draw, so the quiet path costs one function call. */
  function render(alpha, nowMs) {
    if (!s) return;
    var st = Modes.state();
    if (st !== 'playing' && st !== 'results') return;

    Fx.frame({
      room: s.room,
      sim: s.state,
      alpha: alpha,
      ghosts: s.ghost ? [s.ghost.state] : null,
      /* 'out' is a death like any other as far as the picture is concerned —
       * Fx knows 'dead', and the callout naming what killed you matters MOST
       * on the death that ended the run. Passing 'out' through would drop the
       * cause on exactly the one death the player will want explained. */
      mode: s.phase === 'out' ? 'dead' : s.phase,
      label: (s.phase === 'dead' || s.phase === 'out') ? s.state.deathCause : null,
      sublabel: null
    }, nowMs);

    /* Footsteps are keyed to DISTANCE TRAVELLED, not to time, so the cadence
     * is identical at 60Hz and 144Hz. Measured off the sim, not the frame. */
    if (Audio.travel) {
      var dx = (s.state.x - s.lastX) / 65536, dy = (s.state.y - s.lastY) / 65536;
      Audio.travel(Math.sqrt(dx * dx + dy * dy));
    }
    s.lastX = s.state.x; s.lastY = s.state.y;

    /* Hud.update reads keys off the SIM state, so hand it a flat view rather
     * than making every reader remember which fields live one level down. */
    if (Hud.update) {
      Hud.update({
        ticks: s.ticks, deaths: s.deaths, phase: s.phase,
        keys: s.state.keys, keysTotal: s.state.keysTotal,
        token: s.state.token, room: s.room
      });
    }
  }

  BAIT.Play = {
    begin: begin, beginCampaign: beginCampaign, tick: tick, render: render,
    retry: retry, restart: restart, stop: stop,
    medals: medals,
    session: function () { return s; },
    DEATH_HOLD: DEATH_HOLD
  };

})(window.BAIT = window.BAIT || {});
