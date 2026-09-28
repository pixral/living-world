// The sidebar: world stats, the selected nation, the nation list and the chronicle.

const $ = (sel) => document.querySelector(sel);

const STATUS = { good: '#0ca30c', warning: '#fab219', critical: '#d03b3b' };

class Sidebar {
  constructor(app) {
    this.app = app;
    this.lastLogSeq = -1;
    this.sparkHover = -1;
    this.bindSpark();
  }

  reset() {
    this.lastLogSeq = -1;
    this.sparkHover = -1;
  }

  update() {
    const w = this.app.world;
    $('#year').textContent = `Year ${yearOf(w.month)}`;
    $('#month').textContent = MONTH_NAMES[w.month % 12];
    this.updateStats(w);
    this.drawSpark(w);
    this.updateNation(w);
    this.updateList(w);
    this.updateChronicle(w);
  }

  updateStats(w) {
    let pop = 0, alive = 0;
    for (const n of w.nations) {
      if (!n.alive) continue;
      pop += n.pop;
      alive++;
    }
    const outbreaks = w.diseases.filter((d) => d.active);
    const sick = outbreaks.reduce((s, d) => s + d.infected, 0);
    $('#stat-pop').textContent = fmtNum(pop);
    $('#stat-nations').textContent = alive;
    $('#stat-wars').textContent = w.wars.size;
    $('#stat-sick').textContent = outbreaks.length ? fmtNum(sick) : '—';
    $('#stat-sick-k').textContent = outbreaks.length
      ? `Sick · ${outbreaks.length} outbreak${outbreaks.length === 1 ? '' : 's'}`
      : 'Sick';
  }

