/* ============================================================
   app.js — expands a format into timestamped BEAT DIRECTIVES.

   Each beat says: where you are, what the beat has to achieve,
   and the specific points you must hit for THIS build target.
   It does not write your dialogue for you.
   ============================================================ */

let _seed = 1;
function srand(s) { _seed = (s >>> 0) || 1; }
function rnd() {
  _seed ^= _seed << 13; _seed >>>= 0;
  _seed ^= _seed >> 17;
  _seed ^= _seed << 5; _seed >>>= 0;
  return _seed / 4294967296;
}
function pick(a) { return a[Math.floor(rnd() * a.length)]; }

function mmss(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function generateTarget() {
  const g = pick(GAME_TARGETS);
  return rnd() < 0.3 ? `${g} ${pick(GAME_TWISTS)}` : g;
}

function generate(cfg) {
  srand(cfg.seed);

  const fmt = FORMATS[cfg.format];
  const total = cfg.minutes * 60;
  const models = cfg.models;
  const target = cfg.target;
  const spec = specFor(target);
  const rounds = fmt.structure.filter(b => b.role === 'round' || b.role === 'step');
  const nRounds = rounds.length;

  // Outcomes drive the narrative shape: never all-good, never all-bad.
  const outcomes = models.map((_, i) =>
    i === models.length - 1 ? (rnd() < 0.75 ? 'good' : 'mid')
      : i === 0 ? (rnd() < 0.55 ? 'mid' : 'bad')
        : pick(['good', 'mid', 'bad']));

  const blocks = fmt.structure.map((b, i) => {
    const start = b.pct * total;
    const next = fmt.structure[i + 1];
    return { ...b, start, end: next ? next.pct * total : total };
  });

  const rows = [];
  const add = o => rows.push(o);
  const pctOf = t => Math.round((t / total) * 100);

  let roundNo = 0;

  for (const blk of blocks) {
    const dur = blk.end - blk.start;

    /* ================= INTRO ================= */
    if (blk.role === 'intro') {
      add({
        t: blk.start, section: 'COLD OPEN',
        where: `Very top — ${mmss(dur)} of intro total`,
        job: 'Show the single best moment in the whole video before you explain anything.',
        must: [
          `Open on footage, not on you talking. Best 2–3 seconds you captured — ideally ${spec.wow}.`,
          'Do not say hello, do not say what the channel is, do not say what the video is.',
          'First words out of your mouth should be a reaction to what is already on screen.'
        ],
        avoid: 'Any sentence that starts with "Today we\'re going to".',
        prod: 'Cold open clip. No title card yet. Hard cut on the frame that lands.',
        music: MUSIC.out, chapter: 'Intro'
      });
      add({
        t: blk.start + dur * 0.35, section: 'PREMISE',
        where: `~${mmss(dur * 0.35)} in`,
        job: 'Set the rules in one breath so the rest of the video is a fair test.',
        must: [
          `Name the target out loud: ${target}.`,
          `Name every model by name, in order: ${models.join(', ')}.`,
          'State the constraint — same prompt, no follow-ups, no edits from you.',
          'Say what a win looks like before you see any of it.'
        ],
        avoid: 'Explaining what the models are. Assume they know.',
        prod: 'RULES lower-third: same prompt / no edits / one shot',
        music: MUSIC.in
      });
      add({
        t: blk.start + dur * 0.72, section: 'STAKES',
        where: `End of intro, ~${mmss(dur * 0.72)}`,
        job: 'Give them a reason to stay for the whole thing.',
        must: [
          `Say which one you think wins, on record, before you know. Pick ${models[models.length - 1]} or the underdog — either way commit.`,
          `Name the one mechanic you will judge on: ${spec.crux[0]}.`,
          'Promise nothing you cannot pay off in the last minute.'
        ],
        avoid: 'Teasing a result you do not actually have.',
        prod: 'Fast montage — one frame from each build, ~4/sec',
        music: MUSIC.under
      });
      continue;
    }

    /* ================= RESULTS ================= */
    if (blk.role === 'results') {
      add({
        t: blk.start, section: 'VERDICT',
        where: `Final ${Math.round((1 - blk.start / total) * 100)}% — this is the payoff`,
        job: 'Answer the question the title asked. Directly.',
        must: [
          'Kill the music here. Dry audio reads as honest.',
          `Rank all ${models.length} out loud, worst first.`,
          `Judge each on the same thing: ${spec.crux.join(', ')}.`
        ],
        avoid: 'Hedging. "They all did well in their own way" loses the audience.',
        prod: 'Split screen — every build running at once',
        music: MUSIC.out, chapter: 'Results'
      });
      models.forEach((m, i) => {
        const o = outcomes[i];
        add({
          t: blk.start + dur * (0.15 + i * (0.5 / models.length)),
          section: `SCORE · ${m.toUpperCase()}`,
          where: `Verdict ${i + 1} of ${models.length}`,
          job: o === 'good' ? `Explain why ${m} won without overselling it.`
            : o === 'bad' ? `Explain what ${m} got wrong in one sentence and move on.`
              : `Explain why ${m} was close but not finished.`,
          must: o === 'good'
            ? [`Point at the specific thing it got right — ${spec.crux[0]}.`,
               'Say plainly that you did not touch the code.',
               'Give it a number. Numbers get argued about in the comments.']
            : o === 'bad'
              ? [`Name the failure precisely: ${spec.firstFail}.`,
                 'One sentence, then cut. Do not pile on — it stops being funny.',
                 'Give it a number anyway.']
              : [`Say what worked and what did not, in that order.`,
                 `Be specific: it handled ${spec.crux[0]} but not ${spec.crux[spec.crux.length - 1]}.`,
                 'Give it a number.'],
          avoid: 'Reading out code. Nobody is here for the code.',
          prod: 'Scorecard overlay builds line by line',
          music: MUSIC.out
        });
      });
      add({
        t: blk.start + dur * 0.80, section: 'CLOSE',
        where: 'Last ~20% of the outro block',
        job: 'Land the actual conclusion.',
        must: [
          'Say whether the result surprised you. Be honest — if it did not, say that.',
          `Compare to what you predicted in the intro. Pay off the promise.`,
          'One sentence on what this means going forward. One.'
        ],
        avoid: 'A summary of everything that just happened. They watched it.',
        prod: 'Hold on the winning build, still running',
        music: MUSIC.swell
      });
      add({
        t: blk.start + dur * 0.92, section: 'OUTRO',
        where: 'Final seconds',
        job: 'Ask for the next video and get out.',
        must: [
          'Ask which target to run next — make it a question they can answer in four words.',
          'Tell them the prompt is in the description, if it is.',
          'Four seconds maximum. End cards do the rest.'
        ],
        avoid: 'A long subscribe pitch. It is where retention dies.',
        prod: 'End card: next video + subscribe, 4s hard out',
        music: MUSIC.outro
      });
      continue;
    }

    /* ================= ROUND / STEP ================= */
    roundNo++;
    const isStep = blk.role === 'step';
    const model = isStep ? models[0] : (models[blk.slot] || models[0]);
    const outcome = isStep ? 'mid' : (outcomes[blk.slot] || 'mid');
    const step = isStep ? BUILD_STEPS[blk.stepIdx] : null;
    const escal = blk.escalate !== undefined ? ESCALATION[blk.escalate] : null;
    const isRelay = cfg.format === 'collab';

    const label = isStep ? `STEP ${blk.stepIdx + 1}`
      : escal !== null && escal !== undefined ? `TASK ${blk.escalate + 1}`
        : `${fmt.roundNoun} ${roundNo}`;
    const head = isStep ? step.name : model;
    const posn = isStep ? `Step ${blk.stepIdx + 1} of 3`
      : `${fmt.roundNoun.toLowerCase()} ${roundNo} of ${nRounds}`;

    const chapTitle = isStep ? `${step.name}`
      : escal !== null && escal !== undefined ? `${model}: ${escal}`
        : `${model} makes ${target}`;

    // --- setup ---
    add({
      t: blk.start, section: `${label} · SETUP`,
      where: `${posn} — ${pctOf(blk.start)}% in, block runs ${mmss(dur)}`,
      job: isStep ? step.job
        : isRelay ? `Hand the current codebase to ${model} and say what it inherited.`
          : `Introduce ${model} and get the prompt in with no ceremony.`,
      must: isStep
        ? [`Say what step ${blk.stepIdx + 1} is before you start it.`,
           'Show the actual screen. Do not describe it.']
        : isRelay
          ? [`Say out loud what ${model} is inheriting — working or broken.`,
             `Name what you are asking it to add this pass.`,
             'Keep this under 15 seconds. The relay only works if it moves.']
          : [`Name ${model} on screen and out loud.`,
             escal ? `Say this is ${escal} — and why it is harder than the last one.` : `Say this is ${posn}.`,
             'Get to the prompt inside 15 seconds.'],
      avoid: 'Recapping the rules again. You did that in the intro.',
      prod: `Full-bleed card: ${head} · corner tag stays up all block`,
      music: MUSIC.stab, chapter: chapTitle
    });

    // --- the brief ---
    add({
      t: blk.start + dur * 0.10, section: `${label} · THE BRIEF`,
      where: `${posn}, ~10% into the block`,
      job: 'Show the prompt so the test is visibly fair.',
      must: [
        `Put the prompt on screen. Highlight the line that names ${target}.`,
        isRelay ? 'Show the diff from the previous model, not the whole file.'
          : 'Say "same prompt" and mean it — the audience will check.',
        `Do not explain ${spec.genre} conventions. Show them instead.`
      ],
      avoid: 'Reading the whole prompt aloud. Highlight one line.',
      prod: 'Prompt on screen, one line highlighted',
      music: MUSIC.under
    });

    // --- while it builds ---
    add({
      t: blk.start + dur * 0.22, section: `${label} · WHILE IT BUILDS`,
      where: `${posn}, generation phase`,
      job: 'Fill dead air with something worth hearing. This is where people leave.',
      must: [
        'Timelapse the generation. Never show it in real time.',
        `Say one thing you are watching for: whether it bothers with ${pick(spec.crux)}.`,
        `Call the shot — predict whether it ships ${spec.wow} or falls back to ${spec.cheap}.`
      ],
      avoid: 'Silence over a timelapse, and narrating the code line by line.',
      prod: 'Code-gen timelapse 8–16x, terminal only',
      music: MUSIC.under
    });

    // --- first look ---
    add({
      t: blk.start + dur * 0.45, section: `${label} · FIRST LOOK`,
      where: `${posn}, ~${pctOf(blk.start + dur * 0.45)}% into the video`,
      job: 'The reveal. Biggest single moment in the block.',
      must: [
        'Cut the music dead. Silence is what makes a reveal land.',
        'Full screen, no overlays, no talking for the first 2 seconds.',
        `First sentence answers one thing only: does it run.`,
        outcome === 'bad' ? `Do not soften it. If it is broken, say it is broken.`
          : outcome === 'good' ? `React before you analyse. The analysis can wait 5 seconds.`
            : `Say what it looks like before you say what it does.`
      ],
      avoid: 'Talking over the first look. Let them see it.',
      prod: 'Full-screen capture, no overlays, 2s of nothing',
      music: MUSIC.out
    });

    // --- the real test (target-specific) ---
    add({
      t: blk.start + dur * 0.63, section: `${label} · THE REAL TEST`,
      where: `${posn}, the part that decides it`,
      job: `Test the thing a ${target} clone actually lives or dies on.`,
      must: [
        `${spec.verb.charAt(0).toUpperCase() + spec.verb.slice(1)} on camera. Do not describe it — do it.`,
        `Judge ${spec.crux[0]} first. That is what viewers came to see.`,
        `Then check ${spec.crux.slice(1).join(', ')}.`,
        `Explicitly say whether it fell back to ${spec.cheap}.`
      ],
      avoid: `Only showing the menu. The menu is never the point.`,
      prod: outcome === 'bad'
        ? 'Punch in + freeze on the failure frame'
        : 'Hold the gameplay 4–6s with no VO, then punch in on the detail',
      music: MUSIC.out
    });

    // --- call it ---
    add({
      t: blk.start + dur * 0.85, section: `${label} · CALL IT`,
      where: `End of ${posn}`,
      job: 'Give a verdict now so the finale is a ranking, not a reveal.',
      must: [
        outcome === 'good' ? `Say plainly that ${model} handled ${spec.crux[0]}.`
          : outcome === 'bad' ? `Name the failure once: ${spec.firstFail}.`
            : `Say it got ${spec.crux[0]} and missed ${spec.crux[spec.crux.length - 1]}.`,
        'Score it out of 10 on camera. Commit to the number.',
        'One sentence. Then cut.'
      ],
      avoid: 'Saving your opinion for the end. Give it now.',
      prod: 'Score stamp on screen',
      music: MUSIC.duck
    });

    // --- handoff ---
    const nextModel = !isStep && models[(blk.slot || 0) + 1];
    if (nextModel || (isStep && BUILD_STEPS[blk.stepIdx + 1])) {
      add({
        t: blk.end - 3, section: `${label} · HANDOFF`,
        where: 'Transition out',
        job: 'Move to the next block without losing momentum.',
        must: [
          nextModel ? `Name who is next: ${nextModel}.` : `Name the next step: ${BUILD_STEPS[blk.stepIdx + 1].name}.`,
          'Hard cut. No wipe, no transition effect, no "but first".',
          'Under 4 seconds.'
        ],
        avoid: 'A recap of what just happened.',
        prod: 'Hard cut. No transition.',
        music: MUSIC.stab
      });
    }
  }

  rows.sort((a, b) => a.t - b.t);

  /* ---- titles / tags / description ---- */
  const titles = fmt.titleFns.map(fn => fn(models, target));
  const base = target.split(' ')[0].toLowerCase();
  const tagSet = new Set(['ai', 'making games with ai', `ai makes ${base}`, `${base} from scratch`]);
  models.forEach((a, i) => {
    tagSet.add(a.toLowerCase());
    models.forEach((b, j) => {
      if (i === j) return;
      tagSet.add(`${a.toLowerCase()} vs ${b.toLowerCase()}`);
      tagSet.add(`${a.toLowerCase()} vs ${b.toLowerCase()} ${base}`);
    });
  });
  tagSet.add(titles[0].toLowerCase());
  const tags = Array.from(tagSet).slice(0, 15);

  const desc =
`${models.join(' and ')} got the same one-paragraph brief: build ${target}. No follow-ups, no edits from me.

Judged on: ${spec.crux.join(' · ')}

${rows.filter(r => r.chapter).map(r => `${mmss(r.t)} ${r.chapter}`).join('\n')}

Prompt is pinned in the comments.`;

  const beats = rows.length;
  const targetGaps = Math.round(cfg.minutes * GAP_PER_MIN);

  return { rows, titles, tags, desc, total, beats, targetGaps, spec, outcomes };
}

function lint(rows) {
  const all = rows.map(r => [r.job, r.avoid, (r.must || []).join(' ')].join(' ')).join(' ').toLowerCase();
  return BANNED.filter(b => all.includes(b));
}
