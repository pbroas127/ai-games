/* ============================================================
   app.js — beat expansion + script/production-log generation
   ============================================================ */

/* ---------- seeded RNG so a seed reproduces a script ---------- */
let _seed = 1;
function srand(s) { _seed = s >>> 0 || 1; }
function rnd() {
  _seed ^= _seed << 13; _seed >>>= 0;
  _seed ^= _seed >> 17;
  _seed ^= _seed << 5;  _seed >>>= 0;
  return _seed / 4294967296;
}
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
function pickN(arr, n) {
  const c = arr.slice(), out = [];
  while (out.length < n && c.length) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]);
  return out;
}

/* ---------- helpers ---------- */
function mmss(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}
function words(str) { return str.trim().split(/\s+/).filter(Boolean).length; }

/* ---------- build-target idea generator ---------- */
function generateTarget() {
  const g = pick(GAME_TARGETS);
  return rnd() < 0.35 ? `${g} ${pick(GAME_TWISTS)}` : g;
}

/* ---------- sub-beat shapes within a round ---------- */
const ROUND_SHAPE = [
  { key: 'head',      span: 0.08 },
  { key: 'prompt',    span: 0.10 },
  { key: 'timelapse', span: 0.27 },
  { key: 'reveal',    span: 0.35 },
  { key: 'react',     span: 0.20 }
];

