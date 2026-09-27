'use strict';
/**
 * MÜRETTEBAT — oyun sunucusu
 *
 * Tek Node servisi iki işi birden yapar:
 *   1) Among3.html / css / js dosyalarını statik olarak sunar
 *   2) /ws adresinde WebSocket oda sunucusu çalıştırır
 *
 * Sunucu oda durumunun TEK doğruluk kaynağıdır (single source of truth):
 * roller dağıtımı, kill yetkisi ve kazanma koşulları burada hesaplanır.
 * İstemciler sadece kendi girdilerini bildirir, kararı sunucu verir.
 *
 * Böylece "host herkese veri gönderemedi" sorunu ortadan kalkar: kimse
 * host değildir, veri akışı merkezî ve herkese eşit dağıtılır.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;

/* --- Oyun ayarları (istemciyle aynı değerler) --- */
const TICK_HZ = 15;          // durum yayın frekansı
const KILL_RANGE = 60;       // kill menzili (dünya birimi)
const KILL_COOLDOWN = 25;    // saniye
const MAX_PLAYERS = 8;
const MAX_ROOM_AGE_MS = 1000 * 60 * 60 * 2; // boş oda temizliği

const SPAWN = { x: 190, y: 150 };
const SPAWN_OFFSETS = [[-60, -40], [0, -50], [60, -40], [-60, 40], [0, 50], [60, 40], [-30, 0], [30, 10]];
const CODE_ALPHABET = 'ABCDEFGHJKMNPRSTYZ23456789';

/* ------------------------------------------------------------------ */
/* Statik dosya sunucusu                                              */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    res.writeHead(400); return res.end('bad request');
  }

  // Render ve uptime monitorları için sağlık ucu
  if (pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('ok');
  }
  if (pathname === '/rooms') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      rooms: rooms.size,
      players: [...rooms.values()].reduce((n, r) => n + r.players.size, 0),
    }));
  }

  if (pathname === '/' || pathname === '') pathname = '/Among3.html';

  // Dizin dışına çıkmayı engelle
  const file = path.resolve(ROOT, '.' + pathname);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403); return res.end('forbidden');
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('404 — ' + pathname);
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(buf);
  });
});

/* ------------------------------------------------------------------ */
/* Oda durumu                                                         */
/* ------------------------------------------------------------------ */

const rooms = new Map();

function genCode() {
  let s = '';
  do {
    s = '';
    for (let i = 0; i < 5; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  } while (rooms.has(s));
  return s;
}

function newRoom() {
  return {
    code: genCode(),
    players: new Map(),   // id -> player
    hostId: null,
    phase: 'lobby',       // 'lobby' | 'game'
    started: false,
    gameOver: false,
    roles: new Map(),     // id -> 'impostor' | 'crew'
    killAt: new Map(),    // id -> cooldown bitiş zamanı
    lastSent: new Map(),  // id -> son gönderilen alanlar (delta için)
    emptySince: Date.now(),
  };
}

function sanitizeName(v) {
  const s = String(v == null ? '' : v).replace(/[<>\r\n]/g, '').trim().slice(0, 12);
  return s || 'Oyuncu';
}

function clampInt(v, lo, hi) {
  v = parseInt(v, 10);
  if (!Number.isFinite(v)) return 0;
  return Math.max(lo, Math.min(hi, v));
}

function addPlayer(room, ws, name, ci) {
  const id = 'p' + Math.random().toString(36).slice(2, 10);
  const p = {
    id, ws, name: sanitizeName(name), ci: clampInt(ci, 0, 9),
    ready: false, joinedAt: Date.now(),
    x: SPAWN.x, y: SPAWN.y, dir: 1, angle: 0, moving: false, dead: false,
  };
  room.players.set(id, p);
  if (!room.hostId) room.hostId = id;
  // Host'un hazır olması gerekmez; lobide ready butonu gizlidir.
  p.ready = (p.id === room.hostId);
  room.emptySince = 0;
  return p;
}

function lobbyPayload(room) {
  return {
    code: room.code,
    started: room.started,
    ps: [...room.players.values()].map(p => ({
      id: p.id, n: p.name, ci: p.ci, r: p.ready, h: p.id === room.hostId,
    })),
  };
}

function fullState(room) {
  const out = {};
  room.players.forEach(p => {
    out[p.id] = {
      n: p.name, c: p.ci,
      x: Math.round(p.x), y: Math.round(p.y),
      d: p.dir, m: p.moving ? 1 : 0, a: round2(p.angle), k: p.dead ? 1 : 0,
    };
  });
  return out;
}

function round2(v) { return Math.round(v * 100) / 100; }

/* ------------------------------------------------------------------ */
/* Gönderim yardımcıları                                              */
/* ------------------------------------------------------------------ */

function send(ws, obj) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* bağlantı kapandı */ }
  }
}

