/* BharatCiv — India as a Civilization-style hex map, from real public data. Vanilla JS + canvas. */
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 0) => v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const crore = v => v >= 1e5 ? '₹' + fmt(v / 1e5, 2) + ' lakh cr' : '₹' + fmt(v) + ' cr';
const pct = (v, d = 1) => v == null ? '—' : fmt(v, d) + '%';

let H, D, CITIES, F, BORDERS;
const S = { lens: 'terrain', cam: { x: 0, y: 0, s: 0.6 }, hover: -1, sel: -1, highlight: null, custom: null };
const cv = $('#map'), ctx = cv.getContext('2d');
let W = 0, Hh = 0, DPR = 1;

/* ---------------------------------------------------------------- load */
Promise.all(['hexes', 'districts', 'cities', 'features', 'borders'].map(n => fetch('data/' + n + '.json').then(r => {
  if (!r.ok) throw new Error(n + ' ' + r.status); return r.json();
}))).then(([h, d, c, f, b]) => {
  H = h; D = d; CITIES = c; F = f; BORDERS = b;
  prepare(); buildLensUI(); resize(); fitIndia(); draw(); topYields();
  $('#loading').remove();
  const q = new URLSearchParams(location.hash.slice(1));
  if (q.get('lens') && LENSES.find(l => l.id === q.get('lens'))) setLens(q.get('lens'));
}).catch(e => { $('#loading').innerHTML = '<div>Could not load map data: ' + esc(e.message) + '</div>'; });

/* ---------------------------------------------------------------- derived structures */
const DI = {};          // district code -> row index
let distHexes = {};     // code -> [hex]
let cityAt = {};        // hex -> city
let featAt = {};        // hex -> [icons]
let R, HEXW;
function prepare() {
  HEXW = H.hexW; R = HEXW / Math.sqrt(3);
  D.codes.forEach((c, i) => DI[c] = i);
  for (let i = 0; i < H.N; i++) { if (!H.land[i]) continue; (distHexes[H.d[i]] ||= []).push(i); }
  CITIES.sort((a, b) => b.pop - a.pop).forEach((c, k) => { c.rank = k + 1; if (!cityAt[c.h]) cityAt[c.h] = c; });
  const add = (h, ic, t, kind, o) => { if (h == null) return; (featAt[h] ||= []).push({ ic, t, kind, o }); };
  F.whs.forEach(w => add(w.h, '🏛️', w.n, 'wonder', w));
  F.nirf.forEach(u => add(u.h, '📜', u.full + ' (NIRF #' + u.rank + ')', 'wonder', u));
  F.holy.forEach(w => add(w.h, '🛕', w.n + ' — ' + w.rel + ' holy site', 'wonder', w));
  const bigParks = F.parks.filter(p => p.area).sort((a, b) => b.area - a.area).slice(0, 12);
  bigParks.forEach(p => add(p.h, '🏞️', p.n + ' — ' + fmt(p.area) + ' km² (natural wonder)', 'wonder', p));
  F.parks.filter(p => !bigParks.includes(p)).forEach(p => add(p.h, '🌳', p.n + ' (national park)', 'park', p));
  const FUEL = { Coal: '⚫', Hydro: '💧', Nuclear: '☢️', Solar: '☀️', Wind: '🌬️', Gas: '🔥', Oil: '🛢️', Biomass: '🌾' };
  F.plants.filter(p => p.mw >= 500).forEach(p => add(p.h, FUEL[p.f] || '⚡', p.n + ' — ' + fmt(p.mw) + ' MW ' + p.f, 'power', p));
  const RES = { coal: '⚫', iron: '⛓️', copper: '🟠', gold: '🟡', diamond: '💎', aluminium: '🔩', uranium: '☢️', zinc: '🔘', manganese: '🟣', limestone: '🪨', mica: '✨', marble: '⬜', salt: '🧂', mine: '⛏️' };
  F.mines.forEach(m => add(m.h, RES[m.res] || '⛏️', m.n + ' (' + m.res + ' mine)', 'resource', m));
  F.ports.forEach(p => add(p.h, '⚓', p.n + (p.major ? ' (major port)' : ''), 'port', p));
  F.airports.forEach(a => add(a.h, '✈️', a.n + (a.iata ? ' (' + a.iata + ')' : ''), 'airport', a));
  // hex polygon offsets
  HEXV = []; for (let k = 0; k < 6; k++) { const a = Math.PI / 180 * (60 * k - 30); HEXV.push([R * Math.cos(a), R * Math.sin(a)]); }
  // district-level numeric columns available to explorer/lenses
  DCOLS = Object.keys(D.cols).filter(k => typeof D.cols[k][0] === 'number');
}
let HEXV = [], DCOLS = [];
const dval = (col, hex) => { const i = DI[H.d[hex]]; return i == null || !D.cols[col] ? null : D.cols[col][i]; };
const dget = (col, code) => (D.cols[col] || [])[DI[code]];

