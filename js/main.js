// Wires the world, the map and the controls together and runs the clock.

// Months of history simulated per real second.
const SPEEDS = [
  { label: '1×', mps: 3 },
  { label: '3×', mps: 9 },
  { label: '10×', mps: 30 },
  { label: '30×', mps: 90 },
];

const app = {
  world: null,
  running: true,
  speed: 1,
  mode: 'political',
  // Which habit or trait the Minds view colours nations by.
  idea: 'quarantine',
  tool: 'inspect',
  // The choice made in each tool's dropdowns.
  options: { infect: 'plague', temperament: 'random', size: 'small', disaster: 'earthquake', discovery: 'farming' },
  selected: -1,
  hover: -1,
  dirty: true,
};

const renderer = new MapRenderer($('#map'));
const sidebar = new Sidebar(app);

function startWorld(seed) {
  app.world = createWorld(seed);
  app.selected = -1;
  app.hover = -1;
  renderer.setWorld(app.world);
  sidebar.reset();
  $('#seed').value = seed;
  try {
    history.replaceState(null, '', '#seed=' + seed);
  } catch {
    // Some browsers refuse history changes on file:// pages; the seed box still shows it.
  }
  app.dirty = true;
  sidebar.update();
}

const randomSeed = () => 100000 + Math.floor(Math.random() * 900000);

function seedFromHash() {
  const m = location.hash.match(/seed=(\d+)/);
  return m ? +m[1] : null;
}

// ---- Controls ----------------------------------------------------------

function setRunning(running) {
  app.running = running;
  $('#play').textContent = running ? 'Pause' : 'Play';
  $('#play').classList.toggle('paused', !running);
}

function setSpeed(i) {
  app.speed = i;
  document.querySelectorAll('#speeds button').forEach((b, k) => b.classList.toggle('on', k === i));
}

function setMode(mode) {
  app.mode = mode;
  document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  const legend = LEGENDS[mode];
  $('#legend').innerHTML = typeof legend === 'function' ? legend() : legend;
  if (mode === 'minds') {
    $('#idea').addEventListener('change', (e) => {
      app.idea = e.target.value;
      app.dirty = true;
    });
  }
  app.dirty = true;
}

function setTool(tool) {
  app.tool = tool;
  document.querySelectorAll('#tools button').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
  document.querySelectorAll('.tool-options').forEach((el) => (el.hidden = el.dataset.for !== tool));
  $('#map').classList.toggle('aiming', tool !== 'inspect');
  updateHint();
  app.dirty = true;
}

function updateHint() {
  const o = app.options;
  const hints = {
    inspect: 'Click a nation to see its story.',
    infect: 'Click anywhere people live.',
    nation: `${TEMPERAMENTS[o.temperament].hint} Click empty land to found it, or inside a nation to carve it out.`,
    disaster: `${DISASTERS[o.disaster].hint} Click where it should strike.`,
    discovery: `${DISCOVERIES[o.discovery].effect} Click a nation to give it.`,
  };
  $('#tool-hint').textContent = hints[app.tool] + (app.tool === 'inspect' ? '' : ' Shift-click to use it again, Esc to stop.');
}

function select(id) {
  app.selected = id;
  app.dirty = true;
  sidebar.update();
}

const LEGENDS = {
  political: `<span><i class="sw" style="background:#ffb000"></i>War front</span>
              <span><i class="sw" style="background:#eb2d2d"></i>Sickness</span>
              <span><i class="sw" style="background:#86b6ef"></i>Closed border</span>
              <span><i class="sw ring"></i>Disaster area</span>`,
  population: `<span>Empty</span><i class="ramp pop"></i><span>Crowded</span>`,
  disease: `<span><i class="sw" style="background:#f03232"></i>Sick</span>
            <span><i class="sw" style="background:#28aabe"></i>Recovered / immune</span>
            <span><i class="sw" style="background:#2c3038"></i>Never infected</span>`,
  minds: () => `<label class="idea-pick">Showing <select id="idea">${Object.entries(IDEAS)
    .map(([k, v]) => `<option value="${k}"${k === app.idea ? ' selected' : ''}>${v.label}</option>`)
    .join('')}</select></label>
            <span>None</span><i class="ramp idea"></i><span>Strong</span>`,
};

