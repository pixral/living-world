// Memory and learning. Nations remember what happens to them, and those
// memories become habits: a nation scarred by plague learns to close its
// borders, one that was invaded keeps a standing army, one that starved
// builds granaries. Memories fade over generations, so habits fade with them
// unless something renews them. Nations also learn by watching their
// neighbours, and copy the habits of the ones doing well.

// Learned habits, each 0..1. `gain` is how readily memories turn into the
// habit: lessons add up, but with diminishing returns.
const POLICIES = {
  quarantine: { label: 'Quarantine', habit: 'habit of closing its borders to sickness', gain: 1.5 },
  militarism: { label: 'Standing army', habit: 'large standing army', gain: 0.9 },
  granaries: { label: 'Granaries', habit: 'granaries', gain: 1.5 },
};

// What each kind of memory teaches. `feeds` says which habits it builds,
// `drift` how it shifts temperament, `grudge` how much it is resented.
// `other` is a nation id, except for plague, where it is the disease id.
const MEMORY_KINDS = {
  plague: {
    feeds: { quarantine: 1 },
    drift: { openness: -0.05 },
    text: (m) => `Lost ${fmtPct(m.value)} of its people to the {{d:${m.other}}}`,
  },
  witnessed: {
    feeds: { quarantine: 0.5 },
    text: (m) => `Watched {{n:${m.other}}} suffer a plague`,
  },
  copied: {
    feeds: {},
    text: (m) => `Copied {{n:${m.other}}}'s ${POLICIES[m.label].habit}`,
  },
  invaded: {
    feeds: { militarism: 0.3 },
    grudge: 0.4,
    text: (m) => `Attacked by {{n:${m.other}}}`,
  },
  betrayed: {
    feeds: { militarism: 0.5 },
    grudge: 0.7,
    drift: { openness: -0.05 },
    text: (m) => `Betrayed by {{n:${m.other}}}, once a friend`,
  },
  defeat: {
    feeds: { militarism: 0.5 },
    grudge: 0.5,
    drift: { aggression: -0.04 },
    text: (m) => `Lost ${m.value} provinces in a war with {{n:${m.other}}}`,
  },
  capital: {
    feeds: { militarism: 0.5 },
    grudge: 0.4,
    text: (m) => `Its capital was stormed by {{n:${m.other}}}`,
  },
  victory: {
    feeds: {},
    drift: { aggression: 0.06 },
    text: (m) => `Won ${m.value} provinces from {{n:${m.other}}}`,
  },
  revolt: {
    feeds: {},
    grudge: 0.3,
    drift: { expansion: -0.08 },
    text: (m) => `Lost ${m.value} provinces to the {{n:${m.other}}} revolt`,
  },
  famine: {
    feeds: { granaries: 1 },
    text: (m) => `Famine killed ${fmtNum(m.value)} of its people`,
  },
  disaster: {
    feeds: { granaries: 0.5 },
    text: (m) => `Struck by ${withArticle(m.label)}`,
  },
};

const MEMORY_HALF_LIFE = 40; // years
const MAX_MEMORIES = 12;

function memoryStrength(world, m) {
  return m.weight * Math.pow(0.5, (world.month - m.month) / 12 / MEMORY_HALF_LIFE);
}

// Record something a nation lived through. A repeat of the same memory
// (same kind, same nation or disease) deepens the old one instead.
function remember(world, nation, kind, weight, other = -1, value = 0, label = '') {
  if (!nation.alive) return;
  const def = MEMORY_KINDS[kind];
  const old = nation.memory.find((m) => m.kind === kind && m.other === other && m.label === label);
  if (old) {
    old.weight = Math.min(1, memoryStrength(world, old) + weight * 0.7);
    old.value += value;
    old.month = world.month;
  } else {
    nation.memory.push({ kind, weight: Math.min(1, weight), other, value, label, month: world.month });
    if (nation.memory.length > MAX_MEMORIES) {
      let weakest = 0;
      nation.memory.forEach((m, k) => {
        if (memoryStrength(world, m) < memoryStrength(world, nation.memory[weakest])) weakest = k;
      });
      nation.memory.splice(weakest, 1);
    }
  }
  for (const [trait, amount] of Object.entries(def.drift || {})) {
    nation.traits[trait] = clamp(nation.traits[trait] + amount * weight, 0.02, 0.98);
  }
  if (def.grudge && other >= 0 && kind !== 'plague') {
    nation.grudges.set(other, Math.min(1, (nation.grudges.get(other) || 0) + def.grudge * (0.5 + 0.5 * weight)));
  }
}