/* ---------------------------------------------------------------- colour helpers */
const SCALES = {
  viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
  heat: ['#1a1a2e', '#5c1a5e', '#b0304a', '#ef7a2a', '#fbe36b'],
  gold: ['#1f1a10', '#5a4316', '#9b7520', '#d9a441', '#fff0a8'],
  green: ['#13220f', '#2c5a1e', '#4f9a2e', '#8fd04f', '#e6ffb0'],
  blue: ['#0b1730', '#173e75', '#2f6fb7', '#5ab4f0', '#c9ecff'],
  rain: ['#7a4a1c', '#c9a152', '#e4e0a0', '#5fb36b', '#1d6b55', '#123d6b'],
  temp: ['#3954a6', '#8ab6d6', '#f2efc2', '#f0a050', '#c2272d'],
  elev: ['#2f6b3a', '#8fae5b', '#d8c88a', '#a7764a', '#7a6a62', '#f4f4f4'],
  purple: ['#160f24', '#3d2468', '#7c4bb0', '#c77dff', '#f2dcff'],
  red: ['#1a1414', '#4a1d1d', '#8f2a2a', '#d9482e', '#ffb08a'],
  div: ['#b2182b', '#ef8a62', '#f7f7f7', '#67a9cf', '#2166ac'],
};
function hex2rgb(h) { return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); }
function ramp(name, t) {
  const st = SCALES[name]; t = Math.max(0, Math.min(1, t)); const f = t * (st.length - 1), i = Math.min(st.length - 2, Math.floor(f)), u = f - i;
  const a = hex2rgb(st[i]), b = hex2rgb(st[i + 1]);
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * u)).join(',')})`;
}

/* ---------------------------------------------------------------- terrain */
const TER = ['#173f63', '#2a6a96', '#6e9d3c', '#b3a453', '#dcc78c', '#8e9585', '#e9eef2'];
const TER_N = ['Ocean', 'Coast', 'Grassland', 'Plains', 'Desert', 'Tundra', 'Snow'];
const FEAT_N = ['', 'Hills', 'Mountains', 'Forest', 'Rainforest', 'Floodplains', 'Marsh'];
function terrainColor(i) {
  const t = H.terrain[i], f = H.feature[i];
  if (!H.land[i]) return TER[t];
  if (f === 2) return H.elev[i] > 4200 ? '#b9b6b2' : '#80776b';
  if (f === 3) return t === 3 ? '#557a31' : '#3f7330';
  if (f === 4) return '#2b5f2a';
  if (f === 5) return '#9bb54c';
  if (f === 6) return '#4f7d62';
  if (f === 1) { const c = hex2rgb(TER[t]); return `rgb(${c.map(v => Math.round(v * 0.86)).join(',')})`; }
  return TER[t];
}

/* ---------------------------------------------------------------- lenses */
const DLENS = (id, label, icon, col, scale, opts = {}) => ({ id, label, icon, kind: 'district', col, scale, ...opts });
const RELC = { Hindus: '#f39c34', Muslims: '#2fa35a', Christians: '#4f8fe0', Sikhs: '#e6c229', Buddhists: '#c0392b', Jains: '#c77dff', Others_Religions: '#9aa' };
const LENSES = [
  { id: 'terrain', label: 'Terrain', icon: '🗺️', kind: 'terrain' },
  { id: 'elev', label: 'Elevation', icon: '⛰️', kind: 'hex', get: i => H.elev[i], scale: 'elev', range: [0, 5500], fmt: v => fmt(v) + ' m', note: 'SRTM 90 m, mean of 7 samples per hex' },
  { id: 'rain', label: 'Rainfall', icon: '🌧️', kind: 'hex', get: i => H.rain[i], scale: 'rain', range: [100, 3500], fmt: v => fmt(v) + ' mm/yr', note: 'NASA POWER climatology' },
  { id: 'temp', label: 'Temperature', icon: '🌡️', kind: 'hex', get: i => H.temp[i], scale: 'temp', range: [-10, 30], fmt: v => fmt(v, 1) + ' °C', note: 'annual mean, NASA POWER' },
  { id: 'pop', label: 'Population', icon: '👥', kind: 'hex', get: i => H.pop[i] / (HEXW * HEXW * 0.866), log: true, scale: 'heat', range: [1, 20000], fmt: v => fmt(v) + ' /km²', note: 'Census 2011, urban share placed on real towns' },
  { id: 'food', label: 'Food', icon: '🌾', kind: 'hex', get: i => H.food[i], scale: 'green', range: [0, 9], fmt: v => v + ' Food', note: 'terrain + rivers + farm workforce' },
  { id: 'prod', label: 'Production', icon: '⚒️', kind: 'hex', get: i => H.prod[i], scale: 'heat', range: [0, 12], fmt: v => v + ' Production', note: 'hills/forest + power plants + mines + non-farm jobs' },
  { id: 'gold', label: 'Gold (GDP)', icon: '💰', kind: 'hex', get: i => H.gdp[i], log: true, scale: 'gold', range: [10, 200000], fmt: v => crore(v), note: 'state GSDP split by household income & towns' },
  { id: 'sci', label: 'Science', icon: '🔬', kind: 'hex', get: i => H.sci[i], scale: 'blue', range: [0, 10], fmt: v => v + ' Science', note: 'graduates + universities' },
  DLENS('gdppc', 'GDP per person', '📈', 'gdp_pc', 'gold', { log: true, fmt: v => '₹' + fmt(v) }),
  DLENS('income', 'Household income', '🏠', 'hh_income_mean', 'gold', { fmt: v => '₹' + fmt(v) + '/yr', note: 'Census 2011 income brackets, midpoint estimate' }),
  DLENS('lit', 'Literacy', '📖', 'literacy', 'blue', { fmt: v => pct(v) }),
  DLENS('deg', 'Degrees', '🎓', 'pct_graduates', 'purple', { fmt: v => pct(v), note: 'share of people with a graduate degree' }),
  DLENS('net', 'Internet', '🌐', 'pct_internet', 'blue', { fmt: v => pct(v), note: 'households with internet, 2011' }),
  { id: 'faith', label: 'Faith', icon: '🕉️', kind: 'faith', note: 'majority religion by district; brighter = larger share' },
  DLENS('st', 'Tribal (ST)', '🏹', 'pct_st', 'red', { fmt: v => pct(v), note: 'Scheduled Tribe share of population' }),
  DLENS('farmw', 'Farm workforce', '🚜', 'pct_farm', 'green', { fmt: v => pct(v), note: 'cultivators + agricultural labourers' }),
  { id: 'power', label: 'Power', icon: '⚡', kind: 'hex', get: i => H.power[i], log: true, scale: 'heat', range: [10, 5000], fmt: v => fmt(v) + ' MW', note: 'WRI Global Power Plant Database' },
  { id: 'trade', label: 'Trade routes', icon: '🚂', kind: 'trade', get: i => H.rail[i], log: true, scale: 'heat', range: [1, 1500], fmt: v => fmt(v) + ' train routes', note: 'Indian Railways timetables (datameet)' },
  { id: 'dis', label: 'Disasters', icon: '🌪️', kind: 'hex', get: i => H.quake[i] + H.cyclone[i] * 0.35, scale: 'red', range: [0, 6], fmt: (v, i) => 'quake idx ' + H.quake[i] + ', ' + H.cyclone[i] + ' cyclones', note: 'USGS M4.5+ since 1900 · IBTrACS cyclones since 1970' },
  DLENS('latrine', 'Sanitation', '🚽', 'pct_latrine', 'blue', { fmt: v => pct(v), note: 'households with latrine on premises, 2011' }),
  DLENS('elec', 'Electricity', '💡', 'pct_electricity', 'gold', { fmt: v => pct(v), note: 'households with electric lighting, 2011' }),
  DLENS('car', 'Cars', '🚗', 'pct_car', 'heat', { fmt: v => pct(v), note: 'households owning a car/jeep/van' }),
  DLENS('sex', 'Sex ratio', '⚖️', 'sex_ratio', 'div', { range: [850, 1100], fmt: v => fmt(v) + ' F per 1000 M' }),
  DLENS('fwork', 'Women at work', '👩‍🌾', 'female_work_rate', 'purple', { fmt: v => pct(v), note: 'female work participation rate' }),
];
function lensRange(l) {
  if (l.range) return l.range;
  const v = D.cols[l.col].filter(x => x != null && isFinite(x)).sort((a, b) => a - b);
  l.range = [v[Math.floor(v.length * 0.02)], v[Math.floor(v.length * 0.98)]];
  return l.range;
}
function lensT(l, v) {
  const [a, b] = lensRange(l);
  if (l.log) return (Math.log10(Math.max(v, a)) - Math.log10(a)) / (Math.log10(b) - Math.log10(a));
  return (v - a) / (b - a);
}
let colors = [];
function computeColors() {
  const l = currentLens(); colors = new Array(H.N);
  for (let i = 0; i < H.N; i++) {
    if (l.kind === 'terrain' || !H.land[i]) { colors[i] = terrainColor(i); continue; }
    if (l.kind === 'faith') {
      const rel = dval('dominant_religion', i); if (!rel) { colors[i] = '#4a4a42'; continue; } const share = dval('pct_' + rel.toLowerCase(), i) / 100;
      const c = hex2rgb(RELC[rel] || '#999999'); const k = 0.35 + 0.65 * Math.max(0, (share - 0.4) / 0.6);
      colors[i] = `rgb(${c.map(v => Math.round(v * k + 20 * (1 - k))).join(',')})`; continue;
    }
    let v = l.kind === 'district' ? dval(l.col, i) : l.get(i);
    if (l.kind === 'trade' || l.id === 'power') { colors[i] = v > 0 ? ramp(l.scale, lensT(l, v)) : '#1c2a22'; continue; }
    colors[i] = v == null ? '#4a4a42' : ramp(l.scale, lensT(l, v));
  }
}
const currentLens = () => S.custom && S.lens === 'custom' ? S.custom : LENSES.find(l => l.id === S.lens);
function buildLensUI() {
  $('#lensList').innerHTML = LENSES.map(l => `<div class="lens" data-l="${l.id}"><i>${l.icon}</i>${l.label}</div>`).join('');
  $('#lensList').onclick = e => { const el = e.target.closest('.lens'); if (el) setLens(el.dataset.l); };
  setLens('terrain');
}
function setLens(id) {
  S.lens = id;
  document.querySelectorAll('.lens').forEach(el => el.classList.toggle('on', el.dataset.l === id));
  computeColors(); legend(); draw();
  history.replaceState(null, '', id === 'terrain' ? location.pathname : '#lens=' + id);
}
function legend() {
  const l = currentLens(); let h = `<b>${l.icon || '🔎'} ${esc(l.label)}</b>`;
  if (l.kind === 'terrain') {
    h += '<div>' + [[2, 'Grassland'], [3, 'Plains'], [4, 'Desert'], [5, 'Tundra'], [6, 'Snow']].map(([t, n]) => `<span class="cat"><span class="sw" style="background:${TER[t]}"></span>${n}</span>`).join('') + '</div><div>' +
      [['#3f7330', 'Forest'], ['#2b5f2a', 'Rainforest'], ['#80776b', 'Mountains'], ['#9bb54c', 'Floodplains'], ['#4f7d62', 'Marsh']].map(([c, n]) => `<span class="cat"><span class="sw" style="background:${c}"></span>${n}</span>`).join('') +
      '</div><div class="note">Climate- and elevation-derived; zoom in for yields, resources & wonders</div>';
  } else if (l.kind === 'faith') {
    h += '<div>' + Object.entries(RELC).map(([r, c]) => `<span class="cat"><span class="sw" style="background:${c}"></span>${r.replace('_Religions', '')}</span>`).join('') + '</div>';
  } else {
    const [a, b] = lensRange(l); const f = l.fmt || (v => fmt(v, 1));
    const stops = [0, .25, .5, .75, 1].map(t => ramp(l.scale, t)).join(',');
    h += `<div class="bar" style="background:linear-gradient(90deg,${stops})"></div><div class="ends"><span>${f(a, -1)}</span><span>${f(b, -1)}</span></div>`;
  }
  if (l.note) h += `<div class="note">${esc(l.note)}</div>`;
  if (l.kind === 'district') h += `<div class="note">District level · Census 2011 unless noted</div>`;
  $('#legend').innerHTML = h;
}

/* ---------------------------------------------------------------- camera & drawing */
function resize() {
  DPR = window.devicePixelRatio || 1; W = cv.clientWidth || window.innerWidth; Hh = cv.clientHeight || window.innerHeight - 50;
  cv.width = W * DPR; cv.height = Hh * DPR; draw();
}
window.addEventListener('resize', resize);
function fitIndia() {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let i = 0; i < H.N; i++) if (H.land[i]) { x0 = Math.min(x0, H.x[i]); x1 = Math.max(x1, H.x[i]); y0 = Math.min(y0, H.y[i]); y1 = Math.max(y1, H.y[i]); }
  S.cam.x = (x0 + x1) / 2; S.cam.y = (y0 + y1) / 2; S.cam.s = Math.max(0.05, Math.min((W - (W > 760 ? 220 : 20)) / (x1 - x0), (Hh - 40) / (y1 - y0)) * 0.97);
  if (W > 760) S.cam.x -= 90 / S.cam.s;   // keep clear of the lens panel
  S.minS = S.cam.s * 0.7;
}
const toS = (x, y) => [(x - S.cam.x) * S.cam.s + W / 2, (S.cam.y - y) * S.cam.s + Hh / 2];
const toW = (sx, sy) => [(sx - W / 2) / S.cam.s + S.cam.x, S.cam.y - (sy - Hh / 2) / S.cam.s];
let raf = 0;
function draw() { if (!H || raf) return; raf = requestAnimationFrame(() => { raf = 0; render(); }); }

function hexPath(i, shrink = 1) {
  const [sx, sy] = toS(H.x[i], H.y[i]); const s = S.cam.s * shrink;
  ctx.moveTo(sx + HEXV[0][0] * s, sy - HEXV[0][1] * s);
  for (let k = 1; k < 6; k++) ctx.lineTo(sx + HEXV[k][0] * s, sy - HEXV[k][1] * s);
  ctx.closePath();
}
function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#0f2f4d'; ctx.fillRect(0, 0, W, Hh);
  const l = currentLens(), px = R * S.cam.s; // hex radius on screen
  const vis = [];
  for (let i = 0; i < H.N; i++) { const [sx, sy] = toS(H.x[i], H.y[i]); if (sx > -px && sx < W + px && sy > -px && sy < Hh + px) vis.push(i); }
  // fills (batched by colour)
  const byCol = {};
  for (const i of vis) (byCol[colors[i]] ||= []).push(i);
  for (const c in byCol) { ctx.beginPath(); for (const i of byCol[c]) hexPath(i, 1.02); ctx.fillStyle = c; ctx.fill(); }
  if (px > 7) { ctx.beginPath(); for (const i of vis) if (H.land[i]) hexPath(i); ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.lineWidth = 1; ctx.stroke(); }
  if (l.kind === 'terrain' && px > 9) glyphs(vis, px);
  // rivers
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = l.kind === 'terrain' ? '#3d8fd1' : 'rgba(90,170,240,0.55)';
  for (const rv of F.rivers) {
    ctx.lineWidth = Math.max(0.8, (rv.r <= 4 ? 2.6 : rv.r <= 6 ? 1.8 : 1.1) * Math.min(1.6, S.cam.s / 0.8));
    ctx.beginPath(); rv.p.forEach(([x, y], k) => { const [a, b] = toS(x, y); k ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }); ctx.stroke();
  }
  // railways as trade routes
  if (l.kind === 'trade' || (l.kind === 'terrain' && px > 6)) {
    for (const [a, b, n] of F.rail) {
      if (l.kind === 'terrain' && n < 25) continue;
      const [x1, y1] = toS(H.x[a], H.y[a]), [x2, y2] = toS(H.x[b], H.y[b]);
      if ((x1 < 0 && x2 < 0) || (x1 > W && x2 > W) || (y1 < 0 && y2 < 0) || (y1 > Hh && y2 > Hh)) continue;
      ctx.strokeStyle = l.kind === 'trade' ? `rgba(255,${Math.round(240 - Math.min(200, n))},120,${Math.min(1, 0.25 + n / 300)})` : 'rgba(92,60,30,0.75)';
      ctx.lineWidth = l.kind === 'trade' ? Math.max(0.6, Math.log10(n + 1) * 1.3) : 1.3;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
  }
  if (l.id === 'dis' && px > 3) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
    for (const st of F.storms) { if (st.w < 100) continue; ctx.beginPath(); st.p.forEach(([x, y], k) => { const [a, b] = toS(x, y); k ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }); ctx.stroke(); }
    for (const q of F.quakes) { const [a, b] = toS(H.x[q.h], H.y[q.h]); ctx.beginPath(); ctx.arc(a, b, (q.m - 6) * 6 * Math.min(2, S.cam.s), 0, 7); ctx.strokeStyle = '#ffd36b'; ctx.stroke(); }
  }
  // state borders
  ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(255,240,200,0.55)'; ctx.lineWidth = 1.1;
  ctx.beginPath(); for (const b of BORDERS) b.p.forEach(([x, y], k) => { const [a, c] = toS(x, y); k ? ctx.lineTo(a, c) : ctx.moveTo(a, c); });
  ctx.stroke(); ctx.setLineDash([]);
  // highlight
  if (S.highlight && S.highlight.size) {
    ctx.beginPath(); for (const i of S.highlight) hexPath(i, 0.92);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill();
  }
  if (S.sel >= 0) { ctx.beginPath(); hexPath(S.sel, 0.95); ctx.strokeStyle = '#f3d27a'; ctx.lineWidth = 3; ctx.stroke(); }
  if (S.hover >= 0) { ctx.beginPath(); hexPath(S.hover, 0.95); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5; ctx.stroke(); }
  if (px > 13) icons(vis, px);
  if (px > 26) yieldPips(vis, px);
  cityBanners(px);
}
function glyphs(vis, px) {
  for (const i of vis) {
    const f = H.feature[i]; if (!f || !H.land[i]) continue;
    const [x, y] = toS(H.x[i], H.y[i]); const s = px;
    if (f === 2) { // mountain peaks
      ctx.fillStyle = '#5d554c'; ctx.beginPath(); ctx.moveTo(x - s * .6, y + s * .35); ctx.lineTo(x - s * .15, y - s * .5); ctx.lineTo(x + s * .3, y + s * .35); ctx.fill();
      ctx.fillStyle = '#6d655b'; ctx.beginPath(); ctx.moveTo(x - s * .05, y + s * .35); ctx.lineTo(x + s * .3, y - s * .25); ctx.lineTo(x + s * .65, y + s * .35); ctx.fill();
      ctx.fillStyle = '#f4f6f8'; ctx.beginPath(); ctx.moveTo(x - s * .28, y - s * .26); ctx.lineTo(x - s * .15, y - s * .5); ctx.lineTo(x - s * .02, y - s * .26); ctx.fill();
    } else if (f === 1) { // hills bumps
      ctx.strokeStyle = 'rgba(60,40,20,0.45)'; ctx.lineWidth = Math.max(1, s * .07);
      ctx.beginPath(); ctx.arc(x - s * .25, y + s * .2, s * .28, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + s * .25, y + s * .05, s * .24, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    } else if (f === 3 || f === 4) { // trees
      ctx.fillStyle = f === 4 ? '#1b4a1d' : '#2c5a22';
      for (const [dx, dy] of [[-.35, .15], [.05, -.2], [.35, .2], [-.05, .35]]) { ctx.beginPath(); ctx.moveTo(x + dx * s, y + (dy - .25) * s); ctx.lineTo(x + (dx - .15) * s, y + (dy + .12) * s); ctx.lineTo(x + (dx + .15) * s, y + (dy + .12) * s); ctx.fill(); }
    } else if (f === 5) {
      ctx.strokeStyle = 'rgba(70,110,40,0.55)'; ctx.lineWidth = 1;
      for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(x - s * .5, y + k * s * .25); ctx.lineTo(x + s * .5, y + k * s * .25); ctx.stroke(); }
    } else if (f === 6) {
      ctx.strokeStyle = 'rgba(30,60,50,0.7)'; ctx.lineWidth = 1;
      for (const dx of [-.3, 0, .3]) { ctx.beginPath(); ctx.moveTo(x + dx * s, y + s * .25); ctx.lineTo(x + dx * s, y - s * .15); ctx.stroke(); }
    }
  }
}
function icons(vis, px) {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const fs = Math.min(22, px * 0.62);
  ctx.font = fs + 'px "Segoe UI Emoji","Apple Color Emoji",sans-serif';
  const showKinds = px > 22 ? null : new Set(['wonder']);
  for (const i of vis) {
    const fl = featAt[i]; if (!fl || cityAt[i] && px < 40) continue;
    const list = fl.filter(f => !showKinds || showKinds.has(f.kind)).slice(0, px > 40 ? 3 : 1);
    list.forEach((f, k) => {
      const [x, y] = toS(H.x[i], H.y[i]);
      const ox = list.length > 1 ? (k - (list.length - 1) / 2) * fs * 0.95 : 0;
      if (f.kind === 'wonder') { ctx.fillStyle = 'rgba(30,20,0,0.55)'; ctx.beginPath(); ctx.arc(x + ox, y, fs * .62, 0, 7); ctx.fill(); ctx.strokeStyle = '#f3d27a'; ctx.lineWidth = 1.5; ctx.stroke(); }
      ctx.fillText(f.ic, x + ox, y + 1);
    });
  }
}
function yieldPips(vis, px) {
  const Y = [['food', '#7ccf4e'], ['prod', '#e58a3a'], ['gold', '#f3c943'], ['sci', '#5ab4f0']];
  ctx.font = `bold ${Math.min(11, px * .3)}px Inter,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const i of vis) {
    if (!H.land[i] || cityAt[i]) continue;
    const [x, y] = toS(H.x[i], H.y[i]); const ys = Y.filter(([k]) => H[k][i] > 0);
    const r = Math.min(7, px * .17);
    ys.forEach(([k, c], n) => {
      const cx = x + (n - (ys.length - 1) / 2) * r * 2.3, cy = y + px * .55;
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
      ctx.fillStyle = '#111'; ctx.fillText(H[k][i], cx, cy + .5);
    });
  }
}
function citySize(p) { return Math.max(1, Math.round(Math.log(p / 40000) / Math.log(1.6))); }
function cityBanners(px) {
  const placed = [];
  const minPop = px > 30 ? 0 : px > 16 ? 2e5 : px > 9 ? 5e5 : px > 5 ? 1e6 : 2.5e6;
  ctx.textBaseline = 'middle';
  for (const c of CITIES) {
    if (c.pop < minPop) continue;
    const [x, y] = toS(H.x[c.h], H.y[c.h]); if (x < -80 || x > W + 80 || y < -30 || y > Hh + 30) continue;
    const big = c.pop >= 1e6, cap = c.cap === 'PPLC' || c.cap === 'PPLA';
    ctx.font = `${big ? 700 : 600} ${big ? 13 : 11.5}px Cinzel,Georgia,serif`;
    const label = c.n.toUpperCase(), tw = ctx.measureText(label).width, bh = big ? 20 : 17, bw = tw + bh + 14;
    const bx = x - bw / 2, by = y - px * 0.55 - bh;
    if (placed.some(r => bx < r[2] && bx + bw > r[0] && by < r[3] && by + bh > r[1])) continue;
    placed.push([bx - 3, by - 2, bx + bw + 3, by + bh + 2]);
    // city tile marker
    ctx.fillStyle = cap ? '#f3d27a' : '#e9e2cf'; ctx.beginPath(); ctx.arc(x, y, Math.max(2.5, Math.min(7, px * .22)), 0, 7); ctx.fill();
    ctx.strokeStyle = '#2b1d0b'; ctx.lineWidth = 1.5; ctx.stroke();
    // banner
    ctx.fillStyle = 'rgba(16,30,42,0.92)'; ctx.strokeStyle = cap ? '#f3d27a' : '#d9a441'; ctx.lineWidth = cap ? 2 : 1.2;
    roundRect(bx, by, bw, bh, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d9a441'; roundRect(bx + 2, by + 2, bh - 4, bh - 4, 3); ctx.fill();
    ctx.fillStyle = '#1b1205'; ctx.textAlign = 'center'; ctx.font = `700 ${big ? 12 : 10.5}px Inter,sans-serif`;
    ctx.fillText(citySize(c.pop), bx + bh / 2, by + bh / 2 + .5);
    ctx.fillStyle = '#f2ead6'; ctx.textAlign = 'left'; ctx.font = `${big ? 700 : 600} ${big ? 13 : 11.5}px Cinzel,Georgia,serif`;
    ctx.fillText(label, bx + bh + 5, by + bh / 2 + 1);
    if (cap) { ctx.font = '11px sans-serif'; ctx.fillText(c.cap === 'PPLC' ? '★' : '✦', bx + bw - 1, by + 1); }
  }
}
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

/* ---------------------------------------------------------------- interaction */
function hexAtScreen(sx, sy) {
  const [x, y] = toW(sx, sy); let best = -1, bd = R * R * 1.1;
  // coarse: scan candidates near point via row estimate
  for (let i = 0; i < H.N; i++) { const dx = H.x[i] - x; if (dx > R || dx < -R) continue; const dy = H.y[i] - y; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
  return best;
}
let drag = null, moved = false;
cv.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, cx: S.cam.x, cy: S.cam.y }; moved = false; cv.classList.add('drag'); });
window.addEventListener('mouseup', e => {
  cv.classList.remove('drag');
  if (drag && !moved && e.target === cv) { const r = cv.getBoundingClientRect(); const i = hexAtScreen(e.clientX - r.left, e.clientY - r.top); if (i >= 0) selectHex(i); }
  drag = null;
});
window.addEventListener('mousemove', e => {
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    S.cam.x = drag.cx - dx / S.cam.s; S.cam.y = drag.cy + dy / S.cam.s; $('#tooltip').style.display = 'none'; draw(); return;
  }
  if (e.target !== cv) { $('#tooltip').style.display = 'none'; return; }
  const r = cv.getBoundingClientRect(); const i = hexAtScreen(e.clientX - r.left, e.clientY - r.top);
  if (i !== S.hover) { S.hover = i; draw(); }
  tooltip(i, e.clientX, e.clientY);
});
cv.addEventListener('wheel', e => {
  e.preventDefault(); const r = cv.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
  const [wx, wy] = toW(mx, my); const k = Math.exp(-e.deltaY * 0.0015);
  S.cam.s = Math.max(S.minS || 0.2, Math.min(12, S.cam.s * k));
  const [nx, ny] = toW(mx, my); S.cam.x += wx - nx; S.cam.y += wy - ny; draw();
}, { passive: false });
// touch: one-finger pan, two-finger pinch
let touch = null;
cv.addEventListener('touchstart', e => { const t = [...e.touches]; touch = { t: t.map(p => [p.clientX, p.clientY]), cam: { ...S.cam } }; moved = false; }, { passive: true });
cv.addEventListener('touchmove', e => {
  e.preventDefault(); if (!touch) return; const t = [...e.touches].map(p => [p.clientX, p.clientY]); moved = true;
  if (t.length === 1 && touch.t.length === 1) { S.cam.x = touch.cam.x - (t[0][0] - touch.t[0][0]) / S.cam.s; S.cam.y = touch.cam.y + (t[0][1] - touch.t[0][1]) / S.cam.s; }
  else if (t.length === 2 && touch.t.length === 2) {
    const d0 = Math.hypot(touch.t[0][0] - touch.t[1][0], touch.t[0][1] - touch.t[1][1]), d1 = Math.hypot(t[0][0] - t[1][0], t[0][1] - t[1][1]);
    S.cam.s = Math.max(S.minS, Math.min(12, touch.cam.s * d1 / d0));
  }
  draw();
}, { passive: false });
cv.addEventListener('touchend', e => {
  if (!moved && touch && touch.t.length === 1) { const r = cv.getBoundingClientRect(); const i = hexAtScreen(touch.t[0][0] - r.left, touch.t[0][1] - r.top); if (i >= 0) selectHex(i); }
  touch = null;
});
function flyTo(i, s) { S.cam.x = H.x[i] + (window.innerWidth > 760 ? 120 / (s || S.cam.s) : 0); S.cam.y = H.y[i]; if (s) S.cam.s = s; draw(); }

