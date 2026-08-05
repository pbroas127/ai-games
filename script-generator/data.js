/* ============================================================
   data.js — formats, build-target specs, beat directives.

   Beat timings derived from structural metadata (chapter
   distributions, silence-gap cadence, delivery pace) of
   top performers in this genre.

   This file does NOT contain scripted dialogue. It contains
   DIRECTIVES: where you are, what the beat has to do, and the
   specific points you have to hit for THIS build target.
   ============================================================ */

const PACE_WPM = 170;
const GAP_PER_MIN = 4;

const MODELS = [
  'Opus 5', 'Fable 5', 'Sonnet 5', 'Opus 4.8', 'Mythos',
  'GPT-5.6 Sol', 'GPT-5.2', 'Codex',
  'Gemini 3.5 Flash', 'Gemini 3 Pro', 'Antigravity 2.0',
  'Grok 4.5', 'Grok Code Fast',
  'Kimi K3', 'GLM-5.2', 'Qwen 3.8 Max', 'DeepSeek V4',
  'Gemma 4', 'Perplexity', 'Lovart AI', 'OpenClaw'
];

/* ---------- Build-target specs ----------
   crux      : the mechanics viewers actually judge this clone on
   firstFail : what visibly breaks first in a bad attempt
   wow       : the moment that makes the video worth watching
   cheap     : the lazy version a model produces when it gives up
   verb      : how you describe playing it                        */

const TARGET_SPECS = {
  'rocket league': {
    genre: 'physics sports',
    crux: ['car handling with actual weight', 'ball mass and bounce', 'boost and aerials', 'goal detection'],
    firstFail: 'the car slides like it is on ice and the ball has no mass',
    wow: 'landing a real aerial hit',
    cheap: 'a flat plane, two boxes for goals, and a sphere that never leaves the ground',
    verb: 'drive into the ball'
  },
  'fortnite': {
    genre: 'shooter + building',
    crux: ['the build mechanic', 'third-person camera', 'shooting and hit registration', 'a map worth walking around'],
    firstFail: 'building is missing entirely, which makes it a generic shooter',
    wow: 'ramp-and-wall building that actually snaps to a grid',
    cheap: 'a grey box arena with a gun that fires a raycast',
    verb: 'build a ramp and push it'
  },
  'minecraft': {
    genre: 'voxel sandbox',
    crux: ['terrain generation', 'block place and break', 'first-person controls', 'chunk performance'],
    firstFail: 'the world is one flat plane with a single block type',
    wow: 'caves and trees generating on their own',
    cheap: 'a 16x16 grid of identical cubes you can click',
    verb: 'break a block and place it somewhere else'
  },
  'fnaf': {
    genre: 'tension horror',
    crux: ['camera switching', 'power drain as a clock', 'door management', 'the jumpscare trigger'],
    firstFail: 'nothing is on a timer so there is zero tension',
    wow: 'genuinely getting got because you checked the wrong camera',
    cheap: 'static images you click through with no threat behind them',
    verb: 'flip through the cameras and survive the night'
  },
  'gta': {
    genre: 'open world',
    crux: ['driving feel', 'getting in and out of cars', 'an open map with traffic', 'a wanted system'],
    firstFail: 'the car drives like a box sliding on a table',
    wow: 'stealing a car in traffic and being chased for it',
    cheap: 'an empty grid of streets with one drivable cube',
    verb: 'steal a car and drive it badly'
  },
  'among us': {
    genre: 'social deduction',
    crux: ['tasks that take time', 'the kill and report loop', 'a vent or movement advantage', 'a meeting screen'],
    firstFail: 'there is no reason to suspect anyone because nothing is hidden',
    wow: 'a kill that actually goes unseen',
    cheap: 'coloured blobs walking around with a task counter',
    verb: 'do a task and try not to get caught'
  },
  'subway surfers': {
    genre: 'endless runner',
    crux: ['three-lane snapping', 'jump and roll timing', 'speed ramp over time', 'obstacle spawning fairness'],
    firstFail: 'the obstacle spawns are unfair or the lanes do not snap',
    wow: 'the moment the speed ramp makes you actually sweat',
    cheap: 'one lane, one obstacle, no acceleration',
    verb: 'run until you die'
  },
  'geometry dash': {
    genre: 'rhythm platformer',
    crux: ['one-button jump timing', 'sync to the music', 'instant death and instant retry', 'level design'],
    firstFail: 'the jumps do not line up with the beat, which kills the entire point',
    wow: 'a section where the jumps land on the beat',
    cheap: 'a square jumping over spikes with no music at all',
    verb: 'run the level until you clear it'
  },
  'clash royale': {
    genre: 'lane strategy',
    crux: ['elixir economy on a timer', 'unit pathing down lanes', 'tower targeting', 'card cycle'],
    firstFail: 'units ignore lanes and walk straight through each other',
    wow: 'a counter-push that actually works because the economy is real',
    cheap: 'two towers and units that spawn instantly with no cost',
    verb: 'drop units and push a lane'
  },
  'tetris': {
    genre: 'puzzle',
    crux: ['piece rotation including wall kicks', 'line clear detection', 'gravity and lock delay', 'next-piece preview'],
    firstFail: 'rotation against a wall fails, which makes it unplayable at speed',
    wow: 'a clean four-line clear',
    cheap: 'falling squares with no rotation',
    verb: 'stack pieces and clear lines'
  },
  'flappy bird': {
    genre: 'one-button arcade',
    crux: ['gravity and flap feel', 'pipe gap fairness', 'collision precision', 'restart speed'],
    firstFail: 'the gravity is wrong so it is either impossible or trivial',
    wow: 'the difficulty landing exactly where the original did',
    cheap: 'a square that moves up and down between two lines',
    verb: 'flap through the pipes'
  },
  'pokemon': {
    genre: 'turn-based RPG',
    crux: ['turn order and type matchups', 'an overworld with encounters', 'catching', 'stat progression'],
    firstFail: 'the battle system has no types, so every fight is identical',
    wow: 'a type advantage actually mattering in a fight',
    cheap: 'a menu with two buttons and a random number generator',
    verb: 'walk into grass and fight something'
  },
  'doom': {
    genre: 'retro FPS',
    crux: ['raycast rendering', 'movement speed and feel', 'enemy AI that closes distance', 'weapon feedback'],
    firstFail: 'the movement is too slow, which is the one thing this genre cannot get wrong',
    wow: 'the render actually running at a sensible framerate',
    cheap: 'a flat maze with a crosshair and no enemies',
    verb: 'run through it and shoot things'
  },
  'vampire survivors': {
    genre: 'auto-battler roguelite',
    crux: ['auto-attack timing', 'enemy swarm scaling', 'level-up choices', 'the power curve'],
    firstFail: 'the swarm never scales, so it is boring after ninety seconds',
    wow: 'the screen filling up and the build carrying you anyway',
    cheap: 'one enemy type walking at you forever',
    verb: 'walk in circles and let it kill things'
  }
};

