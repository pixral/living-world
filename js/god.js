// God tools: the ways you can reach into the world. Each one makes a change
// and returns a message; how the world reacts is left to the simulation.

const TEMPERAMENTS = {
  random: {
    label: 'Unknown people',
    hint: 'A new people with a temperament of their own.',
    settlers: 0.25,
  },
  peaceful: {
    label: 'Peaceful traders',
    hint: 'Open, rich and unwarlike. They arrive knowing deep-sea sailing.',
    title: 'Merchant Republic',
    traits: { aggression: [0.03, 0.15], expansion: [0.3, 0.5], openness: [0.8, 0.95] },
    settlers: 0.3,
    army: 0.01,
    wealth: 0.06,
    tech: 'sailing',
  },
  warlike: {
    label: 'Warlike horde',
    hint: 'Aggressive and hungry for land. They arrive armed with iron weapons.',
    title: 'Horde',
    traits: { aggression: [0.85, 0.97], expansion: [0.7, 0.9], openness: [0.05, 0.25] },
    settlers: 0.5,
    zeal: 1,
    army: 0.1,
    wealth: 0.02,
    tech: 'iron',
  },
};

const SPAWN_SIZES = {
  small: { label: 'Small (a few provinces)', radius: 2 },
  large: { label: 'Large (a whole region)', radius: 4 },
};

// kill: share of people killed at the centre, fading to the edge.
// hunger: a famine left behind (radius, months, share starving per month).
const DISASTERS = {
  famine: {
    label: 'Famine',
    hint: 'The harvest fails across a wide area for a year and a half.',
    radius: 7,
    kill: 0,
    shock: 0.1,
    hunger: { radius: 7, months: 18, rate: 0.025 },
    color: '#d9a441',
  },
  earthquake: {
    label: 'Earthquake',
    hint: 'Kills up to 15% near the epicentre and wrecks treasuries.',
    radius: 5,
    kill: 0.15,
    wealth: 0.3,
    shock: 0.15,
    color: '#e6e9ee',
  },
  volcano: {
    label: 'Volcanic eruption',
    hint: 'Buries the land in rock and ash. At sea, it raises a new island.',
    radius: 3,
    kill: 0.6,
    shock: 0.2,
    hunger: { radius: 8, months: 12, rate: 0.015 },
    onWater: true,
    color: '#ff6b2c',
  },
  flood: {
    label: 'Great flood',
    hint: 'Drowns the coasts hardest, then ruins the next harvest.',
    radius: 6,
    kill: 0.08,
    shock: 0.1,
    hunger: { radius: 6, months: 8, rate: 0.02 },
    color: '#4fc3f7',
  },
};

// ---- New nations -------------------------------------------------------

