/* =========================================================================
   FEATHER DASH — a voxel endless road-crosser
   Original art, code and sound. Built with Three.js (vendored, offline).
   ========================================================================= */
'use strict';

/* ---------------------------------------------------------------- helpers */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const choice = arr => arr[Math.floor(Math.random() * arr.length)];
// exponential smoothing that is frame-rate independent
const damp = (cur, target, k, dt) => lerp(cur, target, 1 - Math.pow(1 - k, dt * 60));

/* ------------------------------------------------------------- constants */
const GH = 8;                 // playable half-width in cells (x in [-GH, GH])
const SPAN = GH + 10;         // how far cars/logs travel off-field
const HOP_DUR = 0.16;         // seconds per hop
const HOP_H = 0.55;           // hop arc height
const LOG_TOP = 0.24;         // y of a log's top surface
const IDLE_LIMIT = 7.0;       // seconds of idling before the hawk comes

/* ------------------------------------------------------------------ audio */
const SND = (() => {
  let ctx = null, master = null;
  let muted = localStorage.getItem('fd_mute') === '1';

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(type, f0, f1, dur, vol, delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  let noiseBuf = null;
  function noise(dur, vol, f0, f1, delay = 0, hp = false) {
    if (!ctx) return;
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const flt = ctx.createBiquadFilter();
    flt.type = hp ? 'highpass' : 'lowpass';
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  return {
    unlock() { ensure(); },
    get muted() { return muted; },
    toggleMute() {
      muted = !muted;
      localStorage.setItem('fd_mute', muted ? '1' : '0');
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    hop()     { ensure(); tone('square', 660, 1180, 0.07, 0.16); },
    blocked() { ensure(); tone('square', 220, 160, 0.07, 0.14); },
    land()    { /* dust puff is visual only; keep hops crisp */ },
    coin()    { ensure(); tone('sine', 988, 988, 0.07, 0.22); tone('sine', 1319, 1319, 0.16, 0.22, 0.07); },
    splash()  {
      ensure();
      noise(0.45, 0.5, 1400, 220);
      tone('sine', 320, 82, 0.35, 0.35);
    },
    squash()  {
      ensure();
      noise(0.1, 0.55, 3000, 500, 0, true);
      tone('sine', 170, 55, 0.28, 0.55);
    },
    horn()    {
      ensure();
      tone('square', 392, 392, 0.22, 0.18);
      tone('square', 466, 466, 0.22, 0.18);
    },
    trainBell() { ensure(); tone('sine', 1245, 1240, 0.14, 0.2); tone('sine', 1245, 1240, 0.14, 0.2, 0.42); },
    trainHorn() {
      ensure();
      tone('sawtooth', 220, 214, 0.65, 0.16);
      tone('sawtooth', 277, 270, 0.65, 0.16);
      noise(1.1, 0.22, 320, 120);
    },
    hawk()    {
      ensure();
      tone('sawtooth', 1500, 520, 0.5, 0.2);
      tone('sawtooth', 1560, 560, 0.5, 0.12, 0.05);
    },
    milestone() {
      ensure();
      tone('square', 523, 523, 0.1, 0.18);
      tone('square', 659, 659, 0.1, 0.18, 0.1);
      tone('square', 784, 784, 0.2, 0.18, 0.2);
    },
    gameOver() {
      ensure();
      tone('square', 330, 330, 0.16, 0.2, 0.15);
      tone('square', 262, 262, 0.16, 0.2, 0.33);
      tone('square', 165, 160, 0.42, 0.2, 0.51);
    },
    click()   { ensure(); tone('square', 1900, 1400, 0.035, 0.12); },
  };
})();

/* ------------------------------------------------------------ three setup */
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd3ef);

const camera = new THREE.OrthographicCamera(-10, 10, 7, -7, 0.1, 80);
const CAM_OFF = new THREE.Vector3(-6.5, 10.5, -8);

function resize() {
  const a = window.innerWidth / window.innerHeight;
  const H = 6.6;
  camera.left = -H * a; camera.right = H * a;
  camera.top = H; camera.bottom = -H;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

scene.add(new THREE.AmbientLight(0xffffff, 0.62));
const sun = new THREE.DirectionalLight(0xfff4e0, 0.85);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -16; sun.shadow.camera.right = 16;
sun.shadow.camera.top = 16; sun.shadow.camera.bottom = -16;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 45;
sun.shadow.bias = -0.0004;
scene.add(sun);
scene.add(sun.target);

/* --------------------------------------------------- shared geo/materials */
const BOX = new THREE.BoxGeometry(1, 1, 1);
const matCache = new Map();
function mat(color) {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return matCache.get(color);
}
function box(color, sx, sy, sz, x, y, z, shadow = true) {
  const m = new THREE.Mesh(BOX, mat(color));
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  if (shadow) { m.castShadow = true; }
  return m;
}

/* --------------------------------------------------------------- palettes */
const C = {
  grassA: 0xa5d94e, grassB: 0x99cf44, grassDark: 0x6ea336,
  water: 0x4aa8e8, waterDark: 0x3183c2,
  road: 0x454b57, roadDark: 0x343943,
  rail: 0x82868e, railDark: 0x64686f,
  trunk: 0x8a5a2b, rock: 0xb7bdc6, rockDark: 0x8d939c,
  log: 0x9a672f, logEnd: 0xb98244,
  white: 0xffffff, black: 0x1b2430,
};
const FOLIAGE = [0x2f9e44, 0x37b24d, 0x2b8a3e];
const CAR_COLORS = [0xff5533, 0x2f9bff, 0xffd21f, 0x8e5bff, 0x39d05c, 0xff7ab8, 0xf2f4f8, 0xff8a00];

/* ------------------------------------------------------------ world state */
const world = new THREE.Group();
scene.add(world);
const fxRoot = new THREE.Group();
scene.add(fxRoot);

let rows = new Map();       // z (int) -> row object
let genZ = 0;               // next row z to generate
let roadStreak = 0, waterStreak = 0, grassStreak = 0, railStreak = 0;
let lastRoadDir = 1;

/* ----------------------------------------------------------- row builders */
function makeBase(colorMid, colorSide, z, ySize, yPos) {
  const g = new THREE.Group();
  const mid = box(colorMid, GH * 2 + 1, ySize, 1, 0, yPos, 0, false);
  mid.receiveShadow = true;
  const l = box(colorSide, 9, ySize, 1, -(GH + 5), yPos, 0, false);
  const r = box(colorSide, 9, ySize, 1, GH + 5, yPos, 0, false);
  g.add(mid, l, r);
  g.position.z = z;
  return g;
}

function makeTree(gx, big) {
  const t = new THREE.Group();
  const h = big ? rand(1.1, 1.9) : rand(0.6, 1.0);
  t.add(box(C.trunk, 0.28, 0.5, 0.28, 0, 0.25, 0));
  const f1 = choice(FOLIAGE), f2 = choice(FOLIAGE);
  t.add(box(f1, 0.85, h * 0.55, 0.85, 0, 0.4 + h * 0.27, 0));
  t.add(box(f2, 0.62, h * 0.45, 0.62, 0, 0.4 + h * 0.62, 0));
  t.add(box(f1, 0.4, h * 0.28, 0.4, 0, 0.4 + h * 0.9, 0));
  t.position.x = gx;
  return t;
}

function makeRock(gx) {
  const r = new THREE.Group();
  r.add(box(C.rock, 0.6, 0.35, 0.55, 0, 0.17, 0));
  r.add(box(C.rockDark, 0.35, 0.3, 0.3, 0.14, 0.34, 0.08));
  r.position.x = gx;
  r.rotation.y = rand(0, Math.PI);
  return r;
}

function makeCar(truck) {
  const g = new THREE.Group();
  const color = choice(CAR_COLORS);
  if (truck) {
    g.add(box(color, 0.9, 0.75, 0.85, -0.95, 0.55, 0));            // cab
    g.add(box(0xdfe3ea, 1.7, 0.95, 0.9, 0.5, 0.66, 0));            // trailer
    g.add(box(0x9fb6d0, 0.1, 0.28, 0.6, -1.36, 0.72, 0));          // windshield
    for (const wx of [-1.05, 0.05, 1.0])
      for (const wz of [-0.38, 0.38])
        g.add(box(C.black, 0.34, 0.34, 0.14, wx, 0.17, wz));
    g.userData.half = 1.45;
  } else {
    g.add(box(color, 1.55, 0.42, 0.8, 0, 0.4, 0));                 // body
    g.add(box(color, 0.85, 0.35, 0.72, -0.05, 0.76, 0));           // cabin
    g.add(box(0x9fd2e8, 0.6, 0.24, 0.74, -0.05, 0.76, 0));         // glass band
    g.add(box(0xfff6c8, 0.08, 0.14, 0.5, 0.79, 0.42, 0, false));   // headlights
    for (const wx of [-0.52, 0.52])
      for (const wz of [-0.36, 0.36])
        g.add(box(C.black, 0.32, 0.32, 0.14, wx, 0.16, wz));
    g.userData.half = 0.88;
  }
  return g;
}

function makeLog(cells) {
  const g = new THREE.Group();
  const len = cells - 0.16;
  const body = box(C.log, len, 0.3, 0.82, 0, 0.09, 0);
  body.receiveShadow = true;
  g.add(body);
  g.add(box(C.logEnd, 0.1, 0.24, 0.7, len / 2 - 0.02, 0.09, 0, false));
  g.add(box(C.logEnd, 0.1, 0.24, 0.7, -len / 2 + 0.02, 0.09, 0, false));
  g.userData.half = cells / 2;
  return g;
}

function makeTrain() {
  const g = new THREE.Group();
  const bodyC = 0xc23b3b, roofC = 0x8f2626;
  for (let i = 0; i < 5; i++) {
    const x = i * 2.6 - 5.2;
    g.add(box(i === 0 ? 0x394456 : bodyC, 2.35, 0.95, 0.92, x, 0.62, 0));
    g.add(box(roofC, 2.45, 0.16, 1.0, x, 1.16, 0));
    g.add(box(0xbfe3f2, 1.6, 0.3, 0.96, x, 0.82, 0, false));       // window band
  }
  g.userData.half = 6.6;
  return g;
}

function makeSignal(z) {
  const g = new THREE.Group();
  g.add(box(0x5a6270, 0.14, 1.5, 0.14, 0, 0.75, 0));
  g.add(box(0x2e3440, 0.6, 0.34, 0.16, 0, 1.35, 0));
  const lampOff = new THREE.MeshLambertMaterial({ color: 0x551b1b });
  const l1 = new THREE.Mesh(BOX, lampOff.clone());
  l1.scale.set(0.18, 0.18, 0.1); l1.position.set(-0.14, 1.35, 0.1);
  const l2 = new THREE.Mesh(BOX, lampOff.clone());
  l2.scale.set(0.18, 0.18, 0.1); l2.position.set(0.14, 1.35, 0.1);
  g.add(l1, l2);
  g.position.set(GH + 1.3, 0, z);
  g.userData.lamps = [l1, l2];
  return g;
}

function makeCoin(gx, z) {
  const g = new THREE.Group();
  const c = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.08, 14), mat(0xffc400));
  c.rotation.x = Math.PI / 2;
  c.castShadow = true;
  g.add(c);
  g.position.set(gx, 0.55, z);
  g.userData.spin = rand(0, Math.PI * 2);
  return g;
}

/* --------------------------------------------------------- row generation */
function pickRowType(z) {
  if (z < 6) return 'grass';
  const s = score;
  let w = {
    grass: grassStreak >= 3 ? 6 : 30,
    road: roadStreak >= 4 ? 0 : 34 + Math.min(14, s * 0.12),
    water: waterStreak >= 2 ? 0 : 22,
    rail: (z < 12 || railStreak >= 1) ? 0 : 10 + Math.min(10, s * 0.1),
  };
  let total = w.grass + w.road + w.water + w.rail;
  let r = Math.random() * total;
  for (const k of ['grass', 'road', 'water', 'rail']) {
    if (r < w[k]) return k;
    r -= w[k];
  }
  return 'grass';
}

function genRow() {
  const z = genZ++;
  const type = pickRowType(z);
  roadStreak = type === 'road' ? roadStreak + 1 : 0;
  waterStreak = type === 'water' ? waterStreak + 1 : 0;
  grassStreak = type === 'grass' ? grassStreak + 1 : 0;
  railStreak = type === 'rail' ? railStreak + 1 : 0;

  const row = { type, z, group: new THREE.Group(), obstacles: new Set(), cars: [], logs: [], coin: null };
  row.group.position.z = 0;

  if (type === 'grass') {
    row.group.add(makeBase(z % 2 ? C.grassA : C.grassB, C.grassDark, z, 0.4, -0.2));
    // border trees on the dark shoulders
    for (const side of [-1, 1]) {
      if (Math.random() < 0.75) {
        const t = makeTree(side * (GH + rand(1.5, 4)), true);
        t.position.z = z;
        row.group.add(t);
      }
    }
    if (z > 2) {
      const count = z < 6 ? randInt(0, 1) : randInt(0, 3);
      const free = [];
      for (let x = -GH; x <= GH; x++) free.push(x);
      for (let i = 0; i < count; i++) {
        const idx = randInt(0, free.length - 1);
        const gx = free.splice(idx, 1)[0];
        if (z < 8 && Math.abs(gx) < 2) continue;  // keep spawn lane clear
        row.obstacles.add(gx);
        const o = Math.random() < 0.75 ? makeTree(gx, Math.random() < 0.4) : makeRock(gx);
        o.position.z = z;
        row.group.add(o);
      }
      // coin
      if (Math.random() < 0.1) {
        const gx = randInt(-GH, GH);
        if (!row.obstacles.has(gx)) {
          row.coin = makeCoin(gx, z);
          row.group.add(row.coin);
        }
      }
    }
  }

  if (type === 'road') {
    row.group.add(makeBase(C.road, C.roadDark, z, 0.4, -0.2));
    // lane dashes between two adjacent roads
    const prev = rows.get(z - 1);
    if (prev && prev.type === 'road') {
      for (let x = -GH; x <= GH; x += 2) {
        const d = box(C.white, 0.62, 0.02, 0.1, x, 0.011, z - 0.5, false);
        row.group.add(d);
      }
    }
    row.dir = Math.random() < 0.6 ? -lastRoadDir : lastRoadDir;
    lastRoadDir = row.dir;
    row.speed = rand(2.0, 4.2) + Math.min(2.6, score * 0.02);
    const truckLane = Math.random() < 0.15;
    // pre-populate the lane so it's alive when reached
    let x = -SPAN + rand(0, 2);
    while (x < SPAN) {
      const truck = truckLane || Math.random() < 0.12;
      const car = makeCar(truck);
      car.rotation.y = row.dir > 0 ? 0 : Math.PI;
      car.position.set(x, 0, z);
      car.userData.truck = truck;
      row.cars.push(car);
      row.group.add(car);
      x += car.userData.half * 2 + rand(2.2, 6.5);
    }
    if (Math.random() < 0.07) {
      const gx = randInt(-GH, GH);
      row.coin = makeCoin(gx, z);
      row.group.add(row.coin);
    }
  }

  if (type === 'water') {
    row.group.add(makeBase(C.water, C.waterDark, z, 0.3, -0.29));
    row.dir = Math.random() < 0.5 ? 1 : -1;
    row.speed = rand(1.0, 2.1) + Math.min(1.2, score * 0.008);
    let x = -SPAN + rand(0, 2);
    while (x < SPAN) {
      const cells = choice([2, 3, 3, 4]);
      const log = makeLog(cells);
      log.position.set(x, 0, z);
      log.userData.phase = rand(0, Math.PI * 2);
      row.logs.push(log);
      row.group.add(log);
      x += cells + rand(1.6, 2.9);
    }
  }

  if (type === 'rail') {
    row.group.add(makeBase(C.rail, C.railDark, z, 0.4, -0.2));
    for (let x = -GH - 4; x <= GH + 4; x += 1) {
      row.group.add(box(0x6b4a2f, 0.7, 0.05, 0.26, x, 0.01, z, false));
    }
    for (const rz of [-0.28, 0.28]) {
      const rail = box(0xd7dbe2, (GH + 5) * 2, 0.06, 0.09, 0, 0.05, z, false);
      row.group.add(rail);
    }
    row.signal = makeSignal(z);
    row.group.add(row.signal);
    row.train = makeTrain();
    row.train.position.z = z;
    row.train.visible = false;
    row.group.add(row.train);
    row.trainState = 'idle';
    row.trainTimer = rand(1.5, 6);
    row.trainDir = Math.random() < 0.5 ? 1 : -1;
    row.hornPlayed = false;
  }

  rows.set(z, row);
  world.add(row.group);
}

function pruneRows(minZ) {
  for (const [z, row] of rows) {
    if (z < minZ) {
      world.remove(row.group);
      rows.delete(z);
    }
  }
}

/* ----------------------------------------------------------------- player */
function buildChicken() {
  const model = new THREE.Group();
  const white = 0xf7f7f2, wing = 0xe6e6df;
  model.add(box(white, 0.62, 0.5, 0.8, 0, 0.38, 0));            // body
  model.add(box(white, 0.44, 0.44, 0.44, 0, 0.8, 0.12));        // head
  model.add(box(0xe23b2e, 0.14, 0.18, 0.3, 0, 1.08, 0.1));      // comb
  model.add(box(0xff9d1f, 0.14, 0.1, 0.18, 0, 0.8, 0.42));      // beak
  model.add(box(0xe23b2e, 0.1, 0.13, 0.1, 0, 0.68, 0.38));      // wattle
  model.add(box(C.black, 0.06, 0.09, 0.09, 0.225, 0.86, 0.22, false)); // eyes
  model.add(box(C.black, 0.06, 0.09, 0.09, -0.225, 0.86, 0.22, false));
  model.add(box(wing, 0.1, 0.3, 0.52, 0.36, 0.42, -0.05));      // wings
  model.add(box(wing, 0.1, 0.3, 0.52, -0.36, 0.42, -0.05));
  model.add(box(white, 0.34, 0.3, 0.16, 0, 0.52, -0.46));       // tail
  model.add(box(0xff9d1f, 0.1, 0.14, 0.16, 0.15, 0.07, 0.05));  // feet
  model.add(box(0xff9d1f, 0.1, 0.14, 0.16, -0.15, 0.07, 0.05));
  return model;
}

const playerGroup = new THREE.Group();
const chicken = buildChicken();
playerGroup.add(chicken);
scene.add(playerGroup);

const player = {
  x: 0, row: 0, y: 0,
  state: 'idle',            // idle | hop | dead
  hop: null,
  onLog: null, logOffset: 0,
  facing: 0,
  queue: [],
  landSquash: 0,
  blockedT: 0,
};

/* -------------------------------------------------------------- particles */
const particles = [];
function spawnParticles(x, y, z, opts) {
  for (let i = 0; i < opts.count; i++) {
    const s = rand(opts.size * 0.6, opts.size * 1.3);
    const m = box(choice(opts.colors), s, s, s, x, y, z, false);
    fxRoot.add(m);
    particles.push({
      mesh: m,
      vx: rand(-1, 1) * opts.spread,
      vy: rand(opts.up * 0.4, opts.up),
      vz: rand(-1, 1) * opts.spread,
      spin: rand(-9, 9),
      life: rand(opts.life * 0.6, opts.life),
      t: 0,
      grav: opts.grav,
    });
  }
}
const feathers = (x, y, z) => spawnParticles(x, y, z, { count: 12, size: 0.14, colors: [0xf7f7f2, 0xe6e6df, 0xffffff], spread: 2.6, up: 4.2, life: 0.9, grav: 9 });
const splashFX = (x, z) => spawnParticles(x, 0.05, z, { count: 14, size: 0.12, colors: [0x7ec4f2, 0xb8e2fa, 0xffffff], spread: 1.8, up: 3.6, life: 0.7, grav: 10 });
const dustFX = (x, z) => spawnParticles(x, 0.08, z, { count: 4, size: 0.09, colors: [0xd9d4c8, 0xcfe8a8], spread: 1.1, up: 1.1, life: 0.35, grav: 4 });

const ripples = [];
function rippleFX(x, z) {
  for (let i = 0; i < 3; i++) {
    const geo = new THREE.RingGeometry(0.22, 0.3, 20);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.85 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, -0.11, z);
    fxRoot.add(m);
    ripples.push({ mesh: m, t: -i * 0.14, life: 0.7 });
  }
}