function tooltip(i, mx, my) {
  const tt = $('#tooltip'); if (i < 0) { tt.style.display = 'none'; return; }
  const l = currentLens(); let h = '';
  const c = cityAt[i];
  if (c) h += `<b>${esc(c.n)}</b> · pop ${fmt(c.pop)}<br>`;
  if (H.land[i]) {
    const code = H.d[i];
    h += `${esc(dget('name', code))}, ${esc(dget('state', code))}<br>`;
    h += `<span class="muted">${TER_N[H.terrain[i]]}${H.feature[i] ? ' · ' + FEAT_N[H.feature[i]] : ''}${H.river[i] ? ' · River' : ''}</span>`;
    if (l.kind !== 'terrain') {
      let v; if (l.kind === 'faith') { const r = dval('dominant_religion', i) || 'n/a'; v = r.replace('_Religions', '') + ' ' + pct(dval('pct_' + r.toLowerCase(), i)); }
      else { const raw = l.kind === 'district' ? dval(l.col, i) : l.get(i); v = (l.fmt || (x => fmt(x, 1)))(raw, i); }
      h += `<br>${l.icon || ''} ${esc(l.label)}: <b>${v}</b>`;
    }
    const fl = featAt[i]; if (fl) h += '<br>' + fl.slice(0, 4).map(f => f.ic + ' ' + esc(f.t)).join('<br>');
  } else h += TER_N[H.terrain[i]];
  tt.innerHTML = h; tt.style.display = 'block';
  tt.style.left = Math.min(mx + 14, window.innerWidth - 290) + 'px'; tt.style.top = Math.min(my + 14, window.innerHeight - 140) + 'px';
}
document.addEventListener('click', e => {
  const c = e.target.closest('[data-close]'); if (c) { $('#' + c.dataset.close).classList.add('hidden'); if (c.dataset.close === 'panel') { S.sel = -1; S.highlight = null; draw(); } }
  const go = e.target.closest('[data-hex]'); if (go) { const i = +go.dataset.hex; flyTo(i, Math.max(S.cam.s, 2.2)); selectHex(i); if (go.closest('#modal')) $('#modal').classList.add('hidden'); }
  const gd = e.target.closest('[data-dist]'); if (gd) { showDistrict(+gd.dataset.dist, true); if (gd.closest('#modal')) $('#modal').classList.add('hidden'); }
  const gc = e.target.closest('[data-city]'); if (gc) { const ct = CITIES[+gc.dataset.city]; flyTo(ct.h, Math.max(S.cam.s, 2.2)); cityView(ct); if (gc.closest('#modal')) $('#modal').classList.add('hidden'); }
});
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') $('#modal').classList.add('hidden'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('#modal').classList.add('hidden'); } });

