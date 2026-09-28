// The shape of the world: terrain generation, the first nations, and the
// bookkeeping (log, names) the simulation writes into.

const MAP_W = 160;
const MAP_H = 100;
const MAP_N = MAP_W * MAP_H;

// People one tile of perfect farmland can feed.
const TILE_CAP = 40000;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const T = { DEEP: 0, OCEAN: 1, GRASS: 2, FOREST: 3, JUNGLE: 4, DESERT: 5, HILLS: 6, MOUNTAINS: 7, TUNDRA: 8, SNOW: 9 };

// fert: people fed, as a share of TILE_CAP. ease: how readily settlers move in.
// defense: how easily the tile is conquered (lower is harder).
const TERRAIN = [
  { name: 'Deep ocean', color: [20, 45, 76], water: true, fert: 0, ease: 0, defense: 1 },
  { name: 'Ocean', color: [34, 74, 112], water: true, fert: 0, ease: 0, defense: 1 },
  { name: 'Grassland', color: [120, 156, 82], fert: 1.0, ease: 1.0, defense: 1.0 },
  { name: 'Forest', color: [64, 112, 62], fert: 0.55, ease: 0.6, defense: 0.7 },
  { name: 'Jungle', color: [46, 102, 66], fert: 0.45, ease: 0.4, defense: 0.55 },
  { name: 'Desert', color: [214, 192, 132], fert: 0.12, ease: 0.35, defense: 0.9 },
  { name: 'Hills', color: [142, 136, 94], fert: 0.45, ease: 0.6, defense: 0.5 },
  { name: 'Mountains', color: [128, 120, 112], fert: 0.06, ease: 0.15, defense: 0.25 },
  { name: 'Tundra', color: [152, 162, 140], fert: 0.15, ease: 0.45, defense: 0.9 },
  { name: 'Snow', color: [230, 236, 240], fert: 0.02, ease: 0.1, defense: 0.8 },
];

// Four neighbours per tile (left, right, up, down); -1 past the map edge.
const NB = (() => {
  const nb = new Int32Array(MAP_N * 4).fill(-1);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = y * MAP_W + x, k = i * 4;
      if (x > 0) nb[k] = i - 1;
      if (x < MAP_W - 1) nb[k + 1] = i + 1;
      if (y > 0) nb[k + 2] = i - MAP_W;
      if (y < MAP_H - 1) nb[k + 3] = i + MAP_W;
    }
  }
  return nb;
})();

const isWater = (world, i) => TERRAIN[world.terrain[i]].water;
const yearOf = (month) => Math.floor(month / 12);

function tileDist(a, b) {
  return Math.hypot((a % MAP_W) - (b % MAP_W), Math.floor(a / MAP_W) - Math.floor(b / MAP_W));
}

function createWorld(seed, nationCount = 20) {
  const rng = makeRng(seed);
  const world = {
    seed,
    rng,
    month: 0,
    terrain: new Uint8Array(MAP_N),
    elev: new Float32Array(MAP_N),
    shade: new Float32Array(MAP_N),
    cap: new Float32Array(MAP_N),
    soil: new Float32Array(MAP_N),
    coastal: new Uint8Array(MAP_N),
    landmass: new Int32Array(MAP_N).fill(-1),
    landSizes: [],
    // Bumped whenever the land itself changes, so the map repaints it.
    terrainVersion: 0,
    owner: new Int16Array(MAP_N).fill(-1),
    pop: new Float32Array(MAP_N),
    scratch: new Float32Array(MAP_N),
    scratch2: new Float32Array(MAP_N),
    nations: [],
    diseases: [],
    relations: new Map(),
    wars: new Map(),
    truces: new Map(),
    // Lasting effects of interventions (famines) and the rings drawn for them.
    events: [],
    marks: [],
    log: [],
    history: [],
    peakInfected: 0,
    hueOffset: rng() * 360,
    usedNames: new Set(),
    usedDiseaseNames: new Set(),
  };
  generateTerrain(world, rng);
  placeNations(world, rng, nationCount);
  tallyNations(world);
  addLog(world, 'found', `The world awakens with ${world.nations.length} young nations.`);
  return world;
}