function updateFX(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.t += dt;
    if (p.t >= p.life) { fxRoot.remove(p.mesh); particles.splice(i, 1); continue; }
    p.vy -= p.grav * dt;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    if (p.mesh.position.y < 0.03) { p.mesh.position.y = 0.03; p.vy = 0; p.vx *= 0.9; p.vz *= 0.9; }
    p.mesh.rotation.x += p.spin * dt;
    p.mesh.rotation.z += p.spin * dt;
    const k = 1 - p.t / p.life;
    p.mesh.scale.setScalar(Math.max(0.01, k));
  }
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    r.t += dt;
    if (r.t < 0) continue;
    if (r.t >= r.life) { fxRoot.remove(r.mesh); ripples.splice(i, 1); continue; }
    const k = r.t / r.life;
    r.mesh.scale.setScalar(1 + k * 3.2);
    r.mesh.material.opacity = 0.85 * (1 - k);
  }
}

/* ------------------------------------------------------------------- hawk */
let hawk = null;
function buildHawk() {
  const g = new THREE.Group();
  g.add(box(0x6b4a2f, 0.5, 0.35, 0.95, 0, 0, 0));
  g.add(box(0x8a5a2b, 0.4, 0.3, 0.4, 0, 0.1, 0.55));
  g.add(box(0xffd21f, 0.12, 0.1, 0.2, 0, 0.05, 0.8));
  const w1 = box(0x5d4027, 1.1, 0.08, 0.5, 0.75, 0.1, 0);
  const w2 = box(0x5d4027, 1.1, 0.08, 0.5, -0.75, 0.1, 0);
  g.add(w1, w2);
  g.userData.wings = [w1, w2];
  return g;
}

