// Discoveries: knowledge a nation holds, what it does, and how it spreads.
// Knowledge travels between neighbours on its own, faster between open,
// friendly nations; iron weapons also spread by being used against you.

const DISCOVERIES = {
  farming: {
    label: 'Crop rotation',
    noun: 'crop rotation',
    effect: 'Its land feeds 30% more people.',
    mods: { food: 1.3 },
  },
  iron: {
    label: 'Iron weapons',
    noun: 'iron weapons',
    effect: 'Its soldiers fight 50% harder.',
    mods: { might: 1.5 },
  },
  sailing: {
    label: 'Deep-sea sailing',
    noun: 'deep-sea sailing',
    effect: 'Richer trade, and its settlers reach distant shores.',
    mods: { trade: 1.4, sail: 4 },
  },
  medicine: {
    label: 'Medicine',
    noun: 'medicine',
    effect: 'Infections kill 60% fewer of its people.',
    mods: { medicine: 0.4 },
  },
};

function refreshMods(nation) {
  const mods = { food: 1, might: 1, trade: 1, sail: 1, medicine: 1 };
  for (const key of nation.tech) {
    for (const [m, v] of Object.entries(DISCOVERIES[key].mods)) mods[m] *= v;
  }
  nation.mods = mods;
}

// Give a nation a discovery. `teacher` is the nation it learned from, if any.
function grantDiscovery(world, nation, key, teacher = null, quiet = false) {
  if (nation.tech.includes(key)) return false;
  nation.tech.push(key);
  refreshMods(nation);
  if (!quiet) {
    const noun = DISCOVERIES[key].noun;
    addLog(
      world,
      'discovery',
      teacher ? `${ref(nation)} learns ${noun} from ${ref(teacher)}.` : `${ref(nation)} discovers ${noun}.`
    );
  }
  return true;
}

// Once a year, knowledge seeps across borders.
function spreadDiscoveries(world) {
  const { nations, rng } = world;
  const lessons = [];
  for (const teacher of nations) {
    if (!teacher.alive || teacher.tech.length === 0) continue;
    for (const [id] of teacher.neighbors) {
      const pupil = nations[id];
      if (!pupil.alive) continue;
      const key = pairKey(teacher.id, id);
      const atWar = world.wars.has(key);
      const warmth = Math.max(0, world.relations.get(key) ?? 0);
      for (const tech of teacher.tech) {
        if (pupil.tech.includes(tech)) continue;
        let chance = 0.02 + 0.08 * pupil.traits.openness * (1 + warmth);
        if (atWar) chance = tech === 'iron' ? 0.15 : 0.01;
        if (rng() < chance) lessons.push([pupil, tech, teacher]);
      }
    }
  }
  for (const [pupil, tech, teacher] of lessons) grantDiscovery(world, pupil, tech, teacher);
}
