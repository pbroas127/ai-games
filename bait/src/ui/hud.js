/* BAIT — the in-run HUD.
 *
 * OWNER: Frame (UI). Deliberately minimal, because the room is the thing.
 * Timer, deaths, keys, token. It sits in the plate's top margin, never
 * overlaps the play area, and NEVER moves or animates during a run — a HUD
 * that draws attention during a precision run is a bug (SPEC §2, Boss's
 * brief). Values change by textContent swap only.
 *
 * CONTRACT (for Relay's modes.js / Forge's loop):
 *   BAIT.Hud.show()
 *   BAIT.Hud.hide()
 *   BAIT.Hud.setTitle('CH 2 · ROOM 07 — CADENCE')   // static per room
 *   BAIT.Hud.update({ ticks, deaths, keys, keysTotal, token })
 *     ticks      sim ticks elapsed (120Hz) — formatted here
 *     deaths     deaths this attempt/run
 *     keys       collected count; keysTotal 0 hides the slot
 *     token      'none' | 'open' | 'taken'  ('none' hides the slot)
 *
 * update() is safe to call every frame: each field writes to the DOM only
 * when its displayed string actually changed.
 *
 * Styling comes from the .hud- rules injected by screens.js (theme tokens
 * only). The #ui container is aria-live=polite, so everything volatile in
 * here is aria-hidden and the numbers are exposed through calm labels.
 */
(function (BAIT) {
  'use strict';

  var root = null, refs = null;
  var last = { time: '', deaths: '', keys: '', token: '', title: '' };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function slot(label, valueCls) {
    var s = el('div', 'hud-slot');
    s.appendChild(el('span', 'hud-label', label));
    var v = el('span', 'hud-value' + (valueCls ? ' ' + valueCls : ''), '');
    s.appendChild(v);
    return { el: s, value: v };
  }

  function build() {
    if (root) return;
    root = el('div');
    root.id = 'frame-hud';
    /* the timer changes ~10x/s; never let it hit the aria-live region */
    root.setAttribute('aria-live', 'off');

    var left = el('div', 'hud-side');
    var time = slot('time', 'time');
    time.value.setAttribute('aria-hidden', 'true');
    left.appendChild(time.el);
    var deaths = slot('deaths');
    left.appendChild(deaths.el);

    var title = el('span', 'hud-title', '');

    var right = el('div', 'hud-side');
    var keys = slot('keys');
    right.appendChild(keys.el);
    var token = el('div', 'hud-slot');
    token.appendChild(el('span', 'hud-label', 'token'));
    var tokenPip = el('span', 'hud-pip');
    tokenPip.setAttribute('role', 'img');
    tokenPip.setAttribute('aria-label', 'token not taken');
    token.appendChild(tokenPip);
    right.appendChild(token);

    root.appendChild(left);
    root.appendChild(title);
    root.appendChild(right);

    refs = {
      time: time.value, deaths: deaths.value,
      keysSlot: keys.el, keys: keys.value,
      tokenSlot: token, tokenPip: tokenPip,
      title: title
    };

    document.getElementById('ui').appendChild(root);
  }

  function show() { build(); root.className = 'open'; }
  function hide() { if (root) root.className = ''; }

  function setTitle(text) {
    build();
    if (text === last.title) return;
    last.title = text || '';
    refs.title.textContent = last.title;
  }

  function update(s) {
    if (!root || !s) return;

    var t = BAIT.Screens ? BAIT.Screens.fmtTime(s.ticks || 0) : String(s.ticks || 0);
    if (t !== last.time) { last.time = t; refs.time.textContent = t; }

    var d = String(s.deaths || 0);
    if (d !== last.deaths) { last.deaths = d; refs.deaths.textContent = d; }

    var k = (s.keysTotal > 0) ? s.keys + '/' + s.keysTotal : '';
    if (k !== last.keys) {
      last.keys = k;
      refs.keys.textContent = k;
      refs.keysSlot.style.display = k ? '' : 'none';
    }

    var tok = s.token || 'none';
    if (tok !== last.token) {
      last.token = tok;
      refs.tokenSlot.style.display = tok === 'none' ? 'none' : '';
      refs.tokenPip.className = 'hud-pip' + (tok === 'taken' ? ' taken' : '');
      refs.tokenPip.setAttribute('aria-label',
        tok === 'taken' ? 'token taken' : 'token not taken');
    }
  }

  BAIT.Hud = { show: show, hide: hide, update: update, setTitle: setTitle };

})(window.BAIT = window.BAIT || {});
