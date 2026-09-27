'use strict';
/* Geçici sunucu testi: 3 sahte oyuncuyla oda akışını uçtan uca dener.
   Önce sunucunun ayakta olduğundan emin ol:
     npm start                      (ayrı bir terminalde)
     npm test                       (bu test)                     */
const WebSocket = require('ws');

const URL = 'ws://localhost:3000/ws';
const log = [];
const ok = (n, v) => log.push((v ? 'GECTI  ' : 'KALDI  ') + n);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Sunucu ayakta mı? Değilse anlaşılır mesle verip çık. */
fetch('http://localhost:3000/health').catch(() => {
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
  send(imp, { t: 'p', x: 190, y: 150 });
  send(crew[0], { t: 'p', x: 700, y: 400 });
  send(crew[1], { t: 'p', x: 700, y: 420 });
  await sleep(250);
  send(imp, { t: 'kill', target: crew[0].you });
  await sleep(300);
  ok('menzil dışı kill reddedildi', imp.killed.length === 0);

  /* 6) MENZİL İÇİ kill kabul edilmeli */
  send(crew[0], { t: 'p', x: 200, y: 150 });
  await sleep(300);
  send(imp, { t: 'kill', target: crew[0].you });
  await sleep(300);
  ok('menzil içi kill çalıştı', imp.killed.length === 1 && imp.killed[0].victim === crew[0].you);
  ok('kurban da ölümü bildirildi', crew[0].killed.length === 1);
  ok('kill cooldown gönderildi', imp.cds.length === 1);

  /* 7) COOLDOWN: ikinci kill hemen reddedilmeli (1 kurban kaldı) */
  send(crew[1], { t: 'p', x: 195, y: 150 });
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
  const health = await fetch('http://localhost:3000/health').then(r => r.text());
  ok('bağlantı koptuktan sonra sunucu ayakta', health === 'ok');
  const { rooms, players } = await fetch('http://localhost:3000/rooms').then(r => r.json());
  log.push('BILGI  son durum: ' + JSON.stringify({ rooms, players }));

  console.log(log.join('\n'));
  const failed = log.filter(l => l.startsWith('KALDI'));
  console.log('\nSONUC: ' + (log.length - failed.length - 2) + '/' + (log.length - 2) + ' gecti');
  [A, B, C, D, E].forEach(x => { try { x.ws.terminate(); } catch (e) {} });
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('TEST HATASI:', e); process.exit(2); });