/* ---------- main generator ---------- */
function generate(cfg) {
  srand(cfg.seed);

  const fmt = FORMATS[cfg.format];
  const total = cfg.minutes * 60;
  const models = cfg.models;
  const target = cfg.target;

  // outcome per model — weighted so at least one is good and one is rough
  const outcomes = models.map((_, i) => {
    if (i === 0) return rnd() < 0.5 ? 'mid' : 'bad';
    if (i === models.length - 1) return rnd() < 0.7 ? 'good' : 'mid';
    return pick(['good', 'mid', 'bad']);
  });

  // absolute start times for each structural block
  const blocks = fmt.structure.map((b, i) => {
    const start = b.pct * total;
    const next = fmt.structure[i + 1];
    const end = next ? next.pct * total : total;
    return { ...b, start, end };
  });

  const rows = [];
  const push = (t, section, script, prod, music, chapter) =>
    rows.push({ t, section, script, prod, music, chapter: chapter || null });

  for (const blk of blocks) {
    const dur = blk.end - blk.start;

    /* ---- INTRO ---- */
    if (blk.role === 'intro') {
      push(blk.start, 'COLD OPEN', pick(BANK.coldOpen),
        pick(ONSCREEN.intro) + ' · best 3s of footage from the whole shoot', MUSIC.out, 'Intro');
      push(blk.start + dur * 0.35, 'PREMISE',
        `${fill(pick(BANK.premise), {})} We\'re building ${target}.`,
        pick(ONSCREEN.rules), MUSIC.in);
      push(blk.start + dur * 0.72, 'STAKES', pick(BANK.stakes),
        'Quick cut montage: one frame from each build, 4 frames/sec', MUSIC.under);
      continue;
    }

    /* ---- RESULTS ---- */
    if (blk.role === 'results') {
      push(blk.start, 'VERDICT', pick(BANK.verdictOpen),
        pick(ONSCREEN.results), MUSIC.out, 'Results');
      models.forEach((m, i) => {
        const o = outcomes[i];
        const line = o === 'good'
          ? `${m} — this is the one that actually shipped. It runs, it plays, I\'d put it on a phone.`
          : o === 'mid'
            ? `${m} — got there, sort of. Looks the part until you press something.`
            : `${m} — no. Next question.`;
        push(blk.start + dur * (0.15 + i * (0.55 / models.length)), 'SCORE',
          line, fill(pick(ONSCREEN.score), { model: m }), MUSIC.out);
      });
      push(blk.start + dur * 0.78, 'CLOSE', pick(BANK.verdictClose),
        'Hold on winning build, still playing', MUSIC.swell);
      push(blk.start + dur * 0.90, 'OUTRO', pick(BANK.outro),
        pick(ONSCREEN.outro), MUSIC.outro);
      continue;
    }

    /* ---- ROUND / TASK / STEP ---- */
    let model, label;
    if (blk.role === 'round') {
      model = models[blk.slot] || models[0];
      label = model.toUpperCase();
    } else if (blk.role === 'task') {
      model = models[0];
      label = `TASK ${blk.taskIdx + 1}`;
    } else {
      model = models[0];
      label = `STEP ${blk.stepIdx + 1}`;
    }
    const outcome = outcomes[blk.slot || 0] || 'mid';

    let cursor = blk.start;
    for (const sb of ROUND_SHAPE) {
      const t = cursor;
      cursor += dur * sb.span;

      if (sb.key === 'head') {
        const chapTitle = blk.role === 'round'
          ? `${model} makes ${target}`
          : blk.role === 'task' ? `${label}: ${model}` : label;
        push(t, label, fill(pick(BANK.roundStart), { model }),
          fill(pick(ONSCREEN.roundHead), { model }), MUSIC.stab, chapTitle);
      } else if (sb.key === 'prompt') {
        push(t, label,
          `The brief is one paragraph. ${target}, playable, single file. That\'s all it gets.`,
          pick(ONSCREEN.prompt), MUSIC.under);
      } else if (sb.key === 'timelapse') {
        const seg = dur * sb.span;
        push(t, label, pick(BANK.watching), pick(ONSCREEN.timelapse), MUSIC.under);
        push(t + seg * 0.55, label, pick(BANK.watchingB),
          'Timelapse continues — cut to a wide of the editor', MUSIC.under);
      } else if (sb.key === 'reveal') {
        const seg = dur * sb.span;
        const bank = outcome === 'good' ? BANK.revealGood
          : outcome === 'bad' ? BANK.revealBad : BANK.revealMid;
        push(t, label, pick(bank), pick(ONSCREEN.reveal), MUSIC.out);
        push(t + seg * 0.45, label, pick(BANK.revealB),
          'Punch in on the detail you just called out', MUSIC.out);
      } else {
        const react = outcome === 'bad'
          ? `I gave it the same shot as everyone else. That\'s what came back.`
          : outcome === 'good'
            ? `I didn\'t touch a line of that. That\'s straight out of the box.`
            : `It\'s close. It\'s just not finished, and it doesn\'t know that.`;
        push(t, label, react,
          outcome === 'bad' ? pick(ONSCREEN.bug) : 'Let the gameplay run 4–6s with no VO',
          MUSIC.duck);
        if (blk.role === 'round' && models[(blk.slot || 0) + 1]) {
          push(cursor - 2, label,
            fill(pick(BANK.transition), { model: models[blk.slot + 1] }),
            'Hard cut. No transition wipe.', MUSIC.stab);
        }
      }
    }
  }

  rows.sort((a, b) => a.t - b.t);

  /* ---- titles / tags / description ---- */
  const titles = fmt.titleFns.map(fn => fn(models, target));

  const base = target.split(' ')[0].toLowerCase();
  const tagSet = new Set(['ai', 'making games with ai', `ai makes ${base}`, `${base} from scratch`]);
  for (let i = 0; i < models.length; i++) {
    tagSet.add(models[i].toLowerCase());
    for (let j = 0; j < models.length; j++) {
      if (i === j) continue;
      tagSet.add(`${models[i].toLowerCase()} vs ${models[j].toLowerCase()}`);
      tagSet.add(`${models[i].toLowerCase()} vs ${models[j].toLowerCase()} ${base}`);
    }
  }
  tagSet.add(titles[0].toLowerCase());
  const tags = Array.from(tagSet).slice(0, 15);

  const desc =
`${models.join(' and ')} got the same one-paragraph brief: build ${target}. No follow-ups, no edits from me.

Timestamps:
${rows.filter(r => r.chapter).map(r => `${mmss(r.t)} ${r.chapter}`).join('\n')}

Prompt used is pinned in the comments.`;

  /* ---- pacing math ---- */
  const scriptWords = rows.reduce((a, r) => a + words(r.script), 0);
  const spokenSec = Math.round(scriptWords / (PACE_WPM / 60));
  const targetGaps = Math.round(cfg.minutes * GAP_PER_MIN);

  return { rows, titles, tags, desc, scriptWords, spokenSec, targetGaps, total, outcomes };
}

/* ---------- banned-phrase linter ---------- */
function lint(rows) {
  const hits = [];
  const all = rows.map(r => r.script).join(' ').toLowerCase();
  for (const b of BANK.banned) if (all.includes(b)) hits.push(b);
  return hits;
}
