'use strict';
/* Geçici sunucu testi: 3 sahte oyuncuyla oda akışını uçtan uca dener.
   Önce sunucunun ayakta olduğundan emin ol:
     npm start                      (ayrı bir terminalde)
     npm test                       (bu test)                     */
const WebSocket = require('ws');

const GAME_PORT = process.env.PORT || 3000;
const URL = 'ws://localhost:' + GAME_PORT + '/ws';
const log = [];
const ok = (n, v) => log.push((v ? 'GECTI  ' : 'KALDI  ') + n);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Sunucu ayakta mı? Değilse anlaşılır mesle verip çık. */
fetch('http://localhost:' + GAME_PORT + '/health').catch(() => {
  console.error('Sunucu ayakta degil. Once "npm start" calistir, sonra bu testi tekrar et.');
  process.exit(2);
});

function bot() {
  const ws = new WebSocket(URL);
  const b = { ws, you: null, code: null, role: null, mates: null, msgs: [], lastLb: null, killed: [], cds: [], st: {} };
  ws.on('message', raw => {
    const d = JSON.parse(raw);
    b.msgs.push(d);
    if (d.t === 'created' || d.t === 'joined') { b.you = d.you; b.code = d.code; b.lobby = d.lobby; }
    if (d.t === 'go') { b.role = d.role; b.mates = d.mates; }
    if (d.t === 'lb') b.lastLb = d.lobby;
    if (d.t === 'killed') b.killed.push(d);
    if (d.t === 'cd') b.cds.push(d);
    if (d.t === 'st') Object.assign(b.st, d.p);
    if (d.t === 'end') b.end = d;
    if (d.t === 'deny') b.deny = d;
  });
  return b;
}
const send = (b, o) => b.ws.send(JSON.stringify(o));
/* Bağlantı çoktan açıldıysa hemen dön, yoksa 'open' olayını bekle. */
const open = b => b.ws.readyState === 1
  ? Promise.resolve()
  : new Promise(r => b.ws.once('open', r));

