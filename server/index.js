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
const TICK_HZ = 20;          // durum yayın frekansı
const KEYFRAME_TICKS = 40;   // her N tick'te tam durum (≈2 sn) — kendini onarır
const KILL_RANGE = 60;       // kill menzili (dünya birimi)
const KILL_COOLDOWN = 25;    // saniye
const REPORT_RANGE = 70;     // cesedi raporlamak için gereken yakınlık
const EMERG_RANGE = 60;      // acil durum butonuna ulaşmak için gereken yakınlık
const EMERG_BTN = { x: 858, y: 198 }; // kafeterya masası ortası (Skeld, js/meeting.js ile aynı)
const MEET_SECONDS = 90;     // toplantıda tartışma süresi
const EJECT_MS = 11000;      // animasyon (6.4 sn) + rol açıklamasının okunması için pay
const MAX_PLAYERS = 8;
const COLOR_COUNT = 10;      // js/core.js içindeki COLORS uzunluğu
const MAX_ROOM_AGE_MS = 1000 * 60 * 60 * 2; // boş oda temizliği

const SPAWN = { x: 858, y: 198 };
/* Dünya sınırları — js/world.js içindeki WORLD ile AYNI olmalı. Sunucu
   konumu doğrulamazsa istemci harita dışına "ışınlanıp" sunucudaki menzil
   kontrollerini (kill, rapor, acil durum) delebilir. */
const WORLD = { w: 1521, h: 862 };
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
    phase: 'lobby',       // 'lobby' | 'game' | 'meeting'
    started: false,
    gameOver: false,
    roles: new Map(),     // id -> 'impostor' | 'crew'
    killAt: new Map(),    // id -> cooldown bitiş zamanı
    meeting: null,        // {reporter,victim,endsAt,votes,winner,finishing}
    reported: new Set(),  // raporlanmış cesetler (iki kez raporlanamaz)
    emergUsed: new Set(), // acil durum hakkı kullanılmış oyuncular (oyuncu başına 1)
    // Konu (oyuncu) -> alıcı (istemci) -> son gönderilen alanlar.
    // HER İSTEMCİ AYRI TUTULUR: eskiden tek bir "gönderildi" işareti
    // paylaşılıyordu; bir istemcinin gönderimi kaçırırsa sunucu onu
    // bir daha hiç göndermiyor ve o istemci kalıcı olarak bayat kalıyordu.
    sent: new Map(),
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

/* Konum kırpma: değer sayı değilse ekseni DEĞİŞTİRME — yarım kalmış bir
   mesaj oyuncuyu origin'e ışınlamasın; sayıysa harita sınırlarına kırp. */
function clampPos(v, hi, cur) {
  v = Number(v);
  if (!Number.isFinite(v)) return cur;
  return Math.max(0, Math.min(hi, v));
}

/* Oda içinde kullanılmamış bir renk seç. İstediği renk boşsa onu ver,
   doluysa boş olan ilk renge geç. Böylece aynı odada iki kişi aynı
   rengi alamaz ve istemciler birbirini yanlış renkle görmez. */
function pickColor(room, want, selfId) {
  const used = new Set();
  room.players.forEach(p => { if (p.id !== selfId) used.add(p.ci); });
  const c = clampInt(want, 0, COLOR_COUNT - 1);
  if (!used.has(c)) return c;
  for (let i = 0; i < COLOR_COUNT; i++) if (!used.has(i)) return i;
  return c;   // oda doluysa son çare
}

