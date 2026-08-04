/* BAIT — mode state machine.
 *
 * OWNER: Relay. The single source of truth for "which screen are we on".
 * Screens (Frame), the editor (Chisel) and boot (Boss) hang off
 * Modes.subscribe and react to changes; nobody keeps their own copy.
 *
 * Shape: one BASE state plus an OVERLAY stack. Overlays (pause, settings)
 * sit over the base state without destroying it, so resume costs nothing —
 * SPEC §2 says death and retry must be instantaneous, and that starts with
 * never tearing down the playing state to show a menu.
 *
 * BASE STATES
 *   boot      transient: boot.js loads the save, reads #r=, then leaves
 *   title     main menu
 *   chapters  campaign chapter / room select
 *   gauntlet  daily intro and status
 *   workshop  local library (your rooms + imported rooms)
 *   editor    the room editor
 *   playing   the sim is live; ctx.origin says who sent us here
 *   results   post-run screen; ctx.origin says where "back" lands
 *
 * ctx FOR playing / results
 *   { origin: 'campaign' | 'gauntlet' | 'workshop' | 'editor' | 'link',
 *     ...whatever the origin screen needs back (room id, gauntlet run
 *     state, the editor's working room). Modes never inspects it beyond
 *     origin; it is a courier bag. }
 *
 * OVERLAYS
 *   paused    only over playing. Esc pushes it, Esc pops it.
 *   settings  over anything; usually title or paused.
 */
(function (BAIT) {
  'use strict';

  var BASE = {
    boot: 1, title: 1, chapters: 1, gauntlet: 1, workshop: 1,
    editor: 1, playing: 1, results: 1
  };

  var OVERLAYS = { paused: 1, settings: 1 };

  /* Legal moves between base states. go() rejects anything else and
   * returns false, loudly — an illegal transition is always a bug in a
   * screen, and silent acceptance hides it. playing -> playing is legal
   * on purpose: it is the gauntlet advancing to its next room. */
  var EDGES = {
    boot:     { title: 1, playing: 1 },
    title:    { chapters: 1, gauntlet: 1, workshop: 1, playing: 1 },
    chapters: { playing: 1, title: 1 },
    gauntlet: { playing: 1, title: 1 },
    workshop: { editor: 1, playing: 1, title: 1 },
    editor:   { playing: 1, workshop: 1 },
    playing:  { results: 1, playing: 1, editor: 1, chapters: 1,
                gauntlet: 1, workshop: 1, title: 1 },
    results:  { playing: 1, editor: 1, chapters: 1, gauntlet: 1,
                workshop: 1, title: 1 }
  };

  /* Where Esc / "back" lands from each base state. playing pauses
   * instead; results routes home by ctx.origin. */
  var PARENT = { chapters: 'title', gauntlet: 'title',
                 workshop: 'title', editor: 'workshop' };

  var ORIGIN_HOME = {
    campaign: 'chapters', gauntlet: 'gauntlet', workshop: 'workshop',
    editor: 'editor', link: 'title'
  };

  var state = 'boot';
  var ctx = {};
  var stack = [];   // [{ name, ctx }], top of stack is the visible overlay
  var subs = [];

  function snapshot() {
    var top = stack.length ? stack[stack.length - 1] : null;
    return {
      state: state,
      ctx: ctx,
      overlay: top ? top.name : null,
      overlayCtx: top ? top.ctx : null
    };
  }

  function emit() {
    var snap = snapshot();
    for (var i = 0; i < subs.length; i++) {
      try { subs[i](snap); }
      catch (e) {
        /* One broken screen must not stop routing for the rest. */
        if (typeof console !== 'undefined') {
          console.error('BAIT.Modes: subscriber threw', e);
        }
      }
    }
  }

  function warn(msg) {
    if (typeof console !== 'undefined') console.warn('BAIT.Modes: ' + msg);
    return false;
  }

  function go(next, nextCtx) {
    if (!BASE[next]) return warn('unknown state "' + next + '"');
    if (!(EDGES[state] && EDGES[state][next])) {
      return warn('illegal transition ' + state + ' -> ' + next);
    }
    state = next;
    ctx = nextCtx || {};
    stack.length = 0;          // a base change clears every overlay
    emit();
    return true;
  }

  function push(name, overlayCtx) {
    if (!OVERLAYS[name]) return warn('unknown overlay "' + name + '"');
    if (name === 'paused' && state !== 'playing') {
      return warn('paused only overlays playing');
    }
    if (stack.length && stack[stack.length - 1].name === name) {
      return false;            // already on top; Esc handlers double-fire
    }
    stack.push({ name: name, ctx: overlayCtx || {} });
    emit();
    return true;
  }

  function pop() {
    if (!stack.length) return false;
    stack.pop();
    emit();
    return true;
  }

  /* The one Esc handler for the whole game: overlay pops first, playing
   * pauses, results and the rest go home. Frame wires Esc to this and
   * nothing else. */
  function back() {
    if (stack.length) return pop();
    if (state === 'playing') return push('paused');
    if (state === 'results') {
      return go(ORIGIN_HOME[ctx.origin] || 'title', ctx.originCtx || {});
    }
    if (PARENT[state]) return go(PARENT[state]);
    return false;              // title: nowhere further back
  }

  function subscribe(fn) {
    subs.push(fn);
    return function unsubscribe() {
      var i = subs.indexOf(fn);
      if (i >= 0) subs.splice(i, 1);
    };
  }

  BAIT.Modes = {
    state: function () { return state; },
    ctx: function () { return ctx; },
    overlay: function () {
      return stack.length ? stack[stack.length - 1].name : null;
    },
    overlayCtx: function () {
      return stack.length ? stack[stack.length - 1].ctx : null;
    },
    snapshot: snapshot,
    go: go,
    push: push,
    pop: pop,
    back: back,
    subscribe: subscribe,
    ORIGIN_HOME: ORIGIN_HOME
  };

})(typeof window !== 'undefined'
  ? (window.BAIT = window.BAIT || {})
  : (global.BAIT = global.BAIT || {}));
