// Infections, modelled per tile as susceptible / infected / recovered people.
// Sickness spreads inside a province and leaks into neighbouring ones; it
// crosses borders less between closed nations and more between armies at war.

const DISEASE_PRESETS = {
  mild: {
    label: 'Mild: a seasonal fever',
    beta: 1.6, // infections per sick person per month, inside a province
    gamma: 0.9, // share of the sick who recover or die each month
    lethality: 0.004, // share of those leaving sickness who die
    spread: 0.5, // how strongly it leaks into neighbouring provinces
    waning: 1 / 240, // share of immunity lost each month
  },
  plague: {
    label: 'Plague: kills about a quarter',
    beta: 1.6,
    gamma: 0.6,
    lethality: 0.25,
    spread: 0.55,
    waning: 0,
  },
  deadly: {
    label: 'Apocalyptic: kills about half',
    beta: 3.2,
    gamma: 0.45,
    lethality: 0.55,
    spread: 0.65,
    waning: 0,
  },
};

function releaseDisease(world, tile, presetKey) {
  if (world.owner[tile] < 0 || world.pop[tile] < 50) return null;
  const preset = DISEASE_PRESETS[presetKey];
  const disease = {
    id: world.diseases.length,
    name: makeDiseaseName(world.rng, world.usedDiseaseNames),
    kind: presetKey,
    beta: preset.beta,
    gamma: preset.gamma,
    lethality: preset.lethality,
    spread: preset.spread,
    waning: preset.waning,
    active: true,
    start: world.month,
    end: -1,
    origin: tile,
    infected: 0,
    peak: 0,
    deaths: 0,
    reached: new Set(),
    inf: new Float32Array(MAP_N),
    rec: new Float32Array(MAP_N),
  };
  disease.inf[tile] = Math.max(20, world.pop[tile] * 0.02);
  const origin = world.nations[world.owner[tile]];
  disease.reached.add(origin.id);
  world.diseases.push(disease);
  addLog(world, 'plague', `The ${dref(disease)} breaks out in ${ref(origin)}.`);
  return disease;
}

function borderPermeability(world, a, b) {
  if (a < 0 || b < 0) return 0.5;
  // Armies on the march ignore quarantines.
  if (world.wars.has(pairKey(a, b))) return 1;
  const A = world.nations[a], B = world.nations[b];
  const open = 0.3 + 0.35 * (A.traits.openness + B.traits.openness);
  return A.closed || B.closed ? open * 0.05 : open;
}

function stepDiseases(world) {
  const { pop, owner, nations } = world;
  const frac = world.scratch;
  const fresh = world.scratch2;

  for (const d of world.diseases) {
    if (!d.active) continue;
    const { inf, rec } = d;
    // After five years the germ slowly loses its bite. Without this, a growing
    // world keeps feeding it new people and no outbreak would ever end.
    if (world.month - d.start > 60) {
      d.beta *= 0.995;
      d.spread *= 0.995;
    }
    for (let i = 0; i < MAP_N; i++) frac[i] = pop[i] > 1 ? inf[i] / pop[i] : 0;

    // New infections this month, from the sick at home and next door.
    for (let i = 0; i < MAP_N; i++) {
      const p = pop[i];
      fresh[i] = 0;
      if (p <= 1) continue;
      const o = owner[i];
      // A nation in quarantine also keeps its own people apart: fewer
      // gatherings at home, less travel between its provinces.
      const home = o >= 0 && nations[o].closed ? 1 - 0.65 * nations[o].policy.quarantine : 1;
      let nearby = 0;
      for (let k = 0; k < 4; k++) {
        const j = NB[i * 4 + k];
        if (j < 0 || frac[j] === 0) continue;
        nearby += owner[j] === o ? frac[j] * home : frac[j] * borderPermeability(world, o, owner[j]);
      }
      const force = d.beta * frac[i] * home + d.spread * nearby;
      const susceptible = p - inf[i] - rec[i];
      if (force > 0 && susceptible > 0) fresh[i] = susceptible * (1 - Math.exp(-force));
    }

    let total = 0, deaths = 0;
    const byNation = new Float64Array(nations.length);
    for (let i = 0; i < MAP_N; i++) {
      if (inf[i] === 0 && fresh[i] === 0) {
        if (rec[i] > 0) rec[i] = Math.min(pop[i], rec[i] * (1 - d.waning));
        continue;
      }
      const o = owner[i];
      const leaving = inf[i] * d.gamma;
      const dead = leaving * d.lethality * (o >= 0 ? nations[o].mods.medicine : 1);
      inf[i] += fresh[i] - leaving;
      rec[i] = (rec[i] + leaving - dead) * (1 - d.waning);
      pop[i] = Math.max(0, pop[i] - dead);
      // Fewer than one sick person means the chain of infection is broken here.
      if (inf[i] < 1) inf[i] = 0;
      const carried = inf[i] + rec[i];
      if (carried > pop[i]) {
        const k = pop[i] / carried;
        inf[i] *= k;
        rec[i] *= k;
      }
      deaths += dead;
      total += inf[i];
      if (o >= 0) {
        nations[o].deathsThisYear += dead;
        nations[o].sickDeaths += dead;
        nations[o].lastDisease = d.id;
        byNation[o] += inf[i];
      }
    }

    d.infected = total;
    d.deaths += deaths;
    d.peak = Math.max(d.peak, total);

    for (let o = 0; o < byNation.length; o++) {
      if (byNation[o] >= 1 && !d.reached.has(o)) {
        d.reached.add(o);
        addLog(world, 'plague', `The ${dref(d)} reaches ${ref(nations[o])}.`);
      }
    }

    if (total < 1) {
      d.active = false;
      d.end = world.month;
      d.inf = null;
      d.rec = null;
      const years = Math.max(1, Math.round((d.end - d.start) / 12));
      addLog(world, 'plague', `The ${dref(d)} burns out after ${years} year${years === 1 ? '' : 's'}, having killed ${fmtNum(d.deaths)}.`);
    }
  }
}
