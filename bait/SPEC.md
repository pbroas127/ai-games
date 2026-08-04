# BAIT — build specification

> **You build a room that looks fair and isn't. You prove it by clearing it
> yourself. Then you watch strangers walk into it.**

Author of this spec: **Boss**. It is the contract. If your code disagrees with
this document, your code is wrong — or you raise it in `#bait-build` and we
change the document *first*.

---

## 0. Non-negotiable constraints

Read these before writing a line. Every one of them has killed a previous game.

1. **One self-contained folder**: `C:\Users\peter.broas\Projects\AI Game\bait\`.
2. **It must run by double-clicking `index.html` with the network cable pulled.**
   This is the hard one, and it bans more than you think:
   - **NO ES modules.** `<script type="module">` is blocked by CORS on `file://`.
     Every file is a **classic script** that attaches to the global `BAIT`
     namespace. Load order is fixed in `index.html` (§6).
   - **NO `fetch()` / `XMLHttpRequest` of local files.** Blocked on `file://`.
     All data ships as `.js` files that assign into `BAIT.data`.
   - **NO CDN, no npm, no build step, no bundler, no TypeScript.**
   - **NO external fonts.** System font stack only, or draw the wordmark as
     vector paths.
   - **NO audio/image files to load.** Audio is synthesised in WebAudio at
     runtime. Art is drawn procedurally on canvas. Zero binary assets is a
     feature: instant load, perfect offline, and the whole game stays under
     ~400 KB of text.
3. **No backend, ever.** The game is hosted on GitHub Pages (static). "Online"
   is achieved entirely through **room codes** (§5) and the **date-seeded daily**
   (§4.2). Anything requiring a server is out of scope and must not be faked.
4. **Deterministic simulation.** Same room + same inputs = same outcome, on
   every machine, forever. This is what makes replays, ghosts, the prove-gate
   and the headless solver possible. It is enforced by:
   - **Integer / fixed-point maths only in `src/core/`. No `Math.random()`, no
     `Date.now()`, no floats in simulation state.** Floats are allowed in
     rendering and only in rendering.
   - **Fixed timestep** of 120 Hz. Rendering interpolates between ticks.
5. **Strict file ownership** (§6). You edit *your* files. You never edit
   another agent's file, not even a one-line fix. Post in the thread instead.
6. **Never cut safety for brevity.** Validate anything that comes from a room
   code — a pasted code is untrusted input and must not be able to hang the
   loop, allocate unbounded memory, or throw past the parser.

---

## 1. What the player actually does

Three modes off one simulation.

### CAMPAIGN — the offline depth
Six chapters, **~80 hand-authored rooms**, each chapter introducing pieces and
then combining them. This is the part that answers *"it can't be short or
easy."* Expect a competent player to need **4–6 hours** for a full clear, and
considerably longer for every medal.

Four medals per room, shown as four pips:
| Medal | Condition |
|---|---|
| **Clear** | reach the exit |
| **Clean** | clear it with zero deaths in that attempt |
| **Swift** | clear it inside the room's `par.time` (computed by the solver, §7) |
| **Token** | collect the optional token, which always sits on a riskier line |

Chapters unlock on medal count, not on clears, so the back half is gated behind
actually playing well. The final chapter is gated at 80% of all available
medals and is designed to be genuinely hard.

### GAUNTLET — the daily, and the "online" competition
Five rooms generated from a **date seed** (`YYYYMMDD`). Everyone on earth gets
the identical five rooms with no server involved, because the generator is
deterministic and ships in the client. Three lives across all five rooms. One
attempt per day; the run is scored on time + deaths and produces a share string
with a par denominator (§5.2).

### WORKSHOP — the authorship loop
The full editor. Place pieces from a budget, hit **Test**, and you cannot
publish until you have **cleared your own room** — the prove-gate. Publishing
emits a **room code**: a short string that *is* the room. Paste it in Discord
and anyone can play the exact room.

Local library of your rooms, plus rooms you have imported by code, with your
best time and ghost per room.

---

## 2. Feel — the part that must be perfect

The user's words: *"controls should all be smooth perfectly, no lag or delay."*
That is an engineering requirement, and it is met by removing every source of
softness rather than by tuning:

- **Constant speed. No acceleration, no friction, no momentum, ever.** The dot
  moves at exactly `SPEED` units/tick whenever a direction is held.
- **8-way direction, instant.** Input direction is sampled at the start of every
  sim tick and applied that same tick. There is no smoothing, no easing, no
  input buffer, no coyote time. Press → move, in ≤ 8.3 ms.
- Diagonals are normalised so diagonal speed equals cardinal speed (use the
  precomputed fixed-point table in `pieces.js`, not a square root).
