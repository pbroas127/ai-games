/* ============================================================
   data.js — format templates, model list, phrase banks.

   Beat timings are derived from structural metadata scraped
   from top-performing videos in this genre (chapter markers,
   silence-gap cadence, words-per-minute). Every line of copy
   below is original writing in the genre register.
   ============================================================ */

const PACE_WPM = 170;          // measured delivery speed for this genre
const GAP_PER_MIN = 4;         // b-roll / music beats per minute

/* ---------- Models ---------- */
const MODELS = [
  'Opus 5', 'Fable 5', 'Sonnet 5', 'Opus 4.8', 'Mythos',
  'GPT-5.6 Sol', 'GPT-5.2', 'Codex',
  'Gemini 3.5 Flash', 'Gemini 3 Pro', 'Antigravity 2.0',
  'Grok 4.5', 'Grok Code Fast',
  'Kimi K3', 'GLM-5.2', 'Qwen 3.8 Max', 'DeepSeek V4',
  'Gemma 4', 'Perplexity', 'Lovart AI', 'OpenClaw'
];

/* ---------- Build targets ---------- */
const GAME_TARGETS = [
  'Fortnite', 'GTA', 'Minecraft', 'FNAF', 'Clash Royale', 'CS2',
  'Rocket League', 'Subway Surfers', 'Terraria', 'Mario Kart',
  'Among Us', 'Geometry Dash', 'Pokémon', 'Brawl Stars',
  'Call of Duty', 'RDR2', 'Roblox', 'Stardew Valley',
  'Vampire Survivors', 'Balatro', 'Slay the Spire', 'Hollow Knight',
  'Flappy Bird', 'Doom', 'Tetris', 'Pac-Man'
];

const GAME_TWISTS = [
  'but every enemy is procedurally generated',
  'in one prompt, no follow-ups',
  'with zero art assets — everything drawn in code',
  'that has to run in a single HTML file',
  'with working multiplayer',
  'in under 500 lines',
  'but it has to be playable on mobile',
  'with a full progression system',
  'and it has to have sound',
  'with local co-op on one keyboard'
];

/* ---------- Formats ----------
   pct values are fractions of total runtime, taken from the
   real chapter distributions measured in the reference set. */

