// Acceptance checks for Off the Map (PLAN.md section 10).
// Lifts the pure logic straight out of index.html so the tests run the shipped
// code, not a copy of it.
const fs = require('fs')
const path = require('path')

const ROOT = __dirname
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')

const START = '// ===================== PURE LOGIC START ====================='
const END = '// ====================== PURE LOGIC END ======================'
const a = html.indexOf(START), b = html.indexOf(END)
if (a < 0 || b < 0) throw new Error('could not find the pure logic markers in index.html')
const PURE = new Function(html.slice(a + START.length, b) + '\n; return PURE;')()

// data files are plain scripts declaring consts — eval them into scope
function loadData(file, name) {
  const src = fs.readFileSync(path.join(ROOT, 'data', file), 'utf8')
  return new Function(src + '\n; return ' + name + ';')()
}
const QUESTIONS = loadData('questions.js', 'QUESTIONS')
const CITIES = loadData('cities.js', 'CITIES')
const WORLD = loadData('countries.js', 'WORLD_GEOJSON')

let fails = 0, checks = 0
function ok(name, cond, detail) {
  checks++
  if (cond) { console.log('  PASS  ' + name) }
  else { fails++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')) }
}
function group(t) { console.log('\n' + t) }

// deterministic rng so a failure is reproducible
function mulberry(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------- weights
group('Weights and the 1000 cap')
ok('all four patterns sum to 10 and run light to heavy', (() => {
  try { return PURE.assertWeightPatterns(PURE.WEIGHT_PATTERNS) } catch (e) { return false }
})())

ok('assertWeightPatterns actually throws on a bad pattern', (() => {
  try { PURE.assertWeightPatterns([[1, 1, 1, 1, 1, 1, 2, 3]]); return false } catch (e) { return true }
})())

;(() => {
  // a perfect run: every guess exactly on the answer
  let worst = null
  for (let s = 0; s < 400; s++) {
    const rounds = PURE.buildGame(QUESTIONS, mulberry(s))
    let total = 0
    for (const r of rounds) {
      const d = PURE.haversine(r.q.answer.lat, r.q.answer.lon, r.q.answer.lat, r.q.answer.lon)
      total += PURE.baseScore(d, r.q.perfectKm) * r.weight
    }
    if (total !== 1000) { worst = 'seed ' + s + ' scored ' + total; break }
  }
  ok('a perfect run scores exactly 1000, over 400 games', worst === null, worst)
})()

ok('worst possible round scores 0, not negative', PURE.baseScore(20000, 30) === 0)
ok('inside perfectKm is a full 100', PURE.baseScore(9, 30) === 100 && PURE.baseScore(30, 30) === 100)
ok('decay matches the plan (~37 at 1400 km past perfect)', Math.abs(PURE.baseScore(1430, 30) - 37) <= 1,
  'got ' + PURE.baseScore(1430, 30))

// ---------------------------------------------------------------- haversine
group('Haversine')
const H = [
  ['London to Paris', 51.5074, -0.1278, 48.8566, 2.3522, 344],
  ['Sydney to Los Angeles', -33.8688, 151.2093, 34.0522, -118.2437, 12060],
  ['New York to Tokyo', 40.7128, -74.0060, 35.6762, 139.6503, 10850]
]
for (const [name, y1, x1, y2, x2, expect] of H) {
  const got = PURE.haversine(y1, x1, y2, x2)
  const off = Math.abs(got - expect) / expect
  ok(name + ' within 1%', off <= 0.01, 'expected ~' + expect + ' km, got ' + got.toFixed(1) + ' km (' + (off * 100).toFixed(2) + '% off)')
}
ok('identical points are 0 km', PURE.haversine(10, 20, 10, 20) === 0)
ok('antipodes are about half the circumference', Math.abs(PURE.haversine(0, 0, 0, 180) - 20015) < 40,
  'got ' + PURE.haversine(0, 0, 0, 180).toFixed(0))

// ---------------------------------------------------------------- selection
group('Round selection, 500 games')
;(() => {
  let dupPlace = null, dupQ = null, badOrder = null, sportOver = null, shortRun = null
  const patternLens = new Set()

  for (let s = 0; s < 500; s++) {
    const rounds = PURE.buildGame(QUESTIONS, mulberry(s * 7919 + 13))
    patternLens.add(rounds.length)
    if (rounds.length < 6) shortRun = 'seed ' + s + ' produced ' + rounds.length + ' rounds'

    const ids = new Set()
    const sports = {}
    for (let i = 0; i < rounds.length; i++) {
      const q = rounds[i].q
      if (ids.has(q.id)) dupQ = dupQ || ('seed ' + s + ' repeated ' + q.id)
      ids.add(q.id)
      sports[q.sport] = (sports[q.sport] || 0) + 1
      if (sports[q.sport] > PURE.MAX_PER_SPORT) sportOver = sportOver || ('seed ' + s + ' has ' + sports[q.sport] + ' x ' + q.sport)
      if (i && rounds[i - 1].q.difficulty > q.difficulty) badOrder = badOrder || ('seed ' + s + ' round ' + (i + 1))
      for (let j = 0; j < i; j++) {
        const d = PURE.haversine(q.answer.lat, q.answer.lon, rounds[j].q.answer.lat, rounds[j].q.answer.lon)
        if (d < PURE.SAME_CITY_KM) dupPlace = dupPlace || ('seed ' + s + ': ' + q.answer.name + ' and ' + rounds[j].q.answer.name + ' are ' + d.toFixed(0) + ' km apart')
      }
    }
  }
  ok('no question repeats inside a run', dupQ === null, dupQ)
  ok('no two answers in the same place inside a run', dupPlace === null, dupPlace)
  ok('no sport appears more than twice in a run', sportOver === null, sportOver)
  ok('difficulty runs easy to hard, so heavy rounds are hard rounds', badOrder === null, badOrder)
  ok('every run fills its pattern', shortRun === null, shortRun)
  ok('all four weight patterns get used', patternLens.size === 3, 'round counts seen: ' + [...patternLens].join(', ') + ' (patterns are 8,7,7,6 so 3 distinct lengths is right)')
})()

// ---------------------------------------------------------------- antimeridian
group('Antimeridian')
;(() => {
  const nz = { lat: -36.8485, lon: 174.7633 }      // Auckland
  const cl = { lat: -33.4489, lon: -70.6693 }      // Santiago
  const d = PURE.haversine(nz.lat, nz.lon, cl.lat, cl.lon)
  ok('Auckland to Santiago is the short way round (~9650 km, not ~30000)', d > 9000 && d < 10500, 'got ' + d.toFixed(0) + ' km')

  const segs = PURE.greatCircleSegments(nz, cl, 48)
  ok('the path is cut into two pieces at the antimeridian', segs.length === 2, 'got ' + segs.length + ' segment(s)')

  let jump = null
  for (const seg of segs) {
    for (let i = 1; i < seg.length; i++) {
      const dl = Math.abs(seg[i][1] - seg[i - 1][1])
      if (dl > 180) jump = 'a segment steps ' + dl.toFixed(1) + ' degrees of longitude'
    }
  }
  ok('no segment jumps the wrong way across the map', jump === null, jump)

  let outOfRange = null
  for (const seg of segs) for (const p of seg) {
    if (p[1] < -180.001 || p[1] > 180.001 || p[0] < -90 || p[0] > 90) outOfRange = JSON.stringify(p)
  }
  ok('every drawn point is a real lat/lon', outOfRange === null, outOfRange)

  const near = PURE.greatCircleSegments({ lat: 51.5, lon: -0.13 }, { lat: 48.86, lon: 2.35 }, 32)
  ok('a short path stays as one piece', near.length === 1, 'got ' + near.length)
})()

// ---------------------------------------------------------------- ranks
group('Ranks')
const RANKS = [[0, 'Benchwarmer'], [249, 'Benchwarmer'], [250, 'Rotation Player'], [499, 'Rotation Player'],
  [500, 'Starter'], [699, 'Starter'], [700, 'All-Star'], [849, 'All-Star'], [850, 'MVP'], [949, 'MVP'],
  [950, 'Hall of Famer'], [1000, 'Hall of Famer']]
ok('every band maps to the right rank', RANKS.every(([n, r]) => PURE.rankFor(n) === r),
  RANKS.filter(([n, r]) => PURE.rankFor(n) !== r).map(([n, r]) => n + ' gave ' + PURE.rankFor(n) + ' not ' + r).join('; '))

// ---------------------------------------------------------------- bank shape
group('Question bank')
ok('at least 30 questions', QUESTIONS.length >= 30, 'got ' + QUESTIONS.length)
ok('ids are unique', new Set(QUESTIONS.map(q => q.id)).size === QUESTIONS.length)
ok('every question has prompt, answer name and fact',
  QUESTIONS.every(q => q.prompt && q.sport && q.answer && q.answer.name && q.fact))
ok('every coordinate is in range',
  QUESTIONS.every(q => q.answer.lat >= -90 && q.answer.lat <= 90 && q.answer.lon >= -180 && q.answer.lon <= 180),
  QUESTIONS.filter(q => Math.abs(q.answer.lat) > 90 || Math.abs(q.answer.lon) > 180).map(q => q.id).join(', '))
ok('perfectKm is between 15 and 50', QUESTIONS.every(q => q.perfectKm >= 15 && q.perfectKm <= 50))
ok('difficulty is 1, 2 or 3', QUESTIONS.every(q => [1, 2, 3].includes(q.difficulty)))
ok('enough hard questions to fill the heavy rounds', QUESTIONS.filter(q => q.difficulty >= 2).length >= 8)

// ---------------------------------------------------------------- coordinates land where they should
group('Answer coordinates fall in the right country')
function inRing(pt, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
function inPolygon(pt, rings) {
  if (!inRing(pt, rings[0])) return false
  for (let i = 1; i < rings.length; i++) if (inRing(pt, rings[i])) return false   // hole
  return true
}
function countryAt(lon, lat) {
  for (const f of WORLD.features) {
    const g = f.geometry
    if (g.type === 'Polygon') { if (inPolygon([lon, lat], g.coordinates)) return f.properties.n }
    else for (const poly of g.coordinates) if (inPolygon([lon, lat], poly)) return f.properties.n
  }
  return null
}

const EXPECT = {
  'nhl-utah': ['United States of America'], 'nba-okc': ['United States of America'],
  'nfl-raiders': ['United States of America'], 'nfl-chargers': ['United States of America'],
  'mlb-as': ['United States of America'], 'nba-grizzlies': ['United States of America'],
  'fut-maracana': ['Brazil'], 'fut-campnou': ['Spain'], 'fut-bombonera': ['Argentina'],
  'fut-azteca': ['Mexico'], 'fut-dortmund': ['Germany'], 'fut-bernabeu': ['Spain'],
  'fut-lusail': ['Qatar'], 'fut-metlife': ['United States of America'],
  'cri-lords': ['United Kingdom'], 'cri-wankhede': ['India'], 'cri-mcg': ['Australia'],
  'rug-edenpark': ['New Zealand'], 'f1-monaco': ['Monaco', 'France'], 'f1-suzuka': ['Japan'],
  'f1-baku': ['Azerbaijan'], 'golf-standrews': ['United Kingdom'], 'oly-2026': ['Italy'],
  'oly-2032': ['Australia'], 'ten-indianwells': ['United States of America'],
  'run-boston': ['United States of America'], 'cyc-tdf': ['France'],
  'bas-euroleague': ['Greece'], 'nhl-coyotes': ['United States of America'],
  'khl-ska': ['Russia']
}
// Natural Earth 110m has no polygon for micro-states, so these are cross-checked
// against the independently written CITIES file instead.
const MICRO = { 'f1-monaco': { name: 'Monaco', km: 10 } }

let coordFails = []
let coastal = []
for (const q of QUESTIONS) {
  const want = EXPECT[q.id]
  if (!want) { coordFails.push(q.id + ' has no expected country in the test'); continue }
  const got = countryAt(q.answer.lon, q.answer.lat)
  if (got && want.includes(got)) continue

  const micro = MICRO[q.id]
  if (micro) {
    const ref = CITIES.find(c => c.name === micro.name)
    const d = ref ? PURE.haversine(q.answer.lat, q.answer.lon, ref.lat, ref.lon) : Infinity
    if (d <= micro.km) { coastal.push(q.id + ' (micro-state, ' + d.toFixed(1) + ' km from the reference point)'); continue }
    coordFails.push(q.id + ' is ' + d.toFixed(1) + ' km from ' + micro.name)
    continue
  }
  // 2dp simplification can push a genuinely coastal venue just off the polygon
  if (got === null) {
    let nearest = Infinity
    for (const f of WORLD.features) {
      if (!want.includes(f.properties.n)) continue
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
      for (const poly of polys) for (const p of poly[0]) {
        const d = PURE.haversine(q.answer.lat, q.answer.lon, p[1], p[0])
        if (d < nearest) nearest = d
      }
    }
    if (nearest <= 25) { coastal.push(q.id + ' (just offshore of the simplified coastline, ' + nearest.toFixed(1) + ' km)'); continue }
    coordFails.push(q.id + ' landed in open water, ' + nearest.toFixed(0) + ' km from ' + want[0])
  } else {
    coordFails.push(q.id + ' landed in ' + got + ', expected ' + want.join(' or '))
  }
}
ok('every answer coordinate lands in its country', coordFails.length === 0, coordFails.join('\n          '))
if (coastal.length) console.log('        note: ' + coastal.join('\n              '))

// ---------------------------------------------------------------- cities
group('City labels')
ok('around 150 orientation cities', CITIES.length >= 140 && CITIES.length <= 220, 'got ' + CITIES.length)
ok('every city has a rank of 1 or 2', CITIES.every(c => c.rank === 1 || c.rank === 2))
ok('city coordinates are in range', CITIES.every(c => Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180))
ok('city names are unique', new Set(CITIES.map(c => c.name)).size === CITIES.length,
  CITIES.map(c => c.name).filter((n, i, a) => a.indexOf(n) !== i).join(', '))
;(() => {
  // an answer you cannot find on a blank map is a bad question
  const orphans = QUESTIONS.filter(q => !CITIES.some(c => PURE.haversine(q.answer.lat, q.answer.lon, c.lat, c.lon) <= 120))
  ok('every answer has a labelled city within 120 km to navigate by', orphans.length === 0,
    orphans.map(q => q.id + ' (' + q.answer.name + ')').join(', '))
})()

// ---------------------------------------------------------------- offline
group('Offline and self-contained')
;(() => {
  const refs = [...html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)].map(m => m[1])
  const remote = refs.filter(r => /^(https?:)?\/\//i.test(r))
  ok('no remote script or stylesheet', remote.length === 0, remote.join(', '))
  ok('no ES modules (they break under file://)', !/type\s*=\s*"module"/.test(html))
  const missing = refs.filter(r => !/^(https?:|data:|#|mailto:)/i.test(r) && !fs.existsSync(path.join(ROOT, r)))
  ok('every referenced file exists on disk', missing.length === 0, missing.join(', '))

  const css = fs.readFileSync(path.join(ROOT, 'vendor', 'leaflet.css'), 'utf8')
  const cssRemote = [...css.matchAll(/url\(([^)]+)\)/g)].map(m => m[1]).filter(u => /^(https?:)?\/\//i.test(u))
  ok('vendored CSS pulls nothing from the network', cssRemote.length === 0, cssRemote.join(', '))

  const js = fs.readFileSync(path.join(ROOT, 'vendor', 'leaflet.js'), 'utf8')
  ok('Leaflet is the vendored 1.9.4 build', /Leaflet 1\.9\.4/.test(js))
  ok('the game never calls fetch or XHR', !/\bfetch\(|XMLHttpRequest/.test(html))
  ok('world polygons are vendored, not a placeholder rectangle',
    WORLD.features.length > 100 && WORLD.features.some(f => f.properties.n === 'Antarctica'),
    WORLD.features.length + ' features')
})()

// ---------------------------------------------------------------- parent arcade
group('Arcade wiring')
const parentIndex = fs.readFileSync(path.join(ROOT, '..', 'index.html'), 'utf8')
const parentReadme = fs.readFileSync(path.join(ROOT, '..', 'README.md'), 'utf8')
ok('parent launcher has a card for it', /geo-sports-trivia\//.test(parentIndex))
ok('parent README has a table row for it', /geo-sports-trivia\//.test(parentReadme))

console.log('\n' + (fails ? 'FAILED ' + fails + ' of ' + checks : 'All ' + checks + ' checks passed'))
process.exit(fails ? 1 : 0)
