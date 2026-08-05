/* BAIT — the frame loop: fixed timestep, interpolated render.
 *
 * OWNER: Forge (Engine).
 *
 * The classic accumulator. The simulation advances in exact 1/120s steps and
 * never sees a delta time; the renderer is handed `alpha`, the fraction of a
 * step between the last two, and interpolates. That split is what makes 60Hz,
 * 120Hz and 144Hz displays all look equally smooth off one integer sim, and it
 * is the only reason a deterministic game can also feel fluid.
 *
 * The accumulator is capped at K.MAX_CATCHUP steps. A tab that has been
 * throttled in the background comes back owing thousands of ticks, and paying
 * that debt would freeze the page and then teleport the dot into a pit. We
 * drop the debt instead: the run is already lost from the player's point of
 * view, and a spiral of death is worse than a skipped second.
 */
(function (BAIT) {
  'use strict';

  var K = BAIT.Pieces.K;

  var STEP_MS = 1000 / K.TICK_HZ;      // 8.333...ms at 120Hz

  /* A single frame longer than this is a stall, not a slow frame: a laptop
   * lid, a breakpoint, a garbage collection pause. Clamping before the
   * accumulator sees it keeps one bad frame from costing the catch-up budget. */
  var MAX_FRAME_MS = 250;

  var running = false;
  var rafId = 0;
  var acc = 0;
  var last = 0;
  var tickFn = null, renderFn = null;

  /* rolling frame-time statistics for the readout SPEC §8 asks for */
  var SAMPLES = 120;
  var samples = new Float64Array(SAMPLES);
  var sampleAt = 0, sampleCount = 0;
  var worstMs = 0, ticksLastFrame = 0, totalTicks = 0, frames = 0;
  /* Frames where the catch-up cap was hit and the backlog was thrown away, and
   * the total wall-clock time discarded. Dropping the debt is right, doing it
   * without saying so is not: on a machine that cannot hold 120Hz the game
   * quietly runs in slow motion and every other number here still looks fine. */
  var droppedFrames = 0, droppedMs = 0;
  var overlay = null, overlayOn = false, overlayAcc = 0;

  function now() {
    return (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
  }

  function frame(ts) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);

    var t = ts || now();
    var dt = t - last;
    last = t;
    if (dt < 0) dt = 0;
    if (dt > MAX_FRAME_MS) dt = MAX_FRAME_MS;

    /* stats */
    samples[sampleAt] = dt;
    sampleAt = (sampleAt + 1) % SAMPLES;
    if (sampleCount < SAMPLES) sampleCount++;
    if (dt > worstMs) worstMs = dt;
    frames++;

    acc += dt;
    var steps = 0;
    while (acc >= STEP_MS && steps < K.MAX_CATCHUP) {
      tickFn();
      acc -= STEP_MS;
      steps++;
    }
    /* Hit the cap: throw the backlog away rather than spiral, and record that
     * we did it. */
    if (acc >= STEP_MS) { droppedFrames++; droppedMs += acc; acc = 0; }

    ticksLastFrame = steps;
    totalTicks += steps;

    renderFn(acc / STEP_MS);

    if (overlayOn) {
      overlayAcc += dt;
      if (overlayAcc >= 250) { overlayAcc = 0; paintOverlay(); }
    }
  }

  /* Start the loop. onTick() advances the sim exactly one step and takes no
   * arguments, deliberately: nothing downstream of here is allowed to know how
   * much wall-clock time has passed. onRender(alpha) gets 0..1. */
  function start(onTick, onRender) {
    if (running) stop();
    tickFn = onTick;
    renderFn = onRender;
    acc = 0;
    last = now();
    worstMs = 0;
    running = true;
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /* Coming back from a hidden tab, the elapsed time is meaningless. Reset the
   * clock rather than let the first frame carry a five-minute delta. */
  function onVisibility() {
    if (typeof document !== 'undefined' && !document.hidden) {
      last = now();
      acc = 0;
    }
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
  }

  function stats() {
    var sum = 0, i;
    for (i = 0; i < sampleCount; i++) sum += samples[i];
    var avg = sampleCount ? sum / sampleCount : 0;
    return {
      frameMs: avg,
      fps: avg > 0 ? 1000 / avg : 0,
      worstMs: worstMs,
      ticksLastFrame: ticksLastFrame,
      totalTicks: totalTicks,
      frames: frames,
      droppedFrames: droppedFrames,
      droppedMs: droppedMs,
      alpha: acc / STEP_MS
    };
  }

  function resetStats() {
    sampleAt = 0; sampleCount = 0; worstMs = 0; frames = 0; totalTicks = 0;
    droppedFrames = 0; droppedMs = 0;
  }

  /* The built-in readout. Off by default and it does not exist in the DOM
   * until it is switched on, so it costs nothing in a normal session. Frame is
   * welcome to ignore this entirely and draw stats() into the HUD instead. */
  function paintOverlay() {
    var s = stats();
    overlay.textContent =
      s.fps.toFixed(0) + ' fps   ' + s.frameMs.toFixed(2) + ' ms   worst ' +
      s.worstMs.toFixed(1) + ' ms   ' + s.ticksLastFrame + ' tick' +
      (s.ticksLastFrame === 1 ? '' : 's') + '/frame' +
      /* Only ever shown when it has happened, so it reads as an alarm rather
       * than another number to skim past. */
      (s.droppedFrames
        ? '   DROPPED ' + s.droppedFrames + ' (' + s.droppedMs.toFixed(0) + ' ms)'
        : '');
  }

  function showStats(on) {
    overlayOn = !!on;
    if (!overlayOn) {
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      overlay = null;
      return;
    }
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'frametime';
      overlay.setAttribute('aria-hidden', 'true');
      /* Enough inline style to be legible with no stylesheet at all, since
       * this has to work when something is already going wrong. Ink can
       * override the lot from style.css via #frametime. */
      overlay.style.cssText =
        'position:fixed;left:8px;bottom:8px;z-index:9999;pointer-events:none;' +
        'font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;' +
        'letter-spacing:.04em;padding:4px 7px;color:#e8e6e1;' +
        'background:rgba(20,24,28,.82);border:1px solid rgba(232,230,225,.28)';
      document.body.appendChild(overlay);
    }
    worstMs = 0;
    paintOverlay();
  }

  BAIT.Loop = {
    STEP_MS: STEP_MS,
    start: start,
    stop: stop,
    running: function () { return running; },
    stats: stats,
    resetStats: resetStats,
    showStats: showStats,
    statsVisible: function () { return overlayOn; }
  };

})(window.BAIT = window.BAIT || {});