function addPlayer(room, ws, name, ci) {
  const id = 'p' + Math.random().toString(36).slice(2, 10);
  const p = {
    id, ws, name: sanitizeName(name), ci: pickColor(room, ci, id),
    ready: false, joinedAt: Date.now(),
    x: SPAWN.x, y: SPAWN.y, dir: 1, angle: 0, moving: false, dead: false, gone: false,
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
      r: room.reported.has(p.id) ? 1 : 0,
      v: p.gone ? 1 : 0,
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

let tickNo = 0;

function tick() {
  tickNo++;
  const keyframe = (tickNo % KEYFRAME_TICKS) === 0;

  for (const room of rooms.values()) {
    if (!room.players.size) {
      // Oda boş kaldıysa bir süre sonra temizle
      if (!room.emptySince) room.emptySince = Date.now();
      else if (Date.now() - room.emptySince > MAX_ROOM_AGE_MS) rooms.delete(room.code);
      continue;
    }

    // Toplantı sürerken konum yayını yapılmaz; sadece süre kontrol edilir.
    if (room.phase === 'meeting') {
      const m = room.meeting;
      if (m && !m.finishing && Date.now() >= m.endsAt) resolveMeeting(room);
      continue;
    }

    if (room.phase !== 'game') continue;

    // Periyodik tam durum: kaçırılan her mesajı kendiliğinden onarır.
    if (keyframe) {
      const full = fullState(room);
      room.players.forEach(p => send(p.ws, { t: 'st', p: full }));
      room.sent.clear();   // "her şey iletildi" varsayımını sıfırla
      continue;
    }

    // alıcıId -> { konuId: delta }
    const out = new Map();

    room.players.forEach(subject => {
      const next = {
        n: subject.name, c: subject.ci,
        x: Math.round(subject.x), y: Math.round(subject.y),
        d: subject.dir, m: subject.moving ? 1 : 0, a: round2(subject.angle),
        k: subject.dead ? 1 : 0,
        r: room.reported.has(subject.id) ? 1 : 0,
        v: subject.gone ? 1 : 0,
      };
      let per = room.sent.get(subject.id);
      if (!per) { per = new Map(); room.sent.set(subject.id, per); }

      room.players.forEach(receiver => {
        const prev = per.get(receiver.id) || {};
        const d = {};
        let changed = false;
        for (const key in next) {
          if (prev[key] !== next[key]) { d[key] = next[key]; changed = true; }
        }
        if (!changed) return;
        per.set(receiver.id, next);          // yalnızca ALICIYA göre işaretle
        let m = out.get(receiver.id);
        if (!m) { m = {}; out.set(receiver.id, m); }
        m[subject.id] = d;
      });
    });

    out.forEach((delta, receiverId) => {
      const r = room.players.get(receiverId);
      if (r) send(r.ws, { t: 'st', p: delta });
    });
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

/* Herkesi kafeterya spotuna taşır. DİKKAT: ölüm durumuna dokunmaz —
   toplantı sırasında da çağrılır, orada hayaletler hayalet olarak kalır.
   ÖLÜ/RAPORLANMIŞ oyuncular ışınlanmaz: ceset öldüğü yerde kalır, aksi
   hâlde raporlanan ceset kafeteryada belirip oyunun sonuna kadar orada durur. */
function resetPositions(room) {
  let i = 0;
  room.players.forEach(p => {
    if (p.dead || p.gone) return;   // hayaletler ve cesetler yerinde kalır
    const o = SPAWN_OFFSETS[i++ % SPAWN_OFFSETS.length];
    p.x = SPAWN.x + o[0];
    p.y = SPAWN.y + o[1];
    p.moving = false;
    p.angle = 0;
  });
}

function startGame(room, askerWs) {
  const hint = (text) => { if (askerWs) send(askerWs, { t: 'sys', text }); };
  if (room.started) return hint('Oyun zaten başlamış.');
  const players = [...room.players.values()];
  if (players.length < 2) return hint('Başlamak için en az 2 oyuncu gerekli.');
  const notReady = players.filter(p => !p.ready && p.id !== room.hostId);
  if (notReady.length) return hint('Henüz herkes hazır değil: ' + notReady.map(p => p.name).join(', '));

  assignRoles(room);
  room.started = true;
  room.phase = 'game';
  room.gameOver = false;
  room.killAt.clear();
  room.sent.clear();
  room.reported.clear();
  room.emergUsed.clear();
  // Yeni oyun: herkes dirilir, uzaya atılanlar geri gelir.
  room.players.forEach(p => { p.dead = false; p.gone = false; p.killed = false; });
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
    // p: herkese tam oyuncu listesi. Lobide konum yayını olmadığı için
    // istemciler diğer oyuncuları burada tanır; eksik kalırsa görünmezler.
    send(p.ws, { t: 'go', you: p.id, role: mine, mates, code: room.code, p: fullState(room) });
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
  const alive = [...room.players.values()].filter(p => !p.dead && !p.gone);
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
  room.sent.clear();
  room.meeting = null;
  room.reported.clear();
  room.emergUsed.clear();
  room.players.forEach(p => {
    p.ready = (p.id === room.hostId);
    p.dead = false; p.gone = false; p.killed = false;
  });
  broadcast(room, { t: 'back' });
  pushLobby(room);
}

function doKill(room, killerId, targetId) {
  const k = room.players.get(killerId);
  const v = room.players.get(targetId);
  if (!k || !v || room.gameOver || !room.started) return;
  if (k.dead || v.dead || k.gone || v.gone || k.id === v.id) return;
  if (room.roles.get(k.id) !== 'impostor') return;

  const now = Date.now();
  if ((room.killAt.get(k.id) || 0) > now) return;         // cooldown sunucuda da var

  const dist = Math.hypot(k.x - v.x, k.y - v.y);
  if (dist > KILL_RANGE) return;                            // menzil dışı → sessizce yoksay

  room.killAt.set(k.id, now + KILL_COOLDOWN * 1000);
  v.dead = true;
  // x/y: kurbanın ÖLDÜĞÜ konum. Sunucudaki son bilinen konum, istemcideki
  // yarım kalmış çizim konumundan daha güvenilir; ceset burada kalacak.
  broadcast(room, {
    t: 'killed', victim: v.id, killer: k.id,
    x: Math.round(v.x), y: Math.round(v.y),
  });
  send(k.ws, { t: 'cd', ms: KILL_COOLDOWN * 1000 });
  checkEnd(room);
}

/* ------------------------------------------------------------------ */
/* Raporlama ve toplantı                                               */
/* ------------------------------------------------------------------ */

/* Toplantı ekranının her istemciye göre içeriği. OY GİZLİDİR: kimin
   kime oy verdiği yalnızca sonuçta açıklanır, herkes sadece "oy kullandı"
   bilgisini görür — Among Us'taki gibi. */
function meetingPayload(room) {
  const m = room.meeting;
  return {
    t: 'meet',
    reporter: m.reporter,
    victim: m.victim,
    endsAt: m.endsAt,
    seconds: MEET_SECONDS,
    players: [...room.players.values()].map(p => ({
      id: p.id, n: p.name, ci: p.ci,
      dead: p.dead, voted: m.votes.has(p.id),
    })),
    p: fullState(room),
  };
}

function doReport(room, reporterId, victimId) {
  if (room.phase !== 'game' || room.gameOver || room.meeting) return;
  const r = room.players.get(reporterId);
  const v = room.players.get(victimId);
  if (!r || !v) return;
  if (r.dead || r.gone) return;                   // hayalet rapor edemez
  if (!v.dead || v.gone) return;                  // yalnızca CESET raporlanır
  if (room.reported.has(victimId)) return;       // aynı ceset iki kez raporlanamaz
  if (Math.hypot(r.x - v.x, r.y - v.y) > REPORT_RANGE) return;

  room.reported.add(victimId);
  v.gone = true;   // raporlanan ceset sahneden KALDIRILIR (oyun sonuna kadar durmaz)
  room.phase = 'meeting';
  room.sent.clear();
  resetPositions(room);                          // herkes kantine ışınlanır
  room.meeting = {
    reporter: reporterId,
    victim: victimId,
    endsAt: Date.now() + MEET_SECONDS * 1000,
    votes: new Map(),
    winner: null,
    finishing: false,
  };

  room.players.forEach(p => {
    send(p.ws, Object.assign(meetingPayload(room), { you: p.id, myVote: null }));
  });
}

/* ACİL DURUM TOPLANTISI: KANTİN masasındaki buton. Ceset GEREKMEZ;
   her canlı oyuncunun oyun başına 1 hakkı vardır. Sunucu doğrulaması:
   oyun sürüyor, çağıran hayatta, butona yakın, en az 2 canlı var. */
function doEmergency(room, callerId) {
  if (room.phase !== 'game' || room.gameOver || room.meeting) return;
  const r = room.players.get(callerId);
  if (!r || r.dead || r.gone) return;                    // hayalet çağıramaz
  if (room.emergUsed.has(callerId)) return;              // hakkı bir kez
  if (Math.hypot(r.x - EMERG_BTN.x, r.y - EMERG_BTN.y) > EMERG_RANGE) return;
  const alive = [...room.players.values()].filter(p => !p.dead && !p.gone);
  if (alive.length < 2) return;                          // tek başına anlamsız

  room.emergUsed.add(callerId);
  room.phase = 'meeting';
  room.sent.clear();
  resetPositions(room);                          // herkes kantine ışınlanır
  room.meeting = {
    reporter: callerId,
    victim: null,                                // ceset YOK — acil durum
    endsAt: Date.now() + MEET_SECONDS * 1000,
    votes: new Map(),
    winner: null,
    finishing: false,
  };

  room.players.forEach(p => {
    send(p.ws, Object.assign(meetingPayload(room), { you: p.id, myVote: null }));
  });
}

function pushVotes(room) {
  const m = room.meeting;
  if (!m) return;
  room.players.forEach(p => {
    send(p.ws, {
      t: 'votes',
      endsAt: m.endsAt,
      players: [...room.players.values()].map(q => ({ id: q.id, voted: m.votes.has(q.id) })),
      myVote: m.votes.get(p.id) || null,
    });
  });
}

function castVote(room, voterId, targetId) {
  const m = room.meeting;
  if (!m || room.phase !== 'meeting' || m.finishing) return;
  const v = room.players.get(voterId);
  if (!v) return;
  if (v.dead || v.gone) return;     // hayaletler oy veremez

  let t = targetId === 'skip' ? 'skip' : String(targetId == null ? '' : targetId);
  if (t !== 'skip') {
    const target = room.players.get(t);
    if (!target || target.id === voterId) return;   // kendine oy verilemez
    t = target.id;
  }

  m.votes.set(voterId, t);      // oy değiştirilebilir
  pushVotes(room);

  /* HERKES OY KULLANDIYSA beklemeden sonuca geç.
     Hayaletler oy veremediği için yalnızca HAYATTAKİLER sayılır. */
  const voters = [...room.players.values()].filter(q => !q.dead && !q.gone);
  if (voters.length && voters.every(q => m.votes.has(q.id))) resolveMeeting(room);
}

function resolveMeeting(room) {
  const m = room.meeting;
  if (!m || m.finishing) return;
  m.finishing = true;

  const tally = new Map();
  m.votes.forEach(t => tally.set(t, (tally.get(t) || 0) + 1));

  let best = 'skip', bestN = -1, tied = false;
  for (const [t, n] of tally) {
    if (n > bestN) { best = t; bestN = n; tied = false; }
    else if (n === bestN) tied = true;
  }
  // Berelik varsa kimse atılmaz
  if (tied || bestN <= 0) best = 'skip';

  const victim = best === 'skip' ? null : room.players.get(best);
  const role = victim ? room.roles.get(best) : null;
  m.ejectedId = victim ? victim.id : null;

  /* Atılma SONRASI dengeyi kurban henüz ölmeden hesapla: atılan son
     sahtekârsa mürettebat, sahtekârlar çoğunluğa ulaştıysa sahtekârlar
     kazanır. Kurbanı canlı saymaya devam edersek 2 sahtekârlı oyunda
     BİR sahtekâr atılınca oyun erkenden biter. */
  if (victim) {
    const alive = [...room.players.values()]
      .filter(q => !q.dead && !q.gone && q.id !== victim.id);
    const imp = alive.filter(q => room.roles.get(q.id) === 'impostor').length;
    const crew = alive.filter(q => room.roles.get(q.id) === 'crew').length;
    if (imp === 0) m.winner = 'crew';
    else if (imp >= crew) m.winner = 'imp';
  }

  const detail = [...room.players.values()].map(p => ({
    id: p.id, n: p.name, ci: p.ci, dead: p.dead,
    vote: m.votes.get(p.id) || null,
  }));

  broadcast(room, {
    t: 'eject',
    id: victim ? victim.id : null,
    name: victim ? victim.name : null,
    ci: victim ? victim.ci : 0,
    role: role,
    skipped: !victim,
    votes: detail,
    winner: m.winner,
  });

  setTimeout(() => finalizeMeeting(room), EJECT_MS);
}

function finalizeMeeting(room) {
  const m = room.meeting;
  if (!m) return;
  room.meeting = null;

  /* Dışarı atılan oyuncu sahneden TAMAMEN kalkar: artık hareket edemez,
     raporlanamaz, hayatta sayılmaz ve çizilmez. Sahte kar atılırsa oyun
     bittiği için bu işaret, kazanan kontrolünden ÖNCE yapılmalı. */
  if (m.ejectedId) {
    room.reported.add(m.ejectedId);
    const ex = room.players.get(m.ejectedId);
    if (ex) { ex.dead = true; ex.deadAt = Date.now(); ex.killed = false; ex.gone = true; }
  }

  if (m.winner) { endGame(room, m.winner); return; }

  const alive = [...room.players.values()].filter(p => !p.dead && !p.gone);
  const imp = alive.filter(p => room.roles.get(p.id) === 'impostor').length;
  const crew = alive.filter(p => room.roles.get(p.id) === 'crew').length;
  if (imp === 0) return endGame(room, 'crew');
  if (imp >= crew) return endGame(room, 'imp');

  // Oyun sürüyor: herkes kantinden devam eder.
  room.phase = 'game';
  room.sent.clear();
  /* Toplantı, KILL COOLDOWN'unu sıfırlar (Among Us davranışı): istemci
     'resume' ile killCooldown=0 yapıyor, sunucu da 'killAt'ı temizlemeli.
     Aksi halde sunucu eski cooldown'u tutar, buton hazır görünür ama
     kill sessizce reddedilir. */
  room.killAt.clear();
  resetPositions(room);
  const full = fullState(room);
  room.players.forEach(p => {
    send(p.ws, { t: 'resume', you: p.id, myVote: null, p: full });
  });
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
        const ci = clampInt(msg.ci, 0, COLOR_COUNT - 1);
        const taken = [...room.players.values()].some(x => x.id !== p.id && x.ci === ci);
        // Reddedildiğinde otoriter rengi de yolla ki istemci kaydetsin
        if (taken) send(ws, { t: 'colno', ci: p.ci });
        else { p.ci = ci; pushLobby(room); }
        break;
      }

      case 'start':
        if (p.id === room.hostId) startGame(room, p.ws);
        break;

      case 'back':
        if (room.phase === 'lobby') break;
        /* Host oyunu tek başına sıfırlar ve HERKES lobide döner.
           Host dönmemişse bile oyuncu sonuç ekranında sıkışmasın diye
           yalnızca kendisini lobide hazır beklemeye alırız. */
        if (p.id === room.hostId) toLobby(room);
        else {
          p.ready = false;
          send(ws, { t: 'back' });
          pushLobby(room);
        }
        break;

      case 'p': {
        if (room.phase !== 'game' || p.dead || p.gone) break;
        p.x = clampPos(msg.x, WORLD.w, p.x);
        p.y = clampPos(msg.y, WORLD.h, p.y);
        p.dir = msg.d === -1 ? -1 : 1;
        p.moving = !!msg.m;
        p.angle = Number.isFinite(msg.a) ? msg.a : 0;
        break;
      }

      case 'kill':
        if (room.phase === 'game') doKill(room, p.id, String(msg.target || ''));
        break;

      case 'report':
        doReport(room, p.id, String(msg.body || ''));
        break;

      case 'emerg':
        doEmergency(room, p.id);
        break;

      case 'vote':
        castVote(room, p.id, msg.target);
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
  room.killAt.delete(ws.playerId);
  room.roles.delete(ws.playerId);
  // Ayrılan oyuncu hem konu hem alıcı olarak temizlenmeli
  room.sent.delete(ws.playerId);
  room.sent.forEach(per => per.delete(ws.playerId));
  // Toplantı sürerken ayrılırsa oyu düşer, kalanlar yine sonuç alabilir
  if (room.meeting) {
    room.meeting.votes.delete(ws.playerId);
    if (!room.meeting.finishing) pushVotes(room);
  }

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