/* ------------------------------------------------------------------ state */
let state = 'title';          // title | playing | dead
let score = 0;
let best = parseInt(localStorage.getItem('fd_best') || '0', 10);
let coins = parseInt(localStorage.getItem('fd_coins') || '0', 10);
let camFocusX = 0, camFocusZ = 0, camCreepZ = -3, creepOn = false;
let camShake = 0;
let lastMoveTime = 0;
let clockTime = 0;
let deathTimer = -1, deathKind = '';
let milestoneNext = 50;

const el = id => document.getElementById(id);
const scoreEl = el('score'), coinCountEl = el('coinCount'), coinPillEl = el('coinPill');

function updateHUD() {
  scoreEl.textContent = score;
  coinCountEl.textContent = coins;
}

function toast(text) {
  const t = el('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  t.style.animation = 'none';
  void t.offsetWidth;                    // restart the CSS animation
  t.style.animation = '';
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.add('hidden'), 1400);
}

function resetWorld() {
  for (const [, row] of rows) world.remove(row.group);
  rows.clear();
  for (const p of particles) fxRoot.remove(p.mesh);
  particles.length = 0;
  for (const r of ripples) fxRoot.remove(r.mesh);
  ripples.length = 0;
  if (hawk) { scene.remove(hawk.mesh); hawk = null; }

  genZ = -8;
  roadStreak = waterStreak = grassStreak = railStreak = 0;
  for (let i = 0; i < 34; i++) genRow();

  player.x = 0; player.row = 0; player.y = 0;
  player.state = 'idle'; player.hop = null;
  player.onLog = null; player.queue.length = 0;
  player.facing = 0; player.landSquash = 0; player.blockedT = 0;
  playerGroup.position.set(0, 0, 0);
  playerGroup.visible = true;
  chicken.rotation.set(0, 0, 0);
  chicken.scale.set(1, 1, 1);
  chicken.position.set(0, 0, 0);

  score = 0; milestoneNext = 50;
  camFocusX = 0; camFocusZ = 0; camCreepZ = -3; creepOn = false;
  camShake = 0; deathTimer = -1;
  lastMoveTime = clockTime;
  updateHUD();
}

