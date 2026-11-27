/* Illustrated, shaded map sprites (Civ-style): terrain props + resource/building/wonder badges.
   Each sprite is painted once to an offscreen canvas (gradients, highlights, soft shadows) and blitted. */
'use strict';
const SPRITES = (() => {
  const SZ = 128, cache = new Map();
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = SZ; const g = c.getContext('2d'); g.translate(SZ / 2, SZ / 2); return [c, g]; };
  const lin = (g, x0, y0, x1, y1, stops) => { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; };
  const rad = (g, x, y, r, stops, fx = x, fy = y) => { const gr = g.createRadialGradient(fx, fy, 0, x, y, r); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; };
  const shadowEllipse = (g, x, y, rx, ry, a = 0.35) => { g.save(); g.translate(x, y); g.scale(1, ry / rx); g.fillStyle = rad(g, 0, 0, rx, [[0, `rgba(0,0,0,${a})`], [1, 'rgba(0,0,0,0)']]); g.beginPath(); g.arc(0, 0, rx, 0, 7); g.fill(); g.restore(); };
  const soft = (g, blur = 6, oy = 3, a = 0.45) => { g.shadowColor = `rgba(0,0,0,${a})`; g.shadowBlur = blur; g.shadowOffsetY = oy; };
  const noSoft = g => { g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0; };

  /* ---------------- terrain props ---------------- */
  function broadTree(g, x, y, s, dark) {
    g.fillStyle = lin(g, x - 3 * s, 0, x + 3 * s, 0, [[0, '#7a5232'], [1, '#3e2814']]); g.fillRect(x - 3 * s, y - 6 * s, 6 * s, 16 * s);
    const lobes = [[-9, -12, 11], [9, -13, 11], [0, -22, 13], [0, -10, 12]];
    for (const [dx, dy, r] of lobes) {
      g.fillStyle = rad(g, x + dx * s, y + dy * s, r * s, dark ? [[0, '#5fae4a'], [0.55, '#2b6e2a'], [1, '#143d17']] : [[0, '#a6dd6a'], [0.55, '#4e9c34'], [1, '#22541c']], x + (dx - r * 0.4) * s, y + (dy - r * 0.45) * s);
      g.beginPath(); g.arc(x + dx * s, y + dy * s, r * s, 0, 7); g.fill();
    }
  }
  function pineTree(g, x, y, s) {
    g.fillStyle = '#4a2f18'; g.fillRect(x - 2.5 * s, y - 4 * s, 5 * s, 12 * s);
    for (let k = 0; k < 3; k++) {
      const w = (15 - k * 3.5) * s, top = y - (14 + k * 10) * s, base = y - (k * 9) * s;
      g.fillStyle = lin(g, x - w, 0, x + w, 0, [[0, '#7fbf5a'], [0.48, '#3f8a3a'], [0.52, '#245c28'], [1, '#163f1c']]);
      g.beginPath(); g.moveTo(x, top - 6 * s); g.lineTo(x + w, base); g.quadraticCurveTo(x, base + 4 * s, x - w, base); g.closePath(); g.fill();
    }
  }
  function palm(g, x, y, s) {
    g.strokeStyle = lin(g, x - 3, 0, x + 3, 0, [[0, '#9a7347'], [1, '#5a3d1e']]); g.lineWidth = 4.5 * s; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, y + 6 * s); g.quadraticCurveTo(x + 6 * s, y - 12 * s, x + 2 * s, y - 28 * s); g.stroke();
    const cx = x + 2 * s, cy = y - 28 * s;
    for (let k = 0; k < 7; k++) {
      const a = -Math.PI + k * Math.PI / 6 + 0.1; const L = 20 * s;
      g.fillStyle = lin(g, cx, cy, cx + Math.cos(a) * L, cy + Math.sin(a) * L, [[0, '#2f7a2c'], [1, '#86c95a']]);
      g.beginPath(); g.moveTo(cx, cy); g.quadraticCurveTo(cx + Math.cos(a - 0.3) * L * 0.7, cy + Math.sin(a - 0.3) * L * 0.7 - 6 * s, cx + Math.cos(a) * L, cy + Math.sin(a) * L + 6 * s);
      g.quadraticCurveTo(cx + Math.cos(a + 0.3) * L * 0.6, cy + Math.sin(a + 0.3) * L * 0.6, cx, cy); g.fill();
    }
  }
  const DRAW = {
    forest(g) { shadowEllipse(g, 0, 30, 46, 14); [[-22, 22, 0.9, 0], [20, 26, 0.95, 1], [-2, 12, 1.05, 0], [-28, 34, 0.75, 1], [28, 38, 0.8, 0]].sort((a, b) => a[1] - b[1]).forEach(([x, y, s, k]) => broadTree(g, x, y, s * 1.15, k)); },
    pines(g) { shadowEllipse(g, 0, 32, 46, 13); [[-20, 22, 1.1], [18, 24, 1.15], [0, 14, 1.3], [-30, 36, 0.9], [30, 38, 0.95]].sort((a, b) => a[1] - b[1]).forEach(([x, y, s]) => pineTree(g, x, y, s)); },
    jungle(g) { shadowEllipse(g, 0, 32, 48, 14); broadTree(g, -24, 26, 1.0, 1); palm(g, 12, 30, 1.25); broadTree(g, 26, 34, 0.9, 1); palm(g, -10, 38, 1.0); },
    mountain(g, snowy) {
      shadowEllipse(g, 4, 38, 54, 12, 0.45);
      const peak = (px, py, w, h, cap) => {
        g.fillStyle = lin(g, px - w, 0, px + w, 0, [[0, '#b9ad9b'], [0.5, '#8d8070'], [0.5, '#5d5348'], [1, '#3b342d']]);
        g.beginPath(); g.moveTo(px - w, py + h); g.lineTo(px - w * 0.15, py + 4); g.lineTo(px, py); g.lineTo(px + w * 0.2, py + 6); g.lineTo(px + w, py + h); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(40,30,20,0.35)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(px, py); g.lineTo(px + w * 0.05, py + h); g.stroke();
        if (cap) {
          g.fillStyle = lin(g, px - w * 0.4, 0, px + w * 0.4, 0, [[0, '#ffffff'], [0.5, '#eef3f8'], [0.5, '#c9d4e0'], [1, '#aab8c8']]);
          g.beginPath(); g.moveTo(px, py); g.lineTo(px - w * 0.36, py + h * 0.36); g.lineTo(px - w * 0.18, py + h * 0.3); g.lineTo(px - w * 0.05, py + h * 0.4); g.lineTo(px + w * 0.12, py + h * 0.28); g.lineTo(px + w * 0.38, py + h * 0.37); g.closePath(); g.fill();
        }
      };
      peak(24, -18, 30, 54, snowy); peak(-16, -40, 42, 76, true);
    },
    hills(g) {
      shadowEllipse(g, 0, 34, 52, 12, 0.4);
      const mound = (x, y, w, h) => { g.fillStyle = rad(g, x, y + h, w * 1.1, [[0, '#c7c27a'], [0.5, '#8f9a4c'], [1, '#55602a']], x - w * 0.35, y); g.beginPath(); g.moveTo(x - w, y + h); g.bezierCurveTo(x - w * 0.6, y - h * 0.15, x + w * 0.5, y - h * 0.2, x + w, y + h); g.closePath(); g.fill(); };
      mound(22, 0, 40, 36); mound(-16, -14, 46, 50);
      g.strokeStyle = 'rgba(60,70,20,0.5)'; g.lineWidth = 2; g.lineCap = 'round';
      for (const [x, y] of [[-26, 24], [-10, 14], [22, 24], [6, 30]]) { g.beginPath(); g.moveTo(x, y); g.lineTo(x - 2, y - 6); g.moveTo(x + 3, y); g.lineTo(x + 4, y - 7); g.stroke(); }
    },
    wheat(g) {
      shadowEllipse(g, 0, 30, 40, 9, 0.25);
      for (let k = -3; k <= 3; k++) {
        const x = k * 9, y = 28 - Math.abs(k) * 2;
        g.strokeStyle = '#a88a2c'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 2, y - 18, x + 4, y - 30); g.stroke();
        for (let j = 0; j < 5; j++) { g.fillStyle = lin(g, x, y - 30, x + 6, y - 14, [[0, '#ffe58a'], [1, '#c99a2e']]); g.beginPath(); g.ellipse(x + 4 + (j % 2 ? 3 : -3), y - 30 + j * 4, 2.6, 4.5, j % 2 ? 0.5 : -0.5, 0, 7); g.fill(); }
      }
    },
    reeds(g) {
      shadowEllipse(g, 0, 28, 40, 9, 0.25);
      g.fillStyle = 'rgba(70,130,150,0.55)'; g.beginPath(); g.ellipse(0, 26, 38, 9, 0, 0, 7); g.fill();
      for (let k = -4; k <= 4; k++) {
        const x = k * 7; g.strokeStyle = '#4f7a3a'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(x, 26); g.quadraticCurveTo(x + k, 0, x + k * 2, -22 - (k % 2) * 6); g.stroke();
        if (k % 2 === 0) { g.fillStyle = lin(g, 0, -30, 0, -12, [[0, '#8a5a2a'], [1, '#5a3612']]); g.beginPath(); g.ellipse(x + k * 1.6, -16 - (k % 2) * 6, 3, 7, 0, 0, 7); g.fill(); }
      }
    },
  };

  /* ---------------- badges (resource / building / wonder medallions) ---------------- */
  function badge(g, c1, c2, rim = 'gold') {
    soft(g, 10, 5, 0.55);
    g.fillStyle = rim === 'gold' ? lin(g, 0, -50, 0, 50, [[0, '#fff1b8'], [0.35, '#e0b24e'], [0.7, '#9a6a1c'], [1, '#e8c26a']]) : lin(g, 0, -50, 0, 50, [[0, '#f2f5f8'], [0.5, '#9aa7b2'], [1, '#e2e8ee']]);
    g.beginPath(); g.arc(0, 0, 50, 0, 7); g.fill(); noSoft(g);
    g.fillStyle = rad(g, 0, 0, 44, [[0, c1], [1, c2]], -14, -18); g.beginPath(); g.arc(0, 0, 42, 0, 7); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2; g.stroke();
  }
  function gloss(g) { g.save(); g.beginPath(); g.arc(0, 0, 42, 0, 7); g.clip(); g.fillStyle = lin(g, 0, -42, 0, 4, [[0, 'rgba(255,255,255,0.38)'], [1, 'rgba(255,255,255,0)']]); g.beginPath(); g.ellipse(0, -18, 36, 24, 0, 0, 7); g.fill(); g.restore(); }
  const WHITE = g => lin(g, 0, -28, 0, 28, [[0, '#ffffff'], [1, '#cfd8e0']]);
  const SYM = {
    airport(g) { badge(g, '#4aa3e8', '#123d6e'); g.save(); g.rotate(Math.PI / 4); soft(g, 4, 2, 0.5); g.fillStyle = WHITE(g);
      g.beginPath(); g.moveTo(0, -28); g.quadraticCurveTo(5, -24, 5, -15); g.lineTo(5, -6); g.lineTo(28, 7); g.lineTo(28, 12); g.lineTo(5, 6); g.lineTo(5, 17); g.lineTo(12, 23); g.lineTo(12, 27); g.lineTo(0, 24); g.lineTo(-12, 27); g.lineTo(-12, 23); g.lineTo(-5, 17); g.lineTo(-5, 6); g.lineTo(-28, 12); g.lineTo(-28, 7); g.lineTo(-5, -6); g.lineTo(-5, -15); g.quadraticCurveTo(-5, -24, 0, -28); g.fill(); g.restore(); gloss(g); },
    port(g) { badge(g, '#3fb8b0', '#0e4a52'); soft(g, 4, 2, 0.5); g.strokeStyle = lin(g, 0, -28, 0, 28, [[0, '#ffe9a6'], [1, '#c9902c']]); g.lineWidth = 6; g.lineCap = 'round';
      g.beginPath(); g.arc(0, -22, 6, 0, 7); g.stroke(); g.beginPath(); g.moveTo(0, -16); g.lineTo(0, 26); g.moveTo(-13, -8); g.lineTo(13, -8); g.stroke();
      g.beginPath(); g.arc(0, 4, 22, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke(); g.fillStyle = '#e8b94c';
      for (const sgn of [-1, 1]) { const x = sgn * 22 * Math.cos(0.2 * Math.PI), y = 4 + 22 * Math.sin(0.2 * Math.PI); g.beginPath(); g.moveTo(x + sgn * 6, y - 8); g.lineTo(x + sgn * 4, y + 4); g.lineTo(x - sgn * 7, y - 1); g.fill(); }
      gloss(g); },
    coal(g) { badge(g, '#6b6f78', '#1d1f24', 'silver'); soft(g, 5, 3, 0.6);
      for (const [x, y, r] of [[-12, 8, 15], [12, 10, 14], [0, -10, 16]]) { g.fillStyle = rad(g, x, y, r, [[0, '#5a5e66'], [0.6, '#24262b'], [1, '#0b0c0e']], x - r * 0.4, y - r * 0.5); g.beginPath();
        for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2, rr = r * (0.8 + 0.25 * ((k * 37) % 5) / 5); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(x - r * 0.35, y - r * 0.45, r * 0.3, r * 0.15, -0.6, 0, 7); g.fill(); }
      gloss(g); },
    hydro(g) { badge(g, '#7fd0ff', '#0d4f8a'); soft(g, 5, 3, 0.5);
      g.fillStyle = lin(g, -20, -26, 20, 30, [[0, '#d8f3ff'], [0.45, '#3fa8ef'], [1, '#0a4f9e']]); g.beginPath(); g.moveTo(0, -30); g.bezierCurveTo(10, -14, 22, -2, 22, 10); g.arc(0, 10, 22, 0, Math.PI); g.bezierCurveTo(-22, -2, -10, -14, 0, -30); g.fill();
      noSoft(g); g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.ellipse(-9, 4, 4, 9, -0.4, 0, 7); g.fill(); gloss(g); },
    nuclear(g) { badge(g, '#9be36b', '#1f5a24'); soft(g, 5, 3, 0.5);
      g.fillStyle = 'rgba(255,255,255,0.9)'; for (const [x, y, r] of [[-4, -30, 9], [6, -34, 8], [12, -26, 7]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
      g.fillStyle = lin(g, -18, 0, 18, 0, [[0, '#f4f6f8'], [0.5, '#b9c3cc'], [1, '#6c7782']]); g.beginPath(); g.moveTo(-18, 28); g.quadraticCurveTo(-6, 2, -13, -20); g.lineTo(13, -20); g.quadraticCurveTo(6, 2, 18, 28); g.closePath(); g.fill();
      noSoft(g); g.fillStyle = '#3b4650'; g.beginPath(); g.ellipse(0, -20, 13, 3.5, 0, 0, 7); g.fill(); gloss(g); },
    solar(g) { badge(g, '#ffd36b', '#b8560f'); soft(g, 5, 3, 0.5); g.fillStyle = '#3a3f46'; g.fillRect(-2, 6, 4, 20);
      g.save(); g.transform(1, 0, -0.45, 0.7, 0, 0); g.fillStyle = lin(g, -26, -30, 26, 20, [[0, '#7cc4ff'], [0.5, '#1f5ea8'], [1, '#0b2a55']]); g.fillRect(-24, -30, 48, 38);
      noSoft(g); g.strokeStyle = 'rgba(220,240,255,0.7)'; g.lineWidth = 1.4; for (let k = -12; k <= 12; k += 12) { g.beginPath(); g.moveTo(k, -30); g.lineTo(k, 8); g.stroke(); } for (let k = -18; k <= 2; k += 10) { g.beginPath(); g.moveTo(-24, k); g.lineTo(24, k); g.stroke(); } g.restore(); gloss(g); },
    wind(g) { badge(g, '#a9e4ff', '#2a6d9a'); soft(g, 4, 2, 0.45); g.fillStyle = lin(g, -3, 0, 3, 0, [[0, '#ffffff'], [1, '#aab6c0']]);
      g.beginPath(); g.moveTo(-2, -10); g.lineTo(2, -10); g.lineTo(4, 30); g.lineTo(-4, 30); g.fill();
      for (let k = 0; k < 3; k++) { g.save(); g.translate(0, -12); g.rotate(k * Math.PI * 2 / 3 + 0.3); g.fillStyle = WHITE(g); g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(6, -14, 2, -30); g.quadraticCurveTo(-2, -14, -3, 0); g.fill(); g.restore(); }
      g.fillStyle = '#e8eef3'; g.beginPath(); g.arc(0, -12, 4.5, 0, 7); g.fill(); gloss(g); },
    gas(g) { badge(g, '#ffb36b', '#7a1d0d'); soft(g, 6, 2, 0.5);
      g.fillStyle = lin(g, 0, -30, 0, 28, [[0, '#fff7b0'], [0.4, '#ffb52e'], [1, '#d6361a']]); g.beginPath(); g.moveTo(0, -30); g.bezierCurveTo(16, -10, 22, 4, 15, 17); g.quadraticCurveTo(0, 32, -15, 17); g.bezierCurveTo(-22, 4, -6, -6, 0, -30); g.fill();
      noSoft(g); g.fillStyle = lin(g, 0, -4, 0, 24, [[0, '#ffffff'], [1, '#ffe27a']]); g.beginPath(); g.moveTo(0, -4); g.bezierCurveTo(8, 6, 10, 12, 6, 19); g.quadraticCurveTo(0, 25, -6, 19); g.bezierCurveTo(-10, 12, -4, 6, 0, -4); g.fill(); gloss(g); },
    oil(g) { badge(g, '#c9a46b', '#3a2610'); soft(g, 5, 3, 0.5);
      g.fillStyle = lin(g, -18, 0, 18, 0, [[0, '#1d1d1d'], [0.35, '#5a5a5a'], [1, '#111']]); g.fillRect(-18, -22, 36, 46);
      noSoft(g); g.fillStyle = '#6a6a6a'; g.beginPath(); g.ellipse(0, -22, 18, 5, 0, 0, 7); g.fill(); g.fillStyle = '#c9902c'; g.fillRect(-18, -8, 36, 4); g.fillRect(-18, 10, 36, 4); gloss(g); },
    biomass(g) { badge(g, '#c7e36b', '#3d5a14'); DRAW.wheat(g); gloss(g); },
    iron(g) { ingots(g, ['#d8dde3', '#8a96a3', '#4b5561'], '#7d8a99', '#262c33'); },
    copper(g) { ingots(g, ['#ffd0a6', '#d9783a', '#7a3412'], '#e09060', '#4a1e08'); },
    aluminium(g) { ingots(g, ['#ffffff', '#c8d0d8', '#8a96a2'], '#b9c4ce', '#3c4650'); },
    zinc(g) { ingots(g, ['#eef4f8', '#9eb2c2', '#5a6e7e'], '#9fb3c4', '#2a3844'); },
    manganese(g) { ingots(g, ['#e8d6f2', '#8e6aa8', '#45305a'], '#a585c0', '#2a1838'); },
    gold(g) { badge(g, '#ffe27a', '#7a4a0a'); soft(g, 5, 3, 0.55); g.fillStyle = rad(g, 0, 4, 26, [[0, '#fff6c2'], [0.4, '#f5c636'], [1, '#9a650c']], -8, -6);
      g.beginPath(); g.moveTo(-22, 8); g.bezierCurveTo(-24, -12, -6, -20, 4, -14); g.bezierCurveTo(18, -18, 26, -2, 20, 10); g.bezierCurveTo(14, 24, -14, 26, -22, 8); g.fill(); noSoft(g);
      g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.ellipse(-8, -6, 6, 3, -0.5, 0, 7); g.fill(); gloss(g); },
    diamond(g) { badge(g, '#b8f4ff', '#145a7a'); soft(g, 5, 3, 0.5);
      const F = [['#e8fdff', [[-24, -8], [-12, -22], [0, -8]]], ['#9fe8ff', [[-12, -22], [12, -22], [0, -8]]], ['#62c6f0', [[12, -22], [24, -8], [0, -8]]], ['#bff3ff', [[-24, -8], [0, -8], [0, 28]]], ['#2f9fd6', [[0, -8], [24, -8], [0, 28]]]];
      for (const [c, pts] of F) { g.fillStyle = c; g.beginPath(); pts.forEach(([x, y], k) => k ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill(); }
      noSoft(g); g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-24, -8); g.lineTo(24, -8); g.stroke(); gloss(g); },
    uranium(g) { badge(g, '#c8ff6b', '#2a4a0a'); g.fillStyle = rad(g, 0, 2, 30, [[0, '#f4ff9a'], [0.4, '#7fe02e'], [1, 'rgba(40,90,10,0)']]); g.beginPath(); g.arc(0, 2, 30, 0, 7); g.fill();
      soft(g, 4, 2, 0.5); g.fillStyle = rad(g, 0, 4, 20, [[0, '#d6ff7a'], [1, '#3f7a12']], -6, -4); g.beginPath(); for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, r = 16 + (k % 3) * 3; g.lineTo(Math.cos(a) * r, 4 + Math.sin(a) * r * 0.8); } g.closePath(); g.fill(); gloss(g); },
    limestone(g) { badge(g, '#f2eee2', '#8a8270', 'silver'); soft(g, 4, 3, 0.45); for (const [x, y, w, h] of [[-20, 4, 22, 18], [2, 6, 20, 16], [-10, -14, 22, 18]]) { g.fillStyle = lin(g, x, y, x + w, y + h, [[0, '#ffffff'], [1, '#bdb6a2']]); g.fillRect(x, y, w, h); } gloss(g); },
    marble(g) { SYM.limestone(g); },
    mica(g) { badge(g, '#f2e6ff', '#6a5a8a', 'silver'); soft(g, 4, 2, 0.4); for (let k = 0; k < 4; k++) { g.fillStyle = `rgba(255,255,255,${0.5 + k * 0.12})`; g.beginPath(); g.moveTo(-18 + k * 4, 18 - k * 8); g.lineTo(14 + k * 3, 12 - k * 8); g.lineTo(18 + k * 2, -2 - k * 8); g.lineTo(-12 + k * 3, 2 - k * 8); g.closePath(); g.fill(); } gloss(g); },
    salt(g) { badge(g, '#ffffff', '#6a8aa0', 'silver'); soft(g, 4, 3, 0.4); g.fillStyle = lin(g, 0, -10, 0, 26, [[0, '#ffffff'], [1, '#c9d6e0']]); g.beginPath(); g.moveTo(-26, 24); g.lineTo(0, -16); g.lineTo(26, 24); g.closePath(); g.fill(); gloss(g); },
    mine(g) { badge(g, '#c9b08a', '#4a3416'); soft(g, 4, 3, 0.5); g.lineCap = 'round';
      g.strokeStyle = lin(g, -20, 20, 20, -20, [[0, '#6a4520'], [1, '#b08050']]); g.lineWidth = 6; g.beginPath(); g.moveTo(-18, 22); g.lineTo(16, -16); g.stroke();
      g.strokeStyle = lin(g, -24, -24, 24, 0, [[0, '#f4f6f8'], [1, '#6a7480']]); g.lineWidth = 7; g.beginPath(); g.arc(4, 6, 30, -2.2, -0.75); g.stroke(); gloss(g); },
    whs(g) { badge(g, '#c0392b', '#4a0d0d'); soft(g, 4, 3, 0.5);
      g.fillStyle = lin(g, -28, 0, 28, 0, [[0, '#ffffff'], [0.5, '#f4ecdc'], [1, '#bfae92']]);
      g.fillRect(-26, 8, 52, 18); g.fillRect(-30, -18, 4, 44); g.fillRect(26, -18, 4, 44);
      g.beginPath(); g.moveTo(-15, 8); g.bezierCurveTo(-22, -6, -8, -16, 0, -24); g.bezierCurveTo(8, -16, 22, -6, 15, 8); g.closePath(); g.fill();
      noSoft(g); g.fillStyle = '#e8c26a'; g.fillRect(-1, -32, 2, 9); g.beginPath(); g.arc(-28, -20, 3, 0, 7); g.arc(28, -20, 3, 0, 7); g.fill();
      g.fillStyle = '#6a4a2a'; g.beginPath(); g.moveTo(-5, 26); g.lineTo(-5, 16); g.quadraticCurveTo(0, 10, 5, 16); g.lineTo(5, 26); g.fill(); gloss(g); },
    temple(g) { badge(g, '#ff9f3a', '#7a2a06'); soft(g, 4, 3, 0.5);
      g.fillStyle = lin(g, -20, 0, 20, 0, [[0, '#ffe2b0'], [0.5, '#f0a040'], [1, '#a65a14']]);
      g.beginPath(); g.moveTo(-20, 26); g.lineTo(-16, 4); g.quadraticCurveTo(-12, -16, 0, -26); g.quadraticCurveTo(12, -16, 16, 4); g.lineTo(20, 26); g.closePath(); g.fill();
      noSoft(g); g.strokeStyle = 'rgba(120,50,0,0.45)'; g.lineWidth = 1.5; for (const y of [-10, 0, 10]) { g.beginPath(); g.moveTo(-16, y + 4); g.lineTo(16, y + 4); g.stroke(); }
      g.fillStyle = '#e8c26a'; g.beginPath(); g.arc(0, -28, 3.5, 0, 7); g.fill(); g.strokeStyle = '#5a3a1a'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, -30); g.lineTo(0, -40); g.stroke();
      g.fillStyle = '#ff6a1a'; g.beginPath(); g.moveTo(0, -40); g.lineTo(12, -37); g.lineTo(0, -33); g.fill(); gloss(g); },
    library(g) { badge(g, '#5b7fe0', '#14245e'); soft(g, 4, 3, 0.5);
      g.fillStyle = '#7a2a1a'; g.beginPath(); g.moveTo(-28, 18); g.lineTo(0, 24); g.lineTo(28, 18); g.lineTo(28, -12); g.lineTo(0, -6); g.lineTo(-28, -12); g.closePath(); g.fill();
      g.fillStyle = lin(g, -26, 0, 26, 0, [[0, '#ffffff'], [0.48, '#e8e2d2'], [0.52, '#cfc6b0'], [1, '#ffffff']]);
      g.beginPath(); g.moveTo(-26, 14); g.quadraticCurveTo(-12, 10, 0, 18); g.quadraticCurveTo(12, 10, 26, 14); g.lineTo(26, -16); g.quadraticCurveTo(12, -20, 0, -10); g.quadraticCurveTo(-12, -20, -26, -16); g.closePath(); g.fill();
      noSoft(g); g.strokeStyle = 'rgba(80,80,100,0.5)'; g.lineWidth = 1.2; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(-22, -10 + k * 6); g.quadraticCurveTo(-12, -14 + k * 6, -4, -6 + k * 6); g.moveTo(4, -6 + k * 6); g.quadraticCurveTo(12, -14 + k * 6, 22, -10 + k * 6); g.stroke(); } gloss(g); },
    natural(g) { badge(g, '#6fd08a', '#0f4a2a'); g.save(); g.scale(0.62, 0.62); g.translate(0, -4); DRAW.mountain(g, true); g.restore();
      g.fillStyle = lin(g, 0, 16, 0, 28, [[0, '#7fd0ff'], [1, '#1d6aa8']]); g.beginPath(); g.ellipse(4, 22, 22, 6, 0, 0, 7); g.fill(); gloss(g); },
    park(g) { badge(g, '#8fdc6a', '#1f5a1c'); g.save(); g.scale(0.85, 0.85); g.translate(0, 14); broadTree(g, 0, 10, 1.2, 0); g.restore(); gloss(g); },
  };
  function ingots(g, stops, top, dark) {
    badge(g, '#a8b4c0', '#2a323a', 'silver'); soft(g, 5, 3, 0.5);
    for (const [x, y] of [[-14, 12], [14, 12], [0, -6]]) {
      g.fillStyle = lin(g, x, y - 8, x, y + 10, stops.map((c, k) => [k / (stops.length - 1), c]));
      g.beginPath(); g.moveTo(x - 16, y + 8); g.lineTo(x - 11, y - 6); g.lineTo(x + 11, y - 6); g.lineTo(x + 16, y + 8); g.closePath(); g.fill();
      g.fillStyle = top; g.beginPath(); g.moveTo(x - 11, y - 6); g.lineTo(x - 8, y - 10); g.lineTo(x + 8, y - 10); g.lineTo(x + 11, y - 6); g.closePath(); g.fill();
    }
    noSoft(g); gloss(g);
  }

  function get(key) {
    if (cache.has(key)) return cache.get(key);
    const [c, g] = mk();
    if (key === 'snowpeak') DRAW.mountain(g, true);
    else if (key === 'rockpeak') DRAW.mountain(g, false);
    else if (DRAW[key]) DRAW[key](g);
    else if (SYM[key]) SYM[key](g);
    else SYM.mine(g);
    cache.set(key, c);
    return c;
  }
  return { get, draw(ctx, key, x, y, size) { ctx.drawImage(get(key), x - size / 2, y - size / 2, size, size); } };
})();