const FORMATS = {
  versus2: {
    label: '2 Models Head-to-Head',
    blurb: 'Two models, same brief, same rules. The flagship format — highest ceiling.',
    defaultMin: 9,
    slots: 2,
    titleFns: [
      (m, g) => `${m[0]} vs ${m[1]} Make ${g} From Scratch`,
      (m, g) => `${m[0]} vs ${m[1]} Make ${g} (One Prompt)`,
      (m, g) => `I Made ${m[0]} and ${m[1]} Build ${g} From Scratch`
    ],
    structure: [
      { role: 'intro',   pct: 0.00 },
      { role: 'round',   pct: 0.03, slot: 0 },
      { role: 'round',   pct: 0.49, slot: 1 },
      { role: 'results', pct: 0.91 }
    ]
  },

  versus3: {
    label: '3 Models Head-to-Head',
    blurb: 'Three-way. Best like-to-view ratio in the reference set.',
    defaultMin: 9,
    slots: 3,
    titleFns: [
      (m, g) => `${m[0]} vs ${m[1]} vs ${m[2]} Make ${g} From Scratch`,
      (m, g) => `3 AIs Make ${g} From Scratch (Only One Works)`,
      (m, g) => `${m[0]} vs ${m[1]} vs ${m[2]}: ${g} From Scratch`
    ],
    structure: [
      { role: 'intro',   pct: 0.00 },
      { role: 'round',   pct: 0.04, slot: 0 },
      { role: 'round',   pct: 0.20, slot: 1 },
      { role: 'round',   pct: 0.63, slot: 2 },
      { role: 'results', pct: 0.93 }
    ]
  },

  collab: {
    label: 'N AIs Work Together',
    blurb: 'Relay format — each model builds on the last one\'s output. Longer runtime.',
    defaultMin: 13,
    slots: 6,
    titleFns: [
      (m, g) => `${m.length} AIs WORK TOGETHER to Make ${g} From Scratch`,
      (m, g) => `${m.length} AIs Build ${g} in a Relay (It Got Weird)`,
      (m, g) => `I Made ${m.length} AIs Take Turns Building ${g}`
    ],
    structure: [
      { role: 'intro',   pct: 0.00 },
      { role: 'round',   pct: 0.06, slot: 0 },
      { role: 'round',   pct: 0.27, slot: 1 },
      { role: 'round',   pct: 0.34, slot: 2 },
      { role: 'round',   pct: 0.48, slot: 3 },
      { role: 'round',   pct: 0.58, slot: 4 },
      { role: 'round',   pct: 0.72, slot: 5 },
      { role: 'results', pct: 0.87 }
    ]
  },

  showcase: {
    label: 'One Model Is Insane',
    blurb: 'Single model, three escalating tasks. Strongest engagement ratio measured.',
    defaultMin: 9,
    slots: 1,
    titleFns: [
      (m) => `${m[0]} is INSANE.`,
      (m) => `${m[0]} is Ridiculous.`,
      (m, g) => `${m[0]} Made ${g} in One Prompt.`,
      (m) => `${m[0]} is lowkey NUTS.`,
      (m) => `${m[0]} is NOT Real.`
    ],
    structure: [
      { role: 'intro',   pct: 0.00 },
      { role: 'task',    pct: 0.05, taskIdx: 0 },
      { role: 'task',    pct: 0.52, taskIdx: 1 },
      { role: 'task',    pct: 0.80, taskIdx: 2 }
    ]
  },

  buildalong: {
    label: 'Building X With Only AI',
    blurb: 'Start-to-ship walkthrough. Second-highest performer in the reference set.',
    defaultMin: 9,
    slots: 1,
    titleFns: [
      (m, g) => `Building ${g} with Only AI`,
      (m, g) => `I Built ${g} Using ONLY AI (No Code)`,
      (m, g) => `Building a Viral ${g} w/ AI (pretty easy)`
    ],
    structure: [
      { role: 'intro',   pct: 0.00 },
      { role: 'step',    pct: 0.03, stepIdx: 0 },
      { role: 'step',    pct: 0.19, stepIdx: 1 },
      { role: 'step',    pct: 0.81, stepIdx: 2 },
      { role: 'results', pct: 0.94 }
    ]
  }
};

/* ---------- Phrase banks ----------
   Written to sound spoken, not written. Fragments, contractions,
   mid-thought corrections, concrete numbers, deflation after hype. */

