'use strict';
/* world.js — Skeld haritası: kodla çizilen zemin + yürünebilir oda/koridor
   dikdörtgenleri. Çarpışma, sis maskesi ve botlar AREAS'e bakar; çizim
   (paintMap) aynı RECTS verisinden türer, böylece görsel ile yürünebilir alan
   hep hizalı kalır ve vent/görev gibi eklentiler oda merkezlerinden okunabilir. */

const MAP_S = 1.5;                          // çizim (png) pikseli -> dünya birimi
const MAP_IMG = { w: 1014, h: 575 };        // çizim tuvali mantıksal boyutu
const WORLD = { w: Math.round(MAP_IMG.w * MAP_S), h: Math.round(MAP_IMG.h * MAP_S) };
const PAD = 90, PR = 13;
const SPAWN = { x: 858, y: 198 };           // kafeterya masası (server ile aynı)

/* Dikdörtgenler çizim pikseliyle yazılır ve dünyaya ölçeklenir. */
const A = (x, y, w, h, n) => ({
  x: Math.round(x * MAP_S), y: Math.round(y * MAP_S),
  w: Math.round(w * MAP_S), h: Math.round(h * MAP_S), n,
});

/* Dikdörtgenler hem çarpışma (AREAS) hem çizimde kullanılır. floor: zemin rengi,
   noDraw: çizimde atla (kafeterya sekgen olarak çizilir). */
const RECTS = [
  /* --- odalar --- */
  { x: 172, y: 78, w: 98, h: 119, n: 'ÜST MOTOR', floor: '#c98d6b' },
  { x: 492, y: 10, w: 160, h: 40, noDraw: 1 },              // kafeterya: sekgen tepe
  { x: 455, y: 50, w: 235, h: 165, n: 'KAFETERYA', noDraw: 1 }, // sekgen gövde
  { x: 492, y: 215, w: 160, h: 55, noDraw: 1 },              // kafeterya: sekgen taban
  { x: 730, y: 65, w: 88, h: 110, n: 'SİLAHLAR', floor: '#d6cfae' },
  { x: 662, y: 198, w: 84, h: 82, n: 'O2', floor: '#a8bfa8' },
  { x: 920, y: 221, w: 60, h: 62, n: 'NAVİGASYON', floor: '#d6cfae' },
  { x: 618, y: 276, w: 98, h: 112, n: 'İDARE', floor: '#a55a68' },
  { x: 728, y: 378, w: 86, h: 92, n: 'KALKANLAR', floor: '#d6cfae' },
  { x: 612, y: 457, w: 86, h: 86, n: 'İLETİŞİM', floor: '#7e97a3' },
  { x: 477, y: 345, w: 116, h: 192, n: 'DEPO', floor: '#9aa3a8' },
  { x: 363, y: 295, w: 95, h: 135, n: 'ELEKTRİK', floor: '#b8ac83' },
  { x: 278, y: 220, w: 50, h: 97, n: 'GÜVENLİK', floor: '#7fae8e' },
  { x: 345, y: 160, w: 91, h: 130, n: 'REVİR', floor: '#cfd6d9' },
  { x: 86, y: 186, w: 84, h: 152, n: 'REAKTÖR', floor: '#8f86b8' },
  { x: 172, y: 341, w: 100, h: 114, n: 'ALT MOTOR', floor: '#c98d6b' },
  /* --- koridorlar --- */
  { x: 268, y: 133, w: 190, h: 45 },                         // üst motor -> kafeterya
  { x: 208, y: 197, w: 32, h: 166 },                         // motor <-> reaktör <-> alt motor kolonu
  { x: 160, y: 248, w: 125, h: 32 },                         // reaktör -> güvenlik ağzı
  { x: 386, y: 154, w: 32, h: 26 },                          // revir -> üst koridor
  { x: 682, y: 100, w: 50, h: 45 },                          // kafeterya -> silahlar
  { x: 760, y: 175, w: 34, h: 55 },                          // silahlar -> doğu kavşak
  { x: 760, y: 225, w: 35, h: 153 },                         // doğu kavşak dikey (idare doğusu)
  { x: 795, y: 256, w: 128, h: 25 },                         // kavşak -> navigasyon
  { x: 793, y: 256, w: 48, h: 122 },                         // kavşak -> kalkanlar doğusu
  { x: 600, y: 386, w: 130, h: 49 },                         // idare güney -> kalkanlar
  { x: 666, y: 435, w: 36, h: 35 },                          // -> iletişim
  { x: 558, y: 248, w: 36, h: 100 },                         // kafeterya -> depo (orta kolon)
  { x: 270, y: 377, w: 100, h: 55 },                         // alt motor -> elektrik
  { x: 258, y: 444, w: 224, h: 48 },                         // güney koridoru
  { x: 363, y: 430, w: 32, h: 25 },                          // elektrik -> güney koridoru
];

