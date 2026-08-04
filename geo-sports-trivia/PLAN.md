# Off the Map — build plan

A sports trivia game where every answer is a **place**. You read the question,
then click the spot on a world map. Points scale with how close you got.

Author of this plan: Leo. Builder: Chase. Reporter: Max.

---

## 1. The one-paragraph version

8-ish rounds. Each round shows a sports trivia question whose answer is a
location ("Arizona's NHL team was sold in 2024 and relocated here"). The player
pans/zooms a world map and clicks where they think it is. On lock-in, the map
flies out to show both pins, draws a line between them, and awards **0-100
points based on distance**. Some rounds are worth x2 or x3. A perfect game is
**exactly 1000**.

---

## 2. Hard constraints (read these before writing code)

1. **One self-contained folder.** `C:\Users\peter.broas\Projects\AI Game\geo-sports-trivia\`
2. **No CDN, no build step, no npm.** The parent `README.md` says: *"vendor any
   libraries into the folder so it works offline and on Pages."* Follow it. The
   game must work by double-clicking `index.html` with the network cable pulled.
3. **No tile server.** Raster tiles (OSM/CARTO/Mapbox) are a network dependency
   and break rule 2. The basemap is **vendored vector data** — see §5.
4. This is the whole world, not the USA. Question bank and map must both reflect
   that.
5. Add the game to the parent `index.html` launcher and the `README.md` table
   when it works. That is the arcade's stated convention.

---

## 3. Files

```
geo-sports-trivia/
  index.html        game shell, inline CSS + inline game JS
  vendor/
    leaflet.js      Leaflet 1.9.4, vendored (minified)
    leaflet.css     + its marker images if used (prefer CSS/DivIcon pins, no image deps)
  data/
    countries.js    world land polygons as `const WORLD_GEOJSON = {...}`
    cities.js       orientation labels as `const CITIES = [...]`
    questions.js    the bank as `const QUESTIONS = [...]`
  PLAN.md           this file
```

Everything is loaded with plain `<script src>` tags. **No ES modules** — `type="module"`
is blocked by CORS under `file://`, which would break rule 2 on the spot. Plain
scripts and globals.

---

## 4. Scoring — get this exactly right, it is the spine of the game

### 4.1 Distance

Haversine, earth radius 6371 km.

### 4.2 Round base score (0-100)

```js
function baseScore(distKm, perfectKm) {
  if (distKm <= perfectKm) return 100;
  const raw = 100 * Math.exp(-(distKm - perfectKm) / 1400);
  return raw < 1 ? 0 : Math.round(raw);
}
```

`perfectKm` is per-question (§6) — a stadium is tighter than a country. The 1400 km
decay is deliberately forgiving: ~37 pts at 1400 km off, ~13 at 2800, 0 past ~7000.
Roughly-right-continent still scores, wrong hemisphere does not.

### 4.3 Weights and the 1000 cap

Round points = `baseScore * weight`. Every game uses a weight pattern that sums to
**exactly 10**, so max total is always 1000. Pick one at random per game:

| Pattern | Rounds | Weights |
| --- | --- | --- |
| A | 8 | 1,1,1,1,1,1,2,2 |
| B | 7 | 1,1,1,1,2,2,2 |
| C | 7 | 1,1,1,1,1,2,3 |
| D | 6 | 1,1,2,2,2,2 |

Always sort so the heavy rounds come **last** — the finish should feel like it
matters. Assert `weights.reduce((a,b)=>a+b) === 10` at startup and throw loudly if
it ever fails. That assertion is the only thing standing between us and a 1100-point
game.

### 4.4 No time bonus

A timer that adds points makes 1000 unreachable-or-exceedable and turns a knowledge
game into a twitch game. If you want tension, show a **cosmetic** count-up clock on
the final card ("finished in 4:12"). It must not touch scoring.

### 4.5 Ranks (final screen)

0-249 Benchwarmer · 250-499 Rotation Player · 500-699 Starter · 700-849 All-Star ·
850-949 MVP · 950-1000 Hall of Famer

---

## 5. The map

**Base layer:** Leaflet with **no tile layer at all**. Instead:

- `L.geoJSON(WORLD_GEOJSON)` — Natural Earth **110m** land/country polygons
  (public domain, ~100 KB minified). Style: flat dark land `#1c2230`, hairline
  borders `#39445c`, ocean = the map container's background `#0d1017`.
- A lat/lon graticule every 30°, very low opacity.
- `CITIES` — a curated ~150-entry list `{name, lat, lon, rank}` rendered as small
  dots. **Names appear only at zoom >= 4** (rank 1 cities) and zoom >= 5 (rank 2).
  This is the vendored replacement for tile labels: it solves "I can't find Salt
  Lake City on a blank map" without a single network request. Do not label so
  densely that the map reads as an atlas.
- `worldCopyJump: true`, `minZoom: 2`, `maxBounds` on latitude so you cannot pan
  into grey void. `zoomControl` bottom-right. Scroll wheel zoom on, double-click
  zoom **off** (it fights with click-to-guess).

