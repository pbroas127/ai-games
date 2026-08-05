/* BAIT — ink, the death beat, and the only camera move in the game.
 *
 * OWNER: Ink (Art).
 *
 * THE DEATH BEAT IS THE COMEDY AND IT IS ALL TIMING. The joke does not work
 * if any part of it eases, fades, or overlaps another part. It goes:
 *
 *   0 ms      HARD CUT to a frozen frame. Not a fade. The world simply stops
 *             on the frame you died on.
 *   0-500 ms  TOTAL SILENCE and total stillness. Nothing moves, nothing
 *             sounds. This is the load-bearing half second. Every instinct
 *             will tell you to put something here. Do not.
 *   500 ms    The replay starts and the camera begins the push-in. The last
 *             0.75 s of your approach replays once, at real speed, while the
 *             camera moves in on the piece that killed you.
 *   1450 ms   Hold on the piece with its name stencilled beside it. This is
 *             the punchline: the room tells you, flatly, what you walked into.
 *   1900 ms   Done.
 *
 * ANY INPUT ABORTS THE WHOLE THING ON THE FRAME IT ARRIVES. SPEC §2 requires
 * retry on the NEXT FRAME, and that beats the joke every time. The beat is
 * something you are allowed to watch, never something you have to sit through.
 *
 * The push-in is strictly LINEAR. "Slow push-in" is a camera move, which the
 * spec permits exactly once; "ease-in-out" is softness, which it never
 * permits. Linear reads as a machine moving, which is the right register.
 */