(async () => {
  const A = bot(), B = bot(), C = bot(), D = bot(), E = bot();
  await open(A); await open(B); await open(C);

  /* 1) oda kur + katıl */
  send(A, { t: 'create', n: 'Kaptan', ci: 0 });
  await sleep(250);
  ok('oda kodu 5 karakter', /^[A-Z0-9]{5}$/.test(A.code || ''));
  send(B, { t: 'join', code: A.code, n: 'Arda', ci: 3 });
  await sleep(250);
  send(C, { t: 'join', code: A.code, n: 'Nova', ci: 5 });
  await sleep(250);
  ok('katılımcı oda kodunu aldı', B.code === A.code);
  ok('üç oyuncu lobide', A.lastLb && A.lastLb.ps.length === 3);
  ok('ilk oyuncu host', (A.lastLb.ps.find(p => p.id === A.you) || {}).h === true);
  ok('ikinci oyuncu host değil', !(B.lastLb.ps.find(p => p.id === B.you) || {}).h);

  /* 2) olmayan odaya giriş reddedilmeli */
  await open(D);
  send(D, { t: 'join', code: 'ZZZZZ', n: 'Hayalet', ci: 8 });
  await sleep(250);
  ok('olmayan oda reddedildi', !!D.deny);

  /* 3) hazır + başlat */
  send(B, { t: 'ready', v: true });
  send(C, { t: 'ready', v: true });
  await sleep(250);
  ok('hazır durumu lobiye yansıdı',
    A.lastLb.ps.filter(p => p.r).length === 3);
  ok('host otomatik hazır sayılıyor',
    (A.lastLb.ps.find(p => p.id === A.you) || {}).r === true);
  send(A, { t: 'start' });
  await sleep(300);
  ok('oyun başladı (A)', A.role === 'impostor' || A.role === 'crew');
  ok('oyun başladı (B)', B.role === 'impostor' || B.role === 'crew');
  const imp = A.role === 'impostor' ? A : (B.role === 'impostor' ? B : C);
  const crew = [A, B, C].filter(x => x !== imp);
  ok('tek sahtekâr dağıtıldı', crew.length === 2);

  /* 4) ROL SIRLILIĞI */
  const goOf = x => x.msgs.find(m => m.t === 'go');
  log.push('BILGI  imp go=' + JSON.stringify(goOf(imp)));
  log.push('BILGI  crew0 go=' + JSON.stringify(goOf(crew[0])));
  ok('go mesajı sadece kendi rolünü içeriyor',
    goOf(imp).role !== undefined && goOf(imp).roles === undefined);
  ok('mürettebat diğerlerinin rolünü bilmiyor', Array.isArray(goOf(crew[0]).mates) && goOf(crew[0]).mates.length === 0);
  ok('tek sahtekâr varsa eş listesi boş', goOf(imp).mates.length === 0);

  /* 5) MENZİL KURALI: uzaktan kill reddedilmeli */
  send(imp, { t: 'p', x: 858, y: 198 });
  send(crew[0], { t: 'p', x: 700, y: 400 });
  send(crew[1], { t: 'p', x: 700, y: 420 });
  await sleep(250);
  send(imp, { t: 'kill', target: crew[0].you });
  await sleep(300);
  ok('menzil dışı kill reddedildi', imp.killed.length === 0);

  /* 6) MENZİL İÇİ kill kabul edilmeli */
  send(crew[0], { t: 'p', x: 868, y: 198 });
  await sleep(300);
  send(imp, { t: 'kill', target: crew[0].you });
  await sleep(300);
  ok('menzil içi kill çalıştı', imp.killed.length === 1 && imp.killed[0].victim === crew[0].you);
  ok('kurban da ölümü bildirildi', crew[0].killed.length === 1);
  ok('kill cooldown gönderildi', imp.cds.length === 1);

  /* 7) COOLDOWN: ikinci kill hemen reddedilmeli (1 kurban kaldı) */
  send(crew[1], { t: 'p', x: 863, y: 198 });
  await sleep(300);
  send(imp, { t: 'kill', target: crew[1].you });
  await sleep(300);
  ok('cooldown içindeki ikinci kill reddedildi', imp.killed.length === 1);

  /* 8) oyun sonu: 1 imp + 2 crew -> 1 kill sonrası 1v1 -> sahtekâr kazanır
        (Among Us kuralı: imp >= crew ise sahtekâr kazanır) */
  await sleep(400);
  ok('oyun sonu duyuruldu', !!imp.end);
  ok('son mesajda tüm roller açıklandı', !!(imp.end && imp.end.roles && Object.keys(imp.end.roles).length === 3));
  ok('1v1 sonrası sahtekâr kazandı', !!(imp.end && imp.end.winner === 'imp'));

  /* 9) lobiye dönüş */
  send(A, { t: 'back' });
  await sleep(300);
  ok('lobiye dönüldü', A.msgs.some(m => m.t === 'back') && B.msgs.some(m => m.t === 'back'));

  /* 10) sohbet sunucudan dağıtılıyor mu */
  send(B, { t: 'c', m: 'merhaba' });
  await sleep(250);
  const chatToA = A.msgs.filter(m => m.t === 'c').pop();
  ok('sohbet ulaştı', !!chatToA && chatToA.m === 'merhaba');
  ok('sohbet ismi sunucudan geldi', !!chatToA && chatToA.n === 'Arda');

  /* 11) oyun sürerken yeni oyuncu reddedilmeli */
  send(B, { t: 'ready', v: true });
  send(C, { t: 'ready', v: true });
  await sleep(200);
  send(A, { t: 'start' });
  await sleep(300);
  ok('ikinci tur başladı', A.msgs.filter(m => m.t === 'go').length === 2);
  await open(E);
  send(E, { t: 'join', code: A.code, n: 'Geç', ci: 7 });
  await sleep(250);
  ok('oyun sürerken katılım reddedildi', !!E.deny);

  /* 12) ayrılınca listeden düşmeli, host devri olmalı */
  send(A, { t: 'back' });
  await sleep(300);
  const before = A.lastLb.ps.length;
  B.ws.close();
  await sleep(500);
  ok('ayrılan oyuncu lobide düştü', A.lastLb.ps.length === before - 1);

  /* 13) host ayrılırsa yeni host atanmalı */
  A.ws.close();
  await sleep(600);
  const health = await fetch('http://localhost:' + GAME_PORT + '/health').then(r => r.text());
  ok('bağlantı koptuktan sonra sunucu ayakta', health === 'ok');
  const { rooms, players } = await fetch('http://localhost:' + GAME_PORT + '/rooms').then(r => r.json());
  log.push('BILGI  son durum: ' + JSON.stringify({ rooms, players }));

  /* 14) RENK ÇAKIŞMASI: herkes aynı rengi isteyince sunucu benzersiz dağıtmalı.
         Yoksa iki oyuncu aynı renkte görünür ve kim kimin olduğu anlaşılmaz. */
  const c1 = bot(), c2 = bot(), c3 = bot();
  await open(c1); await open(c2); await open(c3);
  send(c1, { t: 'create', n: 'R1', ci: 0 }); await sleep(200);
  send(c2, { t: 'join', code: c1.code, n: 'R2', ci: 0 }); await sleep(200);
  send(c3, { t: 'join', code: c1.code, n: 'R3', ci: 0 }); await sleep(300);
  const roomColors = c1.lastLb.ps.map(p => p.ci);
  log.push('BILGI  aynı renk isteyen 3 oyuncunun renkleri: ' + JSON.stringify(roomColors));
  ok('sunucu benzersiz renk dağıttı', new Set(roomColors).size === 3);
  ok('ilk oyuncu istediği rengi korudu', c1.lastLb.ps[0].ci === 0);
  send(c2, { t: 'col', ci: 0 }); await sleep(250);
  ok('dolu renk değiştirme reddedildi', c2.msgs.some(m => m.t === 'colno'));
  ok('red sonrası sunucu otoriter rengi yolladı',
    !!(c2.msgs.find(m => m.t === 'colno') || {}).ci);

  /* 15) 'go' tam oyuncu listesi taşımalı — lobide konum yayını olmadığı için
         istemciler diğer oyuncuları ancak burada tanır. */
  send(c2, { t: 'ready', v: true });
  send(c3, { t: 'ready', v: true });
  await sleep(200);
  send(c1, { t: 'start' });
  await sleep(300);
  const go1 = c1.msgs.find(m => m.t === 'go');
  ok("'go' tam oyuncu listesi içeriyor",
    !!(go1 && go1.p && Object.keys(go1.p).length === 3));
  ok("'go' listesinde herkesin adı ve rengi var",
    !!(go1 && Object.values(go1.p).every(v => v.n && v.c !== undefined)));

  /* 16) DELTA İNCELİĞİ: yalnızca x değiştiğinde sunucu y'ı yollamamalı.
         Bu, istemcide ty=NaN ve dolayısıyla görünmez oyuncu hatasını
         tetikleyen asıl senaryodur; protokol düzeltilirse test bunu doğrular. */
  const selfId = c1.you;
  const y0 = (go1.p[selfId] || {}).y;
  c1.st = {}; c2.st = {};
  const stFrom = c2.msgs.length;
  send(c1, { t: 'p', x: 500, y: y0, d: 1, m: 1, a: 0 });
  await sleep(400);
  ok('yatay hareket delta\'sı konumu taşıdı', (c2.st[selfId] || {}).x === 500);
  /* Delta mesajlarını keyframe'den AYIR: 2 sn'de bir gelen keyframe TAM
     durum yollar (y dahil), bu yüzden birleşik st'ye bakmak testi
     aralıklı bozuyordu. Delta tek konuyu taşır, keyframe tüm oyuncuları. */
  const deltas = c2.msgs.slice(stFrom)
    .filter(m => m.t === 'st' && Object.keys(m.p).length === 1 && m.p[selfId]);
  ok('yatay hareket delta\'sı yalnızca değişen alanı içeriyor',
    deltas.length > 0 &&
    deltas.every(m => m.p[selfId].x !== undefined && m.p[selfId].y === undefined));

  /* 17) KONUM SINIRI: harita dışı koordinat sunucuda kırpılmalı, yoksa
         istemci harita dışına "ışınlanıp" menzil kontrollerini deler. */
  send(c1, { t: 'p', x: 99999, y: -5000, d: 1, m: 0, a: 0 });
  await sleep(400);
  const cl = c2.st[selfId] || {};
  ok('harita dışı x kırpıldı (0..1521)', cl.x >= 0 && cl.x <= 1521);
  ok('harita dışı y kırpıldı (0..862)', cl.y >= 0 && cl.y <= 862);

  [c1, c2, c3].forEach(x => { try { x.ws.terminate(); } catch (e) {} });

  console.log(log.join('\n'));
  const failed = log.filter(l => l.startsWith('KALDI'));
  const info = log.filter(l => l.startsWith('BILGI'));
  console.log('\nSONUC: ' + (log.length - failed.length - info.length) + '/' + (log.length - info.length) + ' gecti');
  [A, B, C, D, E].forEach(x => { try { x.ws.terminate(); } catch (e) {} });
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('TEST HATASI:', e); process.exit(2); });