function startGame() {
  state = 'playing';
  el('title').classList.add('hidden');
  el('gameover').classList.add('hidden');
  lastMoveTime = clockTime;
}

function showTitle() {
  resetWorld();
  state = 'title';
  el('bestLine').textContent = best > 0 ? 'BEST ' + best : '';
  el('title').classList.remove('hidden');
  el('gameover').classList.add('hidden');
}

/* ------------------------------------------------------------------ death */
function die(kind) {
  if (player.state === 'dead') return;
  player.state = 'dead';
  player.queue.length = 0;
  player.onLog = null;
  deathKind = kind;

  const px = playerGroup.position.x, pz = playerGroup.position.z;

  if (kind === 'car' || kind === 'train') {
    chicken.scale.set(1.7, 0.09, 1.7);
    chicken.position.y = 0;
    feathers(px, 0.4, pz);
    SND.squash();
    if (kind === 'car') SND.horn();
    camShake = 0.32;
    deathTimer = 0.75;
  } else if (kind === 'water') {
    splashFX(px, pz);
    rippleFX(px, pz);
    SND.splash();
    deathTimer = 0.95;
  } else if (kind === 'hawk') {
    deathTimer = 1.45;
  }
  SND.gameOver();
}

function finishDeath() {
  state = 'dead';
  const isBest = score > best;
  if (isBest) {
    best = score;
    localStorage.setItem('fd_best', String(best));
  }
  el('goTitle').textContent = deathKind === 'water' ? 'SPLASH!' : deathKind === 'hawk' ? 'SNATCHED!' : 'SPLAT!';
  el('goScore').textContent = score;
  el('goBest').textContent = 'BEST ' + best;
  el('newBest').classList.toggle('hidden', !isBest);
  el('gameover').classList.remove('hidden');
}