**Sourcing the data:** if you cannot fetch Natural Earth offline, generate the
polygons from any local source you trust and commit the result as
`data/countries.js`. Do not ship a placeholder rectangle world.

**Guessing:** a `click` on the map places/moves a single guess pin. The
**Lock it in** button is disabled until a pin exists. Enter also locks in.

---

## 6. Question data shape

```js
{
  id: 'nhl-utah',
  sport: 'NHL',
  prompt: "In 2024 the Arizona Coyotes' hockey operations were sold and moved here, becoming the Utah Hockey Club.",
  answer: { name: 'Salt Lake City, Utah, USA', lat: 40.7608, lon: -111.8910 },
  perfectKm: 50,
  difficulty: 2,        // 1 easy, 2 medium, 3 hard
  fact: 'The team was renamed the Utah Mammoth in 2025.'
}
```

Rules for the bank:
- **Minimum 30 questions**, target 40. Seed bank below is 30 and is yours to verify.
- Selection per game: shuffle, then **dedupe by city** (never two Melbourne answers
  in one run), then take N for the chosen weight pattern, then **sort by difficulty
  ascending** so the x2/x3 rounds are also the hard ones.
- Spread the sports. A run that is 6 NFL questions is a bad run. Cap any one sport
  at 2 per game.
- **Verify every fact and every coordinate before you ship it.** A trivia game that
  is wrong is worthless, and I wrote these from memory. Anything you cannot confirm,
  delete rather than guess. `perfectKm` should match how precise the answer is:
  ~15-30 km for a stadium or small town, 40-50 km for a big metro.

### Seed bank (30)

| id | sport | prompt (shorten as you like) | answer | lat | lon | perfectKm | diff |
| --- | --- | --- | --- | --- | --- | --- | --- |
| nhl-utah | NHL | Arizona's NHL team was sold in 2024 and relocated here | Salt Lake City, USA | 40.7608 | -111.8910 | 50 | 2 |
| nba-okc | NBA | The SuperSonics left Seattle in 2008 and became the Thunder here | Oklahoma City, USA | 35.4676 | -97.5164 | 50 | 1 |
| nfl-raiders | NFL | The Raiders left Oakland in 2020 for Allegiant Stadium here | Las Vegas, USA | 36.0909 | -115.1833 | 40 | 1 |
| nfl-chargers | NFL | The Chargers left San Diego in 2017 for SoFi Stadium in this city | Inglewood, USA | 33.9535 | -118.3392 | 30 | 3 |
| mlb-as | MLB | After leaving Oakland the Athletics played in a minor-league park in this state capital | Sacramento, USA | 38.5816 | -121.4944 | 40 | 2 |
| nba-grizzlies | NBA | The Grizzlies started in Vancouver and relocated here in 2001 | Memphis, USA | 35.1495 | -90.0490 | 50 | 1 |
| fut-maracana | Football | The Maracanã hosted the 1950 and 2014 World Cup finals here | Rio de Janeiro, Brazil | -22.9121 | -43.2302 | 40 | 1 |
| fut-campnou | Football | Camp Nou, Europe's largest football stadium, is here | Barcelona, Spain | 41.3809 | 2.1228 | 30 | 1 |
| fut-bombonera | Football | La Bombonera, home of Boca Juniors, is in this capital | Buenos Aires, Argentina | -34.6356 | -58.3648 | 40 | 1 |
| fut-azteca | Football | Estadio Azteca, first ground to host two World Cup finals | Mexico City, Mexico | 19.3029 | -99.1505 | 40 | 1 |
| fut-dortmund | Football | The 'Yellow Wall' terrace at Signal Iduna Park is here | Dortmund, Germany | 51.4926 | 7.4518 | 30 | 2 |
| fut-bernabeu | Football | The Santiago Bernabéu is here | Madrid, Spain | 40.4531 | -3.6883 | 30 | 1 |
| fut-lusail | Football | The 2022 World Cup final was played at Lusail Stadium, just north of this capital | Lusail / Doha, Qatar | 25.4210 | 51.4900 | 40 | 2 |
| fut-metlife | Football | MetLife Stadium, the 2026 World Cup final venue, is in this NJ borough | East Rutherford, USA | 40.8135 | -74.0745 | 25 | 3 |
| cri-lords | Cricket | Lord's, the Home of Cricket | London, England | 51.5299 | -0.1729 | 30 | 1 |
| cri-wankhede | Cricket | India won the 2011 World Cup final at Wankhede Stadium here | Mumbai, India | 19.0176 | 72.8300 | 40 | 2 |
| cri-mcg | Cricket | The Boxing Day Test is played at the MCG here | Melbourne, Australia | -37.8200 | 144.9834 | 40 | 1 |
| rug-edenpark | Rugby | Eden Park, where the All Blacks have not lost a Test since 1994 | Auckland, New Zealand | -36.8748 | 174.7445 | 30 | 2 |
| f1-monaco | F1 | This microstate's street circuit runs through Monte Carlo | Monaco | 43.7384 | 7.4246 | 15 | 1 |
| f1-suzuka | F1 | Suzuka, the only figure-eight circuit on the F1 calendar | Suzuka, Japan | 34.8431 | 136.5410 | 30 | 3 |
| f1-baku | F1 | This Caspian capital's street circuit squeezes past a medieval old town | Baku, Azerbaijan | 40.3755 | 49.8535 | 40 | 2 |
| golf-standrews | Golf | The Old Course, the home of golf | St Andrews, Scotland | 56.3433 | -2.8025 | 25 | 2 |
| oly-2026 | Olympics | The 2026 Winter Olympics are co-hosted by Cortina and this larger city | Milan, Italy | 45.4642 | 9.1900 | 40 | 1 |
| oly-2032 | Olympics | The 2032 Summer Olympics were awarded to this city | Brisbane, Australia | -27.4698 | 153.0251 | 50 | 2 |
| ten-indianwells | Tennis | The BNP Paribas Open is played in this California desert town | Indian Wells, USA | 33.7206 | -116.3053 | 25 | 3 |
| run-boston | Running | The world's oldest annual marathon finishes on Boylston Street here | Boston, USA | 42.3505 | -71.0780 | 30 | 1 |
| cyc-tdf | Cycling | The Tour de France has finished on the Champs-Élysées here since 1975 | Paris, France | 48.8698 | 2.3078 | 30 | 1 |
| bas-euroleague | Basketball | EuroLeague rivals Panathinaikos and Olympiacos share this metro | Athens, Greece | 37.9838 | 23.7275 | 40 | 2 |
| nhl-coyotes | NHL | The original Winnipeg Jets relocated in 1996 and became the Coyotes here | Phoenix, USA | 33.4484 | -112.0740 | 50 | 2 |
| khl-ska | Ice hockey | KHL club SKA plays in this Russian city on the Gulf of Finland | Saint Petersburg, Russia | 59.9311 | 30.3609 | 40 | 2 |