const BANK = {
  coldOpen: [
    'Okay so this one got away from me a little.',
    'I need you to look at this before I explain anything.',
    'This is the part where it goes wrong, and I want that on record early.',
    'So I had a stupid idea at like 1am and now here we are.',
    'Right. No intro. Look at this.',
    'I genuinely did not think this would work.'
  ],
  premise: [
    'Same prompt, same file, no edits from me. Whatever comes out is what we play.',
    'One prompt each. No follow-ups, no fixing it, no "actually can you". One shot.',
    'Rules are simple. Identical brief. I don\'t touch the code. If it crashes, it crashes.',
    'Every model gets the exact same paragraph. That\'s it. That\'s the whole test.',
    'I\'m not helping any of them. If it doesn\'t run, that\'s a zero.'
  ],
  stakes: [
    'And I\'ll be honest, I have a guess about who wins. I was wrong.',
    'Winner gets nothing. Loser gets clipped and put in the thumbnail.',
    'I\'m scoring on three things: does it run, does it look right, is it actually fun.',
    'If none of them work I\'m keeping the footage anyway.'
  ],
  roundStart: [
    'Up first, {model}. Sending it.',
    '{model} goes first. Prompt\'s in.',
    'Alright, {model}. Same brief. Go.',
    'Starting with {model}, mostly because I want to get it over with.',
    '{model}\'s turn. Fingers crossed.'
  ],
  watching: [
    'It\'s thinking. It\'s been thinking for a while actually.',
    'Okay it\'s writing a lot. That\'s either very good or very bad.',
    'While that runs — look at how confident it is. It has no idea.',
    'This is the boring part so I\'ll speed it up.',
    'Still going. It\'s written more than I would have.'
  ],
  revealGood: [
    'Oh. Oh that\'s actually good.',
    'Wait. Wait that works.',
    'Okay I wasn\'t ready for that.',
    'That\'s— hang on, that\'s genuinely fine.',
    'No that\'s clean. I\'m annoyed but that\'s clean.'
  ],
  revealBad: [
    'Yeah. Yeah that\'s a black screen.',
    'So it made a menu. Just a menu. Nothing behind it.',
    'It runs. Technically. In the way that a chair technically runs.',
    'Everything is one pixel. Everything.',
    'It works right up until you press anything.'
  ],
  revealMid: [
    'It\'s fine. It\'s just fine. Which is somehow worse.',
    'Half of it is great and half of it does not exist.',
    'The physics are good and the collision is a suggestion.',
    'Looks right, plays wrong.'
  ],
  watchingB: [
    'I do like that it just commits. No clarifying questions, no "did you mean". Just goes.',
    'Worth saying — I\'m not counting time here. If I was, this one already lost.',
    'It\'s rewriting a bit it already wrote. Never a great sign.',
    'The file is getting long. Long is not the same as good but we\'ll see.',
    'It has decided the whole thing lives in one file. Bold. Respect.'
  ],
  revealB: [
    'Watch the corner. Watch what happens when I turn.',
    'Give it a second. It does a thing.',
    'That bit\'s not a bug, I checked. It meant that.',
    'I\'ve played worse things that people charged money for.',
    'The physics are doing something I genuinely can\'t explain.'
  ],
  transition: [
    'Alright. Next.',
    'Okay, clearing that. {model} you\'re up.',
    'Moving on before I get attached.',
    'Right, {model}. Beat that.'
  ],
  verdictOpen: [
    'Okay. Scores.',
    'So where does that leave us.',
    'Let\'s actually rank these.',
    'Right, who won.'
  ],
  verdictClose: [
    'Which I did not expect and I\'m still a bit annoyed about.',
    'And honestly the gap is bigger than I thought it\'d be.',
    'Genuinely closer than the last time I did this.',
    'Not close. Not close at all.'
  ],
  outro: [
    'That\'s it. Tell me what to make them build next.',
    'Drop a game in the comments and I\'ll run it through all of them.',
    'If you want the prompt it\'s in the description. Go break it yourself.',
    'Next one\'s already recorded and it\'s worse. See you then.'
  ],
  // Phrases that make copy read as machine-written. Surfaced as a linter.
  banned: [
    'delve', 'dive in', 'let\'s dive', 'in this video', 'game-changer',
    'game changer', 'revolutionize', 'seamless', 'unleash', 'harness',
    'in today\'s video', 'without further ado', 'buckle up', 'leverage',
    'testament to', 'it\'s important to note', 'landscape of', 'realm of',
    'elevate', 'unlock the power', 'cutting-edge', 'robust'
  ]
};

/* ---------- Production cue vocabulary ---------- */
const ONSCREEN = {
  intro: ['Cold open — best clip of the whole video, no context', 'Title card, 0.5s, hard cut out'],
  rules: ['RULES lower-third: same prompt / no edits / one shot'],
  roundHead: ['Full-bleed card: {model}', 'Corner tag stays up all round: {model}'],
  prompt: ['Prompt on screen, highlight the one line that matters'],
  timelapse: ['Code-gen timelapse, 8–16x, terminal only'],
  reveal: ['Full-screen capture, no overlays, let it breathe'],
  bug: ['Zoom punch-in + freeze on the failure frame'],
  score: ['Scorecard overlay builds line by line'],
  results: ['Side-by-side split, all builds running at once'],
  outro: ['End card: next video + subscribe, 4s max']
};

const MUSIC = {
  in: 'MUSIC IN — upbeat, low',
  under: 'MUSIC UNDER — bed continues',
  duck: 'MUSIC DUCK — drop to 15% for VO',
  out: 'MUSIC OUT — hard cut, silence sells it',
  stab: 'MUSIC STAB — transition hit',
  swell: 'MUSIC SWELL — build into reveal',
  outro: 'MUSIC UP — outro track, full'
};