SPEEDS.forEach((s, i) => {
  const b = document.createElement('button');
  b.textContent = s.label;
  b.title = `${s.label} speed (key ${i + 1})`;
  b.addEventListener('click', () => setSpeed(i));
  $('#speeds').appendChild(b);
});

function fillSelect(select, choices, option) {
  for (const [value, choice] of Object.entries(choices)) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = choice.label;
    select.appendChild(o);
  }
  select.value = app.options[option];
  select.addEventListener('change', (e) => {
    app.options[option] = e.target.value;
    updateHint();
    app.dirty = true;
  });
}
fillSelect($('#opt-infect'), DISEASE_PRESETS, 'infect');
fillSelect($('#opt-temperament'), TEMPERAMENTS, 'temperament');
fillSelect($('#opt-size'), SPAWN_SIZES, 'size');
fillSelect($('#opt-disaster'), DISASTERS, 'disaster');
fillSelect($('#opt-discovery'), DISCOVERIES, 'discovery');

$('#play').addEventListener('click', () => setRunning(!app.running));
document.querySelectorAll('#modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
document.querySelectorAll('#tools button').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('#new-world').addEventListener('click', () => startWorld(randomSeed()));
$('#seed').addEventListener('change', (e) => {
  const v = parseInt(e.target.value, 10);
  if (v > 0) startWorld(v);
});
window.addEventListener('hashchange', () => {
  const s = seedFromHash();
  if (s && s !== app.world.seed) startWorld(s);
});

// Nation links anywhere in the sidebar. pointerdown, because the panels are
// re-rendered several times a second and a click could land on a replaced node.
$('.sidebar').addEventListener('pointerdown', (e) => {
  if (e.target.closest('[data-close]')) return select(-1);
  const link = e.target.closest('[data-nation]');
  if (link) select(+link.dataset.nation);
});

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    setRunning(!app.running);
  } else if (e.key >= '1' && e.key <= String(SPEEDS.length)) {
    setSpeed(+e.key - 1);
  } else if (e.key === 'Escape') {
    setTool('inspect');
    select(-1);
  }
});

// ---- Map interaction ---------------------------------------------------

const canvas = $('#map');
const tooltip = $('#tooltip');

function tileFromEvent(e) {
  const r = canvas.getBoundingClientRect();
  return renderer.tileAt(e.clientX - r.left, e.clientY - r.top);
}

canvas.addEventListener('mousemove', (e) => {
  const tile = tileFromEvent(e);
  if (tile !== app.hover) {
    app.hover = tile;
    app.dirty = true;
  }
  if (tile < 0) return (tooltip.hidden = true);
  tooltip.innerHTML = describeTile(tile);
  tooltip.hidden = false;
  const wrap = $('#map-wrap').getBoundingClientRect();
  let x = e.clientX - wrap.left + 14, y = e.clientY - wrap.top + 14;
  if (x + tooltip.offsetWidth > wrap.width - 8) x -= tooltip.offsetWidth + 28;
  if (y + tooltip.offsetHeight > wrap.height - 8) y -= tooltip.offsetHeight + 28;
  tooltip.style.transform = `translate(${x}px, ${y}px)`;
});

canvas.addEventListener('mouseleave', () => {
  app.hover = -1;
  app.dirty = true;
  tooltip.hidden = true;
});

