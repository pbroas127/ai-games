/* BAIT — screens: title, chapter select, results, pause, settings.
 *
 * OWNER: Frame (UI). Everything the player sees that is not the room itself.
 * All of it is DOM inside #ui, layered over the canvas — DOM because it gives
 * us real typography, real focus rings and real keyboard nav (SPEC §8).
 *
 * STYLE RULE: not one hex literal or ad-hoc font size lives in this file.
 * Every colour is a var(--c-*) custom property and every size a var(--t-*),
 * both published by Ink's theme.js. The structural CSS for these screens is
 * injected below under the .scr-/.hud- prefixes; Ink may absorb it into
 * style.css verbatim — it reads only theme tokens.
 *
 * CONTRACTS this file exposes / consumes (posted in #bait-build):
 *   BAIT.Screens.show(name, data)   name: title|chapters|results|pause|settings
 *   BAIT.Screens.hide()             modes calls this when a run starts
 *   BAIT.Screens.back()             pop one level (Esc does this)
 *   BAIT.Screens.applySettings(s)   boot should call once with saved settings
 *   BAIT.Screens.fmtTime(ticks)     120Hz ticks -> "m:ss.d" (shared formatter)
 *
 *   Consumes, all defensively (reconciled when owners post):
 *   BAIT.Modes.go(name, data)              — Relay
 *   BAIT.Save.get()/.patch(p)/.subscribe() — Relay
 *   BAIT.Input.actions()/.rebind(id, cb)   — Forge
 *   BAIT.Audio.setVolume(v)                — Ink
 *   BAIT.Chapters.chapters                 — Atlas
 *
 * results data: { kind:'campaign'|'gauntlet'|'room', cleared, timeTicks,
 *   parTicks, deaths, tokenTaken, medals:{clear,clean,swift,token},
 *   heldMedals:{...}, lines:[..], shareText, onRetry, onNext, onBack }
 * pause data:   { onResume, onRetry, onQuit }
 */
