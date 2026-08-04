/* BAIT — keyboard, gamepad and touch.
 *
 * OWNER: Forge (Engine).
 *
 * The one rule that matters here: this module is POLLED, never pushed. The sim
 * asks dir() for the direction being held right now, at the top of the tick,
 * and acts on it in that same tick. There is no event queue, no input buffer,
 * no coyote time and no smoothing anywhere in this file (SPEC §2). Events only
 * ever set or clear a flag; they never decide anything.
 *
 * That is the whole reason the controls feel instant: press to move is one
 * tick, 8.3ms, and it cannot be anything else.
 */
(function (BAIT) {
  'use strict';

  var ACTIONS = ['up', 'down', 'left', 'right', 'retry', 'pause'];

  var DEFAULTS = {
    up:    ['ArrowUp', 'KeyW'],
    down:  ['ArrowDown', 'KeyS'],
    left:  ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    retry: ['KeyR'],
    pause: ['Escape', 'KeyP']
  };

  /* Gamepad: a per-axis deadzone rather than a radial one, because this game
   * is 8-way and a radial deadzone makes cardinals hard to hold cleanly. */
  var PAD_DEAD = 0.4;
  var PAD_DPAD = { 12: 'up', 13: 'down', 14: 'left', 15: 'right' };

  /* Touch: the stick is invisible and anchors wherever the thumb lands, so
   * there is no on-screen control to look at or miss. Below the deadzone the
   * dot simply does not move, which is the same contract the keyboard has. */
  var TOUCH_DEAD = 14;      // px from the anchor before any direction reads
  var TOUCH_REANCHOR = 64;  // px: drag further and the stick follows the thumb

  var OCT_TO_DIR = [3, 4, 5, 6, 7, 8, 1, 2];   // E, SE, S, SW, W, NW, N, NE

  var bindings = null;      // code -> action
  var map = null;           // action -> [codes]
  var held = {};            // action -> press sequence number, 0 = up
  var seq = 0;
  var edges = {};           // action -> true until consumed
  var enabled = true;
  var attached = false;
  var el = null;              // touch target, the canvas
  var keyTarget = null;       // key-event target, normally window
  var capturing = null;

  var touchId = null, touchAX = 0, touchAY = 0, touchDir = 0;
  var padIndex = -1;

  /* ---------------------------------------------------------- direction -- */

  function xyToDir(dx, dy) {
    if (!dx && !dy) return 0;
    if (dy < 0) return dx === 0 ? 1 : (dx > 0 ? 2 : 8);
    if (dy > 0) return dx === 0 ? 5 : (dx > 0 ? 4 : 6);
    return dx > 0 ? 3 : 7;
  }

  /* Simultaneous opposite directions: the most recently pressed one wins.
   * Cancelling to neutral instead would mean a fast left-to-right flick drops
   * a frame of movement, and dropped frames are exactly what this game is not
   * allowed to have. */
  function axis(negAction, posAction) {
    var neg = held[negAction] || 0, pos = held[posAction] || 0;
    if (!neg && !pos) return 0;
    if (neg && !pos) return -1;
    if (pos && !neg) return 1;
    return pos > neg ? 1 : -1;
  }

  function keyboardDir() {
    return xyToDir(axis('left', 'right'), axis('up', 'down'));
  }

  function gamepadDir() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return 0;
    var pads;
    try { pads = navigator.getGamepads(); } catch (e) { return 0; }
    if (!pads) return 0;

    for (var i = 0; i < pads.length; i++) {
      var p = pads[i];
      if (!p || !p.connected) continue;
      padIndex = i;

      var dx = 0, dy = 0;
      for (var b in PAD_DPAD) {
        var btn = p.buttons && p.buttons[b];
        if (!btn || !btn.pressed) continue;
        if (PAD_DPAD[b] === 'up') dy = -1;
        else if (PAD_DPAD[b] === 'down') dy = 1;
        else if (PAD_DPAD[b] === 'left') dx = -1;
        else dx = 1;
      }
      if (!dx && !dy && p.axes && p.axes.length >= 2) {
        var ax = p.axes[0], ay = p.axes[1];
        if (ax > PAD_DEAD) dx = 1; else if (ax < -PAD_DEAD) dx = -1;
        if (ay > PAD_DEAD) dy = 1; else if (ay < -PAD_DEAD) dy = -1;
      }
      var d = xyToDir(dx, dy);
      if (d) return d;
    }
    return 0;
  }

  /* The direction held RIGHT NOW, 0..8. Called once per simulation tick.
   * Keyboard wins over pad, pad wins over thumb, so a player with two devices
   * plugged in never gets a fight between them. */
  function dir() {
    if (!enabled) return 0;
    return keyboardDir() || gamepadDir() || touchDir;
  }

  /* ------------------------------------------------------------- events -- */

  function actionFor(code) { return bindings[code] || null; }

  function onKeyDown(e) {
    if (capturing) {
      /* rebinding: swallow the key and hand the code back, but never steal
       * Tab or Escape, which the menus need to stay navigable */
      if (e.code !== 'Tab' && e.code !== 'Escape') {
        e.preventDefault();
        var cb = capturing; capturing = null;
        cb(e.code);
        return;
      }
      capturing = null;
    }
    if (e.repeat) return;
    var a = actionFor(e.code);
    if (!a) return;
    if (!held[a]) { held[a] = ++seq; edges[a] = true; }
    /* Arrows and space scroll the page; the game keys must not. Tab is never
     * touched, so keyboard navigation of the menus keeps working. */
    if (enabled && e.code !== 'Tab') e.preventDefault();
  }

  function onKeyUp(e) {
    var a = actionFor(e.code);
    if (!a) return;
    held[a] = 0;
    if (enabled && e.code !== 'Tab') e.preventDefault();
  }

  /* A window that loses focus mid-run would otherwise come back with a key
   * stuck down and the dot walking into a pit on its own. */
  function clearHeld() {
    for (var i = 0; i < ACTIONS.length; i++) held[ACTIONS[i]] = 0;
    touchId = null; touchDir = 0;
  }

  function touchStart(e) {
    if (!enabled || touchId !== null) return;
    var t = e.changedTouches[0];
    touchId = t.identifier;
    touchAX = t.clientX; touchAY = t.clientY;
    touchDir = 0;
    e.preventDefault();
  }

  function touchMove(e) {
    if (touchId === null) return;
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (t.identifier !== touchId) continue;
      var dx = t.clientX - touchAX, dy = t.clientY - touchAY;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < TOUCH_DEAD) { touchDir = 0; }
      else {
        var oct = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
        touchDir = OCT_TO_DIR[((oct % 8) + 8) % 8];
        if (dist > TOUCH_REANCHOR) {
          /* Let the anchor trail the thumb so a long drag can still change
           * direction without lifting off. */
          var k = (dist - TOUCH_REANCHOR) / dist;
          touchAX += dx * k; touchAY += dy * k;
        }
      }
      e.preventDefault();
    }
  }

  function touchEnd(e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touchId) {
        touchId = null; touchDir = 0;
        e.preventDefault();
      }
    }
  }

  /* ---------------------------------------------------------------- api -- */

  function buildBindings(m) {
    map = {};
    bindings = {};
    for (var i = 0; i < ACTIONS.length; i++) {
      var a = ACTIONS[i];
      var codes = (m && m[a]) ? m[a].slice() : DEFAULTS[a].slice();
      map[a] = codes;
      for (var j = 0; j < codes.length; j++) bindings[codes[j]] = a;
    }
  }

  /* init(keyTarget, touchTarget) — boot.js calls Input.init(window, canvas).
   * Called with a single argument it is treated as the touch target and keys
   * go to window, which is the sane default for a test harness. */
  function init(a, b) {
    if (attached) destroy();
    if (b !== undefined && b !== null) { keyTarget = a || window; el = b; }
    else { keyTarget = window; el = a || (typeof document !== 'undefined' ? document.body : null); }
    if (!bindings) buildBindings(null);
    clearHeld();

    keyTarget.addEventListener('keydown', onKeyDown, { passive: false });
    keyTarget.addEventListener('keyup', onKeyUp, { passive: false });
    window.addEventListener('blur', clearHeld);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', clearHeld);
    }
    if (el) {
      el.addEventListener('touchstart', touchStart, { passive: false });
      el.addEventListener('touchmove', touchMove, { passive: false });
      el.addEventListener('touchend', touchEnd, { passive: false });
      el.addEventListener('touchcancel', touchEnd, { passive: false });
    }
    attached = true;
  }

  function destroy() {
    if (!attached) return;
    (keyTarget || window).removeEventListener('keydown', onKeyDown);
    (keyTarget || window).removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', clearHeld);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', clearHeld);
    }
    if (el) {
      el.removeEventListener('touchstart', touchStart);
      el.removeEventListener('touchmove', touchMove);
      el.removeEventListener('touchend', touchEnd);
      el.removeEventListener('touchcancel', touchEnd);
    }
    attached = false;
    clearHeld();
  }

  /* Rebind. Pass a partial map; anything omitted keeps its default.
   * save.js owns persisting whatever bindings() returns. */
  function rebind(m) {
    var merged = {};
    for (var i = 0; i < ACTIONS.length; i++) {
      var a = ACTIONS[i];
      merged[a] = (m && m[a] && m[a].length) ? m[a].slice() : (map ? map[a] : DEFAULTS[a]);
    }
    buildBindings(merged);
    clearHeld();
    return bindings2map();
  }

  function bindings2map() {
    var out = {};
    for (var i = 0; i < ACTIONS.length; i++) out[ACTIONS[i]] = map[ACTIONS[i]].slice();
    return out;
  }

  /* For Frame's rebinding UI: the next key pressed is handed to cb instead of
   * being treated as input. Tab and Escape are left alone so the dialog stays
   * escapable and navigable. */
  function capture(cb) { capturing = cb; }

  /* One-shot edge read, consumed on read. Retry and pause want "was it pressed"
   * exactly once, not "is it down". */
  function justPressed(action) {
    if (!edges[action]) return false;
    edges[action] = false;
    return true;
  }

  function isDown(action) { return !!held[action]; }

  function setEnabled(on) {
    enabled = !!on;
    if (!enabled) clearHeld();
  }

  BAIT.Input = {
    ACTIONS: ACTIONS,
    DEFAULTS: DEFAULTS,

    init: init, destroy: destroy,
    dir: dir,
    rebind: rebind,
    bindings: function () { return map ? bindings2map() : null; },
    capture: capture,
    justPressed: justPressed,
    isDown: isDown,
    setEnabled: setEnabled,
    enabled: function () { return enabled; },
    clear: clearHeld,
    gamepadConnected: function () { return gamepadDir() !== 0 || padIndex >= 0; },
    touchActive: function () { return touchId !== null; }
  };

})(window.BAIT = window.BAIT || {});