function broadcast(room, obj, exceptId) {
  room.players.forEach(p => { if (p.id !== exceptId) send(p.ws, obj); });
}

function pushLobby(room) {
  broadcast(room, { t: 'lb', lobby: lobbyPayload(room) });
}

/* ------------------------------------------------------------------ */
/* Delta yayıncı — sadece değişen alanları yolla (bant genişliği için) */
/* ------------------------------------------------------------------ */

function tick() {
  for (const room of rooms.values()) {
    if (!room.players.size) {
      // Oda boş kaldıysa bir süre sonra temizle
      if (!room.emptySince) room.emptySince = Date.now();
      else if (Date.now() - room.emptySince > MAX_ROOM_AGE_MS) rooms.delete(room.code);
      continue;
    }

    if (room.phase !== 'game') continue;

    const delta = {};
    room.players.forEach(p => {
      const prev = room.lastSent.get(p.id) || {};
      const next = {
        n: p.name, c: p.ci,
        x: Math.round(p.x), y: Math.round(p.y),
        d: p.dir, m: p.moving ? 1 : 0, a: round2(p.angle),
        k: p.dead ? 1 : 0,
      };
      const d = {};
      let changed = false;
      for (const key in next) {
        if (prev[key] !== next[key]) { d[key] = next[key]; changed = true; }
      }
      if (changed) {
        delta[p.id] = d;
        room.lastSent.set(p.id, next);
      }
    });
    if (Object.keys(delta).length) broadcast(room, { t: 'st', p: delta });
  }
}
setInterval(tick, 1000 / TICK_HZ);

/* ------------------------------------------------------------------ */
/* Oyun akışı                                                         */
/* ------------------------------------------------------------------ */

function assignRoles(room) {
  const ids = [...room.players.keys()];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const impCount = ids.length >= 7 ? 2 : 1;
  room.roles = new Map();
  ids.forEach((id, i) => room.roles.set(id, i < impCount ? 'impostor' : 'crew'));
}

function resetPositions(room) {
  let i = 0;
  room.players.forEach(p => {
    const o = SPAWN_OFFSETS[i++ % SPAWN_OFFSETS.length];
    p.x = SPAWN.x + o[0];
    p.y = SPAWN.y + o[1];
    p.dead = false;
  });
}

function startGame(room) {
  if (room.started) return;
  const players = [...room.players.values()];
  if (players.length < 2) return;
  const notReady = players.filter(p => !p.ready && p.id !== room.hostId);
  if (notReady.length) return; // henüz herkes hazır değil

  assignRoles(room);
  room.started = true;
  room.phase = 'game';
  room.gameOver = false;
  room.killAt.clear();
  room.lastSent.clear();
  resetPositions(room);

  // ROLLERİ SIRRI TUT: her istemciye yalnızca kendi rolü gönderilir.
  // Mates listesi SADECE sahtekâra gider — mürettebata gönderilirse
  // sahtekârın kimliği sızar, oyun bozulur.
  room.players.forEach(p => {
    const mine = room.roles.get(p.id);
    const mates = mine === 'impostor'
      ? [...room.roles.entries()]
          .filter(([id, r]) => r === 'impostor' && id !== p.id)
          .map(([id]) => { const q = room.players.get(id); return q ? { id, n: q.name } : null; })
          .filter(Boolean)
      : [];
    send(p.ws, { t: 'go', you: p.id, role: mine, mates, code: room.code });
  });
}

function endGame(room, winner) {
  if (room.gameOver) return;
  room.gameOver = true;
  // Oyun bittiğinde roller artık sır değil — sonuç ekranı hepsini göstermeli
  broadcast(room, { t: 'end', winner, roles: Object.fromEntries(room.roles) });
}

function checkEnd(room) {
  if (room.gameOver || !room.started) return;
  const alive = [...room.players.values()].filter(p => !p.dead);
  const imp = alive.filter(p => room.roles.get(p.id) === 'impostor').length;
  const crew = alive.filter(p => room.roles.get(p.id) === 'crew').length;
  if (imp === 0) return endGame(room, 'crew');
  if (imp >= crew) return endGame(room, 'imp');
}

function toLobby(room) {
  room.started = false;
  room.phase = 'lobby';
  room.gameOver = false;
  room.roles.clear();
  room.killAt.clear();
  room.lastSent.clear();
  room.players.forEach(p => { p.ready = (p.id === room.hostId); p.dead = false; });
  broadcast(room, { t: 'back' });
  pushLobby(room);
}