/* ---------------------------------------------------------------- hex & district panels */
function yieldsHTML(i) {
  const Y = [['food', 'Food', 'var(--food)'], ['prod', 'Production', 'var(--prod)'], ['gold', 'Gold', 'var(--gold-y)'], ['sci', 'Science', 'var(--sci)'], ['cult', 'Culture', 'var(--cult)'], ['faith', 'Faith', 'var(--faith)']];
  return '<div class="yrow">' + Y.map(([k, n, c]) => `<span class="y" title="${n}"><span class="dot" style="background:${c}"></span>${H[k][i]} ${n}</span>`).join('') + '</div>';
}
function openPanel(html) { $('#panelBody').innerHTML = html; $('#panel').classList.remove('hidden'); $('#panel').scrollTop = 0; }
function selectHex(i) {
  S.sel = i; draw();
  if (cityAt[i]) return cityView(cityAt[i]);
  if (!H.land[i]) { openPanel(`<h2>${TER_N[H.terrain[i]]}</h2><div class="sub">Open water · ${fmt(H.lat[i], 2)}°N ${fmt(H.lon[i], 2)}°E</div>`); return; }
  const code = H.d[i];
  const fl = featAt[i] || [];
  let h = `<h2>${TER_N[H.terrain[i]]}${H.feature[i] ? ' ' + FEAT_N[H.feature[i]] : ''}</h2>
  <div class="sub">${esc(dget('name', code))} district, ${esc(dget('state', code))} · ${fmt(H.lat[i], 2)}°N ${fmt(H.lon[i], 2)}°E</div>${yieldsHTML(i)}`;
  if (fl.length) h += '<h3>On this tile</h3>' + fl.map(f => `<div>${f.ic} ${esc(f.t)}</div>`).join('');
  h += `<h3>The real tile (25 km hex, ${fmt(HEXW * HEXW * .866)} km²)</h3><table class="kv">
  <tr><td>Elevation</td><td>${fmt(H.elev[i])} m (relief ${fmt(H.relief[i])} m)</td></tr>
  <tr><td>Rainfall · temperature</td><td>${fmt(H.rain[i])} mm/yr · ${fmt(H.temp[i], 1)} °C</td></tr>
  <tr><td>People (est.)</td><td>${fmt(H.pop[i])}</td></tr>
  <tr><td>GDP (est.)</td><td>${crore(H.gdp[i])}</td></tr>
  <tr><td>Farm workers · other workers</td><td>${fmt(H.farm[i])} · ${fmt(H.nonfarm[i])}</td></tr>
  <tr><td>Graduates (est.)</td><td>${fmt(H.grads[i])}</td></tr>
  <tr><td>Power capacity</td><td>${fmt(H.power[i])} MW</td></tr>
  <tr><td>Train routes through tile</td><td>${fmt(H.rail[i])}</td></tr>
  <tr><td>Earthquake index · cyclones</td><td>${H.quake[i]} · ${H.cyclone[i]} since 1970</td></tr></table>`;
  h += `<p><a href="#" data-dist="${code}">Open ${esc(dget('name', code))} district →</a></p>`;
  openPanel(h);
}
function showDistrict(code, fly) {
  const hx = distHexes[code] || []; S.highlight = new Set(hx);
  if (fly && hx.length) { let x = 0, y = 0; hx.forEach(i => { x += H.x[i]; y += H.y[i]; }); const c = hx.reduce((b, i) => (H.x[i] - x / hx.length) ** 2 + (H.y[i] - y / hx.length) ** 2 < (H.x[b] - x / hx.length) ** 2 + (H.y[b] - y / hx.length) ** 2 ? i : b, hx[0]); flyTo(c, Math.max(S.cam.s, 1.6)); }
  const g = k => dget(k, code), nat = D.national;
  const cities = CITIES.filter(c => c.d === code);
  let h = `<h2>${esc(g('name'))}</h2><div class="sub">District of ${esc(g('state'))} · ${fmt(g('area_km2'))} km² · ${hx.length} tiles</div>
  <div><span class="stat"><b>${fmt(g('Population'))}</b><span>people (2011)</span></span><span class="stat"><b>${crore(g('gdp_cr'))}</b><span>GDP est.</span></span><span class="stat"><b>₹${fmt(g('gdp_pc'))}</b><span>per person</span></span></div>`;
  if (cities.length) h += '<h3>Cities</h3>' + cities.map(c => `<span class="pill"><a href="#" data-city="${CITIES.indexOf(c)}">${esc(c.n)}</a> ${fmt(c.pop)}</span>`).join('');
  h += '<h3>Citizens (workforce)</h3>' + workforceBars(code);
  h += `<h3>Profile</h3><table class="kv">
  <tr><td>Literacy (female)</td><td>${pct(g('literacy'))} (${pct(g('female_literacy'))})</td></tr>
  <tr><td>Graduates</td><td>${pct(g('pct_graduates'))} · national ${pct(nat.pct_graduates)}</td></tr>
  <tr><td>Urban households</td><td>${pct(g('pct_urban'))}</td></tr>
  <tr><td>Sex ratio</td><td>${fmt(g('sex_ratio'))}</td></tr>
  <tr><td>SC · ST</td><td>${pct(g('pct_sc'))} · ${pct(g('pct_st'))}</td></tr>
  <tr><td>Majority faith</td><td>${esc(g('dominant_religion'))} ${pct(g('pct_' + String(g('dominant_religion')).toLowerCase()))} · diversity ${fmt(g('religious_diversity'))}</td></tr>
  <tr><td>Internet · computer</td><td>${pct(g('pct_internet'))} · ${pct(g('pct_computer'))}</td></tr>
  <tr><td>Electricity · LPG · latrine</td><td>${pct(g('pct_electricity'), 0)} · ${pct(g('pct_lpg'), 0)} · ${pct(g('pct_latrine'), 0)}</td></tr>
  <tr><td>Car · two-wheeler</td><td>${pct(g('pct_car'))} · ${pct(g('pct_twowheeler'))}</td></tr>
  <tr><td>Power capacity</td><td>${fmt(g('power_mw'))} MW</td></tr>
  <tr><td>Universities (Wikidata)</td><td>${g('universities')}</td></tr></table>`;
  openPanel(h); draw();
}
const WF = [['pct_cultivators', 'Cultivators', '#8fd04f'], ['pct_agri_labour', 'Farm labourers', '#c8b45a'], ['pct_household_ind', 'Household industry', '#c77dff'], ['pct_other_workers', 'Industry & services', '#5ab4f0']];
function workforceBars(code) {
  return '<div class="bars">' + WF.map(([k, n, c]) => {
    const v = dget(k, code), nv = D.national[k];
    return `<div class="b"><span>${n}</span><span class="track"><span class="fill" style="width:${v}%;background:${c};display:block"></span><span class="nat" style="left:${nv}%" title="national ${fmt(nv, 1)}%"></span></span><span>${fmt(v, 1)}%</span></div>`;
  }).join('') + '<div class="muted" style="font-size:11px">White tick = national share</div></div>';
}
function oneIn(v) { return v > 0 ? Math.max(1, Math.round(100 / v)) : '∞'; }

