// One month of history. Each system reads the world, nudges it a little, and
// the next month builds on the result. Nothing here is scripted: wars,
// collapses and new nations come out of these rules interacting.

function stepWorld(world) {
  world.month++;
  growPopulation(world);
  migrate(world);
  stepDiseases(world);
  stepEvents(world);
  expand(world);
  fight(world);
  tallyNations(world);
  runEconomy(world);
  runQuarantine(world);
  if (world.month % 12 === 0) runYear(world);
  buryFallen(world);
}

// Logistic growth: fast on empty farmland, flat at what the land can feed.
function growPopulation(world) {
  const { pop, cap, owner, nations } = world;
  const rate = 0.024 / 12;
  for (let i = 0; i < MAP_N; i++) {
    if (owner[i] < 0) continue;
    const c = cap[i] * nations[owner[i]].mods.food;
    if (c <= 1) {
      pop[i] *= 0.98;
      continue;
    }
    pop[i] += rate * pop[i] * (1 - pop[i] / c);
  }
}

// People drift from crowded provinces to emptier ones inside their own nation.
function migrate(world) {
  const { pop, cap, owner } = world;
  const delta = world.scratch;
  delta.fill(0);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = y * MAP_W + x, o = owner[i];
      if (o < 0) continue;
      if (x + 1 < MAP_W && owner[i + 1] === o) migratePair(pop, cap, delta, i, i + 1);
      if (y + 1 < MAP_H && owner[i + MAP_W] === o) migratePair(pop, cap, delta, i, i + MAP_W);
    }
  }
  for (let i = 0; i < MAP_N; i++) {
    if (delta[i] !== 0) pop[i] = Math.max(0, pop[i] + delta[i]);
  }
}

function migratePair(pop, cap, delta, i, j) {
  const ci = cap[i] + 1, cj = cap[j] + 1;
  const flow = 0.04 * (pop[i] / ci - pop[j] / cj) * Math.min(ci, cj);
  delta[i] -= flow;
  delta[j] += flow;
}

// Crowded border provinces send settlers into empty land next door, and
// coastal ones occasionally across the water.
function expand(world) {
  const { pop, cap, owner, terrain, coastal, nations, rng } = world;
  const claims = [];
  for (let i = 0; i < MAP_N; i++) {
    const o = owner[i];
    if (o < 0) continue;
    const n = nations[o];
    const crowding = pop[i] / (cap[i] * n.mods.food + 1);
    if (crowding < 0.05) continue;
    const drive = 0.08 * (0.5 + n.traits.expansion) * Math.sqrt(crowding) * n.stability;
    for (let k = 0; k < 4; k++) {
      const j = NB[i * 4 + k];
      if (j < 0 || owner[j] !== -1) continue;
      const t = TERRAIN[terrain[j]];
      if (!t.water && rng() < drive * t.ease) claims.push(i, j);
    }
    if (coastal[i] && rng() < drive * 0.04 * n.mods.sail) {
      const j = tileNear(i, n.mods.sail > 1 ? 14 : 7, rng);
      if (j >= 0 && owner[j] === -1 && coastal[j] && !isWater(world, j)) claims.push(i, j);
    }
  }
  for (let c = 0; c < claims.length; c += 2) {
    const from = claims[c], to = claims[c + 1];
    if (owner[to] !== -1) continue;
    owner[to] = owner[from];
    const settlers = pop[from] * 0.15;
    pop[from] -= settlers;
    pop[to] += settlers;
  }
}

function tileNear(i, radius, rng) {
  const x = (i % MAP_W) + rng.int(radius * 2 + 1) - radius;
  const y = Math.floor(i / MAP_W) + rng.int(radius * 2 + 1) - radius;
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return -1;
  return y * MAP_W + x;
}

// Along every front, each side tries to take the tile across the line. The
// side with more soldiers per front tile usually wins; rough terrain and
// capitals hold out longer.
function fight(world) {
  if (world.wars.size === 0) return;
  const { owner } = world;
  const captures = [];
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = y * MAP_W + x;
      if (owner[i] < 0) continue;
      if (x + 1 < MAP_W) battle(world, i, i + 1, captures);
      if (y + 1 < MAP_H) battle(world, i, i + MAP_W, captures);
    }
  }
  for (let c = 0; c < captures.length; c += 3) {
    const winner = captures[c], tile = captures[c + 1], loser = captures[c + 2];
    if (owner[tile] !== loser) continue;
    capture(world, world.nations[winner], world.nations[loser], tile);
  }
}