const AREAS = RECTS.map(r => A(r.x, r.y, r.w, r.h, r.n));

/* Kafeterya sekgeni (PNG pikseli) — çarpışma 3 dikdörtgenle, çizim bu poligonla. */
const CAF_OCT = [[492, 10], [652, 10], [690, 50], [690, 215], [652, 270], [492, 270], [455, 215], [455, 50]];

function ptInAreas(px, py) { return AREAS.some(a => px >= a.x && px <= a.x + a.w && py >= a.y && py <= a.y + a.h); }
function canMoveTo(x, y, R) {
  const k = R * .707;
  return ptInAreas(x, y) &&
    ptInAreas(x, y - R) && ptInAreas(x, y + R) && ptInAreas(x - R, y) && ptInAreas(x + R, y) &&
    ptInAreas(x - k, y - k) && ptInAreas(x + k, y - k) && ptInAreas(x - k, y + k) && ptInAreas(x + k, y + k);
}
function tryMove(p, dx, dy) {
  if (canMoveTo(p.x + dx, p.y + dy, PR)) { p.x += dx; p.y += dy; return; }
  if (dx !== 0 && canMoveTo(p.x + dx, p.y, PR)) p.x += dx;
  else if (dy !== 0 && canMoveTo(p.x, p.y + dy, PR)) p.y += dy;
}
function roomAt(x, y) { return AREAS.find(a => a.n && x > a.x && x < a.x + a.w && y > a.y && y < a.y + a.h) || null; }

/* Ekran (fare) koordinatını dünya koordinatına çevirir — render'daki kamera
   dönüşümünün tersi: world = (screen - center)/zoom + cam */
function screenToWorld(sx, sy) { return { x: (sx - vw / 2) / view.sc + cam.x, y: (sy - vh / 2) / view.sc + cam.y }; }

/* ---- prosedürel harita çizimi ----
   Tuval SS katı çözünürlükte çizilir, render'da dünya boyutuna küçültülür;
   böylece kenarlar keskin kalır. Çizim PNG pikseli uzayında yapılır
   (RECTS ile aynı koordinatlar), setTransform ile ölçeklenir. */
const mapC = document.createElement('canvas');
let mapReady = false;
const SS = 3;                                // süper-örnekleme katsayısı

let _seed = 1;
function srand(s) { _seed = s >>> 0; }
function rnd() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }

function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function circ(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, 7); g.closePath(); }
function octPath(g) {
  g.beginPath(); g.moveTo(CAF_OCT[0][0], CAF_OCT[0][1]);
  for (let i = 1; i < CAF_OCT.length; i++) g.lineTo(CAF_OCT[i][0], CAF_OCT[i][1]);
  g.closePath();
}
function shape(g, r) { if (r.oct) octPath(g); else rr(g, r.x, r.y, r.w, r.h, 5); }
function rc(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }

function table(g, x, y, r) {
  r = r || 14;
  g.fillStyle = '#26405f';
  for (let i = 0; i < 3; i++) { const a = Math.PI / 2 + i * 2.09; circ(g, x + Math.cos(a) * (r + 5), y + Math.sin(a) * (r + 5), 4.5); g.fill(); }
  g.fillStyle = '#2f4d73'; circ(g, x, y, r); g.fill();
  g.fillStyle = '#4a7fb5'; circ(g, x, y, r - 4); g.fill();
}
function glow(g, x, y, r, inner, mid, outer) {
  const grd = g.createRadialGradient(x, y, 1, x, y, r);
  grd.addColorStop(0, inner); grd.addColorStop(.45, mid); grd.addColorStop(1, outer);
  g.fillStyle = grd; circ(g, x, y, r); g.fill();
}

/* Oda mobilyaları — her oda kendi çizim px merkezinden hesaplanır. İleride
   görev/vent eklemek için bu fonksiyonlar doğal bağlantı noktasıdır. */