/* ---------------------------------------------------------------- City View */
const DIST_IC = { 'Palace': '👑', 'Government Plaza': '🏛️', 'Campus': '🔬', 'Commercial Hub': '💹', 'Industrial Zone': '🏭', 'Harbor': '⚓', 'Aerodrome': '✈️', 'Holy Site': '🛕', 'Theater Square': '🎭', 'Artisan Quarter': '🧵', 'Granary': '🌾', 'Preserve': '🌳', 'Neighborhood': '🏘️' };
function ring(h, k) { const set = new Set([h]); let fr = [h]; for (let s = 0; s < k; s++) { const nx = []; for (const i of fr) for (const j of nbrs(i)) if (!set.has(j)) { set.add(j); nx.push(j); } fr = nx; } return [...set]; }
let IDX = null;
function nbrs(i) {
  if (!IDX) { IDX = new Map(); for (let k = 0; k < H.N; k++) IDX.set(H.c[k] + ',' + H.r[k], k); }
  const c = H.c[i], r = H.r[i], o = r % 2;
  return [[1, 0], [-1, 0], [o, -1], [o - 1, -1], [o, 1], [o - 1, 1]].map(([dc, dr]) => IDX.get((c + dc) + ',' + (r + dr))).filter(v => v != null);
}
function cityView(c) {
  S.sel = c.h; S.highlight = new Set(ring(c.h, 3).filter(i => H.land[i])); draw();
  const code = c.d, g = k => dget(k, code), nat = D.national;
  const tiles = [...S.highlight]; const sum = k => tiles.reduce((a, i) => a + H[k][i], 0);
  const wonders = tiles.flatMap(i => (featAt[i] || []).filter(f => f.kind === 'wonder'));
  const bld = tiles.flatMap(i => (featAt[i] || []).filter(f => ['airport', 'port', 'power', 'resource'].includes(f.kind)));
  let h = `<h2>${esc(c.n)}</h2><div class="sub">${c.epithet ? '“' + esc(c.epithet) + '” · ' : ''}${esc(g('name'))} district, ${esc(g('state'))}</div>
  <div><span class="stat"><b>${fmt(c.pop)}</b><span>population · #${c.rank} of ${CITIES.length}</span></span><span class="stat"><b>${citySize(c.pop)}</b><span>city size</span></span>
  <span class="stat"><b>${esc(c.sig)}</b><span>workforce signature (${c.sigLQ}× national)</span></span></div>
  <h3>Yields of the city's 3-ring territory (${tiles.length} tiles)</h3><div class="yrow">
  ${[['food', 'Food', 'var(--food)'], ['prod', 'Production', 'var(--prod)'], ['gold', 'Gold', 'var(--gold-y)'], ['sci', 'Science', 'var(--sci)'], ['cult', 'Culture', 'var(--cult)'], ['faith', 'Faith', 'var(--faith)']].map(([k, n, col]) => `<span class="y"><span class="dot" style="background:${col}"></span>${sum(k)} ${n}</span>`).join('')}</div>
  <div class="muted">Territory GDP ≈ ${crore(tiles.reduce((a, i) => a + H.gdp[i], 0))} · people ≈ ${fmt(tiles.reduce((a, i) => a + H.pop[i], 0))}</div>
  <h3>Districts (from real specialisations)</h3>` +
    (c.districts.length ? c.districts.map(d => `<div class="district"><span class="ic">${DIST_IC[d.t] || '🏙️'}</span><div><b>${esc(d.t)}</b><div>${esc(d.why)}</div></div></div>`).join('') : '<div class="muted">No specialised districts yet — a city of the plains.</div>');
  h += '<h3>Citizens</h3>' + workforceBars(code);
  const lines = [];
  const ow = g('pct_other_workers'), cu = g('pct_cultivators'), gr = g('pct_graduates');
  lines.push(`1 in ${oneIn(ow)} workers here works in industry or services, against 1 in ${oneIn(nat.pct_other_workers)} nationally.`);
  lines.push(`1 in ${oneIn(cu)} workers farms their own land (national: 1 in ${oneIn(nat.pct_cultivators)}).`);
  lines.push(`1 in ${oneIn(gr)} people holds a degree (national: 1 in ${oneIn(nat.pct_graduates)}).`);
  if (g('pct_household_ind') > nat.pct_household_ind * 1.5) lines.push(`Household industry employs ${fmt(g('pct_household_ind'), 1)}% of workers — ${fmt(g('pct_household_ind') / nat.pct_household_ind, 1)}× the national rate.`);
  lines.push(`${fmt(g('pct_internet'), 1)}% of households were online in 2011 (national ${fmt(nat.pct_internet, 1)}%).`);
  h += lines.map(s => `<div class="one">${esc(s)}</div>`).join('');
  if (wonders.length) h += '<h3>Wonders in territory</h3>' + [...new Map(wonders.map(w => [w.t, w])).values()].map(w => `<div>${w.ic} ${esc(w.t)}</div>`).join('');
  if (bld.length) h += '<h3>Buildings & resources</h3>' + [...new Map(bld.map(w => [w.t, w])).values()].slice(0, 14).map(w => `<div>${w.ic} ${esc(w.t)}</div>`).join('');
  const pw = Object.entries(c.power).sort((a, b) => b[1] - a[1]);
  if (pw.length) h += `<h3>District power mix</h3>` + pw.map(([f, mw]) => `<span class="pill">${esc(f)} ${fmt(mw)} MW</span>`).join('');
  h += `<p><a href="#" data-dist="${code}">Full ${esc(g('name'))} district profile →</a></p>`;
  openPanel(h);
}