function launchHawk() {
  if (hawk || player.state === 'dead') return;
  const px = playerGroup.position.x, pz = playerGroup.position.z;
  const mesh = buildHawk();
  mesh.position.set(px + 2, 8, pz + 7);
  scene.add(mesh);
  hawk = { mesh, t: 0, phase: 'swoop', grabbed: false };
  SND.hawk();
}

function updateHawk(dt) {
  if (!hawk) return;
  hawk.t += dt;
  const m = hawk.mesh;
  const flap = Math.sin(clockTime * 26) * 0.7;
  m.userData.wings[0].rotation.z = flap;
  m.userData.wings[1].rotation.z = -flap;

  if (hawk.phase === 'swoop') {
    const k = clamp(hawk.t / 0.55, 0, 1);
    const e = k * k;                     // ease-in dive
    const px = playerGroup.position.x, pz = playerGroup.position.z;
    m.position.set(lerp(px + 2, px, e), lerp(8, 0.6, e), lerp(pz + 7, pz, e));
    m.lookAt(px, 0.5, pz);
    if (k >= 1) {
      hawk.phase = 'carry';
      hawk.t = 0;
      feathers(px, 0.6, pz);
      die('hawk');
    }
  } else {
    const k = hawk.t / 1.2;
    m.position.y += (5 + k * 6) * dt;
    m.position.z -= 7 * dt;
    m.position.x += 2.5 * dt;
    playerGroup.position.set(m.position.x, m.position.y - 0.55, m.position.z + 0.1);
    chicken.rotation.z = Math.sin(clockTime * 20) * 0.15;
  }
}

/* --------------------------------------------------------------- movement */
function surfaceY() {
  return player.onLog ? LOG_TOP : 0;
}

