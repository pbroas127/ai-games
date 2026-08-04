/* BAIT — palette, metrics, type scale.
 *
 * OWNER: Ink (Art). SPEC §3: the palette lives HERE and nowhere else. There
 * are no hex literals anywhere else in the project, including style.css —
 * this file publishes every colour as a CSS custom property on :root at load
 * so the DOM chrome and the canvas are literally reading the same numbers.
 *
 * ART DIRECTION, restated so it survives contact with a deadline:
 * blueprint. Chalk-white line work on flat slate. Hard right angles, 2px
 * strokes, stencil labels, drawn like a patent diagram. Blueprints read as
 * HONEST, which is the joke of the entire game.
 *
 * Banned outright: dark background + neon accent + bloom + synth pad.
 * Nothing in here glows. Nothing in here is saturated past ~55%. If a colour
 * you are adding would look at home in a synthwave title card, it is wrong.
 */
(function (BAIT) {
  'use strict';

  var K = BAIT.Pieces.K;

  /* ------------------------------------------------------------- palette --
   * Two plates. `base` ships by default. `cb` is the colourblind-safe plate
   * required by SPEC §8, which swaps the red/green pair (invisible to the
   * ~8% of men with deutan or protan vision) for blue/orange, the one pair
   * that survives every common form of colour vision deficiency.
   *
   * Colour is NEVER the only carrier of meaning. Hazards also hatch, the
   * exit also has a chevron, keys also count in the HUD. The plate below is
   * a second channel, not the channel. See draw.js.
   */
  var PLATES = {
    base: {
      /* the desk the board sits on */
      void:        '#12171b',
      /* the board itself, and the floor inside the room */
      plate:       '#1e262d',
      floor:       '#232c34',
      /* drafting grid — present, quiet, never competing with the line work */
      rule:        '#2b343c',
      ruleStrong:  '#3a4650',

      /* chalk. The primary and almost only mark-making colour. */
      chalk:       '#e8ece9',
      chalkDim:    '#96a1a9',
      chalkFaint:  '#5f6b74',

      /* hazards. Dry oxide red, the colour of a stamped warning on a
       * technical drawing. Deliberately not a "danger neon". */
      danger:      '#c2503b',
      dangerDim:   '#7e3628',

      /* reward metal — keys and the token. Ochre, like a stencil overspray. */
      brass:       '#d3a04d',
      brassDim:    '#8a6931',

      /* the honest exit. Chalky verdigris, desaturated to sit beside chalk
       * without pulling focus. The MIMIC renders in this exact colour — that
       * is the point of it, and it is why this must never be special-cased. */
      verify:      '#7fae9f',
      verifyDim:   '#4d6f65',

      /* the dot */
      dot:         '#f4f7f4',
      dotGhost:    '#4e5b64',

      /* paper */
      grain:       '#ffffff',
      registration:'#6d7982'
    },

    cb: {
      void:        '#12171b',
      plate:       '#1e262d',
      floor:       '#232c34',
      rule:        '#2b343c',
      ruleStrong:  '#3a4650',

      chalk:       '#e8ece9',
      chalkDim:    '#96a1a9',
      chalkFaint:  '#5f6b74',

      /* deutan/protan-safe pair: orange hazard, blue exit */
      danger:      '#d3813a',
      dangerDim:   '#8c5322',

      brass:       '#c9b26a',
      brassDim:    '#847247',

      verify:      '#5c9ec9',
      verifyDim:   '#3a6484',

      dot:         '#f4f7f4',
      dotGhost:    '#4e5b64',

      grain:       '#ffffff',
      registration:'#6d7982'
    }
  };

  /* ------------------------------------------------------------- metrics --
   * The room is 20x14 cells of 40px = 800x560, sitting on a 1000x700 board.
   * That leaves a 100px side margin and a 70px top/bottom margin: the plate
   * border, where the registration marks, the room number and the stencil
   * annotations live. The room never moves and never scrolls.
   */
  var ROOM_W = K.GRID_W * K.CELL;   /* 800 */
  var ROOM_H = K.GRID_H * K.CELL;   /* 560 */

  var M = {
    CANVAS_W: 1000,
    CANVAS_H: 700,
    ROOM_W: ROOM_W,
    ROOM_H: ROOM_H,
    ROOM_X: (1000 - ROOM_W) >> 1,   /* 100 */
    ROOM_Y: (700 - ROOM_H) >> 1,    /* 70  */
    CELL: K.CELL,

    /* stroke weights. Three, and only three. A drawing with five line
     * weights reads as an accident; three reads as a decision. */
    HAIR: 1,
    LINE: 2,
    BOLD: 3,

    /* hazards are hard-edged, always. No rounded corners on anything that
     * can kill you — SPEC §3. Roundness reads as friendly and this game
     * lies quite enough already. */
    RADIUS: 0,

    /* 45-degree hatching is the non-colour channel for lethality */
    HATCH_GAP: 6,
    HATCH_W: 1,

    /* plate furniture */
    REG_SIZE: 13,      /* registration cross arm length */
    REG_INSET: 26,
    PLATE_PAD: 18,     /* inset of the plate border from the canvas edge */

    /* paper grain: sparse, static, generated once into an offscreen tile */
    GRAIN_TILE: 128,
    GRAIN_DOTS: 220,
    GRAIN_ALPHA: 0.022
  };

  /* ---------------------------------------------------------------- type --
   * System stack only — SPEC §0 bans external fonts. The stencil feel comes
   * from uppercase + heavy tracking + a restricted scale, not from a
   * typeface we are not allowed to ship.
   */
  var T = {
    sans: '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
    mono: 'ui-monospace, "Cascadia Mono", "SF Mono", Consolas, "Liberation Mono", monospace',

    /* one scale, used everywhere, no ad-hoc sizes */
    wordmark: 64,
    h1: 34,
    h2: 22,
    h3: 17,
    body: 15,
    small: 13,
    label: 11,        /* stencil labels on pieces and plate furniture */
    micro: 10,

    /* tracking, in em. Uppercase without tracking looks cramped and cheap. */
    trackLabel: 0.22,
    trackWordmark: 0.14,
    trackBody: 0.01,

    lineTight: 1.15,
    lineBody: 1.5
  };

  /* ---------------------------------------------------------------- state --
   * Settings that change how everything draws. modes.js/screens.js flip
   * these; draw.js and fx.js read them every frame. Kept here so there is
   * exactly one place that knows what "reduced motion" means.
   */
  var state = {
    plate: 'base',
    reducedMotion: false,
    grain: true
  };

  var C = PLATES.base;

  /* Publish the active plate as CSS custom properties so style.css can be
   * written entirely in var() and still obey the no-hex-outside-theme rule.
   * Also mirrors the type scale and the two boolean settings, the latter as
   * attributes on <html> for CSS to hook.
   */
  function publish() {
    if (typeof document === 'undefined') return;
    var root = document.documentElement, k;
    for (k in C) if (Object.prototype.hasOwnProperty.call(C, k)) {
      root.style.setProperty('--c-' + kebab(k), C[k]);
    }
    root.style.setProperty('--font-sans', T.sans);
    root.style.setProperty('--font-mono', T.mono);
    root.style.setProperty('--t-wordmark', T.wordmark + 'px');
    root.style.setProperty('--t-h1', T.h1 + 'px');
    root.style.setProperty('--t-h2', T.h2 + 'px');
    root.style.setProperty('--t-h3', T.h3 + 'px');
    root.style.setProperty('--t-body', T.body + 'px');
    root.style.setProperty('--t-small', T.small + 'px');
    root.style.setProperty('--t-label', T.label + 'px');
    root.style.setProperty('--t-micro', T.micro + 'px');
    root.style.setProperty('--track-label', T.trackLabel + 'em');
    root.style.setProperty('--track-wordmark', T.trackWordmark + 'em');
    root.setAttribute('data-plate', state.plate);
    root.setAttribute('data-reduced-motion', state.reducedMotion ? '1' : '0');
  }

  function kebab(s) {
    return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  }

  /* Compose a canvas font string from the scale. Nothing in the renderer
   * builds a font string by hand. */
  function font(size, weight, mono) {
    return (weight || 400) + ' ' + size + 'px ' + (mono ? T.mono : T.sans);
  }

  /* rgba() from a plate colour, for the very few places that need one:
   * ghosts, the grain tile, the death-replay vignette. Kept here so the hex
   * never leaves this file. */
  function alpha(hex, a) {
    var h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' +
           (n & 255) + ',' + a + ')';
  }

  /* Mix two plate colours, 0 = a, 1 = b. Used for the dim tiers of ghosts
   * and for the push-in desaturation on the death replay. */
  function mix(a, b, t) {
    var x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
    var r = Math.round(((x >> 16) & 255) + (((y >> 16) & 255) - ((x >> 16) & 255)) * t);
    var g = Math.round(((x >> 8) & 255) + (((y >> 8) & 255) - ((x >> 8) & 255)) * t);
    var bl = Math.round((x & 255) + ((y & 255) - (x & 255)) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  function setPlate(name) {
    if (!PLATES[name]) return;
    state.plate = name;
    C = PLATES[name];
    Theme.c = C;
    publish();
  }

  function setOption(key, value) {
    if (key === 'colourblind') return setPlate(value ? 'cb' : 'base');
    if (key in state) { state[key] = value; publish(); }
  }

  var Theme = {
    c: C,
    plates: PLATES,
    m: M,
    t: T,
    state: state,
    font: font,
    alpha: alpha,
    mix: mix,
    setPlate: setPlate,
    setOption: setOption,
    publish: publish,

    /* px position of a cell's top-left corner on the canvas */
    cellX: function (cx) { return M.ROOM_X + cx * M.CELL; },
    cellY: function (cy) { return M.ROOM_Y + cy * M.CELL; },

    /* Boss's boot.js calls this by name. Same thing publish() does. */
    install: publish,

    /* THE ONE GRID. Requested by Chisel so the editor hit-tests against the
     * exact geometry the renderer draws on — if we each compute it, we drift
     * by a pixel and placement feels broken.
     *
     * `scale` matters: style.css presents the 1000x700 board at whatever size
     * the window allows, so a click in CSS pixels is not a click in board
     * pixels until you divide by this.
     */
    layout: function (canvas) {
      var scale = 1;
      if (canvas && canvas.getBoundingClientRect) {
        var r = canvas.getBoundingClientRect();
        if (r.width) scale = r.width / M.CANVAS_W;
      }
      return { ox: M.ROOM_X, oy: M.ROOM_Y, cell: M.CELL, scale: scale,
               w: K.GRID_W, h: K.GRID_H };
    },

    /* Client coordinates straight to a cell, or null if outside the room.
     * Use this rather than doing the arithmetic yourself. */
    hitCell: function (canvas, clientX, clientY) {
      if (!canvas || !canvas.getBoundingClientRect) return null;
      var r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      var bx = (clientX - r.left) * (M.CANVAS_W / r.width);
      var by = (clientY - r.top) * (M.CANVAS_H / r.height);
      var cx = Math.floor((bx - M.ROOM_X) / M.CELL);
      var cy = Math.floor((by - M.ROOM_Y) / M.CELL);
      if (cx < 0 || cy < 0 || cx >= K.GRID_W || cy >= K.GRID_H) return null;
      return { cx: cx, cy: cy, index: cy * K.GRID_W + cx };
    }
  };

  BAIT.Theme = Theme;
  publish();

})(window.BAIT = window.BAIT || {});