/* ---------------------------------------------------------------- search */
$('#search').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase(); const box = $('#searchRes');
  if (q.length < 2) { box.style.display = 'none'; return; }
  const cs = CITIES.map((c, k) => [c, k]).filter(([c]) => c.n.toLowerCase().includes(q)).slice(0, 8).map(([c, k]) => `<div data-city="${k}">🏙️ ${esc(c.n)} <small>${esc(dget('state', c.d))} · ${fmt(c.pop)}</small></div>`);
  const ds = D.codes.filter(code => dget('name', code).toLowerCase().includes(q)).slice(0, 8).map(code => `<div data-dist="${code}">📍 ${esc(dget('name', code))} <small>district, ${esc(dget('state', code))}</small></div>`);
  box.innerHTML = cs.concat(ds).join('') || '<div class="muted">No match</div>'; box.style.display = 'block';
});
$('#searchRes').addEventListener('click', () => { $('#searchRes').style.display = 'none'; $('#search').value = ''; });

/* ---------------------------------------------------------------- national top bar */
function topYields() {
  const tot = k => D.cols[k].reduce((a, b) => a + (b || 0), 0);
  $('#natYields').innerHTML = `<span>👥 <b>${fmt(tot('Population') / 1e7, 1)} cr</b> people</span><span>💰 <b>${crore(tot('gdp_cr'))}</b> GSDP</span>
  <span>⚡ <b>${fmt(tot('power_mw') / 1000, 0)} GW</b></span><span>🏙️ <b>${CITIES.length}</b> cities</span><span>🗺️ <b>${D.codes.length}</b> districts · <b>${H.land.reduce((a, b) => a + b, 0)}</b> tiles</span>`;
}