- **120 Hz fixed-step sim, rendered with interpolation** at whatever the display
  runs at. The renderer draws at `alpha` between the previous and current tick,
  so 60 Hz, 120 Hz and 144 Hz monitors all look equally smooth.
- The render loop does the classic accumulator. **Cap the accumulator at 8
  ticks** so a background tab that was throttled does not spiral.
- **Death → retry must be instantaneous.** No fade, no load, no confirmation.
  Target: retry available on the *next frame*. The whole design assumes death is
  cheap (~2s including the replay beat) and it stops being cheap the moment
  there is a transition.
- No screen shake, anywhere. See §3.

---

## 3. Art direction — anti-neon, and deliberately so

The identity is a **blueprint**: chalk-white line work on flat slate, hard right
angles, stencil labels, annotated like a patent diagram. Blueprints read as
*honest*, which is the joke of the entire game.

**Banned outright** (these four defaults are why every browser game looks the
same): dark background + neon accent + bloom + synth pad.

| Lever | The rule |
|---|---|
| **Shape** | Hard right angles, 2px chalk strokes, no fills except ink floods, no rounded corners on hazards, stencil labels on pieces |
| **Camera** | Locked. One room, one screen, dead still. **The only camera move in the entire game is a slow push-in on the death replay.** No shake, no bob, no parallax |
| **Motion** | Everything is either perfectly still or instantaneous. No easing, no springs, no particle systems. The faller drops in one frame. Trap comedy is timing, and timing only reads against stillness |
| **Audio** | Dry mechanical foley, synthesised: a pencil tick per step, a wooden clack on a gate, one dry snap on the faller, then **half a second of total silence** before the death replay. No pad. No music bed. In a category where everything ships neon and synth, silence is the loudest thing on the table |

Palette lives in `src/render/theme.js` and nowhere else. No hex literals outside
that file.

**Quality bar**: this has to look like a designed object, not a programmer's
test harness. Paper grain, plate registration marks, a real typographic
hierarchy, considered spacing. The menus matter as much as the game.

---

## 4. Systems

### 4.1 The piece table
`src/core/pieces.js` is authored by Boss and is **the single source of truth**
for tile ids, names, parameters and the fixed-point constants. Engine implements
its behaviour, Art renders it, Content authors with it, Editor exposes it.
**Nobody edits that file except Boss.** Need a piece changed? Ask in the thread.

Two pieces can lie, and lying is the whole game: the **faller** (walkable once,
a pit the second time) and the **mimic exit** (identical to the exit, fatal).
Everything else is honest and telegraphed. That ratio is deliberate — a room
where anything might be a lie is not a trap, it is noise.

### 4.2 Daily generator
`src/game/daily.js`. `generate(dateSeed) -> Room[5]`, pure, deterministic,
seeded PRNG only. Difficulty ramps across the five. **Every generated room must
be verified solvable by the same solver the campaign uses** (§7) — generate,
solve, and reject-and-regenerate on failure, with a bounded retry count so it
can never hang.