function tryMove(dx, dz) {
  if (state !== 'playing' || player.state !== 'idle') return false;
  const targetRow = player.row + dz;
  const row = rows.get(targetRow);
  if (!row) return false;

  const facing = dz > 0 ? 0 : dz < 0 ? Math.PI : dx > 0 ? Math.PI / 2 : -Math.PI / 2;

  // can't hop far behind the camera
  if (dz < 0 && targetRow < Math.ceil(camFocusZ - 3.5)) { blockedAnim(facing); return true; }

  let tx;
  if (row.type === 'water') {
    tx = player.x + dx;
    if (Math.abs(tx) > GH + 1.5) { blockedAnim(facing); return true; }
  } else {
    tx = clamp(Math.round(player.x) + dx, -GH, GH);
    if (dx !== 0 && tx === Math.round(player.x)) { blockedAnim(facing); return true; }
    if (row.obstacles.has(tx)) { blockedAnim(facing); return true; }
  }

  const fromLogY = surfaceY();
  player.onLog = null;
  player.hop = {
    t: 0,
    fromX: playerGroup.position.x,
    fromZ: playerGroup.position.z,
    fromY: fromLogY,
    toX: tx, toZ: targetRow,
    fromRot: chicken.rotation.y,
    toRot: facing,
  };
  player.state = 'hop';
  player.row = targetRow;
  player.facing = facing;
  lastMoveTime = clockTime;
  if (dz > 0 && !creepOn) creepOn = true;
  SND.hop();
  return true;
}

function blockedAnim(facing) {
  chicken.rotation.y = facing;
  player.facing = facing;
  player.blockedT = 0.14;
  lastMoveTime = clockTime;
  SND.blocked();
}

function landHop() {
  const h = player.hop;
  player.hop = null;
  player.state = 'idle';
  player.x = h.toX;
  playerGroup.position.x = h.toX;
  playerGroup.position.z = h.toZ;
  chicken.rotation.y = h.toRot;
  player.landSquash = 0.1;

  if (h.toZ > score) {
    score = h.toZ;
    scoreEl.classList.remove('pop');
    void scoreEl.offsetWidth;
    scoreEl.classList.add('pop');
    updateHUD();
    if (score >= milestoneNext) {
      toast(milestoneNext + '!');
      SND.milestone();
      milestoneNext += 50;
    }
  }

  const row = rows.get(h.toZ);
  if (!row) return;

  if (row.type === 'water') {
    // find a log under our feet
    let found = null;
    for (const log of row.logs) {
      if (Math.abs(h.toX - log.position.x) <= log.userData.half + 0.25) { found = log; break; }
    }
    if (found) {
      player.onLog = found;
      player.logOffset = h.toX - found.position.x;
      dustFX(h.toX, h.toZ);
    } else {
      playerGroup.position.y = -0.1;
      chicken.scale.set(0.9, 0.6, 0.9);
      die('water');
      return;
    }
  } else {
    dustFX(h.toX, h.toZ);
    if (row.coin) {
      const c = row.coin;
      if (Math.round(c.position.x) === Math.round(h.toX)) {
        row.group.remove(c);
        row.coin = null;
        coins++;
        localStorage.setItem('fd_coins', String(coins));
        SND.coin();
        coinPillEl.classList.remove('pop');
        void coinPillEl.offsetWidth;
        coinPillEl.classList.add('pop');
        spawnParticles(h.toX, 0.6, h.toZ, { count: 7, size: 0.09, colors: [0xffc400, 0xffe873], spread: 1.6, up: 2.6, life: 0.5, grav: 6 });
        updateHUD();
      }
    }
  }
}

/* ------------------------------------------------------------ world tick */
function updateRows(dt) {
  for (const [z, row] of rows) {
    if (row.type === 'road') {
      for (const car of row.cars) {
        car.position.x += row.dir * row.speed * dt;
        // respawn behind the tail car so wrapping never stacks vehicles
        if (row.dir > 0 && car.position.x > SPAN) {
          const tail = Math.min(...row.cars.map(c => c.position.x));
          car.position.x = Math.min(-SPAN, tail - car.userData.half * 2 - rand(2.2, 6.5));
        }
        if (row.dir < 0 && car.position.x < -SPAN) {
          const tail = Math.max(...row.cars.map(c => c.position.x));
          car.position.x = Math.max(SPAN, tail + car.userData.half * 2 + rand(2.2, 6.5));
        }
      }
    } else if (row.type === 'water') {
      for (const log of row.logs) {
        log.position.x += row.dir * row.speed * dt;
        if (row.dir > 0 && log.position.x > SPAN) {
          const tail = Math.min(...row.logs.map(l => l.position.x));
          log.position.x = Math.min(-SPAN, tail - log.userData.half * 2 - rand(1.6, 2.9));
        }
        if (row.dir < 0 && log.position.x < -SPAN) {
          const tail = Math.max(...row.logs.map(l => l.position.x));
          log.position.x = Math.max(SPAN, tail + log.userData.half * 2 + rand(1.6, 2.9));
        }
        log.position.y = Math.sin(clockTime * 2 + log.userData.phase) * 0.02;
      }
    } else if (row.type === 'rail') {
      row.trainTimer -= dt;
      const lamps = row.signal.userData.lamps;
      if (row.trainState === 'idle') {
        lamps[0].material.color.setHex(0x551b1b);
        lamps[1].material.color.setHex(0x551b1b);
        if (row.trainTimer <= 0) {
          row.trainState = 'warn';
          row.trainTimer = 1.5;
          // only ring the bell if it's near the action
          if (Math.abs(z - playerGroup.position.z) < 14) SND.trainBell();
        }
      } else if (row.trainState === 'warn') {
        const blink = Math.floor(clockTime * 5) % 2;
        lamps[0].material.color.setHex(blink ? 0xff2222 : 0x551b1b);
        lamps[1].material.color.setHex(blink ? 0x551b1b : 0xff2222);
        if (row.trainTimer <= 0) {
          row.trainState = 'run';
          row.train.visible = true;
          row.train.position.x = -row.trainDir * (SPAN + row.train.userData.half + 4);
          row.train.rotation.y = row.trainDir > 0 ? 0 : Math.PI;
          row.hornPlayed = false;
        }
      } else if (row.trainState === 'run') {
        const blink = Math.floor(clockTime * 5) % 2;
        lamps[0].material.color.setHex(blink ? 0xff2222 : 0x551b1b);
        lamps[1].material.color.setHex(blink ? 0x551b1b : 0xff2222);
        row.train.position.x += row.trainDir * 26 * dt;
        if (!row.hornPlayed && Math.abs(row.train.position.x) < SPAN && Math.abs(z - playerGroup.position.z) < 14) {
          row.hornPlayed = true;
          SND.trainHorn();
        }
        if (Math.abs(row.train.position.x) > SPAN + row.train.userData.half + 5) {
          row.train.visible = false;
          row.trainState = 'idle';
          row.trainTimer = rand(4, 10);
        }
      }
    }
    if (row.coin) {
      row.coin.userData.spin += dt * 3.2;
      row.coin.rotation.y = row.coin.userData.spin;
      row.coin.position.y = 0.55 + Math.sin(clockTime * 3 + z) * 0.06;
    }
  }
}

