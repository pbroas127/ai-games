# FEATHER DASH

A voxel endless road-crosser — original art, code, and procedural sound.
No build step, no dependencies to install, fully offline (Three.js is vendored).

## Play

Double-click `index.html` — it runs straight from disk in any Chromium browser
(Chrome / Edge). Or serve it (`npx serve`) if you prefer.

## Controls

| Input | Action |
| --- | --- |
| ↑ / W / Space | Hop forward |
| ↓ / S | Hop back |
| ← → / A D | Hop sideways |
| Tap (touch) | Hop forward |
| Swipe (touch) | Hop in swipe direction |
| Space (game over) | Play again |
| R | Restart mid-run |
| 🔊 button | Mute (persisted) |

## The game

- **Terrain**: grass (trees/rocks), roads (cars + trucks, speeds scale with
  score), rivers (ride the logs or drown), railways (warning lights + bell,
  then a train at full tilt).
- **Pressure**: idle too long or fall behind the camera and a hawk takes you.
- **Score** = furthest row reached; best score persisted. Coins spawn on the
  field and bank across runs.
- **Deaths all have their own animation + sound**: flattened by traffic,
  splash-and-sink in water, snatched skyward by the hawk.
- Milestone toast + jingle every 50 rows.

## Tech notes

- Single `game.js` (~900 lines), classic script — works over `file://`.
- All audio is synthesized live with WebAudio (oscillators + filtered noise):
  hop chirp, splash, squash + horn, train bell/horn/rumble, hawk screech,
  coin, milestone arpeggio, game-over sting. No audio files.
- Hop = 160 ms parabolic arc with squash-and-stretch and landing dust;
  inputs queue (max 2) so fast tapping never drops a hop.
- Orthographic camera with gentle forward creep; shadows from one
  directional light; every prop is composed of shared unit-box geometry.
- Saved state (localStorage): best score, coin total, mute.