(function (BAIT) {
  'use strict';

  var T = function () { return BAIT.Theme; };

  /* ------------------------------------------------------------- helpers -- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* 120Hz ticks -> "m:ss.d". Integer maths so it never drifts from the sim. */
  function fmtTime(ticks) {
    if (ticks == null || ticks < 0) return '-:--.-';
    var tenths = Math.floor(ticks / 12);
    var s = Math.floor(tenths / 10), d = tenths % 10;
    var m = Math.floor(s / 60); s = s % 60;
    return m + ':' + (s < 10 ? '0' : '') + s + '.' + d;
  }

  /* tick delta -> "1.2s", rounded up so "missed by 0.0s" cannot happen */
  function fmtDelta(ticks) {
    var tenths = Math.max(1, Math.ceil(ticks / 12));
    return Math.floor(tenths / 10) + '.' + (tenths % 10) + 's';
  }

  function todaySeed() {
    var d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  /* ------------------------------------------- defensive owner adapters -- */

  /* Relay's mode machine. Until it exists, fall back so screens still nav. */
  function modesGo(name, data, fallback) {
    var M = BAIT.Modes;
    var f = M && (M.go || M.to || M.enter);
    if (f) { f.call(M, name, data); return true; }
    if (fallback) { fallback(); return true; }
    setStatus('MODULE NOT LOADED: MODES');
    return false;
  }

  /* Relay's save. Local fallback doc so settings work before save.js lands. */
  var localDoc = null;
  function defaultSettings() {
    var prefersReduced = false;
    try {
      prefersReduced = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {}
    return { volume: 0.8, ghosts: true, reducedMotion: prefersReduced,
             colourblind: false };
  }
  function saveDoc() {
    var S = BAIT.Save;
    if (S && S.get) { var d = S.get(); if (d) return d; }
    if (!localDoc) localDoc = { settings: defaultSettings(), campaign: {} };
    return localDoc;
  }
  function settings() {
    var doc = saveDoc();
    if (!doc.settings) doc.settings = defaultSettings();
    var s = doc.settings, def = defaultSettings(), k;
    for (k in def) if (!(k in s)) s[k] = def[k];
    return s;
  }
  function patchSettings(part) {
    var s = settings(), k;
    for (k in part) if (Object.prototype.hasOwnProperty.call(part, k)) s[k] = part[k];
    var S = BAIT.Save;
    if (S && S.patch) S.patch({ settings: s });
    applySettings(s);
  }

  /* Push saved settings into the modules that act on them. Boot calls this
   * once; the settings screen calls it on every change. */
  function applySettings(s) {
    if (!s) s = settings();
    if (BAIT.Theme) {
      BAIT.Theme.setOption('colourblind', !!s.colourblind);
      BAIT.Theme.setOption('reducedMotion', !!s.reducedMotion);
    }
    var A = BAIT.Audio;
    if (A && A.setVolume) A.setVolume(s.volume);
  }

  /* Atlas's campaign. */
  function campaignChapters() {
    var C = BAIT.Chapters;
    if (!C) return null;
    if (Array.isArray(C)) return C;
    return C.chapters || C.list || null;
  }

  function roomKey(ci, ri, room) {
    return (room && room.id != null) ? String(room.id) : 'c' + ci + 'r' + ri;
  }
  function medalsOf(key) {
    var doc = saveDoc();
    var rec = doc.campaign && doc.campaign[key];
    return (rec && (rec.medals || rec.m)) || {};
  }
  function countMedals(m) {
    return (m.clear ? 1 : 0) + (m.clean ? 1 : 0) + (m.swift ? 1 : 0) + (m.token ? 1 : 0);
  }
  function medalTotals(chapters) {
    var have = 0, possible = 0;
    for (var ci = 0; ci < chapters.length; ci++) {
      var rooms = chapters[ci].rooms || [];
      for (var ri = 0; ri < rooms.length; ri++) {
        possible += 4;
        have += countMedals(medalsOf(roomKey(ci, ri, rooms[ri])));
      }
    }
    return { have: have, possible: possible };
  }

  /* Clipboard with the file:// fallback — navigator.clipboard can reject
   * outside a secure context, and a copy button that silently fails is worse
   * than none. Prefer Relay's Share.copy when it exists. */
  function copyText(text, done) {
    var Sh = BAIT.Share;
    if (Sh && Sh.copy) {
      var r = Sh.copy(text, done);
      if (r && typeof r.then === 'function') r.then(function () { done(true); },
                                                    function () { done(false); });
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); },
                                               function () { legacyCopy(text, done); });
      return;
    }
    legacyCopy(text, done);
  }
  function legacyCopy(text, done) {
    var ta = el('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    done(ok);
  }

  /* ------------------------------------------------------ injected style --
   * Structural CSS only, every value a theme token. Prefixes: .scr- .hud-
   * Ink: lift this whole block into style.css whenever you want it; nothing
   * here will fight you — delete injectCss() and it is gone.
   */
  function injectCss() {
    if (document.getElementById('frame-ui-css')) return;
    var css = [
      '#frame-screens{position:fixed;inset:0;display:none;z-index:20;',
      ' color:var(--c-chalk);font-family:var(--font-sans);font-size:var(--t-body);}',
      '#frame-screens.open{display:block;}',
      '#frame-screens.opaque{background:var(--c-void);}',

      '#frame-screens :focus{outline:none;}',
      '#frame-screens :focus-visible{outline:2px solid var(--c-chalk);outline-offset:3px;}',
      '#frame-screens button{appearance:none;-webkit-appearance:none;background:none;',
      ' border:none;color:inherit;font:inherit;cursor:pointer;text-align:left;padding:0;}',

      '.scr{position:absolute;inset:0;display:flex;flex-direction:column;',
      ' align-items:center;justify-content:center;overflow:auto;box-sizing:border-box;}',
      '.scr-plate-border{position:absolute;inset:18px;border:1px solid var(--c-rule-strong);',
      ' pointer-events:none;}',
      '.scr-reg{position:absolute;width:27px;height:27px;pointer-events:none;}',

      '.scr-label{font-size:var(--t-label);letter-spacing:var(--track-label);',
      ' text-transform:uppercase;color:var(--c-chalk-dim);}',
      '.scr-micro{font-family:var(--font-mono);font-size:var(--t-micro);',
      ' letter-spacing:var(--track-label);text-transform:uppercase;color:var(--c-chalk-faint);}',
      '.scr-h1{font-size:var(--t-h1);font-weight:600;letter-spacing:var(--track-label);',
      ' text-transform:uppercase;margin:0;}',
      '.scr-h2{font-size:var(--t-h2);font-weight:600;letter-spacing:var(--track-label);',
      ' text-transform:uppercase;margin:0;}',

      /* ---- title ---- */
      '.scr-title-inner{display:flex;flex-direction:column;align-items:center;gap:26px;',
      ' max-width:560px;width:100%;padding:24px;box-sizing:border-box;}',
      '.scr-wordmark{width:min(440px,78vw);height:auto;display:block;}',
      '.scr-tagline{margin:0;font-family:var(--font-mono);font-size:var(--t-small);',
      ' letter-spacing:0.1em;color:var(--c-chalk-dim);text-transform:uppercase;}',
      '.scr-menu{display:flex;flex-direction:column;gap:2px;width:100%;max-width:460px;',
      ' border-top:1px solid var(--c-rule);padding-top:18px;}',
      '.scr-item{display:flex;align-items:baseline;gap:16px;padding:11px 16px;',
      ' border:1px solid transparent;width:100%;box-sizing:border-box;}',
      '.scr-item:hover,.scr-item:focus-visible{border-color:var(--c-rule-strong);',
      ' background:var(--c-plate);}',
      '.scr-item[aria-disabled="true"]{color:var(--c-chalk-faint);cursor:default;}',
      '.scr-item-index{font-family:var(--font-mono);font-size:var(--t-small);',
      ' color:var(--c-chalk-faint);}',
      '.scr-item-label{font-size:var(--t-h3);letter-spacing:var(--track-label);',
      ' text-transform:uppercase;white-space:nowrap;}',
      '.scr-item-sub{margin-left:auto;font-family:var(--font-mono);font-size:var(--t-micro);',
      ' letter-spacing:0.08em;color:var(--c-chalk-faint);text-transform:uppercase;',
      ' text-align:right;}',
      '.scr-foot{position:absolute;left:0;right:0;bottom:30px;display:flex;',
      ' justify-content:center;gap:34px;}',
      '.scr-status{min-height:1.2em;}',

      /* ---- generic panel screens (results / pause / settings) ---- */
      '.scr-panel{background:var(--c-plate);border:1px solid var(--c-rule-strong);',
      ' padding:34px 40px;max-width:640px;width:min(640px,92vw);box-sizing:border-box;',
      ' display:flex;flex-direction:column;gap:22px;max-height:88vh;overflow:auto;}',
      '.scr-rule{border:none;border-top:1px solid var(--c-rule);margin:0;}',
      '.scr-row{display:flex;align-items:baseline;justify-content:space-between;gap:18px;}',
      '.scr-value{font-family:var(--font-mono);font-size:var(--t-body);color:var(--c-chalk);}',
      '.scr-lines{font-family:var(--font-mono);font-size:var(--t-small);',
      ' color:var(--c-chalk-dim);margin:0;white-space:pre-wrap;}',

      /* ---- medals ---- */
      '.scr-medals{display:flex;flex-direction:column;gap:10px;}',
      '.scr-medal{display:flex;align-items:center;gap:14px;}',
      '.scr-medal-name{font-size:var(--t-small);letter-spacing:var(--track-label);',
      ' text-transform:uppercase;width:6.5em;}',
      '.scr-medal-note{margin-left:auto;font-family:var(--font-mono);',
      ' font-size:var(--t-small);color:var(--c-chalk-dim);}',
      '.scr-medal.off .scr-medal-name{color:var(--c-chalk-faint);}',

      '.pip{width:9px;height:9px;box-sizing:border-box;display:inline-block;',
      ' border:1px solid var(--c-chalk-dim);background:none;flex:none;}',
      '.pip.on{background:var(--c-chalk);border-color:var(--c-chalk);}',
      '.pip.held{background:var(--c-chalk-faint);border-color:var(--c-chalk-faint);}',
      '.pip.tk.on{background:var(--c-brass);border-color:var(--c-brass);}',

      /* ---- chapter select ---- */
      '.scr-chap{justify-content:flex-start;padding:56px 48px 40px;gap:24px;}',
      '.scr-chap-head{width:100%;max-width:960px;display:flex;align-items:baseline;',
      ' justify-content:space-between;gap:20px;}',
      '.scr-chap-body{width:100%;max-width:960px;display:flex;gap:32px;flex:1;min-height:0;}',
      '.scr-tabs{display:flex;flex-direction:column;gap:2px;min-width:250px;}',
      '.scr-tab{display:flex;align-items:baseline;gap:12px;padding:10px 14px;',
      ' border:1px solid transparent;}',
      '.scr-tab:hover,.scr-tab:focus-visible{border-color:var(--c-rule-strong);',
      ' background:var(--c-plate);}',
      '.scr-tab[aria-selected="true"]{border-color:var(--c-chalk-dim);}',
      '.scr-tab-title{font-size:var(--t-small);letter-spacing:var(--track-label);',
      ' text-transform:uppercase;}',
      '.scr-tab.locked .scr-tab-title{color:var(--c-chalk-faint);}',
      '.scr-tab-count{margin-left:auto;font-family:var(--font-mono);',
      ' font-size:var(--t-micro);color:var(--c-chalk-faint);}',
      '.scr-rooms{flex:1;display:grid;grid-template-columns:repeat(7,1fr);gap:8px;',
      ' align-content:start;}',
      '.scr-room{border:1px solid var(--c-rule-strong);padding:8px 9px;display:flex;',
      ' flex-direction:column;gap:8px;background:none;}',
      '.scr-room:hover,.scr-room:focus-visible{background:var(--c-plate);',
      ' border-color:var(--c-chalk-dim);}',
      '.scr-room-num{font-family:var(--font-mono);font-size:var(--t-small);',
      ' color:var(--c-chalk);}',
      '.scr-room-pips{display:flex;gap:4px;}',
      '.scr-lockplate{flex:1;border:1px solid var(--c-rule-strong);display:flex;',
      ' flex-direction:column;align-items:center;justify-content:center;gap:12px;',
      ' min-height:220px;}',
      '.scr-legend{display:flex;gap:26px;width:100%;max-width:960px;',
      ' border-top:1px solid var(--c-rule);padding-top:14px;}',
      '.scr-legend span{display:flex;align-items:center;gap:7px;}',

      /* ---- buttons row ---- */
      '.scr-actions{display:flex;gap:10px;flex-wrap:wrap;}',
      '.scr-btn{border:1px solid var(--c-rule-strong);padding:9px 18px;',
      ' font-size:var(--t-small);letter-spacing:var(--track-label);',
      ' text-transform:uppercase;}',
      '.scr-btn:hover,.scr-btn:focus-visible{background:var(--c-plate);',
      ' border-color:var(--c-chalk-dim);}',
      '.scr-btn .scr-key{margin-left:10px;color:var(--c-chalk-faint);',
      ' font-family:var(--font-mono);font-size:var(--t-micro);}',

      /* ---- settings ---- */
      '.scr-set-row{display:flex;align-items:center;gap:18px;min-height:34px;}',
      '.scr-set-name{width:15em;flex:none;}',
      '.scr-toggle{border:1px solid var(--c-rule-strong);padding:5px 14px;',
      ' font-family:var(--font-mono);font-size:var(--t-small);min-width:4.5em;',
      ' text-align:center;}',
      '.scr-toggle[aria-pressed="true"]{background:var(--c-plate);',
      ' border-color:var(--c-chalk);color:var(--c-chalk);}',
      '.scr-toggle[aria-pressed="false"]{color:var(--c-chalk-faint);}',
      'input[type=range].scr-range{-webkit-appearance:none;appearance:none;flex:1;',
      ' height:2px;background:var(--c-rule-strong);}',
      'input[type=range].scr-range::-webkit-slider-thumb{-webkit-appearance:none;',
      ' appearance:none;width:14px;height:14px;background:var(--c-chalk);',
      ' border:none;border-radius:0;cursor:pointer;}',
      'input[type=range].scr-range::-moz-range-thumb{width:14px;height:14px;',
      ' background:var(--c-chalk);border:none;border-radius:0;cursor:pointer;}',
      '.scr-bind{display:flex;align-items:center;gap:14px;}',
      '.scr-bind-key{font-family:var(--font-mono);font-size:var(--t-small);',
      ' border:1px solid var(--c-rule);padding:3px 10px;min-width:5em;',
      ' text-align:center;color:var(--c-chalk);}',
      '.scr-bind-key.waiting{border-color:var(--c-brass);color:var(--c-brass);}',

      /* ---- HUD ---- */
      '#frame-hud{position:fixed;top:0;left:50%;transform:translateX(-50%);',
      ' width:min(1000px,100vw);display:none;justify-content:space-between;',
      ' align-items:baseline;padding:12px 28px;box-sizing:border-box;z-index:10;',
      ' pointer-events:none;font-family:var(--font-mono);}',
      '#frame-hud.open{display:flex;}',
      '.hud-side{display:flex;gap:26px;align-items:baseline;}',
      '.hud-slot{display:flex;gap:9px;align-items:baseline;}',
      '.hud-label{font-size:var(--t-micro);letter-spacing:var(--track-label);',
      ' text-transform:uppercase;color:var(--c-chalk-faint);}',
      '.hud-value{font-size:var(--t-small);color:var(--c-chalk);',
      ' font-variant-numeric:tabular-nums;}',
      '.hud-value.time{min-width:5.5ch;display:inline-block;}',
      '.hud-title{font-size:var(--t-micro);letter-spacing:var(--track-label);',
      ' text-transform:uppercase;color:var(--c-chalk-dim);}',
      '.hud-pip{width:9px;height:9px;box-sizing:border-box;display:inline-block;',
      ' border:1px solid var(--c-brass-dim);align-self:center;}',
      '.hud-pip.taken{background:var(--c-brass);border-color:var(--c-brass);}',

      /* ---- reduced motion: this UI animates nothing, but make it a rule ---- */
      ':root[data-reduced-motion="1"] #frame-screens *,',
      ':root[data-reduced-motion="1"] #frame-hud *{transition:none !important;',
      ' animation:none !important;}',

      /* ---- mobile portrait ---- */
      '@media (max-width:740px){',
      ' .scr{justify-content:flex-start;padding-top:40px;}',
      ' .scr-chap{padding:40px 16px 24px;}',
      ' .scr-chap-body{flex-direction:column;gap:18px;}',
      ' .scr-tabs{flex-direction:row;overflow-x:auto;min-width:0;width:100%;}',
      ' .scr-tab{flex:none;}',
      ' .scr-tab-count{margin-left:8px;}',
      ' .scr-rooms{grid-template-columns:repeat(4,1fr);}',
      ' .scr-panel{padding:22px 18px;}',
      ' .scr-foot{position:static;margin-top:26px;flex-wrap:wrap;gap:14px;}',
      ' .scr-item-sub{display:none;}',
      ' .scr-set-name{width:auto;flex:1;}',
      ' #frame-hud{padding:8px 12px;}',
      ' .hud-side{gap:14px;}',
      ' .hud-title{display:none;}',
      '}'
    ].join('\n');
    var s = el('style');
    s.id = 'frame-ui-css';
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* --------------------------------------------------------- decoration -- */

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(name, attrs) {
    var n = document.createElementNS(SVG_NS, name), k;
    for (k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) {
      n.setAttribute(k, attrs[k]);
    }
    return n;
  }

  /* Registration cross, one per plate corner — same furniture the canvas
   * plate wears, so the DOM screens and the board read as one drawing. */
  function regMark() {
    var s = svgEl('svg', { viewBox: '0 0 27 27', 'class': 'scr-reg', 'aria-hidden': 'true' });
    var p = svgEl('path', {
      d: 'M13.5 2 V25 M2 13.5 H25',
      stroke: 'var(--c-registration)', 'stroke-width': '1', fill: 'none'
    });
    s.appendChild(p);
    var c = svgEl('rect', {
      x: '8.5', y: '8.5', width: '10', height: '10',
      stroke: 'var(--c-registration)', 'stroke-width': '1', fill: 'none'
    });
    s.appendChild(c);
    return s;
  }

  function addPlateFurniture(scr) {
    scr.appendChild(el('div', 'scr-plate-border'));
    var pos = [['top', 'left'], ['top', 'right'], ['bottom', 'left'], ['bottom', 'right']];
    for (var i = 0; i < 4; i++) {
      var m = regMark();
      m.style[pos[i][0]] = '5px';
      m.style[pos[i][1]] = '5px';
      scr.appendChild(m);
    }
  }

  /* The wordmark, drawn as vector strokes — no webfonts exist in this game.
   * Letterforms are all hard right angles, per the art direction, with a
   * dimension line under them like a measured drawing. */
  function wordmark() {
    var s = svgEl('svg', {
      viewBox: '0 0 400 148', 'class': 'scr-wordmark',
      role: 'img', 'aria-label': 'BAIT'
    });
    var letters = svgEl('g', {
      stroke: 'var(--c-chalk)', 'stroke-width': '7', fill: 'none',
      'stroke-linecap': 'square', 'stroke-linejoin': 'miter'
    });
    /* B */
    letters.appendChild(svgEl('path', { d: 'M14 106 V14 H62 V56 H14 M14 56 H70 V106 H14' }));
    /* A — boxy stencil form, no diagonals anywhere in this drawing */
    letters.appendChild(svgEl('path', { d: 'M112 106 V14 H184 V106 M112 62 H184' }));
    /* I */
    letters.appendChild(svgEl('path', { d: 'M226 14 H274 M250 14 V106 M226 106 H274' }));
    /* T */
    letters.appendChild(svgEl('path', { d: 'M304 14 H376 M340 14 V106' }));
    s.appendChild(letters);

    /* dimension line, ticked at both ends */
    var dim = svgEl('g', {
      stroke: 'var(--c-chalk-faint)', 'stroke-width': '1', fill: 'none'
    });
    dim.appendChild(svgEl('path', { d: 'M14 132 H376 M14 126 V138 M376 126 V138' }));
    s.appendChild(dim);
    var fig = svgEl('text', {
      x: '195', y: '146', 'text-anchor': 'middle',
      fill: 'var(--c-chalk-faint)', 'font-size': '9',
      'letter-spacing': '2', 'font-family': 'var(--font-mono)'
    });
    fig.textContent = 'FIG. 1 — THE ROOM';
    s.appendChild(fig);
    return s;
  }

  function pip(state, isToken) {
    var p = el('span', 'pip' + (isToken ? ' tk' : ''));
    if (state === 'on') p.className += ' on';
    else if (state === 'held') p.className += ' held';
    p.setAttribute('aria-hidden', 'true');
    return p;
  }

  /* ------------------------------------------------------ screen manager -- */

  var container = null;
  var current = null;      /* { name, data, elRoot, onEsc, onKey } */
  var stack = [];
  var statusEl = null;

  function ensure() {
    if (container) return;
    injectCss();
    var ui = document.getElementById('ui');
    container = el('div');
    container.id = 'frame-screens';
    ui.appendChild(container);
    document.addEventListener('keydown', onDocKey, true);
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text || '';
  }

  var BUILDERS = {};

  function showInternal(name, data, isBack) {
    ensure();
    var build = BUILDERS[name];
    if (!build) return;
    if (current) {
      if (!isBack) stack.push({ name: current.name, data: current.data });
      container.removeChild(current.elRoot);
      current = null;
    } else {
      stack.length = 0;
    }
    statusEl = null;
    var scr = build(data || {});
    scr.name = name;
    scr.data = data || {};
    container.className = 'open' + (scr.overlay ? '' : ' opaque');
    /* overlay screens (pause) sit on a flat scrim so the board recedes;
     * the colour is derived from the theme, never stated here */
    container.style.background =
      scr.overlay && T() ? T().alpha(T().c.void, 0.72) : '';
    container.appendChild(scr.elRoot);
    current = scr;
    focusFirst(scr.elRoot);
  }

  function show(name, data) { showInternal(name, data, false); }

  function hide() {
    if (!container) return;
    if (current) { container.removeChild(current.elRoot); current = null; }
    stack.length = 0;
    container.className = '';
  }

  function back() {
    var prev = stack.pop();
    if (prev) showInternal(prev.name, prev.data, true);
    else hide();
  }

  function isOpen() { return !!current; }

  function onDocKey(e) {
    if (!current || e.defaultPrevented) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (current.onEsc) current.onEsc();
      else back();
      return;
    }
    if (e.key === 'Tab') { trapTab(e); return; }
    if (current.onKey) current.onKey(e);
  }

  /* ---------------------------------------------------- focus & keyboard -- */

  function focusables(root) {
    var nodes = root.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].offsetParent !== null || nodes[i] === document.activeElement) out.push(nodes[i]);
    }
    return out;
  }

  function focusFirst(root) {
    var pref = root.querySelector('[data-autofocus]');
    var f = pref || focusables(root)[0];
    if (f) f.focus();
  }

  function trapTab(e) {
    var f = focusables(current.elRoot);
    if (!f.length) return;
    var i = f.indexOf(document.activeElement);
    e.preventDefault();
    if (e.shiftKey) f[(i <= 0 ? f.length : i) - 1].focus();
    else f[(i + 1) % f.length].focus();
  }

  /* Arrow-key list navigation. vertical by default; horizontal:true swaps
   * the axis. Focus roves; Home/End jump. */
  function attachListNav(listEl, horizontal) {
    listEl.addEventListener('keydown', function (e) {
      var next = horizontal ? 'ArrowRight' : 'ArrowDown';
      var prev = horizontal ? 'ArrowLeft' : 'ArrowUp';
      if (e.key !== next && e.key !== prev && e.key !== 'Home' && e.key !== 'End') return;
      var items = focusables(listEl);
      if (!items.length) return;
      var i = items.indexOf(document.activeElement);
      if (i < 0) i = 0;
      if (e.key === next) i = Math.min(items.length - 1, i + 1);
      else if (e.key === prev) i = Math.max(0, i - 1);
      else if (e.key === 'Home') i = 0;
      else i = items.length - 1;
      items[i].focus();
      e.preventDefault();
      e.stopPropagation();
    });
  }

  /* 2D arrow navigation over a CSS grid; column count read from the computed
   * style so the mobile breakpoint keeps working without a second constant. */
  function attachGridNav(gridEl, onLeaveLeft) {
    gridEl.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k !== 'ArrowUp' && k !== 'ArrowDown' && k !== 'ArrowLeft' && k !== 'ArrowRight' &&
          k !== 'Home' && k !== 'End') return;
      var items = focusables(gridEl);
      if (!items.length) return;
      var cols = 1;
      try {
        cols = getComputedStyle(gridEl).gridTemplateColumns.split(' ').length || 1;
      } catch (err) {}
      var i = items.indexOf(document.activeElement);
      if (i < 0) i = 0;
      if (k === 'ArrowRight') i = Math.min(items.length - 1, i + 1);
      else if (k === 'ArrowLeft') {
        if (i % cols === 0 && onLeaveLeft) { onLeaveLeft(); e.preventDefault(); return; }
        i = Math.max(0, i - 1);
      }
      else if (k === 'ArrowDown') i = Math.min(items.length - 1, i + cols);
      else if (k === 'ArrowUp') i = Math.max(0, i - cols);
      else if (k === 'Home') i = 0;
      else i = items.length - 1;
      items[i].focus();
      e.preventDefault();
      e.stopPropagation();
    });
  }

  /* ---------------------------------------------------------- components -- */

  function menuItem(index, label, sub, onPick) {
    var b = el('button', 'scr-item');
    b.appendChild(el('span', 'scr-item-index', index));
    b.appendChild(el('span', 'scr-item-label', label));
    if (sub) b.appendChild(el('span', 'scr-item-sub', sub));
    b.addEventListener('click', onPick);
    return b;
  }

  function actionBtn(label, key, onPick) {
    var b = el('button', 'scr-btn');
    b.appendChild(document.createTextNode(label));
    if (key) b.appendChild(el('span', 'scr-key', key));
    b.addEventListener('click', onPick);
    return b;
  }

  function toggleBtn(name, get, set) {
    var b = el('button', 'scr-toggle', get() ? 'ON' : 'OFF');
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', get() ? 'true' : 'false');
    b.setAttribute('aria-pressed', get() ? 'true' : 'false');
    b.setAttribute('aria-label', name);
    b.addEventListener('click', function () {
      set(!get());
      var v = get();
      b.textContent = v ? 'ON' : 'OFF';
      b.setAttribute('aria-checked', v ? 'true' : 'false');
      b.setAttribute('aria-pressed', v ? 'true' : 'false');
    });
    return b;
  }

  /* --------------------------------------------------------------- TITLE -- */

  BUILDERS.title = function () {
    var scr = el('section', 'scr scr-title');
    scr.setAttribute('aria-label', 'Title');
    addPlateFurniture(scr);

    var inner = el('div', 'scr-title-inner');
    inner.appendChild(wordmark());
    inner.appendChild(el('p', 'scr-tagline', 'build a room that looks fair and isn’t'));

    var menu = el('nav', 'scr-menu');
    menu.setAttribute('aria-label', 'Main menu');

    var mCampaign = menuItem('01', 'Campaign', 'six chapters', function () {
      modesGo('campaign', null, function () { show('chapters'); });
    });
    mCampaign.setAttribute('data-autofocus', '');
    menu.appendChild(mCampaign);
    menu.appendChild(menuItem('02', 'Daily Gauntlet', 'No. ' + todaySeed(), function () {
      modesGo('gauntlet', null, null);
    }));
    menu.appendChild(menuItem('03', 'Workshop', 'build · prove · share', function () {
      modesGo('workshop', null, null);
    }));
    menu.appendChild(menuItem('04', 'Settings', 'audio · display · keys', function () {
      show('settings');
    }));
    attachListNav(menu, false);
    inner.appendChild(menu);

    statusEl = el('p', 'scr-micro scr-status', '');
    inner.appendChild(statusEl);
    scr.appendChild(inner);

    var foot = el('div', 'scr-foot');
    foot.appendChild(el('span', 'scr-micro', 'arrows move'));
    foot.appendChild(el('span', 'scr-micro', 'enter select'));
    foot.appendChild(el('span', 'scr-micro', 'esc back'));
    scr.appendChild(foot);

    return { elRoot: scr, overlay: false, onEsc: function () {} };
  };

  /* ------------------------------------------------------ CHAPTER SELECT -- */

  var lastChapter = 0;

  BUILDERS.chapters = function () {
    var scr = el('section', 'scr scr-chap');
    scr.setAttribute('aria-label', 'Chapter select');

    var chapters = campaignChapters();

    var head = el('header', 'scr-chap-head');
    head.appendChild(el('h1', 'scr-h1', 'Campaign'));
    var totals = chapters ? medalTotals(chapters) : null;
    if (totals) {
      head.appendChild(el('span', 'scr-value',
        'MEDALS ' + totals.have + ' / ' + totals.possible));
    }
    scr.appendChild(head);

    if (!chapters || !chapters.length) {
      var none = el('div', 'scr-lockplate');
      none.appendChild(el('span', 'scr-label', 'campaign data not loaded'));
      none.appendChild(el('span', 'scr-micro', 'src/data/chapters.js pending'));
      scr.appendChild(none);
      var backB = actionBtn('Back', 'ESC', back);
      backB.setAttribute('data-autofocus', '');
      scr.appendChild(backB);
      return { elRoot: scr, overlay: false };
    }

    var body = el('div', 'scr-chap-body');
    var tabs = el('div', 'scr-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Chapters');
    var main = el('div');
    main.style.flex = '1';
    main.style.minWidth = '0';
    main.style.display = 'flex';

    function chapterLocked(ci) {
      var need = chapters[ci].unlock || 0;
      return totals.have < need;
    }

    function renderRooms(ci) {
      lastChapter = ci;
      main.textContent = '';
      var sel = tabs.querySelectorAll('.scr-tab');
      for (var t = 0; t < sel.length; t++) {
        sel[t].setAttribute('aria-selected', t === ci ? 'true' : 'false');
      }
      var ch = chapters[ci];
      if (chapterLocked(ci)) {
        var lock = el('div', 'scr-lockplate');
        lock.style.flex = '1';
        lock.appendChild(el('span', 'scr-h2', 'Locked'));
        lock.appendChild(el('span', 'scr-value',
          'REQUIRES ' + (ch.unlock || 0) + ' MEDALS · HAVE ' + totals.have));
        lock.appendChild(el('span', 'scr-micro',
          'medals come from every room: clear · clean · swift · token'));
        main.appendChild(lock);
        return;
      }
      var grid = el('div', 'scr-rooms');
      grid.setAttribute('aria-label', (ch.title || ch.name || 'Chapter ' + (ci + 1)) + ' rooms');
      var rooms = ch.rooms || [];
      for (var ri = 0; ri < rooms.length; ri++) {
        (function (ri) {
          var room = rooms[ri];
          var m = medalsOf(roomKey(ci, ri, room));
          var b = el('button', 'scr-room');
          var num = (ri + 1 < 10 ? '0' : '') + (ri + 1);
          b.appendChild(el('span', 'scr-room-num', num));
          var pips = el('span', 'scr-room-pips');
          pips.appendChild(pip(m.clear ? 'on' : '', false));
          pips.appendChild(pip(m.clean ? 'on' : '', false));
          pips.appendChild(pip(m.swift ? 'on' : '', false));
          pips.appendChild(pip(m.token ? 'on' : '', true));
          b.appendChild(pips);
          b.setAttribute('aria-label',
            'Room ' + (ri + 1) + (room.name ? ' — ' + room.name : '') +
            ', ' + countMedals(m) + ' of 4 medals');
          b.addEventListener('click', function () {
            modesGo('play', { source: 'campaign', chapter: ci, room: ri }, null);
          });
          grid.appendChild(b);
        })(ri);
      }
      attachGridNav(grid, function () {
        var t = tabs.querySelectorAll('.scr-tab')[ci];
        if (t) t.focus();
      });
      main.appendChild(grid);
    }

    for (var ci = 0; ci < chapters.length; ci++) {
      (function (ci) {
        var ch = chapters[ci];
        var b = el('button', 'scr-tab' + (chapterLocked(ci) ? ' locked' : ''));
        b.setAttribute('role', 'tab');
        b.appendChild(el('span', 'scr-item-index', String(ci + 1)));
        b.appendChild(el('span', 'scr-tab-title', ch.title || ch.name || 'Chapter ' + (ci + 1)));
        var have = 0, rooms = ch.rooms || [];
        for (var ri = 0; ri < rooms.length; ri++) {
          have += countMedals(medalsOf(roomKey(ci, ri, rooms[ri])));
        }
        b.appendChild(el('span', 'scr-tab-count',
          chapterLocked(ci) ? 'LOCKED' : have + '/' + rooms.length * 4));
        b.addEventListener('click', function () { renderRooms(ci); });
        b.addEventListener('focus', function () { renderRooms(ci); });
        if (ci === Math.min(lastChapter, chapters.length - 1)) b.setAttribute('data-autofocus', '');
        tabs.appendChild(b);
      })(ci);
    }
    attachListNav(tabs, false);
    tabs.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') {
        var first = main.querySelector('button');
        if (first) { first.focus(); e.preventDefault(); e.stopPropagation(); }
      }
    });

    body.appendChild(tabs);
    body.appendChild(main);
    scr.appendChild(body);

    var legend = el('div', 'scr-legend');
    var names = [['CLEAR', false], ['CLEAN', false], ['SWIFT', false], ['TOKEN', true]];
    for (var i = 0; i < names.length; i++) {
      var s = el('span', 'scr-micro');
      s.appendChild(pip('on', names[i][1]));
      s.appendChild(document.createTextNode(names[i][0]));
      legend.appendChild(s);
    }
    if (chapters.length) {
      var gateNote = el('span', 'scr-micro');
      gateNote.style.marginLeft = 'auto';
      var lastGate = chapters[chapters.length - 1].unlock || 0;
      if (lastGate) {
        gateNote.textContent = 'final chapter unlocks at ' + lastGate + ' medals';
      }
      legend.appendChild(gateNote);
    }
    scr.appendChild(legend);

    renderRooms(Math.min(lastChapter, chapters.length - 1));

    return { elRoot: scr, overlay: false };
  };

  /* ------------------------------------------------------------- RESULTS -- */

  BUILDERS.results = function (d) {
    var scr = el('section', 'scr');
    scr.setAttribute('aria-label', 'Results');
    var panel = el('div', 'scr-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');

    var verdict = d.cleared ? 'Cleared' : (d.kind === 'gauntlet' ? 'Out of lives' : 'Caught');
    panel.appendChild(el('h1', 'scr-h1', verdict));

    var timeRow = el('div', 'scr-row');
    timeRow.appendChild(el('span', 'scr-label', 'time'));
    timeRow.appendChild(el('span', 'scr-value',
      fmtTime(d.timeTicks) +
      (d.parTicks != null ? '  (PAR ' + fmtTime(d.parTicks) + ')' : '')));
    panel.appendChild(timeRow);

    var deathRow = el('div', 'scr-row');
    deathRow.appendChild(el('span', 'scr-label', 'deaths'));
    deathRow.appendChild(el('span', 'scr-value', String(d.deaths || 0)));
    panel.appendChild(deathRow);

    if (d.lines && d.lines.length) {
      panel.appendChild(el('hr', 'scr-rule'));
      panel.appendChild(el('pre', 'scr-lines', d.lines.join('\n')));
    }

    if (d.medals) {
      panel.appendChild(el('hr', 'scr-rule'));
      var medals = el('div', 'scr-medals');
      var held = d.heldMedals || {};
      var rows = [
        ['clear', 'Clear', false, d.cleared ? '' : 'reach the exit'],
        ['clean', 'Clean', false,
          d.medals.clean ? '' : (d.deaths ? d.deaths + (d.deaths === 1 ? ' death' : ' deaths') : 'zero deaths')],
        ['swift', 'Swift', false,
          d.medals.swift ? '' :
            (d.parTicks != null && d.timeTicks != null && d.cleared
              ? 'missed by ' + fmtDelta(d.timeTicks - d.parTicks) : 'inside par')],
        ['token', 'Token', true, d.medals.token ? '' : 'left behind']
      ];
      for (var i = 0; i < rows.length; i++) {
        var key = rows[i][0];
        var earned = !!d.medals[key];
        var had = !!held[key];
        var row = el('div', 'scr-medal' + (earned || had ? '' : ' off'));
        row.appendChild(pip(earned ? 'on' : (had ? 'held' : ''), rows[i][2]));
        row.appendChild(el('span', 'scr-medal-name', rows[i][1]));
        var note = earned ? (had ? '' : 'EARNED') : (had ? 'held' : rows[i][3]);
        row.appendChild(el('span', 'scr-medal-note', note));
        medals.appendChild(row);
      }
      panel.appendChild(medals);
    }

    panel.appendChild(el('hr', 'scr-rule'));
    var actions = el('div', 'scr-actions');
    if (d.onRetry) {
      var rb = actionBtn('Retry', 'R', function () { hide(); d.onRetry(); });
      rb.setAttribute('data-autofocus', '');
      actions.appendChild(rb);
    }
    if (d.onNext) {
      var nb = actionBtn('Next', 'N', function () { hide(); d.onNext(); });
      if (!d.onRetry) nb.setAttribute('data-autofocus', '');
      actions.appendChild(nb);
    }
    if (d.shareText) {
      var cb = actionBtn('Copy result', '', function () {
        copyText(d.shareText, function (ok) {
          cb.firstChild.textContent = ok ? 'Copied' : 'Copy failed';
        });
      });
      actions.appendChild(cb);
    }
    actions.appendChild(actionBtn('Back', 'ESC', function () {
      if (d.onBack) { hide(); d.onBack(); } else back();
    }));
    attachListNav(actions, true);
    panel.appendChild(actions);

    scr.appendChild(panel);
    return {
      elRoot: scr, overlay: false,
      onEsc: function () { if (d.onBack) { hide(); d.onBack(); } else back(); },
      onKey: function (e) {
        var k = e.key.toLowerCase();
        if (k === 'r' && d.onRetry) { e.preventDefault(); hide(); d.onRetry(); }
        else if (k === 'n' && d.onNext) { e.preventDefault(); hide(); d.onNext(); }
      }
    };
  };

  /* --------------------------------------------------------------- PAUSE -- */

  BUILDERS.pause = function (d) {
    var scr = el('section', 'scr');
    scr.setAttribute('aria-label', 'Paused');
    var panel = el('div', 'scr-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.appendChild(el('h1', 'scr-h2', 'Paused'));

    var menu = el('div', 'scr-menu');
    menu.style.borderTop = 'none';
    menu.style.paddingTop = '0';
    function resume() { hide(); if (d.onResume) d.onResume(); }
    var mi = menuItem('01', 'Resume', 'esc', resume);
    mi.setAttribute('data-autofocus', '');
    menu.appendChild(mi);
    if (d.onRetry) {
      menu.appendChild(menuItem('02', 'Retry room', 'r', function () {
        hide(); d.onRetry();
      }));
    }
    var ghostRow = el('div', 'scr-set-row');
    ghostRow.style.padding = '0 16px';
    ghostRow.appendChild(el('span', 'scr-label scr-set-name', 'ghosts'));
    ghostRow.appendChild(toggleBtn('Ghosts',
      function () { return !!settings().ghosts; },
      function (v) { patchSettings({ ghosts: v }); }));
    menu.appendChild(ghostRow);
    menu.appendChild(menuItem('03', 'Settings', '', function () {
      show('settings');
    }));
    menu.appendChild(menuItem('04', 'Quit to title', '', function () {
      hide(); if (d.onQuit) d.onQuit(); else show('title');
    }));
    attachListNav(menu, false);
    panel.appendChild(menu);
    scr.appendChild(panel);

    return {
      elRoot: scr, overlay: true,
      onEsc: resume,
      onKey: function (e) {
        if (e.key.toLowerCase() === 'r' && d.onRetry) {
          e.preventDefault(); hide(); d.onRetry();
        }
      }
    };
  };

  /* ------------------------------------------------------------ SETTINGS -- */

  BUILDERS.settings = function () {
    var scr = el('section', 'scr');
    scr.setAttribute('aria-label', 'Settings');
    var panel = el('div', 'scr-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.appendChild(el('h1', 'scr-h2', 'Settings'));

    /* volume */
    var volRow = el('div', 'scr-set-row');
    volRow.appendChild(el('span', 'scr-label scr-set-name', 'master volume'));
    var vol = el('input', 'scr-range');
    vol.type = 'range'; vol.min = '0'; vol.max = '100'; vol.step = '5';
    vol.value = String(Math.round((settings().volume || 0) * 100));
    vol.setAttribute('aria-label', 'Master volume');
    var volVal = el('span', 'scr-value', vol.value + '%');
    volVal.style.minWidth = '4ch';
    vol.addEventListener('input', function () {
      volVal.textContent = vol.value + '%';
      patchSettings({ volume: (+vol.value) / 100 });
    });
    volRow.appendChild(vol);
    volRow.appendChild(volVal);
    panel.appendChild(volRow);

    /* toggles */
    function setRow(name, get, set) {
      var row = el('div', 'scr-set-row');
      row.appendChild(el('span', 'scr-label scr-set-name', name));
      row.appendChild(toggleBtn(name, get, set));
      return row;
    }
    panel.appendChild(setRow('ghosts',
      function () { return !!settings().ghosts; },
      function (v) { patchSettings({ ghosts: v }); }));
    panel.appendChild(setRow('reduced motion',
      function () { return !!settings().reducedMotion; },
      function (v) { patchSettings({ reducedMotion: v }); }));
    panel.appendChild(setRow('colourblind-safe hazards',
      function () { return !!settings().colourblind; },
      function (v) { patchSettings({ colourblind: v }); }));

    /* key bindings */
    panel.appendChild(el('hr', 'scr-rule'));
    panel.appendChild(el('h2', 'scr-label', 'key bindings'));
    var I = BAIT.Input;
    var actions = (I && I.actions) ? I.actions() : null;
    if (!actions || !actions.length) {
      panel.appendChild(el('p', 'scr-micro',
        I ? 'this input module does not expose rebinding'
          : 'input module not loaded'));
    } else {
      for (var i = 0; i < actions.length; i++) {
        (function (a) {
          var row = el('div', 'scr-set-row scr-bind');
          row.appendChild(el('span', 'scr-label scr-set-name', a.label || a.id));
          var keyEl = el('span', 'scr-bind-key', a.key || '—');
          var rb = actionBtn('Rebind', '', function () {
            keyEl.textContent = 'PRESS KEY';
            keyEl.className = 'scr-bind-key waiting';
            function done(newKey) {
              keyEl.className = 'scr-bind-key';
              keyEl.textContent = newKey || a.key || '—';
              if (newKey) a.key = newKey;
            }
            try {
              var r = I.rebind(a.id, done);
              if (r && typeof r.then === 'function') {
                r.then(done, function () { done(null); });
              }
            } catch (e) { done(null); }
          });
          row.appendChild(keyEl);
          row.appendChild(rb);
          panel.appendChild(row);
        })(actions[i]);
      }
    }

    panel.appendChild(el('hr', 'scr-rule'));
    var actionsRow = el('div', 'scr-actions');
    var backB = actionBtn('Back', 'ESC', back);
    backB.setAttribute('data-autofocus', '');
    actionsRow.appendChild(backB);
    panel.appendChild(actionsRow);
    scr.appendChild(panel);

    return { elRoot: scr, overlay: false };
  };

  /* --------------------------------------------------------------- expose -- */

  BAIT.Screens = {
    show: show,
    hide: hide,
    back: back,
    isOpen: isOpen,
    applySettings: applySettings,
    fmtTime: fmtTime,
    fmtDelta: fmtDelta
  };

})(window.BAIT = window.BAIT || {});