---

## 7. Screens and flow

1. **Title** — game name, one-line rules, best score from `localStorage`, Play.
2. **Round** — top bar: round x of n, sport chip, weight badge (`x2` pulses if >1),
   running total. Question card sits over the map, collapsible so it never hides the
   spot you want to click. Map fills the screen. `Lock it in` bottom-centre.
3. **Reveal** — see §8.
4. **Final** — total counting up, rank label, a per-round bar chart, a mini world map
   with all 8 answer pins and your guesses, Play again. Save best to `localStorage`.

Keyboard: `Enter` locks in / advances, `Esc` collapses the question card.

---

## 8. The reveal — this is where the game feels good, do not skimp

Sequence, roughly 2.2s total, each step overlapping slightly:

1. Guess pin **drops and bounces** (transform + cubic-bezier overshoot).
2. Map `flyToBounds` on both points, generous padding, ~800ms.
3. Answer pin **pops in** with an expanding ring pulse (2 rings, staggered).
4. A line draws between the two pins — animate `stroke-dashoffset` on the Leaflet
   polyline's SVG path so it grows from guess to answer. Interpolate the line as a
   great circle (~32 segments) so it curves correctly, and split it at the
   antimeridian instead of drawing a wrong line straight across the map.
5. Distance chip counts up in km **and** miles.
6. Points count up with ease-out, colour-graded (green >= 80, amber >= 40, red below).
   If `weight > 1`, the base number lands first, then a `x2` stamp hits and the
   number multiplies up.
7. Bullseye (`dist <= perfectKm`): short canvas confetti burst plus a "BULLSEYE"
   stamp. Only here — if it fires every round it means nothing.
8. Fact line fades in under the answer name.

Rules: transform and opacity only, no `backdrop-filter`, no animating `width`/`top`.
Respect `prefers-reduced-motion` by cutting straight to the end state.

---

## 9. Look

Dark, sporty, high contrast. Suggested: page `#0d1017`, panels `#161b26` at 92%,
text `#e8edf7`, accent electric orange `#ff7a1a`, correct green `#33d17a`, miss red
`#ff5470`. Big condensed numerals for the score. Rounded 14px panels, one soft
shadow. Must be readable over the map at any zoom — panels get a solid background,
never transparency alone.

Responsive down to ~380px wide: the question card becomes a bottom sheet, the map
keeps the rest.

---

## 10. Acceptance checks before you hand off

- Opens from `file://` with the network **off**: map draws, city labels appear on
  zoom, full game is playable start to finish.
- `weights.sum === 10` for all four patterns; a perfect run scores exactly 1000.
  Verify by temporarily forcing every guess to the answer coords.
- Haversine sanity: London to Paris ≈ 344 km, Sydney to LA ≈ 12 060 km,
  New York to Tokyo ≈ 10 850 km. Within 1%.
- No duplicate answer city inside one run. Run it 20 times in a loop to confirm.
- No question repeats inside a run.
- Antimeridian: a guess in New Zealand for an answer in Chile draws a sane line and
  a sane distance, not a line wrapping the wrong way round the world.
- Zero console errors, zero network requests (check the Network tab is empty).
- Parent `index.html` launcher has a card for it and `README.md` has a table row.

---

## 11. Out of scope

No backend, no accounts, no leaderboard beyond `localStorage`, no sound (unless it
is trivial and muted by default), no map tiles, no build tooling, no frameworks.