function battle(world, i, j, captures) {
  const { owner, terrain, nations, rng } = world;
  const a = owner[i], b = owner[j];
  if (b < 0 || a === b || !world.wars.has(pairKey(a, b))) return;
  const A = nations[a], B = nations[b];
  const sa = A.strength / Math.max(1, A.front);
  const sb = B.strength / Math.max(1, B.front);
  const adv = sa / (sa + sb + 1e-9);
  // Rough ground, capitals and the forts of a standing army all hold out longer.
  const holdJ = TERRAIN[terrain[j]].defense * (j === B.capital ? 0.4 : 1) * (1 - 0.3 * B.policy.militarism);
  const holdI = TERRAIN[terrain[i]].defense * (i === A.capital ? 0.4 : 1) * (1 - 0.3 * A.policy.militarism);
  if (rng() < 0.08 * adv * adv * holdJ) captures.push(a, j, b);
  else if (rng() < 0.08 * (1 - adv) * (1 - adv) * holdI) captures.push(b, i, a);
}

function capture(world, winner, loser, tile) {
  world.owner[tile] = winner.id;
  world.pop[tile] *= 0.88;
  // Plunder: the province's share of the loser's treasury, plus what can be carried off.
  const share = Math.max(0, loser.wealth) / Math.max(1, loser.tiles);
  loser.wealth -= share;
  winner.wealth += share + world.pop[tile] * 0.01;
  const war = world.wars.get(pairKey(winner.id, loser.id));
  if (war) war.gains[winner.id]++;
  if (tile === loser.capital) {
    loser.stability = Math.max(0.02, loser.stability - 0.2);
    // The court flees to the next city, which may fall too; tell that story once.
    if (war && !war.stormed.includes(winner.id)) {
      war.stormed.push(winner.id);
      addLog(world, 'war', `${ref(winner)} storms the capital of ${ref(loser)}.`);
      remember(world, loser, 'capital', 0.7, winner.id);
    }
  }
}

// Recount every nation from the map: people, land, sick, fronts, neighbours.
function tallyNations(world) {
  const { owner, pop, coastal, nations, diseases } = world;
  for (const n of nations) {
    if (!n.alive) continue;
    n.pop = 0;
    n.tiles = 0;
    n.coastal = 0;
    n.front = 0;
    n.infected = 0;
    n.sx = 0;
    n.sy = 0;
    n.best = -1;
    n.bestPop = -1;
    n.neighbors.clear();
    n.warCount = 0;
  }
  const active = diseases.filter((d) => d.active);
  let worldInfected = 0;

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = y * MAP_W + x, o = owner[i];
      if (o < 0) continue;
      const n = nations[o];
      n.pop += pop[i];
      n.tiles++;
      n.sx += x;
      n.sy += y;
      if (coastal[i]) n.coastal++;
      if (pop[i] > n.bestPop) {
        n.bestPop = pop[i];
        n.best = i;
      }
      for (const d of active) n.infected += d.inf[i];
      let front = false;
      for (let k = 0; k < 4; k++) {
        const j = NB[i * 4 + k];
        if (j < 0) continue;
        const o2 = owner[j];
        if (o2 < 0 || o2 === o) continue;
        n.neighbors.set(o2, (n.neighbors.get(o2) || 0) + 1);
        if (!front && world.wars.has(pairKey(o, o2))) front = true;
      }
      if (front) n.front++;
    }
  }

  for (const war of world.wars.values()) {
    nations[war.a].warCount++;
    nations[war.b].warCount++;
  }

  for (const n of nations) {
    if (!n.alive || n.tiles === 0) continue;
    worldInfected += n.infected;
    // A nation that lost its capital moves the court to its largest city.
    if (owner[n.capital] !== n.id) n.capital = n.best;
    const cx = Math.round(n.sx / n.tiles), cy = Math.round(n.sy / n.tiles);
    if (owner[cy * MAP_W + cx] === n.id) {
      n.lx = cx;
      n.ly = cy;
    } else {
      n.lx = n.capital % MAP_W;
      n.ly = Math.floor(n.capital / MAP_W);
    }
  }
  world.peakInfected = Math.max(world.peakInfected, worldInfected);
}