// The strongest memory a nation holds about another, among the given kinds.
function worstMemoryOf(world, nation, otherId, kinds) {
  let best = null, bestS = 0;
  for (const m of nation.memory) {
    if (m.other !== otherId || !kinds.includes(m.kind)) continue;
    const s = memoryStrength(world, m);
    if (s > bestS) {
      best = m;
      bestS = s;
    }
  }
  return best;
}

// ---- Once a year: reflect, watch the neighbours, copy what works --------

function runMinds(world) {
  const alive = world.nations.filter((n) => n.alive);
  const sickShare = (n) => n.sickDeaths / Math.max(1, n.pop + n.sickDeaths);

  // Lessons from this year's plague deaths, at home and next door.
  for (const n of alive) {
    const share = sickShare(n);
    if (share >= 0.005 && n.lastDisease >= 0) {
      remember(world, n, 'plague', clamp(share * 6, 0.15, 1), n.lastDisease, share);
    }
    for (const [id] of n.neighbors) {
      const other = world.nations[id];
      const theirs = sickShare(other);
      // Watching a neighbour suffer teaches caution.
      if (share < 0.01 && theirs >= 0.04) remember(world, n, 'witnessed', Math.min(0.6, theirs * 4), id, theirs);
      // Seeing a neighbour's closed borders spare it teaches the habit itself.
      if (share >= 0.01 && theirs < share * 0.5 && other.policy.quarantine >= 0.3 && world.rng() < 0.3 + 0.5 * n.traits.openness) {
        remember(world, n, 'copied', other.policy.quarantine * 0.8, id, 0, 'quarantine');
      }
    }
  }

  for (const n of alive) imitate(world, n);
  for (const n of alive) reflect(world, n);

  for (const n of alive) {
    n.sickDeaths = 0;
    for (const [id, g] of n.grudges) {
      if (g * 0.96 < 0.05) n.grudges.delete(id);
      else n.grudges.set(id, g * 0.96);
    }
    n.memory = n.memory.filter((m) => memoryStrength(world, m) >= 0.03);
  }
}

// How well a nation is doing, as its neighbours see it: growth and calm.
function success(n) {
  const h = n.history;
  if (h.length < 2) return 0.5 * n.stability;
  const back = Math.min(15, h.length - 1);
  const then = h[h.length - 1 - back];
  const growth = then > 0 ? Math.log(Math.max(1, h[h.length - 1]) / then) / back : 0;
  return growth * 10 + 0.5 * n.stability;
}

// Look at the most successful neighbour; if it is clearly doing better,
// drift toward its temperament and maybe copy one of its habits.
function imitate(world, n) {
  let model = null, best = success(n) + 0.15;
  for (const [id] of n.neighbors) {
    const other = world.nations[id];
    const s = success(other);
    if (s > best) {
      best = s;
      model = other;
    }
  }
  if (!model) return;
  const pull = 0.04 * n.traits.openness;
  for (const t of ['aggression', 'expansion', 'openness']) n.traits[t] += (model.traits[t] - n.traits[t]) * pull;
  for (const p of Object.keys(POLICIES)) {
    if (model.policy[p] > n.policy[p] + 0.2 && world.rng() < 0.25 * (0.5 + n.traits.openness)) {
      remember(world, n, 'copied', model.policy[p] * 0.7, model.id, 0, p);
    }
  }
}

