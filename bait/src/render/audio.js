/* BAIT — foley, synthesised. Zero audio files.
 *
 * OWNER: Ink (Art).
 *
 * THE BRIEF: it should sound like a workshop, not a synthesiser. Dry
 * mechanical foley — a pencil tick per step, a wooden clack on a gate, a dry
 * snap on the faller, a flat report from a turret — and then real silence.
 *
 * BANNED, and this is the whole identity: no pad, no music bed, no reverb
 * tail, no delay, no sustained anything. Every sound in this file is under
 * 140 ms. In a category where everything ships a neon synth wash, silence is
 * the loudest thing on the table, and you only get silence by not filling it.
 *
 * Almost everything here is one recipe: a short burst of noise through a
 * filter, with a fast envelope. Real percussive foley is mostly noise and
 * transient; pitch is the seasoning, not the meal.
 *
 * THE AUDIOCONTEXT IS NOT CREATED UNTIL A USER GESTURE. Chrome blocks it
 * otherwise, and a blocked context is a game that is silent forever with no
 * error to explain why.
 */
(function (BAIT) {
  'use strict';

  var ctx = null;
  var master = null;
  var noise = null;          /* shared white-noise buffer */
  var vol = 0.7;
  var muted = false;
  var hushUntil = 0;         /* ctx-time before which nothing may sound */
  var hushTimer = 0;         /* pending hush, cancellable if the beat is cut */
  var travelAcc = 0;         /* px travelled since the last footstep tick */

  var STEP_PX = 19;          /* one pencil tick per 19px of travel */

  /* ------------------------------------------------------------- lifecycle */

  function build() {
    if (ctx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { return false; }

    master = ctx.createGain();
    master.gain.value = muted ? 0 : vol;
    master.connect(ctx.destination);

    /* One second of white noise, reused by every sound. Generating it once
     * costs nothing and means no sound ever allocates a buffer at play time. */
    var n = ctx.sampleRate | 0;
    noise = ctx.createBuffer(1, n, ctx.sampleRate);
    var ch = noise.getChannelData(0);
    for (var i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
    return true;
  }

  /* Call from any real user gesture. Safe to call repeatedly. */
  function unlock() {
    if (!build()) return false;
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  /* Attach the unlock to the first gesture of any kind, so no other file has
   * to remember to do it. Removed as soon as it fires. */
  function armUnlock() {
    var once = function () {
      unlock();
      window.removeEventListener('pointerdown', once, true);
      window.removeEventListener('keydown', once, true);
      window.removeEventListener('touchstart', once, true);
    };
    window.addEventListener('pointerdown', once, true);
    window.addEventListener('keydown', once, true);
    window.addEventListener('touchstart', once, true);
  }

  function ready() { return !!ctx && ctx.state === 'running'; }

  function setVolume(v) {
    vol = Math.max(0, Math.min(1, v));
    if (master) master.gain.value = muted ? 0 : vol;
  }

  function setMuted(m) {
    muted = !!m;
    if (master) master.gain.value = muted ? 0 : vol;
  }

  /* Enforced silence. The death beat calls this and NOTHING can sound for the
   * duration — not a queued step, not a UI tick. The half second of silence
   * in fx.js is the single best thing in the game's audio and it only works
   * if it is actually total. */
  function hush(ms) {
    if (!ctx) return;
    /* Kill any hush that was scheduled but has not landed yet. Without this a
     * beat cut short between the impact and the hush leaves a timer with no
     * owner, and it silences whatever screen happens to be up 70ms later.
     * A pending hush belongs to the beat that asked for it and dies with it. */
    if (hushTimer) { clearTimeout(hushTimer); hushTimer = 0; }
    /* `ms === undefined` rather than `ms ||` — hush(0) has to mean "clear the
     * hush", not "hush for the default half second". */
    hushUntil = ctx.currentTime + (ms === undefined ? 500 : ms) / 1000;
  }

  function blocked() {
    return !ctx || ctx.state !== 'running' || muted ||
           ctx.currentTime < hushUntil;
  }

  /* ---------------------------------------------------------------- engine */

  /* A burst of noise through one filter, with a linear attack and an
   * exponential decay. This is the entire synth. */
  function burst(o) {
    if (blocked()) return;
    var t = ctx.currentTime;
    var dur = o.dur || 0.05;

    var src = ctx.createBufferSource();
    src.buffer = noise;
    /* start from a random offset so repeated hits are not identical — real
     * foley never repeats exactly, and a perfectly identical tick is the
     * fastest way to sound synthetic */
    var off = Math.random() * 0.9;

    var filt = ctx.createBiquadFilter();
    filt.type = o.type || 'bandpass';
    filt.frequency.value = o.freq || 1200;
    filt.Q.value = o.q === undefined ? 1 : o.q;

    var g = ctx.createGain();
    var peak = (o.gain === undefined ? 0.5 : o.gain);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + (o.attack || 0.001));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    /* an optional downward sweep gives a "thing striking a thing" feel */
    if (o.sweepTo) {
      filt.frequency.setValueAtTime(o.freq, t);
      filt.frequency.exponentialRampToValueAtTime(Math.max(40, o.sweepTo), t + dur);
    }

    src.connect(filt); filt.connect(g); g.connect(master);
    src.start(t, off, dur + 0.02);
    src.stop(t + dur + 0.03);
  }

  /* A short pitched body, for the few sounds that need a sense of material.
   * Triangle, not sine — a sine reads as a synthesiser, a triangle reads as
   * something hollow being struck. */
  function body(freq, dur, gain, type, delay) {
    if (blocked()) return;
    var t = ctx.currentTime + (delay || 0);
    var osc = ctx.createOscillator();
    osc.type = type || 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.55), t + dur);

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain === undefined ? 0.25 : gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g); g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /* ----------------------------------------------------------- the library */

  /* Pencil on paper. Tiny, bright, almost subliminal — it plays constantly
   * while running, so it has to sit under everything else or it becomes a
   * rattle. */
  function step() {
    burst({ dur: 0.018, type: 'highpass', freq: 4200, q: 0.6, gain: 0.055 });
  }

  /* Call every frame with the distance the dot moved, in px. Emits a tick at
   * a fixed spatial cadence, so the footstep rate is tied to distance rather
   * than to frame rate, and a 144 Hz monitor does not sound different. */
  function travel(px) {
    if (!px) return;
    travelAcc += px;
    while (travelAcc >= STEP_PX) { travelAcc -= STEP_PX; step(); }
  }

  function resetTravel() { travelAcc = 0; }

  /* Wood on wood. Two-part: a click transient and a short hollow body. */
  function gate(open) {
    burst({ dur: 0.03, type: 'bandpass', freq: 2000, q: 1.4, gain: 0.34 });
    body(open ? 300 : 210, 0.075, 0.2);
  }

  /* THE FALLER. A single dry snap — a floorboard letting go. It is the only
   * warning you ever get and it arrives strictly too late to help. */
  function faller() {
    burst({ dur: 0.045, type: 'bandpass', freq: 2600, q: 0.9, gain: 0.6,
            sweepTo: 500 });
    body(150, 0.06, 0.3, 'square');
  }

  /* A flat report. Deliberately unmusical and deliberately quiet — a turret
   * fires on a fixed cadence, so this repeats forever and must never nag. */
  function turret() {
    burst({ dur: 0.04, type: 'lowpass', freq: 1500, q: 0.8, gain: 0.3,
            sweepTo: 300 });
  }

  /* Lathe. A short sweep, once per quarter turn — NOT a drone. A sustained
   * rotor hum would be a pad by another name and would eat the silence. */
  function rotor() {
    burst({ dur: 0.13, type: 'bandpass', freq: 700, q: 3.5, gain: 0.13,
            sweepTo: 1500, attack: 0.03 });
  }

  function deflect() {
    burst({ dur: 0.025, type: 'highpass', freq: 3000, q: 1, gain: 0.28 });
  }

  function conveyor() {
    burst({ dur: 0.03, type: 'bandpass', freq: 900, q: 2, gain: 0.09 });
  }

  function teleport() {
    burst({ dur: 0.05, type: 'bandpass', freq: 1800, q: 6, gain: 0.22,
            sweepTo: 3400 });
  }

  function plate() {
    burst({ dur: 0.028, type: 'lowpass', freq: 1100, q: 1, gain: 0.3 });
    body(180, 0.05, 0.16);
  }

  /* A stamp coming down. Pairs with the ink stamp in fx.js — same gesture,
   * same length, so picture and sound land together. */
  function key() {
    burst({ dur: 0.035, type: 'bandpass', freq: 1400, q: 2, gain: 0.4 });
    body(520, 0.05, 0.14);
  }

  function token() {
    burst({ dur: 0.04, type: 'bandpass', freq: 1150, q: 2.4, gain: 0.42 });
    body(392, 0.08, 0.16);
  }

  /* Clearing the room. The one sound allowed to be even slightly pleasant,
   * and still only two notes, still dry, still under 200 ms. */
  function exit() {
    /* scheduled on the audio clock, not setTimeout — the two notes have to
     * land exactly 90 ms apart regardless of what the main thread is doing */
    body(523, 0.09, 0.2, 'triangle', 0);
    body(784, 0.13, 0.18, 'triangle', 0.09);
  }

  /* DEATH. One impact, then hush() takes the room to total silence for the
   * length of fx.js's frozen beat. The silence is the sound design. */
  function die() {
    if (blocked()) return;
    burst({ dur: 0.05, type: 'lowpass', freq: 800, q: 0.7, gain: 0.55,
            sweepTo: 120 });
    body(98, 0.07, 0.3, 'square');
    var t = BAIT.Fx && BAIT.Fx.T ? BAIT.Fx.T.SILENCE : 500;
    /* the hush starts after the impact has decayed, not before it */
    hushTimer = setTimeout(function () { hushTimer = 0; hush(t); }, 70);
  }

  /* UI. One tick for movement through a menu, one firmer for commit. */
  function ui(kind) {
    if (kind === 'confirm') {
      burst({ dur: 0.03, type: 'bandpass', freq: 1600, q: 2, gain: 0.26 });
    } else if (kind === 'back') {
      burst({ dur: 0.03, type: 'lowpass', freq: 900, q: 1, gain: 0.2 });
    } else if (kind === 'deny') {
      burst({ dur: 0.06, type: 'lowpass', freq: 400, q: 1, gain: 0.28,
              sweepTo: 160 });
    } else {
      burst({ dur: 0.014, type: 'highpass', freq: 3600, q: 0.7, gain: 0.12 });
    }
  }

  /* -------------------------------------------------- Boss's fixed contract */

  /* Boss gates this on the first real input, so it is never called before a
   * gesture. Idempotent. */
  function init() { return unlock(); }

  /* One dispatch table so play.js, the editor and the screens all name sounds
   * the same way. Boss's list so far is 'clear' and 'death'; everything else
   * a caller might reasonably reach for is wired here too, because a missing
   * name silently doing nothing is worse than an unused entry.
   *
   * `detail` is passed through where a sound has a variant — Audio.play('gate',
   * {open:true}) and Audio.play('death', {cause:'faller'}) both use it. */
  var NAMES = {
    step: function () { step(); },
    gate: function (d) { gate(d && d.open); },
    plate: plate,
    faller: faller,
    turret: turret,
    rotor: rotor,
    deflect: deflect,
    conveyor: conveyor,
    teleport: teleport,
    key: key,
    token: token,
    clear: exit,
    exit: exit,
    death: function (d) {
      /* The faller gets its own snap before the impact. It is the signature
       * betrayal in the game and it should not sound like a pit. */
      if (d && d.cause === 'faller') faller();
      die();
    },
    ui: function (d) { ui(d && d.kind); },
    move: function () { ui('move'); },
    confirm: function () { ui('confirm'); },
    back: function () { ui('back'); },
    deny: function () { ui('deny'); }
  };

  function play(name, detail) {
    var fn = NAMES[name];
    if (fn) fn(detail);
  }

  armUnlock();

  BAIT.Audio = {
    init: init,
    play: play,

    unlock: unlock,
    ready: ready,
    setVolume: setVolume,
    volume: function () { return vol; },
    setMuted: setMuted,
    muted: function () { return muted; },
    hush: hush,

    step: step,
    travel: travel,
    resetTravel: resetTravel,
    gate: gate,
    faller: faller,
    turret: turret,
    rotor: rotor,
    deflect: deflect,
    conveyor: conveyor,
    teleport: teleport,
    plate: plate,
    key: key,
    token: token,
    exit: exit,
    die: die,
    ui: ui
  };

})(window.BAIT = window.BAIT || {});
