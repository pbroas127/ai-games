/* BAIT — result strings and the URL layer.
 *
 * OWNER: Relay.
 *
 * Two jobs (SPEC §5):
 *   1. Result strings, ALWAYS with a par denominator — a bare number
 *      means nothing to a reader:
 *        BAIT gauntlet 214 · cleared 4/5 · 3 deaths · 2:41 (par 3:10)
 *        BAIT room k3f9x2m0qr7v · cleared in 2 deaths · 0:38 (par 0:31)
 *   2. The #r=CODE hash: reading it at boot, writing it on share.
 *      A hash is untrusted input; this file only checks shape and size,
 *      and Codec.decode remains the real validator.
 *
 * No leaderboard, ever. There is no server.
 */
(function (BAIT) {
  'use strict';

  var TICK_HZ = BAIT.Pieces ? BAIT.Pieces.K.TICK_HZ : 120;

  /* Room codes are base64url. Anything else in a hash is garbage and is
   * rejected before it gets near the codec. Size cap stops a megabyte
   * hash from even being sliced. */
  var CODE_RE = /^[A-Za-z0-9_-]+$/;
  var CODE_MAX = 4096;

  /* ------------------------------------------------------------- format */

  /* ticks -> 'm:ss'. Elapsed and par both round down, so a displayed tie
   * really is a tie. */
  function fmtTime(ticks) {
    if (ticks == null || ticks < 0) return '-:--';
    var s = Math.floor(ticks / TICK_HZ);
    var m = Math.floor(s / 60);
    s -= m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ticks -> '1.2s', for "Swift missed by 1.2s" on the results screen. */
  function fmtDelta(ticks) {
    if (ticks == null) return '';
    var tenths = Math.round(Math.abs(ticks) * 10 / TICK_HZ);
    return (tenths / 10).toFixed(1) + 's';
  }

  function deathsPhrase(deaths) {
    deaths = deaths | 0;
    if (deaths === 0) return 'clean';
    if (deaths === 1) return '1 death';
    return deaths + ' deaths';
  }

  function par(parTicks) {
    /* The denominator. Only omitted when we genuinely do not have one
     * (a fallback room before the solver has run). */
    return parTicks == null ? '' : ' (par ' + fmtTime(parTicks) + ')';
  }

  /* { seed, cleared, deaths, ticks, parTicks } ->
   * 'BAIT gauntlet 214 · cleared 4/5 · 3 deaths · 2:41 (par 3:10)' */
  function gauntletString(r) {
    var n = (BAIT.Daily && BAIT.Daily.dayNumber)
      ? BAIT.Daily.dayNumber(r.seed) : r.seed;
    return 'BAIT gauntlet ' + n +
      ' · cleared ' + (r.cleared | 0) + '/5' +
      ' · ' + deathsPhrase(r.deaths) +
      ' · ' + fmtTime(r.ticks) + par(r.parTicks);
  }

  /* { code, deaths, ticks, parTicks } ->
   * 'BAIT room k3f9x2m0qr7v · cleared in 2 deaths · 0:38 (par 0:31)' */
  function roomString(r) {
    var d = (r.deaths | 0) === 0
      ? 'cleared clean'
      : 'cleared in ' + deathsPhrase(r.deaths);
    return 'BAIT room ' + r.code +
      ' · ' + d +
      ' · ' + fmtTime(r.ticks) + par(r.parTicks);
  }

  /* --------------------------------------------------------------- copy */

  /* One-tap copy. Resolves true only when the text is actually on the
   * clipboard — the caller shows visible confirmation on true and a
   * "copy failed, select it yourself" fallback on false. Never throws.
   *
   * file:// is not a secure context, so navigator.clipboard is usually
   * absent there and the execCommand path is the one that matters. */
  function copy(text) {
    return new Promise(function (resolve) {
      if (typeof navigator !== 'undefined' && navigator.clipboard &&
          navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { resolve(true); },
          function () { resolve(copyFallback(text)); }
        );
        return;
      }
      resolve(copyFallback(text));
    });
  }

  function copyFallback(text) {
    if (typeof document === 'undefined') return false;
    var ok = false;
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    try {
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      ok = document.execCommand('copy');
    } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  /* ---------------------------------------------------------------- url */

  /* '#r=CODE' -> 'CODE', or null. Shape-check only; the codec decides
   * whether it is a room. */
  function parseHash(hash) {
    if (typeof hash !== 'string') return null;
    if (hash.charAt(0) === '#') hash = hash.slice(1);
    if (hash.slice(0, 2) !== 'r=') return null;
    var code = hash.slice(2);
    if (!code || code.length > CODE_MAX || !CODE_RE.test(code)) return null;
    return code;
  }

  function readHash() {
    if (typeof location === 'undefined') return null;
    return parseHash(location.hash);
  }

  /* Set / clear the hash without adding history entries — sharing a room
   * must not stack twenty back-button steps. */
  function writeHash(code) {
    if (typeof history === 'undefined' || typeof location === 'undefined') return;
    if (CODE_RE.test(code) && code.length <= CODE_MAX) {
      history.replaceState(null, '', '#r=' + code);
    }
  }

  function clearHash() {
    if (typeof history === 'undefined' || typeof location === 'undefined') return;
    history.replaceState(null, '',
      location.pathname + location.search);
  }

  /* Full shareable link for a code. */
  function link(code) {
    if (typeof location === 'undefined') return '#r=' + code;
    return location.href.split('#')[0] + '#r=' + code;
  }

  /* Someone pastes a #r= link over a running game: subscribe here and
   * route it. fn(code|null). Returns unsubscribe. */
  function onHash(fn) {
    if (typeof window === 'undefined' || !window.addEventListener) {
      return function () {};
    }
    var handler = function () { fn(readHash()); };
    window.addEventListener('hashchange', handler);
    return function () { window.removeEventListener('hashchange', handler); };
  }

  BAIT.Share = {
    fmtTime: fmtTime,
    fmtDelta: fmtDelta,
    gauntletString: gauntletString,
    roomString: roomString,
    copy: copy,
    readHash: readHash,
    parseHash: parseHash,   // exposed for tests
    writeHash: writeHash,
    clearHash: clearHash,
    link: link,
    onHash: onHash
  };

})(typeof window !== 'undefined'
  ? (window.BAIT = window.BAIT || {})
  : (global.BAIT = global.BAIT || {}));
