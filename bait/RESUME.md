# BAIT — where the build stopped, and how to pick it up

Paused mid-build on 2026-08-04 at Peter's request (usage limit), with the game
in a shippable state rather than a broken one. Chapters 1 and 2 are live; 3 to
6 are designed but not authored.

**Everything below is a decision that was already made.** Do not relitigate
these, just continue from them.

---

## What is done

| Area | State |
|---|---|
| Engine (`src/core/*`, `input`, `loop`) | Complete. Hygiene-clean, Node-loadable, deterministic. |
| Render / audio (`src/render/*`) | Complete. |
| Save / daily / share / modes | Complete. |
| Play session (`src/game/play.js`) | Complete. |
| Screens / HUD | Complete except the **gauntlet screen builder**, which does not exist. |
| Editor / workshop | Complete. Prove-gate verified end to end, 91 assertions. |
| Verifier (`tools/verify.cjs`) + `src/core/solve.js` | Complete. |
| Campaign | **26 of 81 rooms.** Ch1 (13) and ch2 (13) authored, par-verified. |

## What is left

1. **Chapters 3-6, 55 rooms.** Per-room briefs (teach line + twist line) are
   already written in the header of `src/data/chapters.js`. This is execution
   against a finished design, not new design work.
2. **The gauntlet screen.** `Screens.BUILDERS` has title, chapters, results,
   pause, settings. The router calls `Screens.show('gauntlet')` and gets
   nothing, because `showInternal` returns silently on an unknown name. Build
   the screen, and make that early return warn.
3. **Two cosmetic bugs**: the HUD clips against the top edge of the canvas, and
   chapter select reports a total medal count that does not match the rooms
   that exist.
4. Re-add a `<script>` tag in `index.html` for each `src/data/ch<N>.js` as it
   lands. A tag for a file that does not exist is a 404 on Pages.

## How guest authors plug in

`chapters.js` (Atlas) owns the chapter list, the design plan and the `R()`
helper. Each guest chapter is its own file, loaded **after** `chapters.js`:

```js
(function (BAIT) { 'use strict';
  var R = BAIT.Chapters.R;
  BAIT.Chapters.attach(3, [ R('3-01', 'TITLE', 'teach', 'twist', [...14 lines...], params), ... ]);
})(typeof window !== 'undefined' ? (window.BAIT = window.BAIT || {}) : (global.BAIT = global.BAIT || {}));
```

`attach` throws on wrong room count, wrong ids, non-null par, or double
attach, so a short chapter cannot ship quietly.

**Atlas's split, ratified:** two guest authors take **ch3 LINKAGE** and **ch4
DRIFT**, which are mechanically self-contained. Atlas keeps ch2, ch5 and ch6,
because ch5 pays off setups planted in ch1 and ch6 is the finale — hand those
out and the payoffs stop landing.

---

## Rulings that are settled

**Deflectors are rails.** The original brief said the player keeps the
deflected heading "until they input a new direction", which is unimplementable:
a player crossing a deflector is *already* holding a direction, so every launch
cancelled on the next tick and the piece was inert for everyone. The shipped
rule: held input does not cancel a launch; a launch ends the tick the dot is
fully blocked; entering a second deflector re-slams and stays launched so
chains chain. Consequence, and it is intended: a launched player genuinely
cannot steer, so a deflector aimed at a pit is unavoidable once entered.
**Authors must never build a closed deflector loop** — it traps a live player
and the solver will not flag it, because the room may still be solvable another
way.

**The Token medal requires carrying the token to the exit.** Grab-then-die
earns nothing. The token always sits on a strictly worse line, and Token/Swift
conflicts are allowed but must be tagged in comments with the literal string
`DELIBERATE TOKEN/SWIFT CONFLICT` so the verifier does not report them as
broken.

**Waiting is legal exactly once in the whole game**, in room 2-04. If a room is
solved by standing still, it is wrong.

**Par is generated, never typed.** `tools/verify.cjs` solves every room and
writes `tools/par.generated.json`; `src/data/par.js` mirrors it as a classic
script (fetch of a local file is blocked on `file://`) and `Chapters.applyPar()`
stamps it at boot. Hand-typing 81 par times would drift into a silently wrong
Swift medal. `Chapters.parComplete()` is a ship blocker.

**The daily never solves at runtime.** `Daily.generate(seed)` is a pure
function of the seed with no solver anywhere, so the browser and Node build
byte-identical days. Correctness is proven at build time instead.

**Verify has two speeds.** Default run: campaign plus the next 30 days.
Release run (`--full`): every seed through `Daily.VERIFIED_UNTIL`. That
constant may only be bumped *after* a full run passes, so the constant is the
receipt. A check nobody runs because it takes half an hour is worse than a
smaller one that runs every time.

**UNSOLVABLE and UNKNOWN are different verdicts.** A search that exhausts its
node budget says nothing about the room. Conflating them sends authors
rewriting rooms that were fine.

**A failed test run after a room is already proved does not revoke the proof.**
The room did not change, so the run that cleared it still stands. Requiring the
last attempt to be the winning one would punish an author for double-checking.

**The author ghost is the proof.** `Workshop.recordRun` never overwrites the
ghost on a room in `workshop.rooms`, but does replace it on an imported room,
where it is only your own best line. Losing an author ghost to a slow play
session would quietly destroy the proof.

**Chapter 6 unlocks at 211 medals** (80% of the 264 available before it). That
number moved from 208 when ch1 gained a 13th room.

---

## Engine facts that cost people real time

1. **An L bend is not a corner.** Wall sliding carries the dot round it, so a
   corridor going east then north is cleared by holding one diagonal. Use
   switchbacks.
2. **Stepping stones touching at a corner are not crossable.** Radius 7 in a
   40px cell means a diagonal corner cut overlaps both pits. Paths must be
   orthogonally connected.
3. **Faller occupancy is the centre cell**, so a graze never consumes one.
4. **`period` is in units of 10 ticks at 120Hz**, so period 12 is one second.
5. **`phase` means three different things.** Turret: a time offset, wraps at
   `period`. Phase block: only the *parity* matters — even starts solid, odd
   starts open, so you cannot fine-tune a block with it. Rotor: only `phase & 3`
   matters, picking the starting quarter turn.
6. **A turret whose muzzle cell is solid never fires.** It passes every check
   and does nothing.
7. **Standing in a phase block when it closes kills you** (`crushed`). It does
   not shove you out.
8. **A conveyor is exactly half walking speed** and can never take control
   away. Two overlapping conveyors apply only one, the lowest cell index.
9. **`#ui > *` takes pointer events back**, so any full-bleed element inside
   `#ui` eats every click meant for the board, and `.passthrough` cannot be
   undone on a child.
