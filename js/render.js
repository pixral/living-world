// Draws the world onto the map canvas. The world is 1 pixel per tile on two
// small offscreen canvases (terrain, overlay) that get scaled up crisply.

// Population density on a dark map: dark blue when empty, light blue when full.
const POP_RAMP = [
  [13, 54, 107],
  [28, 92, 171],
  [57, 135, 229],
  [109, 167, 236],
  [205, 226, 251],
];

// Learned habits and temperament, for the Minds view: dark when absent,
// bright orange when strong.
const IDEA_RAMP = [
  [45, 22, 12],
  [110, 45, 18],
  [194, 86, 31],
  [235, 104, 52],
  [248, 170, 120],
  [253, 226, 206],
];

const IDEAS = {
  quarantine: { label: 'Quarantine', get: (n) => n.policy.quarantine },
  militarism: { label: 'Standing army', get: (n) => n.policy.militarism },
  granaries: { label: 'Granaries', get: (n) => n.policy.granaries },
  aggression: { label: 'Aggression', get: (n) => n.traits.aggression },
  expansion: { label: 'Expansion', get: (n) => n.traits.expansion },
  openness: { label: 'Openness', get: (n) => n.traits.openness },
};

class MapRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.terrainCanvas = Object.assign(document.createElement('canvas'), { width: MAP_W, height: MAP_H });
    this.overlayCanvas = Object.assign(document.createElement('canvas'), { width: MAP_W, height: MAP_H });
    this.overlayCtx = this.overlayCanvas.getContext('2d');
    this.overlayImage = this.overlayCtx.createImageData(MAP_W, MAP_H);
    this.sick = new Float32Array(MAP_N);
    this.immune = new Float32Array(MAP_N);
    this.tile = 6;
    this.dpr = 1;
  }

  setWorld(world) {
    this.world = world;
    this.paintTerrain();
  }

  fit(width, height) {
    this.dpr = window.devicePixelRatio || 1;
    this.tile = Math.max(2, Math.min(width / MAP_W, height / MAP_H));
    const cssW = Math.floor(MAP_W * this.tile), cssH = Math.floor(MAP_H * this.tile);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
  }

  tileAt(px, py) {
    const x = Math.floor(px / this.tile), y = Math.floor(py / this.tile);
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return -1;
    return y * MAP_W + x;
  }

  paintTerrain() {
    const { terrain, shade } = this.world;
    this.terrainVersion = this.world.terrainVersion;
    const ctx = this.terrainCanvas.getContext('2d');
    const img = ctx.createImageData(MAP_W, MAP_H);
    const px = img.data;
    for (let i = 0; i < MAP_N; i++) {
      const c = TERRAIN[terrain[i]].color, s = 1 + shade[i], k = i * 4;
      px[k] = c[0] * s;
      px[k + 1] = c[1] * s;
      px[k + 2] = c[2] * s;
      px[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  // Sum every active disease into per-tile sick and immune counts.
  gatherDisease() {
    const { sick, immune } = this;
    sick.fill(0);
    immune.fill(0);
    for (const d of this.world.diseases) {
      if (!d.active) continue;
      for (let i = 0; i < MAP_N; i++) {
        if (d.inf[i] > 0) sick[i] += d.inf[i];
        if (d.rec[i] > 0) immune[i] += d.rec[i];
      }
    }
  }

  draw(view) {
    const { ctx, world } = this;
    const s = this.tile * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    if (this.terrainVersion !== world.terrainVersion) this.paintTerrain();
    ctx.drawImage(this.terrainCanvas, 0, 0);
    this.gatherDisease();
    this.paintOverlay(view);
    ctx.drawImage(this.overlayCanvas, 0, 0);
    this.drawBorders(view);
    if (view.hover >= 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5 / this.tile;
      ctx.strokeRect(view.hover % MAP_W, Math.floor(view.hover / MAP_W), 1, 1);
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (view.mode !== 'disease' || world.diseases.every((d) => !d.active)) this.drawLabels(view);
    this.drawMarks(view);
  }

  // Dashed rings over disaster areas, and a ring under the cursor showing
  // how far the chosen tool will reach.
  drawMarks(view) {
    const { ctx, world, tile } = this;
    const ring = (center, radius, color, label, alpha) => {
      const cx = ((center % MAP_W) + 0.5) * tile;
      const cy = (Math.floor(center / MAP_W) + 0.5) * tile;
      const r = (radius + 0.5) * tile;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      // A dark underlay keeps the ring readable over any terrain or nation colour.
      ctx.lineWidth = 4.5;
      ctx.strokeStyle = 'rgba(10,12,18,0.7)';
      ctx.stroke();
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.setLineDash([]);
      if (label) {
        ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(10,12,18,0.85)';
        ctx.strokeText(label, cx, cy - r - 8);
        ctx.fillStyle = color;
        ctx.fillText(label, cx, cy - r - 8);
      }
      ctx.globalAlpha = 1;
    };

    for (const m of world.marks) {
      const def = DISASTERS[m.kind];
      // Fade out over the last six months.
      ring(m.center, m.radius, def.color, def.label, clamp((m.until - world.month) / 6, 0.3, 1));
    }

    if (view.hover < 0) return;
    const radius =
      view.tool === 'disaster'
        ? DISASTERS[view.options.disaster].radius
        : view.tool === 'nation'
          ? SPAWN_SIZES[view.options.size].radius
          : 0;
    if (radius > 0) ring(view.hover, radius, 'rgba(255,255,255,0.85)', null, 1);
  }

  paintOverlay(view) {
    const mode = view.mode;
    const { owner, pop, terrain, nations } = this.world;
    const { sick, immune } = this;
    const px = this.overlayImage.data;
    const ideaColor = mode === 'minds' ? nations.map((n) => sampleRamp(IDEA_RAMP, IDEAS[view.idea].get(n))) : null;
    for (let i = 0; i < MAP_N; i++) {
      const k = i * 4;
      let r = 0, g = 0, b = 0, a = 0;
      const water = TERRAIN[terrain[i]].water;
      const p = pop[i];

      if (mode === 'political') {
        const o = owner[i];
        if (o >= 0) {
          const c = nations[o].color;
          r = c[0];
          g = c[1];
          b = c[2];
          a = 125;
        }
        const f = p > 1 ? sick[i] / p : 0;
        if (f > 0.002) {
          const t = Math.min(1, 0.3 + f * 3);
          r = lerp(r, 235, t);
          g = lerp(g, 45, t);
          b = lerp(b, 45, t);
          a = lerp(a, 220, t);
        }
      } else if (mode === 'population') {
        if (!water) {
          const density = Math.min(1, p / (TILE_CAP * 0.9));
          if (density < 0.004) {
            r = g = b = 8;
            a = 170;
          } else {
            [r, g, b] = sampleRamp(POP_RAMP, Math.sqrt(density));
            a = 235;
          }
        }
      } else if (mode === 'minds') {
        if (!water) {
          const o = owner[i];
          if (o < 0) {
            r = g = b = 8;
            a = 170;
          } else {
            [r, g, b] = ideaColor[o];
            a = 235;
          }
        }
      } else if (mode === 'disease') {
        if (!water) {
          if (p < 1) {
            r = g = b = 8;
            a = 170;
          } else {
            r = 44;
            g = 48;
            b = 56;
            a = 215;
            const fi = Math.min(1, sick[i] / p), fr = Math.min(1, immune[i] / p);
            if (fr > 0.01) {
              const t = 0.25 + fr * 0.7;
              r = lerp(r, 40, t);
              g = lerp(g, 170, t);
              b = lerp(b, 190, t);
            }
            if (fi > 0.001) {
              const t = Math.min(1, 0.35 + fi * 3);
              r = lerp(r, 240, t);
              g = lerp(g, 50, t);
              b = lerp(b, 50, t);
              a = 240;
            }
          }
        }
      }
      px[k] = r;
      px[k + 1] = g;
      px[k + 2] = b;
      px[k + 3] = a;
    }
    this.overlayCtx.putImageData(this.overlayImage, 0, 0);
  }

  drawBorders(view) {
    const { ctx, world } = this;
    const { owner, terrain } = world;
    const plain = new Path2D(), front = new Path2D(), sealed = new Path2D(), chosen = new Path2D();
    const nations = world.nations;
    const sel = view.selected;

    const edge = (i, j, x0, y0, x1, y1) => {
      const a = owner[i], b = owner[j];
      if (a === b || TERRAIN[terrain[i]].water || TERRAIN[terrain[j]].water) return;
      const atWar = a >= 0 && b >= 0 && world.wars.has(pairKey(a, b));
      const shut = (a >= 0 && nations[a].closed) || (b >= 0 && nations[b].closed);
      const path = atWar ? front : shut ? sealed : plain;
      path.moveTo(x0, y0);
      path.lineTo(x1, y1);
      if (sel >= 0 && (a === sel || b === sel)) {
        chosen.moveTo(x0, y0);
        chosen.lineTo(x1, y1);
      }
    };

    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = y * MAP_W + x;
        if (x + 1 < MAP_W) edge(i, i + 1, x + 1, y, x + 1, y + 1);
        if (y + 1 < MAP_H) edge(i, i + MAP_W, x, y + 1, x + 1, y + 1);
      }
    }

    // A coastline of the selected nation, so it reads as one shape.
    if (sel >= 0) {
      for (let i = 0; i < MAP_N; i++) {
        if (owner[i] !== sel) continue;
        const x = i % MAP_W, y = Math.floor(i / MAP_W);
        for (let k = 0; k < 4; k++) {
          const j = NB[i * 4 + k];
          if (j >= 0 && !TERRAIN[terrain[j]].water) continue;
          if (k === 0) { chosen.moveTo(x, y); chosen.lineTo(x, y + 1); }
          if (k === 1) { chosen.moveTo(x + 1, y); chosen.lineTo(x + 1, y + 1); }
          if (k === 2) { chosen.moveTo(x, y); chosen.lineTo(x + 1, y); }
          if (k === 3) { chosen.moveTo(x, y + 1); chosen.lineTo(x + 1, y + 1); }
        }
      }
    }

    const px = 1 / this.tile;
    ctx.lineCap = 'square';
    ctx.strokeStyle = 'rgba(12,14,20,0.55)';
    ctx.lineWidth = 1 * px;
    ctx.stroke(plain);
    ctx.strokeStyle = 'rgba(134,182,239,0.95)';
    ctx.lineWidth = 2 * px;
    ctx.stroke(sealed);
    ctx.strokeStyle = 'rgba(255,176,0,0.95)';
    ctx.lineWidth = 2 * px;
    ctx.stroke(front);
    if (sel >= 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 2 * px;
      ctx.stroke(chosen);
    }
  }

  drawLabels(view) {
    const { ctx, world, tile } = this;
    const zoom = tile / 6;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const n of world.nations) {
      if (!n.alive || n.tiles < 3) continue;
      const cx = ((n.capital % MAP_W) + 0.5) * tile;
      const cy = (Math.floor(n.capital / MAP_W) + 0.5) * tile;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, tile * 0.32), 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(10,12,18,0.85)';
      ctx.stroke();

      if (n.tiles < 6 && n.id !== view.selected) continue;
      const size = clamp((7 + Math.sqrt(n.tiles) * 0.9) * zoom, 10, 24);
      const lx = (n.lx + 0.5) * tile;
      // Lift the name off the capital dot when they share a tile.
      const ly = (n.ly + 0.5) * tile - (n.ly * MAP_W + n.lx === n.capital ? size * 0.9 : 0);
      ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10,12,18,0.8)';
      ctx.strokeText(n.name, lx, ly);
      ctx.fillStyle = n.id === view.selected ? '#fff' : 'rgba(255,255,255,0.9)';
      ctx.fillText(n.name, lx, ly);
    }
  }
}

function sampleRamp(ramp, t) {
  const x = clamp(t, 0, 1) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  const f = x - i;
  const a = ramp[i], b = ramp[i + 1];
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
}