function checkCollisions() {
  if (player.state === 'dead') return;
  const px = playerGroup.position.x;
  const pz = playerGroup.position.z;
  for (const [z, row] of rows) {
    if (Math.abs(z - pz) > 0.55) continue;
    if (row.type === 'road') {
      for (const car of row.cars) {
        if (Math.abs(px - car.position.x) < car.userData.half + 0.12) {
          playerGroup.position.z = z;      // pin the pancake to the lane
          die('car');
          return;
        }
      }
    } else if (row.type === 'rail' && row.trainState === 'run') {
      if (Math.abs(px - row.train.position.x) < row.train.userData.half + 0.15) {
        playerGroup.position.z = z;
        die('train');
        return;
      }
    }
  }
}

function updatePlayer(dt) {
  if (player.state === 'dead') return;

  // riding a log
  if (player.onLog) {
    playerGroup.position.x = player.onLog.position.x + player.logOffset;
    player.x = playerGroup.position.x;
    playerGroup.position.y = LOG_TOP + player.onLog.position.y;
    if (Math.abs(player.x) > GH + 1.2) {
      splashFX(player.x, playerGroup.position.z);
      rippleFX(player.x, playerGroup.position.z);
      playerGroup.position.y = -0.1;
      die('water');
      return;
    }
  }

  if (player.state === 'hop') {
    const h = player.hop;
    h.t += dt;
    const k = clamp(h.t / HOP_DUR, 0, 1);
    const toY = 0;   // target height resolved on land (logs re-attach there)
    playerGroup.position.x = lerp(h.fromX, h.toX, k);
    playerGroup.position.z = lerp(h.fromZ, h.toZ, k);
    playerGroup.position.y = lerp(h.fromY, toY, k) + Math.sin(k * Math.PI) * HOP_H;
    // stretch in the air
    const s = 1 + Math.sin(k * Math.PI) * 0.18;
    chicken.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
    // turn to face the hop direction over the first half
    let d = h.toRot - h.fromRot;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    chicken.rotation.y = h.fromRot + d * clamp(k * 2, 0, 1);
    if (k >= 1) landHop();
  } else {
    // process queued moves
    if (player.queue.length && player.state === 'idle') {
      const mv = player.queue.shift();
      tryMove(mv[0], mv[1]);
    }
    // idle breathing + land squash + blocked wiggle
    if (player.landSquash > 0) {
      player.landSquash -= dt;
      const k = clamp(player.landSquash / 0.1, 0, 1);
      const s = 1 - k * 0.18;
      chicken.scale.set(1 + k * 0.14, s, 1 + k * 0.14);
    } else if (player.blockedT > 0) {
      player.blockedT -= dt;
      const k = clamp(player.blockedT / 0.14, 0, 1);
      chicken.scale.set(1 + k * 0.1, 1 - k * 0.12, 1 + k * 0.1);
    } else if (state === 'playing' || state === 'title') {
      chicken.scale.set(1, 1 + Math.sin(clockTime * 3.2) * 0.018, 1);
    }
    if (!player.onLog) playerGroup.position.y = 0;
  }

  checkCollisions();

  // hawk pressure: idling too long, or falling behind the camera
  if (state === 'playing' && !hawk) {
    if (clockTime - lastMoveTime > IDLE_LIMIT) launchHawk();
    else if (playerGroup.position.z < camFocusZ - 5.5) launchHawk();
  }
}

/* ----------------------------------------------------------------- camera */
function updateCamera(dt, snap) {
  if (creepOn && state === 'playing' && player.state !== 'dead') {
    camCreepZ += (0.45 + Math.min(1.0, score * 0.006)) * dt;
  }
  const followZ = Math.max(playerGroup.position.z, camCreepZ);
  camFocusZ = snap ? followZ : Math.max(camCreepZ, damp(camFocusZ, followZ, 0.12, dt));
  const tx = clamp(playerGroup.position.x * 0.55, -4.5, 4.5);
  camFocusX = snap ? tx : damp(camFocusX, tx, 0.08, dt);

  let sx = 0, sy = 0;
  if (camShake > 0) {
    camShake -= dt;
    const k = camShake * 0.9;
    sx = rand(-k, k); sy = rand(-k, k);
  }

  camera.position.set(camFocusX + CAM_OFF.x + sx, CAM_OFF.y + sy, camFocusZ + CAM_OFF.z);
  camera.lookAt(camFocusX + sx, 0, camFocusZ + 2.4);

  sun.position.set(playerGroup.position.x - 6, 13, playerGroup.position.z - 4);
  sun.target.position.set(playerGroup.position.x, 0, playerGroup.position.z + 2);
}