const PROPS = {
  'ÜST MOTOR'(g, r) { engine(g, rc(r)); },
  'ALT MOTOR'(g, r) { engine(g, rc(r)); },
  'REAKTÖR'(g, r) {
    const c = rc(r);
    g.fillStyle = '#4a4568'; circ(g, c.x, c.y, 34); g.fill();
    g.fillStyle = '#6d6794'; circ(g, c.x, c.y, 27); g.fill();
    glow(g, c.x, c.y, 24, '#eaffff', '#54e0d6', 'rgba(40,180,200,0)');
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2; circ(g, c.x, c.y, 17); g.stroke();
    g.fillStyle = '#3b3654';
    for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + i * Math.PI / 2; circ(g, c.x + Math.cos(a) * 30, c.y + Math.sin(a) * 30, 5); g.fill(); }
  },
  'GÜVENLİK'(g, r) {
    const c = rc(r);
    g.fillStyle = '#3c4a44'; rr(g, c.x - 18, c.y - 16, 36, 22, 3); g.fill();
    for (let i = 0; i < 3; i++) { g.fillStyle = '#9fe0c0'; rr(g, c.x - 15 + i * 11, c.y - 13, 9, 16, 1); g.fill(); }
  },
  'REVİR'(g, r) {
    const c = rc(r);
    [-22, 4].forEach(dx => {
      g.fillStyle = '#eef3f5'; rr(g, c.x + dx, c.y - 22, 18, 44, 4); g.fill();
      g.fillStyle = '#c3ced2'; rr(g, c.x + dx, c.y - 22, 18, 10, 4); g.fill();
    });
    g.strokeStyle = '#8fb6c4'; g.lineWidth = 2; circ(g, c.x + 8, c.y + 32, 11); g.stroke();
  },
  'ELEKTRİK'(g, r) {
    const c = rc(r);
    g.fillStyle = '#6f6a4e'; rr(g, c.x - 34, c.y - 34, 68, 16, 3); g.fill();
    g.fillStyle = '#cfd35a';
    for (let i = 0; i < 5; i++) { rr(g, c.x - 30 + i * 13, c.y - 31, 8, 10, 1); g.fill(); }
    ['#e0574a', '#e0c14a', '#4aa8e0', '#57c462'].forEach((col, i) => {
      g.strokeStyle = col; g.lineWidth = 2.5; g.beginPath();
      g.moveTo(c.x - 27 + i * 18, c.y - 18);
      g.bezierCurveTo(c.x - 27 + i * 18, c.y + 6, c.x - 8 + i * 9, c.y + 4, c.x - 4 + i * 11, c.y + 30);
      g.stroke();
    });
  },
  'DEPO'(g, r) {
    g.fillStyle = '#6e767b';
    rr(g, r.x + 7, r.y + 12, 12, r.h * .42, 3); g.fill();
    rr(g, r.x + 7, r.y + r.h - 46, 12, 34, 3); g.fill();
    g.strokeStyle = '#565d61'; g.lineWidth = 1.5;
    for (let y = r.y + 22; y < r.y + 12 + r.h * .42; y += 14) { g.beginPath(); g.moveTo(r.x + 7, y); g.lineTo(r.x + 19, y); g.stroke(); }
    srand(7);
    for (let i = 0; i < 10; i++) {
      const s = 13 + rnd() * 8, x = r.x + 24 + rnd() * (r.w - s - 32), y = r.y + 10 + rnd() * (r.h - s - 18);
      g.fillStyle = '#8a6b45'; rr(g, x, y, s, s, 2); g.fill();
      g.strokeStyle = '#6b5236'; g.lineWidth = 1.5; rr(g, x, y, s, s, 2); g.stroke();
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + s, y + s); g.moveTo(x + s, y); g.lineTo(x, y + s); g.stroke();
    }
  },
  'İDARE'(g, r) {
    const c = rc(r);
    g.fillStyle = '#7d3f4b'; rr(g, c.x - 26, c.y - 14, 52, 30, 7); g.fill();
    g.fillStyle = '#8f4b58'; rr(g, c.x - 22, c.y - 10, 44, 22, 5); g.fill();
    g.fillStyle = '#e8e2d2'; rr(g, c.x - 14, c.y - 6, 10, 7, 1); g.fill(); rr(g, c.x + 2, c.y + 1, 10, 7, 1); g.fill();
    g.fillStyle = '#c9a24a'; rr(g, c.x + 20, c.y - 26, 11, 16, 2); g.fill();
  },
  'KALKANLAR'(g, r) {
    const c = rc(r);
    g.fillStyle = '#6f7a8c'; g.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3, px = c.x + Math.cos(a) * 21, py = c.y + Math.sin(a) * 21; i ? g.lineTo(px, py) : g.moveTo(px, py); }
    g.closePath(); g.fill();
    g.fillStyle = '#8fd6ff'; circ(g, c.x, c.y, 8); g.fill();
  },
  'NAVİGASYON'(g, r) {
    const c = rc(r);
    g.fillStyle = '#6f7a8c'; rr(g, c.x - 22, c.y - 6, 44, 18, 4); g.fill();
    g.fillStyle = '#8fd6ff'; rr(g, c.x - 18, c.y - 3, 36, 8, 2); g.fill();
    g.fillStyle = '#e8f6ff';
    for (let i = 0; i < 4; i++) { circ(g, c.x - 13 + i * 9, c.y - 1 + (i % 2) * 3, 1.3); g.fill(); }
  },
  'SİLAHLAR'(g, r) {
    const c = rc(r);
    g.strokeStyle = '#5c6472'; g.lineWidth = 7; g.beginPath(); g.moveTo(c.x, c.y); g.lineTo(c.x, c.y - 26); g.stroke();
    g.fillStyle = '#5c6472'; circ(g, c.x, c.y, 15); g.fill();
    g.fillStyle = '#8b93a3'; circ(g, c.x, c.y, 7); g.fill();
  },
  'O2'(g, r) {
    const c = rc(r);
    [-13, 13].forEach(dx => {
      g.fillStyle = '#4f7f6a'; rr(g, c.x + dx - 6, c.y - 22, 12, 44, 6); g.fill();
      g.fillStyle = '#7fbfa0'; rr(g, c.x + dx - 4, c.y - 17, 4, 34, 2); g.fill();
    });
    g.strokeStyle = '#3f6a58'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(c.x - 13, c.y + 24); g.lineTo(c.x + 13, c.y + 24); g.stroke();
  },
  'İLETİŞİM'(g, r) {
    const c = rc(r);
    g.fillStyle = '#4f6570'; rr(g, c.x - 22, c.y - 4, 44, 18, 4); g.fill();
    g.strokeStyle = '#cfd8dd'; g.lineWidth = 2; g.beginPath(); g.moveTo(c.x, c.y - 4); g.lineTo(c.x, c.y - 26); g.stroke();
    g.fillStyle = '#e0574a'; circ(g, c.x, c.y - 27, 3.5); g.fill();
  },
};
function engine(g, c) {
  g.strokeStyle = '#4a5064'; g.lineWidth = 5;
  g.beginPath();
  g.moveTo(c.x - 20, c.y - 22); g.lineTo(c.x - 34, c.y - 22);
  g.moveTo(c.x - 20, c.y + 22); g.lineTo(c.x - 34, c.y + 22);
  g.moveTo(c.x + 20, c.y - 22); g.lineTo(c.x + 34, c.y - 22);
  g.moveTo(c.x + 20, c.y + 22); g.lineTo(c.x + 34, c.y + 22);
  g.stroke();
  g.fillStyle = '#3a3f52'; rr(g, c.x - 21, c.y - 42, 42, 84, 8); g.fill();
  g.fillStyle = '#6b7288'; rr(g, c.x - 15, c.y - 35, 30, 70, 6); g.fill();
  glow(g, c.x, c.y, 26, '#fff3c4', '#ffae3b', 'rgba(255,120,20,0)');
}
function cafeteriaFloor(g) {
  g.save(); octPath(g); g.clip();
  g.fillStyle = '#cfc9b4';
  for (let y = 10; y < 270; y += 24) for (let x = 455; x < 690; x += 24) if (((x + y) / 24) % 2 < 1) g.fillRect(x, y, 24, 24);
  g.restore();
}
function cafeteriaTables(g) {
  [[510, 72], [635, 72], [510, 205], [635, 205]].forEach(p => table(g, p[0], p[1]));
  table(g, 572, 132, 20);                       // merkez masa (acil buton altında)
}