// What each tool does to the clicked tile. Each returns { ok, msg } and,
// optionally, a nation to select afterwards.
const TOOL_ACTIONS = {
  infect(w, tile) {
    const d = releaseDisease(w, tile, app.options.infect);
    if (!d) return { ok: false, msg: 'Nobody lives there. Pick a populated place.' };
    return { ok: true, msg: `The ${d.name} is loose in ${w.nations[w.owner[tile]].name}. Open the Disease view to follow it.` };
  },
  nation(w, tile) {
    const r = spawnNation(w, tile, app.options.temperament, app.options.size);
    return r.ok ? { ...r, select: r.nation.id } : r;
  },
  disaster: (w, tile) => strikeDisaster(w, tile, app.options.disaster),
  discovery(w, tile) {
    const o = w.owner[tile];
    if (o < 0) return { ok: false, msg: 'Click inside a nation to give it the discovery.' };
    const n = w.nations[o], d = DISCOVERIES[app.options.discovery];
    if (!grantDiscovery(w, n, app.options.discovery)) return { ok: false, msg: `${n.name} already knows ${d.noun}.` };
    return { ok: true, msg: `${n.name} discovers ${d.noun}. Watch it spread to the neighbours.`, select: o };
  },
};

canvas.addEventListener('click', (e) => {
  const tile = tileFromEvent(e);
  if (tile < 0) return;
  if (app.tool === 'inspect') return select(app.world.owner[tile]);
  const result = TOOL_ACTIONS[app.tool](app.world, tile);
  toast(result.msg);
  if (!result.ok) return;
  if (result.select !== undefined) app.selected = result.select;
  if (!e.shiftKey) setTool('inspect');
  app.dirty = true;
  sidebar.update();
});

function describeTile(i) {
  const w = app.world;
  const t = TERRAIN[w.terrain[i]];
  const lines = [`<b>${t.name}</b>${w.coastal[i] ? ' · coast' : ''}`];
  const o = w.owner[i];
  if (o >= 0) {
    const n = w.nations[o];
    lines.push(`<span class="ref"><i style="background:${n.css}"></i>${escapeHtml(n.title)} of ${escapeHtml(n.name)}</span>`);
  } else if (!t.water) {
    lines.push('<span class="muted">Unclaimed</span>');
  }
  if (o >= 0 && app.mode === 'minds') {
    const idea = IDEAS[app.idea];
    lines.push(`${idea.label}: ${Math.round(idea.get(w.nations[o]) * 100)}`);
  }
  if (o >= 0 && w.nations[o].closed) lines.push('<span class="closed-text">Borders closed</span>');
  const p = w.pop[i];
  if (p >= 1) lines.push(`${fmtNum(p)} people`);
  if (p >= 1) {
    let sick = 0, immune = 0;
    for (const d of w.diseases) {
      if (!d.active) continue;
      sick += d.inf[i];
      immune += d.rec[i];
    }
    if (sick >= 1) lines.push(`<span class="sick-text">${fmtPct(sick / p)} sick</span>`);
    if (immune >= 1) lines.push(`<span class="muted">${fmtPct(immune / p)} recovered</span>`);
  }
  return lines.join('<br>');
}

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

new ResizeObserver(() => {
  const wrap = $('#map-wrap');
  const style = getComputedStyle(wrap);
  const w = wrap.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const h = wrap.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - $('#legend').offsetHeight - 8;
  renderer.fit(w, h);
  app.dirty = true;
}).observe($('#map-wrap'));

// ---- Clock -------------------------------------------------------------

let last = performance.now(), pending = 0, lastPanel = 0;

function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (app.running) {
    pending += dt * SPEEDS[app.speed].mps;
    let steps = 0;
    while (pending >= 1 && steps < 30) {
      stepWorld(app.world);
      pending -= 1;
      steps++;
    }
    if (steps === 30) pending = 0;
    if (steps) app.dirty = true;
  }
  if (app.dirty) {
    renderer.draw(app);
    app.dirty = false;
  }
  if (now - lastPanel > 250) {
    sidebar.update();
    lastPanel = now;
  }
  requestAnimationFrame(frame);
}

setSpeed(app.speed);
setMode(app.mode);
setTool(app.tool);
startWorld(seedFromHash() ?? randomSeed());
requestAnimationFrame(frame);