function generateTerrain(world, rng) {
  const shape = makeNoise(rng), warp = makeNoise(rng), moist = makeNoise(rng), jitter = makeNoise(rng);
  const { elev, terrain, shade, cap, coastal } = world;

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = y * MAP_W + x;
      const fx = x / 36, fy = y / 36;
      // Warp the sample point so coastlines bend instead of following the noise grid.
      const wx = fx + 1.1 * (warp.fbm(fx * 0.7 + 3.1, fy * 0.7 + 7.7, 3) - 0.5);
      const wy = fy + 1.1 * (warp.fbm(fx * 0.7 + 9.4, fy * 0.7 + 1.3, 3) - 0.5);
      let h = shape.fbm(wx, wy, 6);
      // Sink the edges so the world is ringed by ocean.
      const dx = Math.abs(x / (MAP_W - 1) - 0.5) * 2;
      const dy = Math.abs(y / (MAP_H - 1) - 0.5) * 2;
      h -= 0.35 * smoothstep(0.6, 1, Math.max(dx, dy));
      elev[i] = h;
    }
  }

  // Sea level sits at a percentile, so every seed has a similar share of land.
  const sorted = Float32Array.from(elev).sort();
  const sea = sorted[Math.floor(MAP_N * 0.6)];
  world.seaLevel = sea;

  // Rank land by height and by moisture so the terrain thresholds below are
  // shares of the land ("the top 7% are mountains") rather than raw noise values.
  const land = [];
  for (let i = 0; i < MAP_N; i++) if (elev[i] >= sea) land.push(i);
  const heightRank = new Float32Array(MAP_N);
  land.sort((a, b) => elev[a] - elev[b]).forEach((i, r) => (heightRank[i] = r / land.length));
  const moistVal = new Float32Array(MAP_N);
  for (const i of land) moistVal[i] = moist.fbm((i % MAP_W) / 28 + 20, Math.floor(i / MAP_W) / 28 + 20, 4);
  const moistRank = new Float32Array(MAP_N);
  land.slice().sort((a, b) => moistVal[a] - moistVal[b]).forEach((i, r) => (moistRank[i] = r / land.length));

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = y * MAP_W + x;
      if (elev[i] < sea) {
        terrain[i] = elev[i] < sea - 0.06 ? T.DEEP : T.OCEAN;
        continue;
      }
      const h = heightRank[i], m = moistRank[i];
      const lat = Math.abs(y / (MAP_H - 1) - 0.5) * 2;
      const temp = 1 - lat * 1.05 - h * 0.22 + (jitter.fbm(x / 18, y / 18, 3) - 0.5) * 0.35;
      let t;
      if (h > 0.93) t = temp < 0.35 ? T.SNOW : T.MOUNTAINS;
      else if (temp < 0.1) t = T.SNOW;
      else if (temp < 0.26) t = T.TUNDRA;
      else if (h > 0.8) t = T.HILLS;
      else if (m < 0.22 && temp > 0.5) t = T.DESERT;
      else if (m > 0.72 && temp > 0.72) t = T.JUNGLE;
      else if (m > 0.56) t = T.FOREST;
      else t = T.GRASS;
      terrain[i] = t;
    }
  }

  const at = (x, y) => elev[clamp(y, 0, MAP_H - 1) * MAP_W + clamp(x, 0, MAP_W - 1)];
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = y * MAP_W + x;
      world.soil[i] = 0.85 + 0.3 * jitter.noise(x / 6 + 50, y / 6 + 50);
      if (TERRAIN[terrain[i]].water) {
        // Deeper water is darker.
        shade[i] = clamp((elev[i] - sea) * 2.5, -0.35, 0);
      } else {
        // Hillshade lit from the north-west.
        shade[i] = clamp((at(x + 1, y + 1) - at(x - 1, y - 1)) * 7, -0.28, 0.28);
      }
      settleTile(world, i);
    }
  }

  labelLandmasses(world);
}

// Work out whether a tile is coast and how many people it can feed.
function settleTile(world, i) {
  const { terrain, coastal, cap } = world;
  coastal[i] = 0;
  cap[i] = 0;
  if (TERRAIN[terrain[i]].water) return;
  for (let k = 0; k < 4; k++) {
    const j = NB[i * 4 + k];
    if (j >= 0 && TERRAIN[terrain[j]].water) coastal[i] = 1;
  }
  cap[i] = TERRAIN[terrain[i]].fert * TILE_CAP * world.soil[i] * (coastal[i] ? 1.2 : 1);
}

// Re-derive coast, food and landmasses after the land itself has changed.
function refreshTerrain(world, center, radius) {
  for (const { i } of tilesWithin(center, radius + 1)) settleTile(world, i);
  world.landmass.fill(-1);
  world.landSizes = [];
  labelLandmasses(world);
  world.terrainVersion++;
}

// Every tile within `radius` of `center`, with its distance.
function tilesWithin(center, radius) {
  const cx = center % MAP_W, cy = Math.floor(center / MAP_W);
  const r = Math.ceil(radius);
  const out = [];
  for (let y = Math.max(0, cy - r); y <= Math.min(MAP_H - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(MAP_W - 1, cx + r); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= radius) out.push({ i: y * MAP_W + x, d });
    }
  }
  return out;
}