function paintMap() {
  const g = mapC.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, mapC.width, mapC.height);
  /* uzay zemini + yıldızlar (device px) */
  g.fillStyle = '#070b16'; g.fillRect(0, 0, mapC.width, mapC.height);
  srand(4242);
  for (let i = 0; i < 300; i++) {
    const big = rnd() < .12;
    g.fillStyle = 'rgba(255,255,255,' + (.15 + rnd() * .6).toFixed(2) + ')';
    g.fillRect(rnd() * mapC.width, rnd() * mapC.height, big ? 2 : 1, big ? 2 : 1);
  }
  /* bundan sonra çizim pikseli uzayı */
  g.setTransform(SS * MAP_S, 0, 0, SS * MAP_S, SS * PAD, SS * PAD);

  const DRAW = RECTS.filter(r => !r.noDraw).concat([{ oct: 1, floor: '#d8d3c0' }]);
  /* gövde: ince dış rim -> koyu siluet -> çelik duvar -> zemin (ayrı geçişler,
     zemin üstte). Çelik bant geniş tutulur ki bitişik odalar arasındaki
     boşluk duvar gibi dolsun. */
  DRAW.forEach(r => { g.fillStyle = g.strokeStyle = '#31405f'; g.lineWidth = 74; shape(g, r); g.stroke(); g.fill(); });
  DRAW.forEach(r => { g.fillStyle = g.strokeStyle = '#1b2135'; g.lineWidth = 66; shape(g, r); g.stroke(); g.fill(); });
  DRAW.forEach(r => { g.fillStyle = g.strokeStyle = '#59677f'; g.lineWidth = 42; shape(g, r); g.stroke(); g.fill(); });
  /* çelik bant üstüne panel çizgileri: gövdeyi düz banttan çıkarır */
  DRAW.forEach(r => {
    const b = r.oct ? { x: 455, y: 10, w: 235, h: 260 } : r;
    g.save(); shape(g, r); g.clip();
    g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 1.5;
    g.beginPath();
    for (let x = b.x - 30; x <= b.x + b.w + 30; x += 46) { g.moveTo(x, b.y - 30); g.lineTo(x, b.y + b.h + 30); }
    g.stroke();
    g.restore();
  });
  DRAW.forEach(r => { g.fillStyle = r.floor || '#b9c6cf'; shape(g, r); g.fill(); });
  /* zemin dokusu: her şeklin içine hafif karo ızgarası + merkez ışığı */
  DRAW.forEach(r => {
    const b = r.oct ? { x: 455, y: 10, w: 235, h: 260 } : r;
    g.save(); shape(g, r); g.clip();
    g.strokeStyle = 'rgba(0,0,0,.07)'; g.lineWidth = 1;
    g.beginPath();
    for (let x = b.x; x <= b.x + b.w; x += 24) { g.moveTo(x, b.y); g.lineTo(x, b.y + b.h); }
    for (let y = b.y; y <= b.y + b.h; y += 24) { g.moveTo(b.x, y); g.lineTo(b.x + b.w, y); }
    g.stroke();
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, rad = Math.max(b.w, b.h) * .75;
    const lg = g.createRadialGradient(cx, cy, 4, cx, cy, rad);
    lg.addColorStop(0, 'rgba(255,255,255,.10)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg; g.fillRect(b.x, b.y, b.w, b.h);
    g.restore();
  });
  /* iç kenar gölgesi (AO): zemin duvara değdiği yerde koyulaşsın */
  cafeteriaFloor(g);
  DRAW.forEach(r => {
    g.save(); shape(g, r); g.clip();
    g.strokeStyle = 'rgba(8,12,22,.22)'; g.lineWidth = 12; shape(g, r); g.stroke();
    g.restore();
  });

  /* oda mobilyaları */
  cafeteriaTables(g);
  RECTS.forEach(r => { if (r.n && PROPS[r.n]) PROPS[r.n](g, r); });

  /* ACİL DURUM butonu — merkez masanın üstünde (js/meeting.js EMERG_BTN, dünya px) */
  const bx = EMERG_BTN.x / MAP_S, by = EMERG_BTN.y / MAP_S;
  g.strokeStyle = '#0a1120'; g.lineWidth = 2;
  circ(g, bx, by, 11); g.fillStyle = '#6d1220'; g.fill(); g.stroke();
  circ(g, bx, by, 8.5); g.fillStyle = '#ff3b30'; g.fill(); g.stroke();
  circ(g, bx - 3, by - 3.5, 2.6); g.fillStyle = 'rgba(255,255,255,.45)'; g.fill();

  /* oda etiketleri */
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 11px system-ui, sans-serif';
  RECTS.forEach(r => {
    if (!r.n || r.n === 'KAFETERYA') return;
    g.fillStyle = 'rgba(18,24,38,.42)';
    g.fillText(r.n, r.x + r.w / 2, r.y + r.h - 9);
  });
  g.fillStyle = 'rgba(18,24,38,.42)'; g.fillText('KAFETERYA', 572, 256);

  mapReady = true;
}

function buildMap() {
  const MW = WORLD.w + PAD * 2, MH = WORLD.h + PAD * 2;
  const w = MW * SS, h = MH * SS;
  if (mapC.width !== w || mapC.height !== h) { mapC.width = w; mapC.height = h; }
  paintMap();
}