  // World population, one point per year, with a hover readout.
  drawSpark(w) {
    const canvas = $('#spark');
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    if (canvas.width !== Math.round(cssW * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const series = w.history;
    const tip = $('#spark-tip');
    if (series.length < 2) {
      ctx.fillStyle = '#8b95a5';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText('Collecting history…', 0, cssH / 2);
      tip.textContent = '';
      return;
    }
    const pad = 3;
    let max = 0;
    for (const p of series) max = Math.max(max, p.pop);
    const xAt = (i) => pad + (i / (series.length - 1)) * (cssW - pad * 2);
    const yAt = (v) => cssH - pad - (v / (max || 1)) * (cssH - pad * 2);

    ctx.beginPath();
    series.forEach((p, i) => (i ? ctx.lineTo(xAt(i), yAt(p.pop)) : ctx.moveTo(xAt(i), yAt(p.pop))));
    ctx.lineTo(xAt(series.length - 1), cssH);
    ctx.lineTo(xAt(0), cssH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(57,135,229,0.14)';
    ctx.fill();

    ctx.beginPath();
    series.forEach((p, i) => (i ? ctx.lineTo(xAt(i), yAt(p.pop)) : ctx.moveTo(xAt(i), yAt(p.pop))));
    ctx.strokeStyle = '#3987e5';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    const h = this.sparkHover >= 0 ? Math.min(this.sparkHover, series.length - 1) : series.length - 1;
    const x = xAt(h), y = yAt(series[h].pop);
    if (this.sparkHover >= 0) {
      ctx.strokeStyle = 'rgba(230,233,238,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, cssH);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#3987e5';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#161b22';
    ctx.stroke();
    tip.textContent = `Year ${series[h].year} · ${fmtNum(series[h].pop)} people`;
  }

  bindSpark() {
    const canvas = $('#spark');
    canvas.addEventListener('mousemove', (e) => {
      const n = this.app.world.history.length;
      if (n < 2) return;
      const r = canvas.getBoundingClientRect();
      const t = clamp((e.clientX - r.left - 3) / (r.width - 6), 0, 1);
      this.sparkHover = Math.round(t * (n - 1));
      this.drawSpark(this.app.world);
    });
    canvas.addEventListener('mouseleave', () => {
      this.sparkHover = -1;
      this.drawSpark(this.app.world);
    });
  }

  updateNation(w) {
    const panel = $('#nation-panel');
    const n = w.nations[this.app.selected];
    if (!n) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;

    const head = `
      <div class="nation-head">
        <span class="swatch lg" style="background:${n.css}"></span>
        <div class="grow">
          <div class="nation-name">${escapeHtml(n.name)}</div>
          <div class="muted">${escapeHtml(n.title)} · founded year ${yearOf(n.founded)}${
            n.parent >= 0 ? ` · broke from ${nationRef(w, n.parent)}` : ''
          }</div>
        </div>
        <button class="icon-btn" data-close title="Close">×</button>
      </div>`;

    if (!n.alive) {
      panel.innerHTML = head + `<p class="muted">Fell in year ${yearOf(n.fell)}.</p>`;
      return;
    }

    const stab = n.stability;
    const [stabLabel, stabColor] =
      stab > 0.6 ? ['Stable', STATUS.good] : stab > 0.35 ? ['Uneasy', STATUS.warning] : ['Unrest', STATUS.critical];

    const rels = [...n.neighbors.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => {
        const key = pairKey(n.id, id);
        const [label, cls] = w.wars.has(key)
          ? ['at war', 'war']
          : inTruce(w, key)
            ? ['truce', 'truce']
            : relationLabel(w.relations.get(key) ?? 0);
        const grudge = (n.grudges.get(id) || 0) >= 0.3 ? '<span class="badge warn">grudge</span>' : '';
        return `<li>${nationRef(w, id)}<span>${grudge} <span class="badge ${cls}">${label}</span></span></li>`;
      })
      .join('');

    const sickShare = n.infected / Math.max(1, n.pop);
    const knowledge = n.tech.length
      ? `<div class="chips">${n.tech
          .map((k) => `<span class="chip" title="${escapeHtml(DISCOVERIES[k].effect)}">${DISCOVERIES[k].label}</span>`)
          .join('')}</div>`
      : '<p class="muted">Nothing beyond the basics yet.</p>';
    const habits = Object.entries(POLICIES)
      .map(([k, p]) => traitMeter(p.label, n.policy[k]))
      .join('');
    const memories = n.memory
      .map((m) => ({ m, s: memoryStrength(w, m) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 6)
      .map(
        ({ m, s }) =>
          `<li style="opacity:${(0.45 + 0.55 * s).toFixed(2)}"><span class="when">${yearOf(m.month)}</span><span>${renderLogText(
            w,
            MEMORY_KINDS[m.kind].text(m)
          )}</span></li>`
      )
      .join('');
    panel.innerHTML =
      head +
      `
      <div class="stats small">
        <div class="stat"><div class="v">${fmtNum(n.pop)}</div><div class="k">Population</div></div>
        <div class="stat"><div class="v">${n.tiles}</div><div class="k">Provinces</div></div>
        <div class="stat"><div class="v">${fmtNum(n.army)}</div><div class="k">Soldiers</div></div>
        <div class="stat"><div class="v">${fmtNum(n.wealth)}</div><div class="k">Treasury</div></div>
      </div>
      <div class="meter">
        <span class="k">Stability</span>
        <div class="bar"><i style="width:${Math.round(stab * 100)}%;background:${stabColor}"></i></div>
        <span class="v">${stabLabel}</span>
      </div>
      ${n.infected >= 1 ? `<p class="sick-note">${fmtNum(n.infected)} sick (${fmtPct(sickShare)} of the people)</p>` : ''}
      ${n.closed ? '<p class="closed-note">Borders closed against sickness</p>' : ''}
      <h3>Knowledge</h3>
      ${knowledge}
      <h3>Learned habits</h3>
      ${habits}
      <h3>Memories</h3>
      ${memories ? `<ol class="memories">${memories}</ol>` : '<p class="muted">Nothing worth remembering yet.</p>'}
      <h3>Temperament <span class="muted">(change since founding)</span></h3>
      ${traitMeter('Aggression', n.traits.aggression, n.born.aggression)}
      ${traitMeter('Expansion', n.traits.expansion, n.born.expansion)}
      ${traitMeter('Openness', n.traits.openness, n.born.openness)}
      <h3>Neighbours</h3>
      ${rels ? `<ul class="rels">${rels}</ul>` : '<p class="muted">No land neighbours.</p>'}`;
  }

  updateList(w) {
    const rows = w.nations
      .filter((n) => n.alive)
      .sort((a, b) => b.pop - a.pop)
      .map(
        (n) => `
        <li data-nation="${n.id}" class="${n.id === this.app.selected ? 'on' : ''}">
          <span class="swatch" style="background:${n.css}"></span>
          <span class="name">${escapeHtml(n.name)}</span>
          ${n.warCount > 0 ? '<span class="badge war">war</span>' : ''}
          ${n.infected / Math.max(1, n.pop) > 0.01 ? '<span class="badge sick">sick</span>' : ''}
          <span class="num">${fmtNum(n.pop)}</span>
        </li>`
      )
      .join('');
    $('#nation-list').innerHTML = rows;
  }

  updateChronicle(w) {
    if (w.logSeq === this.lastLogSeq) return;
    this.lastLogSeq = w.logSeq;
    const items = [];
    for (let k = w.log.length - 1; k >= 0 && items.length < 150; k--) {
      const e = w.log[k];
      items.push(
        `<li class="kind-${e.kind}"><span class="when">${yearOf(e.month)}</span><span class="what">${renderLogText(w, e.text)}</span></li>`
      );
    }
    $('#chronicle').innerHTML = items.join('');
  }
}

function renderLogText(w, text) {
  return escapeHtml(text).replace(/\{\{([nd]):(\d+)\}\}/g, (_, type, id) =>
    type === 'n' ? nationRef(w, +id) : `<span class="dref">${escapeHtml(w.diseases[+id].name)}</span>`
  );
}

function nationRef(w, id) {
  const n = w.nations[id];
  return `<span class="ref" data-nation="${id}"><i style="background:${n.css}"></i>${escapeHtml(n.name)}</span>`;
}

function relationLabel(rel) {
  if (rel > 0.4) return ['friendly', 'good'];
  if (rel > 0.1) return ['cordial', 'good'];
  if (rel > -0.2) return ['neutral', ''];
  if (rel > -0.5) return ['tense', 'warn'];
  return ['hostile', 'war'];
}

// A 0..1 value as a bar. With `born`, also shows how far it has drifted.
function traitMeter(label, v, born) {
  const change = born === undefined ? 0 : Math.round((v - born) * 100);
  const drift = change ? `<span class="drift">${change > 0 ? '+' : ''}${change}</span>` : '';
  return `<div class="meter"><span class="k">${label}</span><div class="bar"><i style="width:${Math.round(
    v * 100
  )}%"></i></div><span class="v">${drift}${Math.round(v * 100)}</span></div>`;
}