function spawnNation(world, tile, temperamentKey, sizeKey) {
  const { owner, pop, cap, nations, rng } = world;
  if (isWater(world, tile)) return { ok: false, msg: 'A nation needs land. Click a continent or an island.' };
  const capitals = new Set(nations.filter((n) => n.alive).map((n) => n.capital));
  if (capitals.has(tile)) return { ok: false, msg: 'That is a capital. Pick a spot a little away from it.' };

  const temperament = TEMPERAMENTS[temperamentKey];
  const radius = SPAWN_SIZES[sizeKey].radius;

  // Spread out from the click across land, leaving other capitals alone.
  const region = [tile];
  const depth = new Map([[tile, 0]]);
  for (let q = 0; q < region.length; q++) {
    const i = region[q], d = depth.get(i);
    if (d >= radius) continue;
    for (let k = 0; k < 4; k++) {
      const j = NB[i * 4 + k];
      if (j < 0 || depth.has(j) || isWater(world, j) || capitals.has(j)) continue;
      depth.set(j, d + 1);
      region.push(j);
    }
  }

  const before = region.map((i) => owner[i]);
  const traits = temperament.traits
    ? Object.fromEntries(Object.entries(temperament.traits).map(([k, [lo, hi]]) => [k, rng.range(lo, hi)]))
    : undefined;
  const nation = createNation(world, tile, { title: temperament.title, traits, zeal: temperament.zeal });

  const victims = new Map();
  let regionPop = 0;
  // The newcomers bring their own people, who settle alongside anyone already there.
  region.forEach((i, k) => {
    const prev = before[k];
    if (prev >= 0) victims.set(prev, (victims.get(prev) || 0) + 1);
    pop[i] += cap[i] * temperament.settlers;
    owner[i] = nation.id;
    regionPop += pop[i];
  });
  if (pop[tile] < 5000) {
    regionPop += 5000 - pop[tile];
    pop[tile] = 5000;
  }

  nation.army = regionPop * (temperament.army ?? 0.02);
  nation.wealth = regionPop * (temperament.wealth ?? 0.03);
  if (temperament.tech) grantDiscovery(world, nation, temperament.tech, null, true);
  tallyNations(world);

  // The neighbours size up the newcomer. Those who lost land to it fight,
  // unless the newcomers are traders who bought their way in.
  for (const [id] of nation.neighbors) {
    const other = nations[id];
    const key = pairKey(nation.id, id);
    if (victims.has(id)) {
      if (temperamentKey === 'peaceful') {
        world.relations.set(key, 0.05);
      } else {
        world.relations.set(key, -0.7);
        declareWar(world, nation, other);
        remember(world, other, 'invaded', 0.6, nation.id);
      }
    } else if (temperamentKey === 'warlike') {
      world.relations.set(key, -0.5);
    } else if (temperamentKey === 'peaceful') {
      world.relations.set(key, 0.1 + 0.4 * other.traits.openness);
    } else {
      world.relations.set(key, (rng() - 0.5) * 0.4);
    }
  }
  tallyNations(world);

  const losers = [...victims.keys()].map((id) => nations[id]);
  const where = joinWords(losers.map(ref));
  const whereText = joinWords(losers.map((n) => n.name));
  let text, msg;
  if (temperamentKey === 'warlike') {
    text = losers.length
      ? `The ${ref(nation)} horde bursts into ${where}, armed with iron.`
      : `The ${ref(nation)} horde gathers in the wilderness, armed with iron.`;
    msg = losers.length ? `The ${nation.name} horde invades ${whereText}.` : `The ${nation.name} horde gathers in the wilderness.`;
  } else if (temperamentKey === 'peaceful') {
    text = losers.length
      ? `Traders found the ${nation.title} of ${ref(nation)}, buying land from ${where}.`
      : `Traders found the ${nation.title} of ${ref(nation)} on empty land.`;
    msg = `The ${nation.title} of ${nation.name} is founded.`;
  } else {
    text = losers.length
      ? `The ${nation.title} of ${ref(nation)} rises inside ${where} and fights for its land.`
      : `The ${nation.title} of ${ref(nation)} is founded in empty land.`;
    msg = `The ${nation.title} of ${nation.name} appears${losers.length ? ` inside ${whereText}` : ''}.`;
  }
  addLog(world, 'found', text);
  return { ok: true, msg, nation };
}

// ---- Disasters ---------------------------------------------------------

function strikeDisaster(world, tile, kind) {
  const def = DISASTERS[kind];
  const { owner, pop, coastal, nations } = world;
  const atSea = isWater(world, tile);
  if (atSea && !def.onWater) return { ok: false, msg: `${withArticle(def.label.toLowerCase(), true)} needs land. Click on land.` };

  let risen = false;
  if (kind === 'volcano') risen = raiseVolcano(world, tile, atSea);

  const area = tilesWithin(tile, def.radius);
  const deathsBy = new Map();
  const touched = new Map();
  let total = 0;
  for (const { i, d } of area) {
    const o = owner[i];
    if (o < 0) continue;
    touched.set(o, (touched.get(o) || 0) + 1);
    if (!def.kill) continue;
    let share = def.kill * (1 - (0.7 * d) / def.radius);
    if (kind === 'flood') share *= coastal[i] ? 1.6 : 0.5;
    const dead = pop[i] * Math.min(0.95, share);
    pop[i] -= dead;
    total += dead;
    deathsBy.set(o, (deathsBy.get(o) || 0) + dead);
  }

  // Nations reel in proportion to how hard they were hit.
  for (const [o, tiles] of touched) {
    const n = nations[o];
    const dead = deathsBy.get(o) || 0;
    const hit = clamp(Math.max(dead / Math.max(1, n.pop), tiles / Math.max(1, n.tiles) / 4) * 10, 0.2, 1);
    n.army *= 1 - dead / Math.max(1, n.pop);
    n.deathsThisYear += dead;
    n.stability = Math.max(0.02, n.stability - def.shock * hit);
    if (def.wealth && n.wealth > 0) n.wealth -= n.wealth * def.wealth * hit;
    if (kind !== 'famine') remember(world, n, 'disaster', hit * 0.8, -1, dead, def.label.toLowerCase());
  }

  const victims = [...touched.entries()].sort((a, b) => b[1] - a[1]).map(([o]) => nations[o]);
  const where = joinWords(victims.slice(0, 3).map(ref));
  const whereText = joinWords(victims.slice(0, 3).map((n) => n.name));

  if (def.hunger) {
    const h = def.hunger;
    startFamine(world, tile, h.radius, h.months, h.rate, kind, victims.slice(0, 3));
  }
  world.marks.push({ center: tile, radius: def.radius, kind, until: world.month + (def.hunger ? def.hunger.months : 18) });

  let text;
  if (kind === 'volcano' && atSea) {
    text = `A volcano rises from the sea${risen ? ', forming a new island' : ''}${victims.length ? ` off ${where}` : ''}.`;
  } else if (kind === 'famine') {
    text = victims.length ? `The harvest fails in ${where}. Famine begins.` : 'The harvest fails in the empty wilds.';
  } else {
    const what = withArticle(def.label.toLowerCase(), true);
    text = victims.length
      ? `${what} strikes ${where}, killing ${fmtNum(total)}.`
      : `${what} strikes the empty wilds.`;
  }
  addLog(world, 'disaster', text);

  let msg;
  if (risen) msg = `A volcano rises from the sea and forms a new island${total >= 1 ? `, killing ${fmtNum(total)} on nearby shores` : ''}.`;
  else if (kind === 'famine') msg = `Famine grips ${whereText || 'the wilds'}.`;
  else msg = `${def.label}${victims.length ? ` in ${whereText}: ${fmtNum(total)} dead` : ' in the wilds'}.`;
  return { ok: true, msg };
}

