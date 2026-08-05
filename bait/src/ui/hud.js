/* BAIT — the in-run HUD.
 *
 * OWNER: Frame (UI). Deliberately minimal, because the room is the thing.
 * Timer, deaths, keys, token. It NEVER moves and never animates during a
 * run — a HUD that draws attention during a precision run is a bug (SPEC §2,
 * Boss's brief). Values change by textContent swap only.
 *
 * PLACEMENT: the strip sits in the canvas plate's TOP margin — the band
 * between the plate border (PLATE_PAD, y=18) and the room's top edge
 * (ROOM_Y, y=70), spanning exactly the room's width. draw.js keeps its
 * title block in the BOTTOM margin, so the two never collide, and the strip
 * can never clip the plate border or occlude a single cell of play. The
 * position is computed from the real #stage rect on show and on resize,
 * never per frame.
 *
 * CONTRACT (play.js calls update every rendered frame):
 *   BAIT.Hud.show() / .hide()
 *   BAIT.Hud.update({ ticks, deaths, keys, keysTotal, token, room })
 *     ticks      sim ticks elapsed (120Hz) — formatted here
 *     deaths     deaths this attempt
 *     keys       collected count; keysTotal 0 hides the slot
 *     token      the SIM boolean: true while the token is carried. Whether
 *                the slot shows at all comes from the room (no token tile,
 *                no slot). A legacy 'none'|'open'|'taken' string still works.
 *     room       the live room; sets the title line and the token slot,
 *                cached by reference so the per-frame cost is comparisons.
 *   BAIT.Hud.setTitle(text)   manual override, e.g. '2-07 — FOUR CORNERS'
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
  var roomRef = null, roomHasToken = false;

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
    window.addEventListener('resize', place);
  }

  /* Fit the strip to the plate's top margin, in the canvas's own scale.
   * Every number here is Ink's (Theme.m); nothing is invented. Falls back
   * to the CSS default (viewport top) when there is no #stage, e.g. in a
   * DOM-only harness. */
  function place() {
    if (!root) return;
    var c = document.getElementById('stage');
    var T = BAIT.Theme, m = T && T.m;
    if (!c || !m || !c.getBoundingClientRect) return;
    var r = c.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var sx = r.width / m.CANVAS_W, sy = r.height / m.CANVAS_H;
    root.style.left = (r.left + m.ROOM_X * sx) + 'px';
    root.style.top = (r.top + m.PLATE_PAD * sy) + 'px';
    root.style.width = (m.ROOM_W * sx) + 'px';
    root.style.height = ((m.ROOM_Y - m.PLATE_PAD) * sy) + 'px';
    root.style.transform = 'none';
  }

  function show() { build(); root.className = 'open'; place(); }
  function hide() { if (root) root.className = ''; }

  function setTitle(text) {
    build();
    if (text === last.title) return;
    last.title = text || '';
    refs.title.textContent = last.title;
  }

  /* sim boolean + room -> 'none' | 'open' | 'taken'. The room scan runs
   * once per room, cached by reference. */
  function tokenState(s) {
    if (typeof s.token === 'string') return s.token;
    if (s.room !== roomRef) {
      roomRef = s.room;
      roomHasToken = false;
      var P = BAIT.Pieces, tiles = s.room && s.room.tiles;
      if (P && tiles) {
        for (var i = 0; i < tiles.length; i++) {
          if (tiles[i] === P.TILE.TOKEN) { roomHasToken = true; break; }
        }
      }
    }
    if (!roomHasToken) return 'none';
    return s.token ? 'taken' : 'open';
  }

  function update(s) {
    if (!root || !s) return;

    if (s.room) {
      var name = s.room.name || '';
      setTitle(s.room.id
        ? String(s.room.id) + (name ? ' — ' + name : '')
        : name);
    }

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

    var tok = tokenState(s);
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