### 4.3 Save
`src/game/save.js`. One `localStorage` key, one versioned JSON document,
migrated forward on load. Holds: medals per room, best times, best ghosts
(RLE'd input strings, capped in size), workshop library, imported rooms, daily
history, settings. **A corrupt or absent save must never break boot** — parse
in a try/catch and fall back to a fresh document.

### 4.4 Ghosts
Deterministic replay makes these free. Two are shown, both optional in settings:
**your best run on this room**, and **the ghost of your last death**, which
stops where you died. No third-party ghosts — there is no server.

---

## 5. The social objects

### 5.1 Room code
The room code **is** the room — no server lookup, the whole level is in the
string. Base64url over an RLE'd byte stream. Target: a typical room under ~120
characters. Shareable as a bare code or as a link: `index.html#r=<code>`.

Opening a `#r=` link boots straight into that room. The parser must treat the
code as hostile: validate version, bounds, tile ids and param ranges, and fail
to a clean "that code isn't valid" screen rather than throwing.

### 5.2 Result strings
Always carry a par denominator — a bare number means nothing to a reader.

```
BAIT gauntlet 214 · cleared 4/5 · 3 deaths · 2:41 (par 3:10)
BAIT room k3f9x2m0qr7v · cleared in 2 deaths · 0:38 (par 0:31)
```

One-tap copy. No scrollable leaderboard, ever — there is no server and it would
be a status report on your irrelevance if there were.

---

## 6. File ownership and load order

`index.html` loads these as classic scripts, in exactly this order. **The owner
column is binding.**

| # | File | Owner |
|---|---|---|
| 1 | `src/core/fixed.js` — Q16.16 fixed-point maths | Engine |
| 2 | `src/core/rng.js` — seeded PRNG (xorshift32) | Engine |
| 3 | `src/core/pieces.js` — **tile table + constants** | **Boss** |
| 4 | `src/core/room.js` — Room shape, validation, helpers | Engine |
| 5 | `src/core/sim.js` — the deterministic simulation | Engine |
| 6 | `src/core/codec.js` — room ⇄ code | Engine |
| 7 | `src/core/replay.js` — record/playback, RLE | Engine |
| 8 | `src/render/theme.js` — palette, metrics, type scale | Art |
| 9 | `src/render/draw.js` — the room renderer | Art |
| 10 | `src/render/fx.js` — ink, death replay push-in, transitions | Art |
| 11 | `src/render/audio.js` — WebAudio foley synth | Art |
| 12 | `src/game/input.js` — keyboard / gamepad / touch | Engine |
| 13 | `src/game/loop.js` — rAF accumulator + interpolation | Engine |
| 14 | `src/game/save.js` — localStorage schema | Meta |
| 15 | `src/game/daily.js` — date-seeded gauntlet | Meta |
| 16 | `src/game/share.js` — result strings, URL codes | Meta |
| 17 | `src/game/modes.js` — mode state machine | Meta |
| 18 | `src/ui/screens.js` — title, chapter select, results, pause, settings | UI |
| 19 | `src/ui/hud.js` — in-run HUD | UI |
| 20 | `src/ui/editor.js` — the editor | Editor |
| 21 | `src/ui/workshop.js` — library, publish, import | Editor |
| 22 | `src/data/chapters.js` — **the campaign** | Content |
| 23 | `src/boot.js` — wires it together, starts the loop | Boss |
| — | `style.css` | Art |
| — | `index.html` | Boss |
| — | `tools/verify.cjs` — headless solver + CI check | QA |

Every file starts with `(function(BAIT){ 'use strict'; ... })(window.BAIT = window.BAIT || {});`
and attaches exactly one namespace, e.g. `BAIT.Sim`.

**Rule: you may read every file. You may write only your own.**

---

## 7. The headless solver — how we guarantee quality

`tools/verify.cjs` runs under plain Node with no dependencies. It loads the core
files (which must therefore have **zero DOM references** — this is why `core/`
is separate from everything else) and, for every campaign room and every daily
room for the next 365 days:

1. **Proves it is clearable** by searching the deterministic sim (A*/BFS over
   quantised state: position, heading, tick modulo the LCM of hazard periods,
   and the flag set). A room that cannot be solved does not ship.
2. **Computes `par.time`** from the optimal solution, which is what sets the
   Swift medal. No human tuning, no guesswork.
3. **Proves the token is reachable** on a legal line.
4. **Round-trips the room through the codec** and asserts equality.
5. **Replays the solution** and asserts the sim result is identical — the
   determinism regression test.

`node tools/verify.cjs` must exit 0 with every room green before we ship. This
is the definition of "internally reviewed and checked off."

---

## 8. Definition of done

Nothing ships until every line is true:

- [ ] `node tools/verify.cjs` exits 0: every campaign room solvable, par
      computed, token reachable, codec round-trips, determinism holds.
- [ ] Opening `index.html` from `file://` with the network disabled plays the
      full game, all three modes.
- [ ] Campaign: 6 chapters, ~80 rooms, medals, unlock gates, all reachable.
- [ ] Gauntlet: today's five rooms generate, are solvable, produce a string.
- [ ] Workshop: place → test → prove-gate → publish → code → reopen from code
      round-trips, including in a fresh browser profile.
- [ ] Ghosts render and are frame-accurate against a recorded run.
- [ ] Zero console errors or warnings in a full session.
- [ ] Keyboard, gamepad and touch all play. Mobile portrait is usable.
- [ ] 60 fps on a mid laptop with the heaviest room on screen, verified by the
      built-in frame-time readout.
- [ ] Settings: audio volume, ghosts on/off, reduced-motion, colourblind-safe
      hazard marking, key rebinding.
- [ ] Accessibility: full keyboard nav on every menu, visible focus rings,
      hazards distinguishable without relying on colour alone.
- [ ] Save survives a reload, a version bump, and a deliberately corrupted blob.
- [ ] `README.md` written; a card added to the arcade launcher `../index.html`
      and a row to `../README.md`.

---

## 9. Working agreement

- Post in `#bait-build` when you finish a file, when you need something from
  another owner, or when you are blocked. Do not sit blocked.
- **Do not edit another owner's file.** Ask.
- When you need an interface that does not exist yet, write against the
  signature in this document and stub it locally in your head — do not invent a
  second version of someone else's module.
- Commit nothing. Boss handles git at the end.
- If you think the spec is wrong, say so. It has been wrong before.