// Turn the vent into a mountain and its flanks into hills. At sea this
// builds a small island.
function raiseVolcano(world, tile, atSea) {
  const { terrain, shade } = world;
  const reach = atSea ? 1.5 : 1;
  for (const { i, d } of tilesWithin(tile, reach)) {
    const t = terrain[i];
    if (d === 0) terrain[i] = T.MOUNTAINS;
    else if (TERRAIN[t].water || t === T.GRASS || t === T.FOREST || t === T.JUNGLE || t === T.DESERT) terrain[i] = T.HILLS;
    else continue;
    shade[i] = d === 0 ? 0.2 : 0.08;
  }
  refreshTerrain(world, tile, reach);
  return atSea;
}

function startFamine(world, center, radius, months, rate, cause, victims) {
  const tiles = [], weights = [];
  for (const { i, d } of tilesWithin(center, radius)) {
    if (isWater(world, i)) continue;
    tiles.push(i);
    weights.push(1 - (0.6 * d) / radius);
  }
  world.events.push({ kind: 'famine', cause, left: months, rate, tiles, weights, deaths: 0, deathsBy: new Map(), victims });
}

// Lasting effects: famines starve people month by month until they lift.
function stepEvents(world) {
  if (world.events.length === 0 && world.marks.length === 0) return;
  const { owner, pop, nations } = world;
  for (const e of world.events) {
    for (let k = 0; k < e.tiles.length; k++) {
      const i = e.tiles[k], o = owner[i];
      if (o < 0) continue;
      // Full granaries save most of the people who would have starved.
      const dead = pop[i] * e.rate * e.weights[k] * (1 - 0.7 * nations[o].policy.granaries);
      pop[i] -= dead;
      e.deaths += dead;
      e.deathsBy.set(o, (e.deathsBy.get(o) || 0) + dead);
      nations[o].deathsThisYear += dead;
    }
    e.left--;
    if (e.left === 0) {
      for (const [o, dead] of e.deathsBy) {
        const n = nations[o];
        const share = dead / Math.max(1, n.pop + dead);
        if (share >= 0.003) remember(world, n, 'famine', clamp(share * 15, 0.2, 1), -1, dead);
      }
    }
    if (e.left === 0 && e.deaths >= 100) {
      const where = e.victims.length ? ` in ${joinWords(e.victims.map(ref))}` : '';
      const lead = { famine: 'The famine', volcano: 'The hunger after the eruption', flood: 'The hunger after the flood' }[e.cause];
      addLog(world, 'disaster', `${lead}${where} ends, having killed ${fmtNum(e.deaths)}.`);
    }
  }
  world.events = world.events.filter((e) => e.left > 0);
  world.marks = world.marks.filter((m) => m.until > world.month);
}

function withArticle(word, capital = false) {
  const a = /^[aeiou]/i.test(word) ? 'an' : 'a';
  return (capital ? a[0].toUpperCase() + a.slice(1) : a) + ' ' + word;
}

function joinWords(list) {
  if (list.length <= 1) return list.join('');
  return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
}