const FALLBACK_SPEC = {
  genre: 'game',
  crux: ['does it actually run', 'do the controls feel right', 'is there a real loop', 'does it look finished'],
  firstFail: 'it opens to a menu with nothing behind it',
  wow: 'a moment where you forget a model wrote it',
  cheap: 'a title screen and a start button that does nothing',
  verb: 'play it'
};

function specFor(target) {
  const k = String(target || '').toLowerCase();
  for (const name in TARGET_SPECS) if (k.includes(name)) return TARGET_SPECS[name];
  return FALLBACK_SPEC;
}

/* ---------- Build targets offered by the dice ---------- */
const GAME_TARGETS = Object.keys(TARGET_SPECS)
  .map(s => s.replace(/\b\w/g, c => c.toUpperCase()))
  .concat(['CS2', 'Mario Kart', 'Terraria', 'Brawl Stars', 'Stardew Valley', 'Balatro', 'Hollow Knight']);

const GAME_TWISTS = [
  'in one prompt, no follow-ups',
  'with zero art assets — everything drawn in code',
  'that has to run in a single HTML file',
  'in under 500 lines',
  'with working local multiplayer',
  'but it has to be playable on a phone'
];

/* ---------- Formats ---------- */
const FORMATS = {
  versus2: {
    label: '2 Models Head-to-Head',
    blurb: 'Two models, same brief. Highest ceiling in the reference set.',
    defaultMin: 9, slots: 2, roundNoun: 'ROUND',
    titleFns: [
      (m, g) => `${m[0]} vs ${m[1]} Make ${g} From Scratch`,
      (m, g) => `${m[0]} vs ${m[1]} Make ${g} (One Prompt)`,
      (m, g) => `I Made ${m[0]} and ${m[1]} Build ${g} From Scratch`
    ],
    structure: [
      { role: 'intro', pct: 0.00 },
      { role: 'round', pct: 0.03, slot: 0 },
      { role: 'round', pct: 0.49, slot: 1 },
      { role: 'results', pct: 0.91 }
    ]
  },
  versus3: {
    label: '3 Models Head-to-Head',
    blurb: 'Three-way. Best like-to-view ratio measured.',
    defaultMin: 9, slots: 3, roundNoun: 'ROUND',
    titleFns: [
      (m, g) => `${m[0]} vs ${m[1]} vs ${m[2]} Make ${g} From Scratch`,
      (m, g) => `3 AIs Make ${g} From Scratch (Only One Works)`,
      (m, g) => `${m[0]} vs ${m[1]} vs ${m[2]}: ${g} From Scratch`
    ],
    structure: [
      { role: 'intro', pct: 0.00 },
      { role: 'round', pct: 0.04, slot: 0 },
      { role: 'round', pct: 0.20, slot: 1 },
      { role: 'round', pct: 0.63, slot: 2 },
      { role: 'results', pct: 0.93 }
    ]
  },
  collab: {
    label: 'N AIs Work Together',
    blurb: 'Relay — each model inherits the last one\'s code. Longer runtime.',
    defaultMin: 13, slots: 6, roundNoun: 'HANDOFF',
    titleFns: [
      (m, g) => `${m.length} AIs WORK TOGETHER to Make ${g} From Scratch`,
      (m, g) => `${m.length} AIs Build ${g} in a Relay (It Got Weird)`,
      (m, g) => `I Made ${m.length} AIs Take Turns Building ${g}`
    ],
    structure: [
      { role: 'intro', pct: 0.00 },
      { role: 'round', pct: 0.06, slot: 0 },
      { role: 'round', pct: 0.27, slot: 1 },
      { role: 'round', pct: 0.34, slot: 2 },
      { role: 'round', pct: 0.48, slot: 3 },
      { role: 'round', pct: 0.58, slot: 4 },
      { role: 'round', pct: 0.72, slot: 5 },
      { role: 'results', pct: 0.87 }
    ]
  },
  showcase: {
    label: 'One Model Is Insane',
    blurb: 'Single model, three escalating asks. Strongest engagement ratio.',
    defaultMin: 9, slots: 1, roundNoun: 'TASK',
    titleFns: [
      (m) => `${m[0]} is INSANE.`,
      (m) => `${m[0]} is Ridiculous.`,
      (m, g) => `${m[0]} Made ${g} in One Prompt.`,
      (m) => `${m[0]} is NOT Real.`
    ],
    structure: [
      { role: 'intro', pct: 0.00 },
      { role: 'round', pct: 0.05, slot: 0, escalate: 0 },
      { role: 'round', pct: 0.52, slot: 0, escalate: 1 },
      { role: 'round', pct: 0.80, slot: 0, escalate: 2 }
    ]
  },
  buildalong: {
    label: 'Building X With Only AI',
    blurb: 'Start to ship. Second-highest performer measured.',
    defaultMin: 9, slots: 1, roundNoun: 'STEP',
    titleFns: [
      (m, g) => `Building ${g} with Only AI`,
      (m, g) => `I Built ${g} Using ONLY AI (No Code)`,
      (m, g) => `Building a Viral ${g} w/ AI (pretty easy)`
    ],
    structure: [
      { role: 'intro', pct: 0.00 },
      { role: 'step', pct: 0.03, stepIdx: 0 },
      { role: 'step', pct: 0.19, stepIdx: 1 },
      { role: 'step', pct: 0.81, stepIdx: 2 },
      { role: 'results', pct: 0.94 }
    ]
  }
};

