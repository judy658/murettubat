'use strict';
/* world.js — Skeld haritası: PNG zemin + yürünebilir oda/koridor dikdörtgenleri.
   Çarpışma, sis maskesi ve botlar AREAS'e bakar; PNG yalnızca görsel katmandır,
   bu yüzden dikdörtgenler zeminle hizalı izlenmelidir. */

const MAP_S = 1.5;                          // PNG pikseli -> dünya birimi
const MAP_IMG = { w: 1014, h: 575 };
const WORLD = { w: Math.round(MAP_IMG.w * MAP_S), h: Math.round(MAP_IMG.h * MAP_S) };
const PAD = 90, PR = 13;
const SPAWN = { x: 858, y: 198 };           // kafeterya masası (server ile aynı)

/* Dikdörtgenler PNG pikseliyle yazılır ve dünyaya ölçeklenir — izlerken
   görüntüyle birebir karşılaştırabilmek için. */
const A = (x, y, w, h, n) => ({
  x: Math.round(x * MAP_S), y: Math.round(y * MAP_S),
  w: Math.round(w * MAP_S), h: Math.round(h * MAP_S), n,
});

const AREAS = [
  /* --- odalar --- */
  A(172, 78, 98, 119, 'ÜST MOTOR'),
  A(492, 10, 160, 40),                      // kafeterya: sekgen tepe
  A(455, 50, 235, 165, 'KAFETERYA'),        // kafeterya: geniş gövde
  A(492, 215, 160, 55),                     // kafeterya: sekgen taban
  A(730, 65, 88, 110, 'SİLAHLAR'),
  A(662, 198, 84, 82, 'O2'),
  A(920, 221, 60, 62, 'NAVİGASYON'),
  A(618, 276, 98, 112, 'İDARE'),
  A(728, 378, 86, 92, 'KALKANLAR'),
  A(612, 457, 86, 86, 'İLETİŞİM'),
  A(477, 345, 116, 192, 'DEPO'),
  A(363, 295, 95, 135, 'ELEKTRİK'),
  A(278, 220, 50, 97, 'GÜVENLİK'),
  A(345, 160, 91, 130, 'REVİR'),
  A(86, 186, 84, 152, 'REAKTÖR'),
  A(172, 341, 100, 114, 'ALT MOTOR'),
  /* --- koridorlar --- */
  A(268, 133, 190, 45),                     // üst motor -> kafeterya
  A(208, 197, 32, 166),                     // üst motor <-> reaktör <-> alt motor kolonu
  A(160, 248, 125, 32),                     // reaktör -> güvenlik ağzı
  A(386, 154, 32, 26),                      // revir -> üst koridor
  A(682, 100, 50, 45),                      // kafeterya -> silahlar
  A(760, 175, 34, 55),                      // silahlar -> doğu kavşak
  A(760, 225, 35, 153),                     // doğu kavşak dikey (idare doğusu)
  A(795, 256, 128, 25),                     // kavşak -> navigasyon
  A(793, 256, 48, 122),                     // kavşak -> kalkanlar doğusu
  A(600, 386, 130, 49),                     // idare güney -> kalkanlar
  A(666, 435, 36, 35),                      // -> iletişim
  A(558, 248, 36, 100),                     // kafeterya -> depo (orta kolon)
  A(270, 377, 100, 55),                     // alt motor -> elektrik
  A(258, 444, 224, 48),                     // güney koridoru
  A(363, 430, 32, 25),                      // elektrik -> güney koridoru
];

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

const mapC = document.createElement('canvas');
let mapReady = false;
const mapImg = new Image();
mapImg.src = 'assets/skeld.png';
mapImg.onload = () => { if (mapC.width) paintMap(); };

function paintMap() {
  const g = mapC.getContext('2d');
  g.clearRect(0, 0, mapC.width, mapC.height);
  g.save(); g.translate(PAD, PAD);
  g.drawImage(mapImg, 0, 0, WORLD.w, WORLD.h);
  /* ACİL DURUM butonu — kafeterya masasının ortasındaki kırmızı buton
     (js/meeting.js EMERG_BTN). PNG'de masa var ama buton belirgin değil. */
  g.strokeStyle = '#0a1120'; g.lineWidth = 2;
  g.beginPath(); g.arc(EMERG_BTN.x, EMERG_BTN.y, 12, 0, 7); g.fillStyle = '#6d1220'; g.fill(); g.stroke();
  g.beginPath(); g.arc(EMERG_BTN.x, EMERG_BTN.y, 9.5, 0, 7); g.fillStyle = '#ff3b30'; g.fill(); g.stroke();
  g.beginPath(); g.arc(EMERG_BTN.x - 3, EMERG_BTN.y - 3.5, 3, 0, 7); g.fillStyle = 'rgba(255,255,255,.45)'; g.fill();
  g.restore();
  mapReady = true;
}

function buildMap() {
  const MW = WORLD.w + PAD * 2, MH = WORLD.h + PAD * 2;
  if (mapC.width !== MW || mapC.height !== MH) { mapC.width = MW; mapC.height = MH; }
  if (mapImg.complete && mapImg.naturalWidth) paintMap();
}