// Armies, treasuries and stability move a little every month.
function runEconomy(world) {
  for (const n of world.nations) {
    if (!n.alive) continue;
    const atWar = n.warCount > 0;
    const aggression = n.traits.aggression;

    const mobilisation =
      (atWar ? 0.03 + 0.02 * aggression : 0.006 + 0.008 * aggression) +
      n.zeal * (atWar ? 0.12 : 0.04) +
      n.policy.militarism * 0.02;
    n.army += (n.pop * mobilisation - n.army) * (atWar ? 0.08 : 0.03);
    if (atWar) n.army *= 0.99;

    const coastalShare = n.coastal / Math.max(1, n.tiles);
    // Closed borders choke trade; granaries cost a little to keep full.
    const income =
      n.pop * 0.001 * (0.4 + 0.6 * n.stability) * (1 + 0.3 * coastalShare) * n.mods.trade *
      (n.closed ? 0.8 : 1) * (1 - 0.05 * n.policy.granaries);
    const upkeep = n.army * (atWar ? 0.03 : 0.02) * (1 - 0.7 * n.zeal);
    // Courts, roads and corruption eat 1% of the treasury a month.
    n.wealth = n.wealth * (n.wealth > 0 ? 0.99 : 1) + income - upkeep;
    // Unpaid soldiers go home.
    if (n.wealth < 0) n.army *= 0.97;
    // A full treasury buys better-equipped soldiers.
    n.strength = n.army * n.mods.might * (1 + 0.5 * Math.tanh(Math.max(0, n.wealth) / (n.pop * 0.02 + 1)));

    let target = 0.85;
    target -= Math.max(0, n.tiles - 200) / 500;
    target -= n.warCount * 0.12;
    target -= Math.min(0.45, ((n.deathsThisYear + n.deathsLastYear) / Math.max(1, n.pop)) * 3);
    if (n.wealth < 0) target -= 0.2;
    n.stability += (clamp(target, 0.02, 1) - n.stability) * 0.03;
  }
}

function runYear(world) {
  const { nations, rng } = world;

  for (const a of nations) {
    if (!a.alive) continue;
    for (const [bid, border] of a.neighbors) {
      if (bid < a.id) continue;
      const b = nations[bid];
      const key = pairKey(a.id, bid);
      const war = world.wars.get(key);
      // Open societies warm to each other; long shared borders breed friction.
      // Old grudges and friendships fade by 8% a year.
      let drift = (a.traits.openness + b.traits.openness - 1) * 0.08 - 0.03 * Math.min(1, border / 40) + (rng() - 0.5) * 0.16;
      // Old wounds keep neighbours apart.
      drift -= 0.08 * grudgeBetween(a, b);
      if (war) drift -= 0.1;
      const rel = clamp((world.relations.get(key) ?? 0) * 0.92 + drift, -1, 1);
      world.relations.set(key, rel);
      if (!war && !inTruce(world, key)) {
        if (!considerWar(world, a, b, rel)) considerWar(world, b, a, rel);
      }
    }
  }

  for (const [key, war] of world.wars) considerPeace(world, key, war);
  spreadDiscoveries(world);
  runMinds(world);
  for (const n of nations.slice()) if (n.alive) considerRebellion(world, n);
  tallyNations(world);

  let total = 0;
  for (const n of nations) {
    if (!n.alive) continue;
    total += n.pop;
    n.deathsLastYear = n.deathsThisYear;
    n.zeal = n.zeal > 0.02 ? n.zeal * 0.95 : 0;
    n.deathsThisYear = 0;
    n.history.push(n.pop);
    if (n.history.length > 500) n.history.shift();
  }
  world.history.push({ year: yearOf(world.month), pop: total, infected: world.peakInfected });
  if (world.history.length > 1000) world.history.shift();
  world.peakInfected = 0;
}

const inTruce = (world, key) => (world.truces.get(key) ?? -1) > world.month;

function relationOf(world, a, b) {
  return world.relations.get(pairKey(a, b)) ?? 0;
}

// Aggressive nations attack neighbours they dislike and can beat, especially
// neighbours already busy fighting someone else.
function considerWar(world, a, b, rel) {
  if (a.warCount >= 2 || a.stability < 0.3) return false;
  let ratio = a.strength / (b.strength + 1);
  if (b.warCount > 0) ratio *= 1.3;
  const advantage = clamp((ratio - 0.9) / 1.2, 0, 1);
  // An old grudge is a reason of its own, and makes a nation readier to strike.
  const grudge = a.grudges.get(b.id) || 0;
  const grievance = Math.max((1 - rel) / 2, grudge);
  const chance = 0.35 * a.traits.aggression * grievance * advantage * a.stability * (1 + 1.5 * grudge);
  if (world.rng() >= chance) return false;
  declareWar(world, a, b);
  const reason = grudge >= 0.2 ? revengeReason(world, a, b) : null;
  addLog(
    world,
    'war',
    reason ? `${ref(a)}, remembering ${reason}, declares war on ${ref(b)}.` : `${ref(a)} declares war on ${ref(b)}.`
  );
  // Being attacked is remembered; being attacked by a friend, more so.
  if (rel > 0.25) remember(world, b, 'betrayed', 0.8, a.id);
  else remember(world, b, 'invaded', 0.5, a.id);
  return true;
}

function declareWar(world, a, b) {
  world.wars.set(pairKey(a.id, b.id), {
    a: a.id,
    b: b.id,
    start: world.month,
    gains: { [a.id]: 0, [b.id]: 0 },
    startTiles: { [a.id]: a.tiles, [b.id]: b.tiles },
    stormed: [],
  });
  a.warCount++;
  b.warCount++;
}

