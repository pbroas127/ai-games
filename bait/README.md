# BAIT

**You build a room that looks fair and isn't. You prove it by clearing it
yourself. Then you watch strangers walk into it.**

A one-screen, top-down precision game about authorship and deceit. Play it in
a browser, offline, with no install and no account.

- **Play online**: https://pbroas127.github.io/ai-games/bait/
- **Play offline**: clone the repo and open `index.html`. That's it — no build
  step, no server, no network. Pull the cable out and it still works.

---

## The idea

You move a dot at a constant speed. No acceleration, no momentum, no jump.
Press a direction and you move that direction, this frame. Every room is one
screen and every hazard is on a fixed, visible cadence, so nothing that kills
you was ever hidden — except for the two pieces that are *allowed* to lie:

- **The faller** looks exactly like floor. It holds you the first time. The
  second time, you fall.
- **The mimic exit** is drawn with the same function, in the same colour, as
  the real exit.

Everything else is honest. That ratio is the design: a room where anything
might be a lie is not a trap, it's noise.

## Three ways to play

**Campaign** — hand-authored rooms across six chapters, each introducing
pieces and then combining them. **Chapter 1, Ground Floor, is live now with 13
rooms; chapters 2 to 6 are being authored and will land in later updates** —
the chapter list shows them locked until then. Four medals per room: **Clear**, **Clean** (no
deaths), **Swift** (inside par), and **Token** (the optional collectible,
which always sits on a worse line than the route you'd rather take). Later
chapters unlock on medals, not on clears, so the back half is gated behind
actually playing well.

**Daily Gauntlet** — five rooms generated from the date. Everyone in the world
gets the same five, and there is no server involved: the generator is
deterministic and ships inside the page. Three lives, one run, and a result
string with a par denominator you can paste into a group chat.

**Workshop** — the editor. Place pieces from a budget, hit Test, and you
cannot publish a room you have not cleared yourself. That prove-gate is the
whole feature: you discover your own room is unfair by failing to beat it.
Publishing gives you a **room code** — a short string that *is* the room, with
the entire level packed into it. Paste the code, or share the link, and anyone
plays that exact room. No accounts, no uploads, no backend.

## Controls

| | |
|---|---|
| Move | WASD, arrow keys, gamepad, or touch |
| Retry | any direction, instantly, the frame you die |
| Pause | Esc |

Everything is rebindable in Settings, every menu is fully keyboard navigable,
and hazards are distinguishable without relying on colour.

## How it's built

No dependencies, no bundler, no framework, no assets. Every file is a classic
script attaching to one global, which is what lets the game run from a
`file://` double-click — ES modules would be blocked by CORS. All audio is
synthesised in WebAudio at runtime and all art is drawn procedurally, so there
is not a single image or sound file in the folder and the whole game is a few
hundred kilobytes of text.

The simulation is **deterministic**: fixed 120 Hz timestep, integer fixed-point
maths, no floats and no randomness anywhere in `src/core/`. Rendering
interpolates between ticks, so it's equally smooth at 60, 120 or 144 Hz.

That determinism is what pays for everything else. Replays are just an input
list. Ghosts are a second simulation stepped alongside yours. A room code is
the level itself rather than a database key. And `tools/verify.cjs` loads the
same core files under plain Node to **prove every room is solvable**, compute
each room's par time from an optimal solution, and check that a room code
still decodes to the room it encoded.

```
node tools/verify.cjs
```

That has to pass before anything ships.

## Layout

```
index.html          shell + script load order
src/core/           deterministic, integer-only, DOM-free (Node loads these too)
src/render/         canvas renderer, effects, WebAudio foley
src/game/           input, loop, save, daily, share, modes, play session
src/ui/             screens, HUD, editor, workshop
src/data/           the campaign
tools/verify.cjs    headless solver + build gate
```

Built with Claude agents in [DASH](https://dashcanvas.dev).