/* ---------------------------------------------------------------- advisors */
function rankTable(rows, cols) {
  return `<table class="rank"><tr>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr>${rows.map(r => `<tr class="link" ${r.attr}>${cols.map(c => `<td class="${c[2] || ''}">${c[1](r)}</td>`).join('')}</tr>`).join('')}</table>`;
}
function topDistricts(col, n = 10, asc = false, filter) {
  let codes = D.codes.filter(c => dget(col, c) != null && (!filter || filter(c)));
  codes.sort((a, b) => asc ? dget(col, a) - dget(col, b) : dget(col, b) - dget(col, a));
  return codes.slice(0, n).map(code => ({ code, attr: `data-dist="${code}"` }));
}
const distCols = (col, label, f) => [['District', r => esc(dget('name', r.code))], ['State', r => esc(dget('state', r.code)), 'muted'], [label, r => f(dget(col, r.code)), 'n']];
function stateAgg(col, weight) {
  const agg = {}; D.codes.forEach(c => { const s = dget('state', c); const w = weight ? dget(weight, c) : 1; (agg[s] ||= { s, v: 0, w: 0 }); agg[s].v += dget(col, c) * (weight ? w : 1); agg[s].w += w; });
  return Object.values(agg).map(a => ({ s: a.s, v: weight ? a.v / a.w : a.v }));
}
const ADVISORS = [
  { id: 'econ', face: '💰', name: 'Economic Advisor', sub: 'GDP & income', fn: () => {
      const tot = D.cols.gdp_cr.reduce((a, b) => a + b, 0); const sorted = [...D.cols.gdp_cr].sort((a, b) => b - a); const top = sorted.slice(0, 64).reduce((a, b) => a + b, 0);
      const st = stateAgg('gdp_cr').sort((a, b) => b.v - a.v);
      return `<div class="quote">“The top 10% of districts produce ${fmt(100 * top / tot, 0)}% of the nation's Gold. ${esc(st[0].s)} alone yields ${fmt(100 * st[0].v / tot, 0)}%.”</div>
      <div class="cols"><div><h3>Richest districts — GDP per person</h3>${rankTable(topDistricts('gdp_pc'), distCols('gdp_pc', '₹/person', v => fmt(v)))}</div>
      <div><h3>State treasuries (GSDP)</h3>${rankTable(st.slice(0, 10).map(s => ({ ...s, attr: '' })), [['State', r => esc(r.s)], ['GSDP', r => crore(r.v), 'n']])}</div></div>
      <h3>Poorest districts — GDP per person</h3>${rankTable(topDistricts('gdp_pc', 8, true), distCols('gdp_pc', '₹/person', v => fmt(v)))}`; } },
  { id: 'sci', face: '🔬', name: 'Science Advisor', sub: 'degrees & universities', fn: () => `<div class="quote">“Our Great Libraries are ranked by NIRF 2024. And 1 in ${oneIn(D.national.pct_graduates)} Indians holds a degree — but in some districts it is 1 in 5.”</div>
      <div class="cols"><div><h3>Great Libraries (NIRF 2024 overall)</h3>${rankTable(F.nirf.map(u => ({ ...u, attr: `data-hex="${u.h}"` })), [['#', r => r.rank], ['Institution', r => esc(r.full)]])}</div>
      <div><h3>Most graduates</h3>${rankTable(topDistricts('pct_graduates'), distCols('pct_graduates', 'Graduates', v => pct(v)))}</div></div>
      <h3>Most universities (Wikidata)</h3>${rankTable(topDistricts('universities', 8), distCols('universities', 'Universities', v => v))}` },
  { id: 'cult', face: '🎭', name: 'Culture Advisor', sub: 'heritage & wonders', fn: () => `<div class="quote">“India holds ${F.whs.length} World Heritage entries in our records — each a Wonder on the map.”</div>
      <h3>World Heritage Wonders</h3><div>${F.whs.map(w => `<span class="pill"><a href="#" data-hex="${w.h}">🏛️ ${esc(w.n)}</a></span>`).join('')}</div>
      <h3>Natural Wonders — largest national parks</h3>${rankTable(F.parks.filter(p => p.area).sort((a, b) => b.area - a.area).slice(0, 12).map(p => ({ ...p, attr: `data-hex="${p.h}"` })), [['Park', r => esc(r.n)], ['Area', r => fmt(r.area) + ' km²', 'n']])}` },
  { id: 'faith', face: '🕉️', name: 'Religious Advisor', sub: 'faiths & holy sites', fn: () => {
      const tot = D.cols.Population.reduce((a, b) => a + b, 0); const rel = ['hindus', 'muslims', 'christians', 'sikhs', 'buddhists', 'jains'];
      const shares = rel.map(r => [r, D.codes.reduce((a, c) => a + dget('pct_' + r, c) * dget('Population', c) / 100, 0) / tot * 100]);
      return `<div class="quote">“${shares.map(([r, s]) => r[0].toUpperCase() + r.slice(1) + ' ' + fmt(s, 1) + '%').join(' · ')}.”</div>
      <div class="cols"><div><h3>Most diverse districts</h3>${rankTable(topDistricts('religious_diversity'), distCols('religious_diversity', 'Diversity', v => fmt(v, 0)))}</div>
      <div><h3>Holy Sites</h3>${rankTable(F.holy.map(hh => ({ ...hh, attr: `data-hex="${hh.h}"` })), [['Site', r => esc(r.n)], ['Faith', r => esc(r.rel), 'muted']])}</div></div>`; } },
  { id: 'agri', face: '🌾', name: 'Agriculture Advisor', sub: 'food & farmers', fn: () => `<div class="quote">“${fmt(D.national.pct_cultivators + D.national.pct_agri_labour, 0)}% of our workers live off the land. Our rivers feed the floodplains of the north.”</div>
      <div class="cols"><div><h3>Most agrarian districts</h3>${rankTable(topDistricts('pct_farm'), distCols('pct_farm', 'Farm workers', v => pct(v)))}</div>
      <div><h3>Food-richest tiles</h3>${rankTable(topHexes('food', 10), [['Tile', r => esc(dget('name', H.d[r.i]))], ['Food', r => H.food[r.i], 'n']])}</div></div>` },
  { id: 'ind', face: '🏭', name: 'Industry Advisor', sub: 'power & mines', fn: () => {
      const fuels = {}; F.plants.forEach(p => fuels[p.f] = (fuels[p.f] || 0) + p.mw); const tot = Object.values(fuels).reduce((a, b) => a + b, 0);
      return `<div class="quote">“Coal still powers ${fmt(100 * (fuels.Coal || 0) / tot, 0)}% of our recorded generating capacity. The coal belt of Jharkhand, Odisha and Chhattisgarh is our forge.”</div>
      <div>${Object.entries(fuels).sort((a, b) => b[1] - a[1]).map(([f, mw]) => `<span class="pill">${esc(f)} ${fmt(mw / 1000, 1)} GW</span>`).join('')}</div>
      <div class="cols"><div><h3>Largest power stations</h3>${rankTable([...F.plants].sort((a, b) => b.mw - a.mw).slice(0, 12).map(p => ({ ...p, attr: `data-hex="${p.h}"` })), [['Plant', r => esc(r.n)], ['Fuel', r => esc(r.f), 'muted'], ['MW', r => fmt(r.mw), 'n']])}</div>
      <div><h3>Most power by district</h3>${rankTable(topDistricts('power_mw'), distCols('power_mw', 'MW', v => fmt(v)))}</div></div>`; } },
  { id: 'trade', face: '🚂', name: 'Trade Advisor', sub: 'rail, ports, air', fn: () => `<div class="quote">“${fmt(F.rail.length)} rail links connect our tiles; ${F.ports.filter(p => p.major).length} major ports and ${F.airports.length} scheduled airports carry our trade.”</div>
      <div class="cols"><div><h3>Busiest rail tiles</h3>${rankTable(topHexes('rail', 12), [['Tile', r => esc(cityAt[r.i]?.n || dget('name', H.d[r.i]))], ['Train routes', r => fmt(H.rail[r.i]), 'n']])}</div>
      <div><h3>Harbors</h3>${rankTable(F.ports.filter(p => p.major).map(p => ({ ...p, attr: `data-hex="${p.h}"` })), [['Major port', r => esc(r.n)]])}
      <h3>International aerodromes</h3><div>${F.airports.filter(a => a.big).map(a => `<span class="pill"><a href="#" data-hex="${a.h}">${esc(a.iata || a.n)}</a></span>`).join('')}</div></div></div>` },
  { id: 'env', face: '🌪️', name: 'Environment Advisor', sub: 'quakes & cyclones', fn: () => `<div class="quote">“${F.quakes.length} earthquakes of magnitude 6.5+ and ${F.storms.length} cyclones have struck our region in the records. The Himalaya and the Bay of Bengal coast must build to last.”</div>
      <div class="cols"><div><h3>Great earthquakes (M6.5+)</h3>${rankTable([...F.quakes].sort((a, b) => b.m - a.m).slice(0, 12).map(q => ({ ...q, attr: `data-hex="${q.h}"` })), [['Year', r => r.y], ['M', r => r.m.toFixed(1), 'n'], ['Where', r => esc(r.place), 'muted']])}</div>
      <div><h3>Fiercest cyclones (since 1970)</h3>${rankTable([...F.storms].sort((a, b) => b.w - a.w).slice(0, 12).map(s => ({ ...s, attr: '' })), [['Name', r => esc(r.n)], ['Year', r => r.y], ['Peak wind', r => r.w + ' kt', 'n']])}</div></div>
      <h3>Most cyclone-struck districts</h3>${rankTable(topDistricts('cyclones_since_1970', 8), distCols('cyclones_since_1970', 'Cyclones', v => v))}` },
  { id: 'civic', face: '🏘️', name: 'Domestic Advisor', sub: 'homes & amenities', fn: () => `<div class="quote">“In 2011, ${fmt(100 - pctNat('Having_latrine_facility_within_the_premises_Total_Households'), 0)}% of our households had no latrine at home. Sanitation and electricity remain the great domestic quests.”</div>
      <div class="cols"><div><h3>Least sanitation</h3>${rankTable(topDistricts('pct_latrine', 10, true), distCols('pct_latrine', 'Latrine', v => pct(v)))}</div>
      <div><h3>Least electricity</h3>${rankTable(topDistricts('pct_electricity', 10, true), distCols('pct_electricity', 'Electric', v => pct(v)))}</div></div>
      <h3>Most car-owning districts</h3>${rankTable(topDistricts('pct_car', 8), distCols('pct_car', 'Cars', v => pct(v)))}` },
];
function pctNat(col) { return col === 'Having_latrine_facility_within_the_premises_Total_Households' ? D.codes.reduce((a, c) => a + dget('pct_latrine', c) * dget('Households', c), 0) / D.cols.Households.reduce((a, b) => a + b, 0) : 0; }
function topHexes(k, n) { const idx = []; for (let i = 0; i < H.N; i++) if (H.land[i]) idx.push(i); idx.sort((a, b) => H[k][b] - H[k][a]); return idx.slice(0, n).map(i => ({ i, attr: `data-hex="${i}"` })); }
function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').classList.remove('hidden'); $('.modalBox').scrollTop = 0; }
$('#btnAdvisors').onclick = () => openModal('<h2>Your Advisors</h2><div class="advisors">' + ADVISORS.map(a => `<div class="adv" data-adv="${a.id}"><span class="face">${a.face}</span><div><b>${a.name}</b><small>${a.sub}</small></div></div>`).join('') +
  `<div class="adv" data-adv="explorer"><span class="face">🧭</span><div><b>Explorer</b><small>any column, any district</small></div></div></div>`);
$('#modalBody').addEventListener('click', e => {
  const a = e.target.closest('[data-adv]'); if (!a) return;
  if (a.dataset.adv === 'explorer') return explorer();
  const adv = ADVISORS.find(x => x.id === a.dataset.adv);
  openModal(`<h2>${adv.face} ${adv.name}</h2><a href="#" class="muted" data-back>← all advisors</a>` + adv.fn());
});
$('#modalBody').addEventListener('click', e => { if (e.target.closest('[data-back]')) { e.preventDefault(); $('#btnAdvisors').onclick(); } });

