# Living World

A world that runs on its own. Nations are born, settle the land, grow, trade
insults, go to war, make peace, fall apart and rise again, all from a handful
of simple rules. You watch, and now and then you intervene.

## Running it

Double-click `index.html`. No install, no server, no build step.

Add `#seed=1234` to the address to replay a specific world. The same seed
always grows the same map and the same first nations.

**Keys:** `Space` pauses, `1`–`4` set the speed, `Esc` cancels a tool.
Shift-click keeps a tool active so you can use it several times.

## The world on its own

| System | What it does |
| --- | --- |
| Terrain | Continents from layered noise, with climate by latitude and height, and farmland, forest, desert, hills, mountains and snow |
| Population | Grows toward what the land can feed and drifts from crowded provinces to emptier ones |
| Expansion | Crowded border provinces settle empty land next door, and coastal ones settle across the water |
| Diplomacy | Open nations warm to each other, and long borders breed friction |
| War | Aggressive nations attack neighbours they dislike and can beat. Fronts move tile by tile, with rough terrain and capitals holding out longer |
| Economy | Taxes fill the treasury and armies drain it. A broke nation's soldiers go home |
| Stability | Falls with war, plague, debt and overextension. Large unhappy nations crack, and a region revolts to become a new nation |
| Knowledge | Discoveries spread to neighbours each year, faster between open, friendly nations. Iron weapons also spread through war |

Everything that matters ends up in the **Chronicle**.

## Memory and learning

Nations remember what happens to them, and their memories turn into habits.
Memories fade with a half-life of about 40 years, so habits fade too unless
something renews them.

| Memory | What it teaches |
| --- | --- |
| Losing people to a plague, or watching a neighbour suffer one | **Quarantine**: close the borders early when sickness is near, and keep people apart at home |
| Being attacked, betrayed, defeated or losing the capital | A **standing army** in peacetime, with fortified provinces, plus a **grudge** against the attacker |
| Famine or disaster | **Granaries**: most people who would have starved survive the next famine |
| Winning wars | More aggression |
| Losing wars or provinces to a revolt | Less aggression, or less appetite for land |

Nations also learn from each other. A nation copies the habits of a neighbour
that is growing faster and is more stable. A nation whose neighbour's closed
borders spared it from a plague copies that habit too. Grudges start revenge wars:
"Arec, remembering its defeat in year 212, declares war on Quelmavia."

**It works.** In tests, the same nations lost 10–20% of their people to a
second plague instead of 26–27% when their memories of the first were wiped.

The **Minds** map view colours nations by any learned habit or trait, so you
can watch ideas spread. A nation's panel shows its memories, habits and how
its temperament has drifted since it was founded.

## God tools (Intervene panel)

| Tool | What it does |
| --- | --- |
| Infection | Mild, plague or apocalyptic. It spreads province to province through susceptible, sick and recovered people, crosses closed borders slowly and war fronts quickly, and fades after a few decades |
| New nation | Unknown people, peaceful traders (who arrive with sailing) or a warlike horde (who arrive with iron weapons and warrior zeal). Drop one on empty land, or inside a nation to carve out a piece. Neighbours react: the ones who lost land fight back, unless traders bought it |
| Disaster | Famine, earthquake, volcanic eruption (raises a new island at sea) or great flood. Deaths, broken treasuries and shaken stability make the victims tempting targets |
| Discovery | Crop rotation (+30% food), iron weapons (+50% fighting strength), deep-sea sailing (trade and overseas settlers) or medicine (−60% infection deaths) |

## Files

| File | Role |
| --- | --- |
| `js/util.js` | Seeded randomness, noise and small helpers |
| `js/names.js` | Nation and disease name generators |
| `js/world.js` | Terrain generation, nation creation and the chronicle log |
| `js/sim.js` | The monthly tick: growth, migration, expansion, war, economy, diplomacy and revolts |
| `js/discoveries.js` | Discoveries, their effects and how they spread |
| `js/disease.js` | The infection model |
| `js/god.js` | New nations, disasters and famines |
| `js/mind.js` | Memory, learned habits, grudges, imitation and quarantine |
| `js/render.js` | Map drawing (Nations, Population, Disease and Minds views) |
| `js/ui.js` | Sidebar panels |
| `js/main.js` | Controls, input and the clock |

## Roadmap

- ~~**v1 – God tools**~~ done.
- ~~**v2 – Memory and learning**~~ done.
- **v3 – Leaders powered by Claude:** for big decisions, a nation's leader reads a briefing and decides in plain language.
