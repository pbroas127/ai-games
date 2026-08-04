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

    if (s.phase === 'dead') {
      s.deadFor++;
      /* Any direction retries instantly. This is deliberately checked BEFORE
       * the hold expires: an impatient player never waits for the replay.
       * Fx.abort() kills the push-in mid-frame so the beat is watchable but
       * never sit-through-able. */
      if (dir) { if (Fx.abort) Fx.abort(); retry(); }
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
      mode: s.phase,
      label: s.phase === 'dead' ? s.state.deathCause : null,
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
    begin: begin, tick: tick, render: render,
    retry: retry, restart: restart, stop: stop,
    medals: medals,
    session: function () { return s; },
    DEATH_HOLD: DEATH_HOLD
  };

})(window.BAIT = window.BAIT || {});
