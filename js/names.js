// Names for nations and diseases, built from syllables so every world is new.

const NAME_START = [
  'Ar', 'Bel', 'Cor', 'Dra', 'El', 'Fen', 'Gal', 'Hal', 'Is', 'Jor', 'Kal', 'Lor', 'Mar', 'Nor',
  'Or', 'Pel', 'Quel', 'Ros', 'Sar', 'Tal', 'Ul', 'Vel', 'Wen', 'Xan', 'Yr', 'Zan', 'Ost', 'Esk',
  'Tor', 'Val', 'Mir', 'Ash', 'Bran', 'Cal', 'Dun', 'Kess', 'Lys', 'Mor', 'Nam', 'Pra', 'Sil', 'Thal',
];
const NAME_LINK = ['r', 'n', 'l', 'v', 'd', 'th', 's', 'm', 'g'];
const NAME_END = [
  'ia', 'and', 'mark', 'heim', 'ora', 'os', 'ar', 'un', 'eth', 'ovia', 'esh', 'aria', 'und', 'ist',
  'avia', 'ea', 'oth', 'ium', 'yr', 'enna', 'ad', 'oria', 'ec', 'is', 'avar', 'ante', 'ol',
];

const NATION_TITLES = ['Kingdom', 'Realm', 'Duchy', 'Republic', 'Principality', 'Confederation', 'Dominion'];
const REBEL_TITLES = ['Free State', 'Republic', 'Commonwealth', 'League', 'Free Cities'];

function makeNationName(rng, used) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const start = rng.pick(NAME_START);
    const end = rng.pick(NAME_END);
    const link = /^[aeiou]/.test(end) && rng.chance(0.35) ? rng.pick(NAME_LINK) : '';
    const name = start + link + end;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = 'Land ' + used.size;
  used.add(fallback);
  return fallback;
}

const DISEASE_ADJ = ['Red', 'Grey', 'Black', 'Pale', 'Yellow', 'Crimson', 'Silent', 'Weeping', 'Burning', 'Blue', 'Shaking', 'Hollow'];
const DISEASE_NOUN = ['Fever', 'Cough', 'Pox', 'Plague', 'Sickness', 'Rot', 'Blight', 'Chill', 'Sweat', 'Flux'];

function makeDiseaseName(rng, used) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const name = rng.pick(DISEASE_ADJ) + ' ' + rng.pick(DISEASE_NOUN);
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  return 'Sickness ' + used.size;
}