const BUILD_STEPS = [
  { name: 'Pick the idea', job: 'Show the idea being chosen, not handed down. The audience needs to believe you did not know the answer either.' },
  { name: 'Build it', job: 'The long middle. This is where the video is won or lost — keep it moving.' },
  { name: 'Ship it', job: 'Prove it exists outside your machine. A URL, a build, something real.' }
];

const ESCALATION = ['the baseline ask', 'the harder ask', 'the one that should break it'];

/* Phrases that read as machine-written. Surfaced as a linter. */
const BANNED = [
  'delve', 'dive in', 'let\'s dive', 'in this video', 'game-changer', 'game changer',
  'revolutionize', 'seamless', 'unleash', 'harness', 'in today\'s video',
  'without further ado', 'buckle up', 'leverage', 'testament to',
  'it\'s important to note', 'landscape of', 'realm of', 'elevate',
  'unlock the power', 'cutting-edge', 'robust', 'moreover', 'furthermore'
];

const MUSIC = {
  in: 'MUSIC IN — upbeat, low',
  under: 'MUSIC UNDER — bed continues',
  duck: 'MUSIC DUCK — 15% under VO',
  out: 'MUSIC OUT — silence sells the reveal',
  stab: 'MUSIC STAB — transition hit',
  swell: 'MUSIC SWELL — build into reveal',
  outro: 'MUSIC UP — outro track, full'
};