(function (BAIT) {
  'use strict';

  var P = BAIT.Pieces, K = P.K, T = P.TILE;
  var Theme = BAIT.Theme, M = Theme.m;
  var ONE = K.ONE;

  /* Beat boundaries, ms. Named so nobody has to count offsets in their head. */
  var SILENCE_MS = 500;
  var REPLAY_MS = 950;
  var HOLD_MS = 450;
  var TOTAL_MS = SILENCE_MS + REPLAY_MS + HOLD_MS;

  var PUSH_TO = 2.15;          /* final camera scale */
  var REPLAY_TICKS = 90;       /* 0.75 s of approach at 120 Hz */

  /* Ring buffer of recent dot positions, so the replay does not need the sim
   * to rewind. Two shorts per tick — cheap, and it means death costs nothing
   * until it happens. */
  var trail = new Int32Array(REPLAY_TICKS * 2);
  var trailN = 0;

  /* The ink stamp. Not a particle system and not an animation: two hard
   * steps, ~100 ms, then gone. It reads as a rubber stamp coming down on the
   * drawing, which is exactly the right gesture for a blueprint. */
  var stamps = [];

  var death = null;   /* active death beat, or null */
  var now = 0;        /* ms, supplied by the caller — fx never reads a clock */

  /* ------------------------------------------------------------------ util */

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* --------------------------------------------------------------- capture */

  /* Called when a key or the token is taken. cell is the grid index. */
  function stamp(cell, kind) {
    stamps.push({
      x: Theme.cellX(cell % K.GRID_W) + M.CELL / 2,
      y: Theme.cellY((cell / K.GRID_W) | 0) + M.CELL / 2,
      born: now,
      kind: kind || 'key'
    });
  }

  function drawStamps(ctx) {
    var C = Theme.c;
    for (var i = stamps.length - 1; i >= 0; i--) {
      var s = stamps[i];
      var age = now - s.born;
      if (age > 110) { stamps.splice(i, 1); continue; }
      /* Two discrete steps. No interpolation between them, deliberately —
       * a stamp lands, it does not grow. */
      var step = age < 55 ? 0 : 1;
      var r = step === 0 ? 13 : 21;
      var col = s.kind === 'token' ? C.brass : C.brass;
      ctx.save();
      ctx.globalAlpha = step === 0 ? 1 : 0.45;
      ctx.strokeStyle = col;
      ctx.lineWidth = step === 0 ? M.BOLD : M.LINE;
      ctx.strokeRect(Math.round(s.x - r), Math.round(s.y - r), r * 2, r * 2);
      ctx.restore();
    }
  }

  /* ------------------------------------------------------------- the trail */

  /* Call once per SIM TICK with the live state. Costs two array writes. */
  function record(state) {
    if (!state || state.dead) return;
    var i = (trailN % REPLAY_TICKS) * 2;
    trail[i] = state.x;
    trail[i + 1] = state.y;
    trailN++;
  }

  function trailAt(back) {
    /* back = 0 is the most recent recorded tick */
    var n = Math.min(trailN, REPLAY_TICKS);
    if (n === 0) return null;
    var idx = ((trailN - 1 - back) % REPLAY_TICKS + REPLAY_TICKS) % REPLAY_TICKS;
    return { x: trail[idx * 2], y: trail[idx * 2 + 1] };
  }

  /* ---------------------------------------------------------------- death */

  /* Forge's state carries deathCause, deathX, deathY. deathCause may be a
   * tile id (number) or a piece name (string); both are accepted so a change
   * upstream cannot blank the label. Coordinates are Q16.16 canvas pixels. */
  function nameOfCause(cause) {
    if (cause === undefined || cause === null) return '';
    if (typeof cause === 'number') {
      var d = P.BY_ID[cause];
      return d ? d.name : '';
    }
    return String(cause);
  }

  /* Boss calls Fx.death(state, rec). `rec` is the Replay recorder; we do not
   * need it — the trail fed by Draw.tick is cheaper than re-simulating — but
   * it is accepted so the signature matches exactly. */
  function begin(state, rec) {
    now = clock();
    /* deathX/deathY are ROOM-space Q16.16, same as x,y — the camera works in
     * canvas space, so the room origin has to be added. Without it the
     * push-in centres on a point up and to the left of the room and the
     * callout lands on empty plate. */
    var cause = state && state.deathCause;
    var dx = state && state.deathX !== undefined ? state.deathX / ONE + M.ROOM_X
           : state ? state.x / ONE + M.ROOM_X : M.CANVAS_W / 2;
    var dy = state && state.deathY !== undefined ? state.deathY / ONE + M.ROOM_Y
           : state ? state.y / ONE + M.ROOM_Y : M.CANVAS_H / 2;

    /* Snap to the centre of the cell the death happened in — the callout
     * names a PIECE, and a piece occupies a cell, not a point. */
    var gx = Math.floor((dx - M.ROOM_X) / M.CELL);
    var gy = Math.floor((dy - M.ROOM_Y) / M.CELL);
    gx = Math.max(0, Math.min(K.GRID_W - 1, gx));
    gy = Math.max(0, Math.min(K.GRID_H - 1, gy));

    death = {
      start: now,
      x: dx,
      y: dy,
      /* cell centre in canvas space; the camera centres on x,y so these are
       * offset from it by at most half a cell and stay on screen */
      gcx: M.ROOM_X + gx * M.CELL + M.CELL / 2,
      gcy: M.ROOM_Y + gy * M.CELL + M.CELL / 2,
      label: nameOfCause(cause),
      /* Reduced motion gets the information without the camera move: same
       * beat, same label, no push-in. SPEC §8. */
      push: Theme.state.reducedMotion ? 1 : PUSH_TO,
      frames: Math.min(trailN, REPLAY_TICKS)
    };
    return death;
  }

  /* The half second of silence belongs to the beat. If the beat is cut short
   * the silence has to go with it, or the room we cut TO is mute for the
   * remainder. This matters now that a run can end on a death: out of lives
   * plays the beat and then leaves, so something else is on screen while the
   * hush is still counting down. */
  function unhush() {
    if (BAIT.Audio && BAIT.Audio.hush) BAIT.Audio.hush(0);
  }

  function abort() { death = null; unhush(); }

  function busy() { return death !== null; }

  function elapsed() { return death ? now - death.start : 0; }

  /* Which phase of the beat we are in — audio.js reads this so it knows to
   * stay silent, and so does anything that wants to know whether the world
   * is currently frozen. */
  function phase() {
    if (!death) return 'none';
    var e = elapsed();
    if (e < SILENCE_MS) return 'silence';
    if (e < SILENCE_MS + REPLAY_MS) return 'replay';
    if (e < TOTAL_MS) return 'hold';
    return 'done';
  }

  /* ------------------------------------------------------------- overlays */

  function drawVignette(ctx, strength) {
    /* A plain darkening at the edges. Not a glow, not a bloom — the inverse.
     * It exists to pull the eye to the piece that killed you. */
    if (strength <= 0) return;
    ctx.save();
    ctx.fillStyle = Theme.alpha(Theme.c.void, 0.55 * strength);
    ctx.fillRect(0, 0, M.CANVAS_W, M.PLATE_PAD + 40);
    ctx.fillRect(0, M.CANVAS_H - M.PLATE_PAD - 40, M.CANVAS_W, M.PLATE_PAD + 40);
    ctx.fillRect(0, 0, M.PLATE_PAD + 40, M.CANVAS_H);
    ctx.fillRect(M.CANVAS_W - M.PLATE_PAD - 40, 0, M.PLATE_PAD + 40, M.CANVAS_H);
    ctx.restore();
  }

  /* The punchline. A leader line out to a stencilled name, drawn like an
   * annotation on the patent diagram it has been pretending to be. */
  /* THE RETICLE BELONGS TO THE ROOM, THE LABEL BELONGS TO THE LENS.
   *
   * The box frames the actual CELL that killed you, so it scales with the
   * push-in and lands exactly on the piece. A fixed-size box floats inside a
   * zoomed cell framing nothing, which is worse than no box at all — it reads
   * as marking a point rather than naming a thing.
   *
   * The leader line and the stencilled name stay at screen size, because they
   * are annotation on the drawing and have to stay legible at any scale.
   */
  function drawCallout(ctx, d, alpha, scale) {
    if (!d.label || alpha <= 0) return;
    var C = Theme.c;
    scale = scale || 1;

    /* the cell's half-extent on screen under the current camera */
    var half = (M.CELL / 2) * scale;
    var lx = d.x, ly = d.y;

    /* Push the label to whichever side has room, so it never leaves the plate */
    var right = lx < M.CANVAS_W / 2;
    var arm = right ? half + 26 : -(half + 26);

    ctx.save();
    ctx.globalAlpha = alpha;

    /* Frame the cell, snapped to the cell the death happened in. */
    BAIT.Draw.box(ctx, d.cx - half, d.cy - half, half * 2, half * 2, C.chalk, M.LINE);

    var edge = right ? d.cx + half : d.cx - half;
    BAIT.Draw.line(ctx, edge, d.cy, lx + arm, ly - half, C.chalk, M.HAIR);
    BAIT.Draw.line(ctx, lx + arm, ly - half, lx + arm + (right ? 92 : -92), ly - half,
                   C.chalk, M.HAIR);

    var tx = lx + arm + (right ? 6 : -6);
    BAIT.Draw.stencil(ctx, d.label, tx, ly - half - 10, C.chalk, Theme.t.label,
                      right ? 'left' : 'right');
    ctx.restore();
  }

  /* ------------------------------------------------ Boss's fixed contract */

  /* THE CLOCK. play.js hands us the rAF timestamp via Fx.frame(view, nowMs);
   * when nobody hands us one we read performance.now() ourselves. Those are
   * the same timebase — a requestAnimationFrame timestamp and
   * performance.now() share an origin — so the two entry points below cannot
   * drift apart no matter which one the caller uses. Both are legal here:
   * this is the render layer and none of it touches simulation state. */
  function clock() {
    return (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : 0;
  }

  function setNow(ms) {
    now = (typeof ms === 'number' && ms > 0) ? ms : clock();
  }

  /* THE COMPOSITE, and the only implementation of it.
   *
   *   view = { room, sim, alpha, ghosts, mode, label, sublabel }
   *
   * play.js calls this instead of touching Draw, because the push-in has to
   * WRAP the room render and only the thing that owns the camera can do that.
   * When no beat is running it is a straight delegation plus a stamp pass,
   * which is a no-op on almost every frame.
   */
  function frame(view, nowMs) {
    setNow(nowMs);
    var ctx = BAIT.Draw.ctx();
    if (!ctx || !view) return;

    if (!death) {
      BAIT.Draw.render(view);
      drawStamps(ctx);
      return;
    }

    var e = elapsed(), d = death;

    if (e >= TOTAL_MS) {
      death = null;
      BAIT.Draw.render(view);
      drawStamps(ctx);
      return;
    }

    /* FROZEN. The death frame, held, in silence. Draw it exactly as it was
     * and put NOTHING over it. Every instinct will tell you to add something
     * here. Do not — this half second is the whole joke. */
    if (e < SILENCE_MS) {
      BAIT.Draw.render(view);
      return;
    }

    var t, scale;
    if (e < SILENCE_MS + REPLAY_MS) {
      t = (e - SILENCE_MS) / REPLAY_MS;
      scale = lerp(1, d.push, t);          /* linear. see the header. */
    } else {
      t = 1;
      scale = d.push;
    }

    /* Replay the approach by overriding the dot position from the trail. The
     * room and its hazards stay frozen at the death tick: only the dot moves,
     * because only the dot is the story. */
    var back = Math.max(0, Math.round((1 - t) * (d.frames - 1)));
    var pt = e < SILENCE_MS + REPLAY_MS ? trailAt(back) : null;

    var replayView = {
      room: view.room,
      sim: view.sim,
      alpha: 0,
      ghosts: null,
      mode: view.mode,
      label: view.label,
      sublabel: view.sublabel,
      camera: { x: d.x, y: d.y, scale: scale }
    };

    if (pt && view.sim) {
      /* shallow clone so we never write into the sim's live state */
      var fake = {}, k, s = view.sim;
      for (k in s) {
        if (Object.prototype.hasOwnProperty.call(s, k)) fake[k] = s[k];
      }
      fake.x = fake.px = pt.x;
      fake.y = fake.py = pt.y;
      fake.dead = false;
      fake.result = 'run';
      replayView.sim = fake;
    }

    BAIT.Draw.render(replayView);

    /* Overlays sit outside the camera transform: the annotation is on the
     * lens, not in the room, so it stays legible as we push in. */
    ctx.setTransform(BAIT.Draw.dpr(), 0, 0, BAIT.Draw.dpr(), 0, 0);
    drawVignette(ctx, t);

    /* The callout lands with the hold, not during the move. A punchline does
     * not arrive early. The push-in is centred on the death point, so that
     * point sits exactly where it always was no matter the scale. */
    if (e >= SILENCE_MS + REPLAY_MS) {
      /* The camera centres on the death point, so that point is fixed on
       * screen; the cell centre moves out from it by the scale factor. */
      drawCallout(ctx, {
        x: d.x, y: d.y, label: d.label,
        cx: (d.gcx - d.x) * scale + d.x,
        cy: (d.gcy - d.y) * scale + d.y
      }, 1, scale);
    }
    drawStamps(ctx);
  }

  /* Adapter for the earlier Draw.draw + Fx.render(alpha, session) call shape.
   * It builds a view and defers to frame(), so there is ONE implementation of
   * the composite and not two that drift. Safe either way: if a caller has
   * already drawn the room this frame, the beat repaints over it, and if it
   * has not, this draws it.
   */
  function render(alpha, session) {
    if (!session) { setNow(); if (BAIT.Draw.ctx()) drawStamps(BAIT.Draw.ctx()); return; }
    frame({
      room: session.room,
      sim: session.state,
      alpha: alpha,
      ghosts: session.ghost ? [session.ghost] : null,
      mode: 'play',
      label: session.label,
      sublabel: session.sublabel
    });
  }

  /* ---------------------------------------------------------- transitions */

  /* Screen changes are HARD CUTS. This exists so that "transitions" has an
   * owner and an answer, and the answer is that we do not have any. If a
   * transition ever becomes necessary it goes here, in discrete steps, and
   * it is never longer than two frames. */
  function cut() { stamps.length = 0; death = null; unhush(); }

  /* Reset between attempts. Called on retry: the trail must not carry across
   * a death or the next replay shows the previous life. */
  function reset() {
    trailN = 0;
    stamps.length = 0;
    death = null;
    unhush();
  }

  BAIT.Fx = {
    /* Boss's fixed contract */
    death: begin,
    frame: frame,
    render: render,
    clear: reset,

    /* the rest of the surface */
    record: record,
    stamp: stamp,
    abort: abort,
    busy: busy,
    phase: phase,
    reset: reset,
    cut: cut,
    /* timings, exported so audio.js and modes.js agree with the picture
     * rather than each keeping their own copy of the numbers */
    T: {
      SILENCE: SILENCE_MS,
      REPLAY: REPLAY_MS,
      HOLD: HOLD_MS,
      TOTAL: TOTAL_MS
    }
  };

})(window.BAIT = window.BAIT || {});