function labelLandmasses(world) {
  const { landmass, landSizes } = world;
  for (let start = 0; start < MAP_N; start++) {
    if (landmass[start] >= 0 || isWater(world, start)) continue;
    const id = landSizes.length;
    const stack = [start];
    landmass[start] = id;
    let size = 0;
    while (stack.length) {
      const i = stack.pop();
      size++;
      for (let k = 0; k < 4; k++) {
        const j = NB[i * 4 + k];
        if (j >= 0 && landmass[j] < 0 && !isWater(world, j)) {
          landmass[j] = id;
          stack.push(j);
        }
      }
    }
    landSizes.push(size);
  }
}

function placeNations(world, rng, count) {
  const candidates = [];
  for (let i = 0; i < MAP_N; i++) {
    if (world.cap[i] >= TILE_CAP * 0.5 && world.landSizes[world.landmass[i]] >= 80) candidates.push(i);
  }
  shuffle(candidates, rng);

  // Spread capitals apart, relaxing the spacing until enough fit.
  const capitals = [];
  for (let minDist = 22; capitals.length < count && minDist >= 4; minDist -= 3) {
    for (const c of candidates) {
      if (capitals.length >= count) break;
      if (capitals.every((o) => tileDist(o, c) >= minDist)) capitals.push(c);
    }
  }

  for (const c of capitals) {
    const n = createNation(world, c);
    settleAround(world, n, c, 2);
  }
}

// Claim the unowned land within `radius` steps of a tile and put people on it.
function settleAround(world, nation, center, radius) {
  const { owner, pop, cap } = world;
  let frontier = [center];
  owner[center] = nation.id;
  pop[center] = cap[center] * 0.6;
  for (let step = 1; step <= radius; step++) {
    const next = [];
    for (const i of frontier) {
      for (let k = 0; k < 4; k++) {
        const j = NB[i * 4 + k];
        if (j < 0 || owner[j] !== -1 || isWater(world, j)) continue;
        owner[j] = nation.id;
        pop[j] = cap[j] * 0.3;
        next.push(j);
      }
    }
    frontier = next;
  }
}

function createNation(world, capital, opts = {}) {
  const rng = world.rng;
  const id = world.nations.length;
  const hue = (world.hueOffset + id * 137.508) % 360;
  const color = hslToRgb(hue, 0.55 + rng() * 0.2, 0.5 + rng() * 0.08);
  const parent = opts.parent;
  // Rebels inherit their parent's temperament, with a twist. Nations you
  // place can be handed a temperament outright.
  const trait = (k) =>
    opts.traits
      ? opts.traits[k]
      : parent
        ? clamp(parent.traits[k] + (rng() - 0.5) * 0.5, 0.05, 0.95)
        : 0.15 + rng() * 0.7;

  const nation = {
    id,
    name: makeNationName(rng, world.usedNames),
    title: opts.title || rng.pick(NATION_TITLES),
    color,
    css: `rgb(${color.join(',')})`,
    capital,
    parent: parent ? parent.id : -1,
    founded: world.month,
    fell: -1,
    alive: true,
    traits: {
      aggression: trait('aggression'),
      expansion: trait('expansion'),
      openness: trait('openness'),
    },
    army: 0,
    strength: 0,
    // Warrior spirit: extra soldiers who cost little to keep. Fades over a generation.
    zeal: opts.zeal ?? 0,
    wealth: 0,
    stability: opts.stability ?? 0.8,
    pop: 0,
    tiles: 0,
    coastal: 0,
    front: 0,
    infected: 0,
    warCount: 0,
    neighbors: new Map(),
    deathsThisYear: 0,
    deathsLastYear: 0,
    // Discoveries it knows (rebels keep their parent's), and their effects.
    tech: parent ? [...parent.tech] : [],
    mods: null,
    // What it has lived through, and the habits and grudges that came of it.
    // Rebels share their parent's history, but not its grudges.
    memory: parent ? parent.memory.map((m) => ({ ...m })) : [],
    policy: parent ? { ...parent.policy } : { quarantine: 0, militarism: 0, granaries: 0 },
    announced: new Set(parent ? parent.announced : []),
    grudges: new Map(),
    closed: false,
    closedFor: -1,
    quiet: 0,
    sickDeaths: 0,
    lastDisease: -1,
    lx: capital % MAP_W,
    ly: Math.floor(capital / MAP_W),
    history: [],
  };
  nation.born = { ...nation.traits };
  refreshMods(nation);
  world.nations.push(nation);
  world.owner[capital] = id;
  return nation;
}

// Chronicle entries embed {{n:ID}} and {{d:ID}} tokens so the UI can colour
// and link nation and disease names.
const ref = (nation) => `{{n:${nation.id}}}`;
const dref = (disease) => `{{d:${disease.id}}}`;

function addLog(world, kind, text) {
  world.logSeq = (world.logSeq || 0) + 1;
  world.log.push({ month: world.month, kind, text });
  if (world.log.length > 500) world.log.shift();
}