// Wars end when they drag on, when one side is losing badly, or when the
// money runs out.
function considerPeace(world, key, war) {
  const A = world.nations[war.a], B = world.nations[war.b];
  const years = (world.month - war.start) / 12;
  const lossA = war.gains[war.b] / Math.max(1, war.startTiles[war.a]);
  const lossB = war.gains[war.a] / Math.max(1, war.startTiles[war.b]);
  const broke = A.wealth < 0 || B.wealth < 0 ? 0.2 : 0;
  const exhaustion = Math.min(0.9, 0.05 + years * 0.06 + Math.max(lossA, lossB) * 0.8 + broke);
  if (world.rng() >= exhaustion) return;

  world.wars.delete(key);
  world.truces.set(key, world.month + 12 * (10 + world.rng.int(11)));
  world.relations.set(key, Math.min(relationOf(world, war.a, war.b), -0.2));
  const net = war.gains[war.a] - war.gains[war.b];
  if (Math.abs(net) >= 3) {
    const [w, l] = net > 0 ? [A, B] : [B, A];
    const gained = Math.abs(net);
    remember(world, w, 'victory', clamp((gained / Math.max(1, w.tiles)) * 5, 0.1, 1), l.id, gained);
    remember(world, l, 'defeat', clamp((gained / Math.max(1, war.startTiles[l.id])) * 3, 0.2, 1), w.id, gained);
  }
  if (Math.abs(net) < 3) {
    addLog(world, 'peace', `${ref(A)} and ${ref(B)} make peace with nothing gained.`);
  } else {
    const [w, l] = net > 0 ? [A, B] : [B, A];
    addLog(world, 'peace', `${ref(w)} wins its war against ${ref(l)}, keeping ${Math.abs(net)} provinces.`);
  }
}

// Large, unhappy nations crack: the populous province farthest from the
// capital leads its region into revolt, and a new nation is born at war.
function considerRebellion(world, n) {
  if (n.tiles < 14 || n.stability > 0.33) return;
  if (world.rng() > (0.33 - n.stability) * 1.5) return;
  const { owner, pop } = world;

  let seat = -1, best = -1;
  for (let i = 0; i < MAP_N; i++) {
    if (owner[i] !== n.id) continue;
    const score = tileDist(i, n.capital) * Math.sqrt(pop[i] + 1);
    if (score > best) {
      best = score;
      seat = i;
    }
  }
  if (seat < 0 || seat === n.capital) return;

  // Flood out from the seat through provinces nearer to it than to the capital.
  const maxSize = Math.floor(n.tiles * 0.45);
  const region = [seat];
  const seen = new Set(region);
  for (let q = 0; q < region.length && region.length < maxSize; q++) {
    const i = region[q];
    for (let k = 0; k < 4; k++) {
      const j = NB[i * 4 + k];
      if (j < 0 || seen.has(j) || owner[j] !== n.id || j === n.capital) continue;
      seen.add(j);
      if (tileDist(j, seat) < tileDist(j, n.capital)) region.push(j);
    }
  }
  if (region.length < 4) return;

  const rebel = createNation(world, seat, { parent: n, title: world.rng.pick(REBEL_TITLES), stability: 0.65 });
  let regionPop = 0;
  for (const t of region) {
    owner[t] = rebel.id;
    regionPop += pop[t];
  }
  const share = regionPop / Math.max(1, n.pop);
  rebel.army = n.army * share * 1.3;
  n.army *= 1 - share;
  rebel.wealth = Math.max(0, n.wealth * share);
  n.wealth -= rebel.wealth;
  world.relations.set(pairKey(n.id, rebel.id), -0.6);
  declareWar(world, n, rebel);
  remember(world, n, 'revolt', clamp((region.length / n.tiles) * 3, 0.2, 1), rebel.id, region.length);
  addLog(world, 'rebel', `Provinces of ${ref(n)} rise in revolt and proclaim the ${rebel.title} of ${ref(rebel)}.`);
}

function buryFallen(world) {
  for (const n of world.nations) {
    if (!n.alive || n.tiles > 0) continue;
    n.alive = false;
    n.fell = world.month;
    n.pop = 0;
    let conqueror = null;
    for (const [key, war] of world.wars) {
      if (war.a !== n.id && war.b !== n.id) continue;
      conqueror = world.nations[war.a === n.id ? war.b : war.a];
      world.wars.delete(key);
    }
    addLog(world, 'fall', conqueror ? `${ref(n)} falls to ${ref(conqueror)}.` : `${ref(n)} has vanished.`);
  }
}