// Turn memories into habits. Fresh pain is learned fast; habits fade slowly
// as the memories behind them do.
function reflect(world, n) {
  const target = { quarantine: 0, militarism: 0, granaries: 0 };
  const cause = {};
  for (const m of n.memory) {
    const s = memoryStrength(world, m);
    const feeds = m.kind === 'copied' ? { [m.label]: 1 } : MEMORY_KINDS[m.kind].feeds;
    for (const [p, f] of Object.entries(feeds)) {
      target[p] += s * f;
      if (!cause[p] || s * f > cause[p].score) cause[p] = { m, score: s * f };
    }
  }
  for (const p of Object.keys(POLICIES)) {
    const goal = 1 - Math.exp(-POLICIES[p].gain * target[p]);
    const before = n.policy[p];
    n.policy[p] = goal > before ? before + (goal - before) * 0.5 : before - (before - goal) * 0.08;
    if (before < 0.5 && n.policy[p] >= 0.5 && !n.announced.has(p)) {
      n.announced.add(p);
      addLog(world, 'learn', lessonText(world, n, p, cause[p].m));
    }
    if (n.policy[p] < 0.25) n.announced.delete(p);
  }
}

function lessonText(world, n, policy, m) {
  const other = m.other >= 0 && m.kind !== 'plague' ? `{{n:${m.other}}}` : '';
  if (m.kind === 'copied') return `${ref(n)} copies ${other}'s ${POLICIES[policy].habit}.`;
  if (policy === 'quarantine') {
    return m.kind === 'plague'
      ? `Scarred by the {{d:${m.other}}}, ${ref(n)} resolves to close its borders at the first sign of sickness.`
      : `Having watched ${other} suffer, ${ref(n)} learns to guard its borders against sickness.`;
  }
  if (policy === 'militarism') {
    const why = {
      invaded: `the attack by ${other}`,
      betrayed: `the betrayal by ${other}`,
      defeat: `its defeat by ${other}`,
      capital: `the fall of its capital to ${other}`,
    }[m.kind];
    return `Remembering ${why}, ${ref(n)} keeps a large standing army.`;
  }
  return m.kind === 'famine'
    ? `After the famine, ${ref(n)} builds granaries against the next one.`
    : `After the ${m.label}, ${ref(n)} starts storing grain.`;
}

// ---- Every month: close or reopen borders against sickness --------------

function runQuarantine(world) {
  const anyActive = world.diseases.some((d) => d.active);
  for (const n of world.nations) {
    if (!n.alive) continue;
    const q = n.policy.quarantine;
    let threat = 0;
    if (anyActive) {
      threat = n.infected / Math.max(1, n.pop);
      for (const [id] of n.neighbors) {
        const o = world.nations[id];
        threat = Math.max(threat, o.infected / Math.max(1, o.pop));
      }
    }
    if (!n.closed) {
      // The more a nation fears sickness, the earlier it shuts the gates.
      if (q >= 0.15 && threat > 0.02 * (1 - q) * (1 - q) + 0.0002) {
        n.closed = true;
        n.quiet = 0;
        // Tell the story once per outbreak, not every time a wave passes.
        const outbreak = world.diseases.findLast((d) => d.active).id;
        if (n.closedFor === outbreak) continue;
        n.closedFor = outbreak;
        const scar = n.memory
          .filter((m) => m.kind === 'plague')
          .sort((a, b) => memoryStrength(world, b) - memoryStrength(world, a))[0];
        addLog(
          world,
          'learn',
          scar
            ? `${ref(n)}, remembering the {{d:${scar.other}}}, closes its borders as sickness spreads nearby.`
            : `${ref(n)} closes its borders as sickness spreads nearby.`
        );
      }
    } else if (threat < 0.0001) {
      if (++n.quiet >= 12) {
        n.closed = false;
        if (!anyActive) addLog(world, 'learn', `${ref(n)} reopens its borders.`);
      }
    } else {
      n.quiet = 0;
    }
  }
}

// How much a nation resents another, from either side.
function grudgeBetween(a, b) {
  return Math.max(a.grudges.get(b.id) || 0, b.grudges.get(a.id) || 0);
}

// The memory that makes a nation want revenge on another, as a phrase.
function revengeReason(world, a, b) {
  const m = worstMemoryOf(world, a, b.id, ['defeat', 'invaded', 'betrayed', 'capital', 'revolt']);
  if (!m) return null;
  const year = yearOf(m.month);
  return {
    defeat: `its defeat in year ${year}`,
    invaded: `the attack of year ${year}`,
    betrayed: `the betrayal of year ${year}`,
    capital: `the fall of its capital in year ${year}`,
    revolt: `the revolt of year ${year}`,
  }[m.kind];
}