function doKill(room, killerId, targetId) {
  const k = room.players.get(killerId);
  const v = room.players.get(targetId);
  if (!k || !v || room.gameOver || !room.started) return;
  if (k.dead || v.dead || k.id === v.id) return;
  if (room.roles.get(k.id) !== 'impostor') return;

  const now = Date.now();
  if ((room.killAt.get(k.id) || 0) > now) return;         // cooldown sunucuda da var

  const dist = Math.hypot(k.x - v.x, k.y - v.y);
  if (dist > KILL_RANGE) return;                            // menzil dışı → sessizce yoksay

  room.killAt.set(k.id, now + KILL_COOLDOWN * 1000);
  v.dead = true;
  broadcast(room, { t: 'killed', victim: v.id, killer: k.id });
  send(k.ws, { t: 'cd', ms: KILL_COOLDOWN * 1000 });
  checkEnd(room);
}

/* ------------------------------------------------------------------ */
/* WebSocket bağlantıları                                             */
/* ------------------------------------------------------------------ */

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', ws => {
  ws.room = null;
  ws.playerId = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    if (raw && raw.length > 4096) return;   // abartılı paketleri kes
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;

    /* --- Odaya giriş --- */
    if (msg.t === 'create' || msg.t === 'join') {
      if (ws.room) return;
      let room;
      if (msg.t === 'create') {
        room = newRoom();
        rooms.set(room.code, room);
      } else {
        const code = String(msg.code || '').toUpperCase().slice(0, 5);
        room = rooms.get(code);
        if (!room) { send(ws, { t: 'deny', r: 'Oda bulunamadı. Kodu kontrol et.' }); return; }
        if (room.started) { send(ws, { t: 'deny', r: 'Oyun başladı' }); return; }
        if (room.players.size >= MAX_PLAYERS) { send(ws, { t: 'deny', r: 'Oda dolu' }); return; }
      }
      const p = addPlayer(room, ws, msg.n, msg.ci);
      ws.room = room;
      ws.playerId = p.id;
      send(ws, { t: msg.t === 'create' ? 'created' : 'joined', you: p.id, code: room.code, lobby: lobbyPayload(room), p: fullState(room) });
      if (msg.t === 'join') pushLobby(room);   // odaya gireni herkese duyur
      return;
    }

    const room = ws.room;
    const p = room && room.players.get(ws.playerId);
    if (!room || !p) return;

    switch (msg.t) {
      case 'ping':
        send(ws, { t: 'pong' });
        break;

      case 'ready':
        p.ready = !!msg.v;
        pushLobby(room);
        break;

      case 'col': {
        const ci = clampInt(msg.ci, 0, 9);
        const taken = [...room.players.values()].some(x => x.id !== p.id && x.ci === ci);
        if (taken) send(ws, { t: 'colno' });
        else { p.ci = ci; pushLobby(room); }
        break;
      }

      case 'start':
        if (p.id === room.hostId) startGame(room);
        break;

      case 'back':
        if (p.id === room.hostId) toLobby(room);
        break;

      case 'p': {
        if (room.phase !== 'game' || p.dead) break;
        p.x = Number(msg.x) || 0;
        p.y = Number(msg.y) || 0;
        p.dir = msg.d === -1 ? -1 : 1;
        p.moving = !!msg.m;
        p.angle = Number.isFinite(msg.a) ? msg.a : 0;
        break;
      }

      case 'kill':
        if (room.phase === 'game') doKill(room, p.id, String(msg.target || ''));
        break;

      case 'c': {
        const text = String(msg.m == null ? '' : msg.m).replace(/[\r\n]/g, ' ').trim().slice(0, 120);
        if (!text) break;
        broadcast(room, { t: 'c', n: p.name, ci: p.ci, m: text });
        break;
      }
    }
  });

  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});

function leave(ws) {
  const room = ws.room;
  if (!room) return;
  ws.room = null;
  const p = room.players.get(ws.playerId);
  if (!p) return;
  room.players.delete(ws.playerId);
  room.lastSent.delete(ws.playerId);
  room.killAt.delete(ws.playerId);
  room.roles.delete(ws.playerId);

  if (!room.players.size) {
    rooms.delete(room.code);
    return;
  }
  // Host ayrıldıysa en eski oyuncuyu host yap
  if (room.hostId === p.id) {
    const next = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
    room.hostId = next ? next.id : null;
  }
  if (room.started) checkEnd(room);
  pushLobby(room);
}

/* Ölü bağlantıları temizle */
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* yoksay */ }
  });
}, 30000);

server.on('error', err => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`MÜRETTEBAT: ${PORT} portu kullanımda. Başka bir sunucu çalışıyor olabilir.`);
  } else {
    console.error('MÜRETTEBAT sunucu hatası:', err);
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`MÜRETTEBAT sunucusu ayakta: http://0.0.0.0:${PORT}  (WebSocket: /ws)`);
});