/* ---------------------------------------------------------------- Explorer */
const LABEL = k => k.replace(/^pct_/, '% ').replace(/_/g, ' ');
let EX = { x: 'literacy', y: 'gdp_pc', sort: 'gdp_pc', asc: false, state: '', logy: true };
function explorer() {
  const opts = sel => DCOLS.map(k => `<option value="${k}" ${k === sel ? 'selected' : ''}>${LABEL(k)}</option>`).join('');
  const states = [...new Set(D.cols.state)].sort();
  openModal(`<h2>🧭 Explorer</h2><div class="muted">Every column for all ${D.codes.length} Census-2011 districts. Click a row or dot to show it on the map; “Map it” turns a column into a lens.</div>
  <div class="controls" style="margin-top:10px"><label>X <select id="exX">${opts(EX.x)}</select></label><label>Y <select id="exY">${opts(EX.y)}</select></label>
  <label><input type="checkbox" id="exLog" ${EX.logy ? 'checked' : ''}> log Y</label>
  <label>State <select id="exS"><option value="">All India</option>${states.map(s => `<option ${s === EX.state ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
  <button class="btn" id="exMap">Map Y as lens</button><span id="exR" class="muted"></span></div>
  <div class="explorer"><canvas id="scatter"></canvas><div class="tablewrap" id="exTable"></div></div>`);
  ['exX', 'exY', 'exS', 'exLog'].forEach(id => $('#' + id).onchange = () => { EX.x = $('#exX').value; EX.y = $('#exY').value; EX.state = $('#exS').value; EX.logy = $('#exLog').checked; exRender(); });
  $('#exMap').onclick = () => { S.custom = { id: 'custom', label: LABEL(EX.y), icon: '🧭', kind: 'district', col: EX.y, scale: 'viridis', log: EX.logy && Math.min(...D.cols[EX.y].filter(v => v != null)) > 0, fmt: v => fmt(v, 2), note: 'custom lens from Explorer' }; $('#modal').classList.add('hidden'); setLens('custom'); };
  exRender();
}
function exRows() { return D.codes.filter(c => (!EX.state || dget('state', c) === EX.state) && dget(EX.x, c) != null && dget(EX.y, c) != null); }
function pearson(xs, ys) { const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n; let a = 0, b = 0, c = 0; for (let i = 0; i < n; i++) { a += (xs[i] - mx) * (ys[i] - my); b += (xs[i] - mx) ** 2; c += (ys[i] - my) ** 2; } return a / Math.sqrt(b * c); }
let exPts = [];
function exRender() {
  const rows = exRows(); const sc = $('#scatter'); const dpr = window.devicePixelRatio || 1;
  const w = sc.clientWidth, h = sc.clientHeight; sc.width = w * dpr; sc.height = h * dpr; const c = sc.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const ly = EX.logy && rows.every(r => dget(EX.y, r) > 0);
  const X = rows.map(r => dget(EX.x, r)), Y = rows.map(r => ly ? Math.log10(dget(EX.y, r)) : dget(EX.y, r));
  const ext = a => { const s = [...a].sort((p, q) => p - q); return [s[0], s[s.length - 1]]; };
  const [x0, x1] = ext(X), [y0, y1] = ext(Y); const m = { l: 52, r: 12, t: 12, b: 34 };
  const sx = v => m.l + (v - x0) / ((x1 - x0) || 1) * (w - m.l - m.r), sy = v => h - m.b - (v - y0) / ((y1 - y0) || 1) * (h - m.t - m.b);
  c.fillStyle = '#0a151d'; c.fillRect(0, 0, w, h); c.strokeStyle = '#2d4a5c'; c.fillStyle = '#9fb0b8'; c.font = '11px Inter'; c.textAlign = 'center';
  for (let k = 0; k <= 4; k++) { const vx = x0 + (x1 - x0) * k / 4, vy = y0 + (y1 - y0) * k / 4; c.beginPath(); c.moveTo(sx(vx), m.t); c.lineTo(sx(vx), h - m.b); c.moveTo(m.l, sy(vy)); c.lineTo(w - m.r, sy(vy)); c.stroke(); c.fillText(fmt(vx, 1), sx(vx), h - m.b + 14); c.textAlign = 'right'; c.fillText(fmt(ly ? 10 ** vy : vy, 1), m.l - 4, sy(vy) + 4); c.textAlign = 'center'; }
  c.fillStyle = '#e9e2cf'; c.fillText(LABEL(EX.x), (w + m.l) / 2, h - 4); c.save(); c.translate(12, h / 2); c.rotate(-Math.PI / 2); c.fillText(LABEL(EX.y) + (ly ? ' (log)' : ''), 0, 0); c.restore();
  exPts = rows.map((r, k) => ({ code: r, x: sx(X[k]), y: sy(Y[k]) }));
  const sel = S.highlight && S.exSel;
  for (const p of exPts) { const s = dget('state', p.code); c.fillStyle = `hsla(${hashHue(s)},70%,60%,0.75)`; c.beginPath(); c.arc(p.x, p.y, p.code === S.exSel ? 6 : 3.2, 0, 7); c.fill(); if (p.code === S.exSel) { c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke(); } }
  $('#exR').textContent = `n = ${rows.length} · r = ${fmt(pearson(X, Y), 2)}`;
  sc.onclick = e => { const b = sc.getBoundingClientRect(); const mx = e.clientX - b.left, my = e.clientY - b.top; let best = null, bd = 100; for (const p of exPts) { const d = (p.x - mx) ** 2 + (p.y - my) ** 2; if (d < bd) { bd = d; best = p; } } if (best) { S.exSel = best.code; showDistrict(best.code, true); exRender(); } };
  sc.onmousemove = e => { const b = sc.getBoundingClientRect(); const mx = e.clientX - b.left, my = e.clientY - b.top; let best = null, bd = 64; for (const p of exPts) { const d = (p.x - mx) ** 2 + (p.y - my) ** 2; if (d < bd) { bd = d; best = p; } } sc.title = best ? `${dget('name', best.code)}, ${dget('state', best.code)}\n${LABEL(EX.x)}: ${fmt(dget(EX.x, best.code), 2)}\n${LABEL(EX.y)}: ${fmt(dget(EX.y, best.code), 2)}` : ''; };
  // table
  const sk = EX.sort; const tr = [...rows].sort((a, b) => (EX.asc ? 1 : -1) * ((dget(sk, a) ?? -1e18) - (dget(sk, b) ?? -1e18)));
  const cols = [...new Set([EX.x, EX.y, 'Population', 'gdp_pc'])];
  $('#exTable').innerHTML = `<table class="rank"><tr><th>District</th><th class="muted">State</th>${cols.map(k => `<th data-sort="${k}">${LABEL(k)}${sk === k ? (EX.asc ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr>` +
    tr.map(r => `<tr class="link" data-exd="${r}" ${r === S.exSel ? 'style="background:#2b4a5e"' : ''}><td>${esc(dget('name', r))}</td><td class="muted">${esc(dget('state', r))}</td>${cols.map(k => `<td class="n">${fmt(dget(k, r), 1)}</td>`).join('')}</tr>`).join('') + '</table>';
  $('#exTable').onclick = e => { const th = e.target.closest('[data-sort]'); if (th) { if (EX.sort === th.dataset.sort) EX.asc = !EX.asc; else { EX.sort = th.dataset.sort; EX.asc = false; } return exRender(); } const row = e.target.closest('[data-exd]'); if (row) { S.exSel = +row.dataset.exd; showDistrict(S.exSel, true); exRender(); } };
}
function hashHue(s) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; }
$('#btnExplorer').onclick = explorer;

/* ---------------------------------------------------------------- about */
$('#btnAbout').onclick = () => openModal(`<h2>About BharatCiv</h2>
<p>A Civilization-style map of India where every tile, yield, city district, wonder and advisor is computed from real public data, reconciled onto one 25&nbsp;km hex grid (equal-area Lambert projection, ~${H.land.reduce((a, b) => a + b, 0)} land tiles). Inspired by Andrej Karpathy's <a href="https://karpathy.ai/usaciv/" target="_blank" rel="noopener">USA Civ</a>.</p>
<h3>How the data becomes Civ</h3><ul>
<li><b>Terrain</b>: SRTM elevation & relief → hills/mountains; NASA POWER rainfall & temperature → desert/plains/grassland/tundra/snow; forests where it is wet <i>and</i> sparsely populated; floodplains on rivers in dry plains.</li>
<li><b>Food</b> = terrain + rivers + real farm workforce. <b>Production</b> = hills/forest + power stations + mines + non-farm jobs. <b>Gold</b> = GDP (state GSDP split to districts by Census household-income brackets, then to tiles by town populations). <b>Science</b> = graduates + universities. <b>Culture</b> = World Heritage + national parks. <b>Faith</b> = major pilgrimage sites.</li>
<li><b>City districts</b> are rules on real data: Campus = NIRF top-10 institution or 1.6× national graduates; Industrial Zone = ≥1.5 GW power in district or mines; Harbor = port; Aerodrome = scheduled airport; Granary = &gt;65% farm workers; Artisan Quarter = 2× national household industry; etc.</li>
<li><b>Wonders</b>: UNESCO World Heritage sites (Wikidata), the 12 largest national parks (by area), NIRF 2024 top-10 institutions, and major pilgrimage sites of each faith.</li></ul>
<h3>Sources</h3><ul class="src">
<li>Census of India 2011 — district primary census abstract, religion, education, households & amenities (via <a href="https://github.com/nishusharma1608/India-Census-2011-Analysis" target="_blank" rel="noopener">compiled CSV</a>)</li>
<li>Census 2011 district boundaries — <a href="https://github.com/datameet/maps" target="_blank" rel="noopener">DataMeet maps</a></li>
<li>State GSDP — <a href="https://en.wikipedia.org/wiki/List_of_Indian_states_and_union_territories_by_GDP" target="_blank" rel="noopener">MoSPI figures via Wikipedia</a></li>
<li>Elevation — SRTM 90 m via <a href="https://www.opentopodata.org/" target="_blank" rel="noopener">OpenTopoData</a></li>
<li>Climate — <a href="https://power.larc.nasa.gov/" target="_blank" rel="noopener">NASA POWER</a> climatology</li>
<li>Rivers — <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a></li>
<li>Power plants — <a href="https://datasets.wri.org/dataset/globalpowerplantdatabase" target="_blank" rel="noopener">WRI Global Power Plant Database</a></li>
<li>Railways — stations & train routes from <a href="https://github.com/datameet/railways" target="_blank" rel="noopener">DataMeet railways</a></li>
<li>Airports — <a href="https://ourairports.com/data/" target="_blank" rel="noopener">OurAirports</a></li>
<li>Earthquakes — <a href="https://earthquake.usgs.gov/fdsnws/event/1/" target="_blank" rel="noopener">USGS ComCat</a> (M4.5+, 1900–today)</li>
<li>Cyclones — <a href="https://www.ncei.noaa.gov/products/international-best-track-archive" target="_blank" rel="noopener">NOAA IBTrACS</a> North Indian basin</li>
<li>Cities & towns — <a href="https://www.geonames.org/" target="_blank" rel="noopener">GeoNames</a></li>
<li>World Heritage, national parks, universities, ports, mines, dams — <a href="https://query.wikidata.org/" target="_blank" rel="noopener">Wikidata</a></li>
<li>University ranks — <a href="https://www.nirfindia.org/" target="_blank" rel="noopener">NIRF 2024</a> (overall)</li></ul>
<h3>Caveats</h3><p class="muted">Census figures are from 2011 (the latest full census); districts and states follow 2011 boundaries, with Telangana and Ladakh split out for GDP. GDP below state level is a modelled estimate. Terrain is climate-derived, not satellite land cover. Wikidata coverage of ports, mines and universities is incomplete.</p>
<p><a href="https://github.com/prathmesh-garule/bharatciv" id="srcLink" target="_blank" rel="noopener">Source code on GitHub</a></p>`);