/* -------------------------------------------------------------- main loop */
let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  clockTime += dt;

  // keep the strip generated ahead and pruned behind
  while (genZ < player.row + 26) genRow();
  pruneRows(Math.min(player.row, Math.floor(camFocusZ)) - 12);

  updateRows(dt);
  updatePlayer(dt);
  updateHawk(dt);
  updateFX(dt);
  updateCamera(dt, false);

  if (deathTimer > 0) {
    deathTimer -= dt;
    if (deathKind === 'water' && playerGroup.position.y > -0.6) {
      playerGroup.position.y -= dt * 1.1;   // sink
    }
    if (deathTimer <= 0) { deathTimer = -1; finishDeath(); }
  }

  renderer.render(scene, camera);
}
updateCamera(0, true);
requestAnimationFrame(frame);

/* ------------------------------------------------------------------ input */
function queueMove(dx, dz) {
  SND.unlock();
  if (state === 'title') { startGame(); }
  if (state === 'dead') return;
  if (state !== 'playing') return;
  if (player.state === 'idle' && player.queue.length === 0) {
    tryMove(dx, dz);
  } else if (player.queue.length < 2 && player.state !== 'dead') {
    player.queue.push([dx, dz]);
  }
}

const KEYMAP = {
  ArrowUp: [0, 1], KeyW: [0, 1], Space: [0, 1],
  ArrowDown: [0, -1], KeyS: [0, -1],
  ArrowLeft: [1, 0], KeyA: [1, 0],
  ArrowRight: [-1, 0], KeyD: [-1, 0],
};

window.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.code === 'Space' && state === 'dead') { e.preventDefault(); restart(); return; }
  if (e.code === 'KeyR' && (state === 'dead' || state === 'playing')) { restart(); return; }
  const mv = KEYMAP[e.code];
  if (mv) {
    e.preventDefault();
    queueMove(mv[0], mv[1]);
  }
});

// touch: tap = forward, swipe = direction
let touchStart = null;
canvas.addEventListener('pointerdown', e => {
  touchStart = { x: e.clientX, y: e.clientY, t: performance.now() };
});
canvas.addEventListener('pointerup', e => {
  if (!touchStart) return;
  const dx = e.clientX - touchStart.x;
  const dy = e.clientY - touchStart.y;
  const dist = Math.hypot(dx, dy);
  touchStart = null;
  if (dist < 24) { queueMove(0, 1); return; }
  if (Math.abs(dx) > Math.abs(dy)) queueMove(dx < 0 ? 1 : -1, 0);
  else queueMove(0, dy < 0 ? 1 : -1);
});

function restart() {
  SND.click();
  resetWorld();
  startGame();
  updateCamera(0, true);
}

el('playBtn').addEventListener('click', restart);
el('muteBtn').addEventListener('click', () => {
  const m = SND.toggleMute();
  el('muteBtn').classList.toggle('muted', m);
  el('muteBtn').innerHTML = m ? '&#128263;' : '&#128266;';
  SND.click();
});
if (SND.muted) {
  el('muteBtn').classList.add('muted');
  el('muteBtn').innerHTML = '&#128263;';
}

/* -------------------------------------------------------------- autopilot */
/* Self-play demo mode: load the game with ?auto (or #auto) in the URL.
   Normal play is completely unaffected. */
if (/[?#]auto/.test(location.href)) {
  let restartPending = false;
  const autoSafe = (row, x) => {
    if (!row) return false;
    if (row.type === 'grass') return !row.obstacles.has(Math.round(x));
    if (row.type === 'road')
      return !row.cars.some(c => Math.abs(c.position.x + row.dir * row.speed * 0.35 - x) < c.userData.half + 1.2);
    if (row.type === 'rail') return row.trainState === 'idle' || (row.trainState === 'warn' && row.trainTimer > 0.6);
    if (row.type === 'water')
      return row.logs.some(l => Math.abs(x - (l.position.x + row.dir * row.speed * 0.18)) <= l.userData.half - 0.15);
    return true;
  };
  setInterval(() => {
    if (state === 'title') { queueMove(0, 1); return; }
    if (state === 'dead') {
      if (!restartPending) {
        restartPending = true;
        setTimeout(() => { restartPending = false; restart(); }, 1600);
      }
      return;
    }
    if (state !== 'playing' || player.state !== 'idle' || player.queue.length) return;
    const px = playerGroup.position.x;
    const cur = rows.get(player.row);
    const next = rows.get(player.row + 1);
    const danger =
      (cur && cur.type === 'road' && cur.cars.some(c => Math.abs(c.position.x + cur.dir * cur.speed * 0.55 - px) < c.userData.half + 1.0)) ||
      (cur && cur.type === 'rail' && cur.trainState !== 'idle') ||
      (player.onLog && Math.abs(px) > GH - 1);
    if (autoSafe(next, px)) { queueMove(0, 1); return; }
    for (const dx of (px > 0 ? [-1, 1] : [1, -1])) {   // sidestep toward center first
      if (autoSafe(cur, px + dx) && (danger || autoSafe(next, px + dx))) { queueMove(dx, 0); return; }
    }
    if (danger) {
      const back = rows.get(player.row - 1);
      if (autoSafe(back, px)) { queueMove(0, -1); return; }
      queueMove(0, 1);                                  // cornered — gun it
    }
  }, 170);
}

/* ------------------------------------------------------------------- boot */
showTitle();
updateHUD();
updateCamera(0, true);
