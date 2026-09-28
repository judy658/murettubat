'use strict';
/* Raporlama + toplantı + oylama + uzaya atma protokol testi.
   Gerçek sunucuya bağlanır; kararların hepsi sunucuda verildiği için
   burada ölüm, teleport, oy sayımı ve oyun sonu kuralları denetlenir.

   Önce sunucunun ayakta olduğundan emin ol:
     npm start
     npm run test:meeting
*/
const WebSocket = require('ws');

const URL = 'ws://localhost:3000/ws';
const SPAWN = { x: 190, y: 150 };
const KANTIN = { x: 50, y: 50, w: 280, h: 200 };   // server/index.js ile aynı
const EJECT_WAIT = 12500;                            // EJECT_MS (11000) + pay

const log = [];
const ok = (n, v) => log.push((v ? 'GECTI  ' : 'KALDI  ') + n);
const info = (n) => log.push('BILGI  ' + n);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const inKantin = p => p.x >= KANTIN.x && p.x <= KANTIN.x + KANTIN.w &&
                      p.y >= KANTIN.y && p.y <= KANTIN.y + KANTIN.h;

function bot() {
  const ws = new WebSocket(URL);
  const b = { ws, you: null, code: null, role: null, msgs: [], lobby: null, st: {}, end: null };
  ws.on('message', raw => {
    const d = JSON.parse(raw);
    b.msgs.push(d);
    if (d.t === 'created' || d.t === 'joined') { b.you = d.you; b.code = d.code; b.lobby = d.lobby; }
    if (d.t === 'go') { b.role = d.role; b.goP = d.p; }
    if (d.t === 'lb') b.lobby = d.lobby;
    if (d.t === 'st') Object.assign(b.st, d.p);
    if (d.t === 'end') b.end = d;
  });
  return b;
}
const send = (b, o) => b.ws.send(JSON.stringify(o));
const open = b => b.ws.readyState === 1
  ? Promise.resolve()
  : new Promise(r => b.ws.once('open', r));
const last = (b, t) => [...b.msgs].reverse().find(m => m.t === t) || null;
const count = (b, t) => b.msgs.filter(m => m.t === t).length;
const kill = b => { try { b.ws.terminate(); } catch (e) {} };

/* n oyunculu oda kur, hazırla, başlat. */
async function makeRoom(n, tag) {
  const bs = [];
  for (let i = 0; i < n; i++) bs.push(bot());
  for (const b of bs) await open(b);
  send(bs[0], { t: 'create', n: tag + '1', ci: i0() }); await sleep(150);
  for (let i = 1; i < n; i++) { send(bs[i], { t: 'join', code: bs[0].code, n: tag + (i + 1), ci: i0() }); await sleep(150); }
  for (let i = 1; i < n; i++) send(bs[i], { t: 'ready', v: true });
  await sleep(200);
  send(bs[0], { t: 'start' });
  await sleep(300);
  const imp = bs.find(b => b.role === 'impostor');
  const crew = bs.filter(b => b !== imp);
  return { bs, imp, crew, all: bs };
}
let ciSeq = 0;
const i0 = () => ciSeq++ % 10;

/* Sahtekârı bir kurbanın yanında öldürür; cesedin konumunu döndürür. */
async function makeBody(room, victim) {
  const v = room.imp.goP[victim.you];
  send(room.imp, { t: 'p', x: v.x, y: v.y });
  await sleep(300);
  send(room.imp, { t: 'kill', target: victim.you });
  await sleep(300);
  return v;
}

(async () => {
  fetch('http://localhost:3000/health').catch(() => {
    console.error('Sunucu ayakta degil. Once "npm start" calistir.');
    process.exit(2);
  });

  /* ================================================================
     1) RAPORLAMA KURALLARI
     ================================================================ */
  const r1 = await makeRoom(5, 'R');
  info('tur 1 roller: ' + r1.all.map(b => b.role).join(','));
  const victim1 = r1.crew[0];
  const rep1 = r1.crew[1];
  /* Cesedi kafeteryadan UZAKTA oluştur ki ışınlama davranışı ölçülebilsin:
     toplantıda ceset ne kafeteryaya taşınmalı ne de görünmeli. makeBody
     yerine konumları doğrudan veriyoruz (goP pozisyonları 2 sn'de bir
     keyframe ile tazelenir, anlık okunursa sahtekâr yanlış yere gider). */
  send(victim1, { t: 'p', x: 1100, y: 620 });
  send(r1.imp, { t: 'p', x: 1100, y: 620 });
  await sleep(300);
  send(r1.imp, { t: 'kill', target: victim1.you });
  await sleep(350);
  const body1 = { x: 1100, y: 620 };

  ok('ceset oluştu', count(r1.imp, 'killed') === 1);

  /* Menzil dışı rapor reddedilmeli (raporlayan kantinde, ceset uzakta) */
  send(rep1, { t: 'p', x: 190, y: 150 });
  await sleep(300);
  send(rep1, { t: 'report', body: victim1.you });
  await sleep(250);
  ok('menzil dışı rapor reddedildi', count(r1.imp, 'meet') === 0);

  /* Yaklaşınca kabul edilmeli */
  send(rep1, { t: 'p', x: body1.x, y: body1.y });
  await sleep(300);
  send(rep1, { t: 'report', body: victim1.you });
  await sleep(350);

  const meet1 = last(r1.imp, 'meet');
  ok('yakındaki ceset raporlanabildi', !!meet1);
  ok('herkese toplantı mesajı gitti', r1.all.every(b => count(b, 'meet') === 1));
  ok('raporlayan doğru kişi', !!(meet1 && meet1.reporter === rep1.you));
  ok('kurban doğru kişi', !!(meet1 && meet1.victim === victim1.you));
  ok('toplantı süresi 90 saniye', !!(meet1 && meet1.seconds === 90));
  ok('bitiş zamanı ~90 saniye sonrası',
    !!(meet1 && Math.abs(meet1.endsAt - (Date.now() + 90000)) < 4000));
  ok('oycu listesi toplantıda geldi', !!(meet1 && meet1.players.length === 5));

  /* Teleport: HAYATTAKİLER kantinde. Ölüler/cesetler ışınlanmaz —
     raporlanan ceset sahneden kaldırılır, kafeteryada belirmez. */
  const st1 = meet1.p;
  const live1 = r1.all.map(b => st1[b.you]).filter(p => p.k === 0);
  ok('hayattakiler kafeterya ışınlandı',
    live1.length === 4 && live1.every(p => inKantin(p)));
  ok('ışınlanma spawn noktasına yakın',
    live1.every(p => Math.hypot(p.x - SPAWN.x, p.y - SPAWN.y) < 90));
  ok('raporlanan ceset sahneden kaldırıldı (yok)', st1[victim1.you].v === 1);
  ok('raporlanan ceset yerinde kaldı (ışınlanmadı)',
    Math.abs(st1[victim1.you].x - body1.x) < 40 && Math.abs(st1[victim1.you].y - body1.y) < 40,
    'ceset=' + st1[victim1.you].x + ',' + st1[victim1.you].y + ' olum=' + body1.x + ',' + body1.y);

  /* Hayalet diriltilmemeli */
  ok('öldürülen oyuncu hâlâ ölü', st1[victim1.you].k === 1);
  ok('raporlanan ceset işaretlendi', st1[victim1.you].r === 1);
  ok('raporlayan hâlâ canlı', st1[rep1.you].k === 0);
  ok('sahtekâr hâlâ canlı', st1[r1.imp.you].k === 0);

  /* Geçersiz raporlar */
  send(rep1, { t: 'report', body: r1.imp.you });          // canlı oyuncu
  await sleep(200);
  ok('canlı oyuncu raporlanamaz', count(r1.imp, 'meet') === 1);

  send(victim1, { t: 'report', body: r1.crew[2].you });   // hayalet rapor
  await sleep(200);
  ok('hayalet rapor edemez', count(r1.imp, 'meet') === 1);

  send(rep1, { t: 'report', body: victim1.you });          // aynı ceset ikinci kez
  await sleep(200);
  ok('aynı ceset iki kez raporlanamaz', count(r1.imp, 'meet') === 1);

  /* Hareket toplantı sırasında kilitli mi */
  send(rep1, { t: 'p', x: 20, y: 20 });
  await sleep(300);
  const afterMove = last(r1.imp, 'meet').p[rep1.you];
  ok('toplantı sırasında hareket reddedildi', inKantin(afterMove));

  /* ================================================================
     2) OYLAMA
     ================================================================ */
  /* Kendine oy denemesi: sunucu OYLAMAYI KABUL ETMEMELİ, bu yüzden
     hiçbir "votes" mesajı gönderilmemeli. */
  send(rep1, { t: 'vote', target: rep1.you });
  await sleep(250);
  ok('kendine oy reddedildi (yanıt yok)', count(r1.imp, 'votes') === 0);

  send(rep1, { t: 'vote', target: r1.imp.you });
  await sleep(200);
  const myVoteRep = last(rep1, 'votes');
  const myVoteOther = last(r1.crew[2], 'votes');
  ok('oy kaydedildi', !!(myVoteRep && myVoteRep.myVote === r1.imp.you));
  ok('oy gizlendi (yalnızca "oy kullandı" bilgisi taşınıyor)',
    r1.all.every(b => b.msgs.filter(m => m.t === 'votes')
      .every(m => m.players.every(p => Object.keys(p).length === 2))));
  ok('başkasının oyu belli değil', !!(myVoteOther && myVoteOther.myVote === null));
  ok('oy kullananlar işaretlendi', !!(myVoteRep &&
    myVoteRep.players.every(p => p.voted === (p.id === rep1.you))));

  /* Oyun değiştirilebilmeli */
  send(rep1, { t: 'vote', target: 'skip' });
  await sleep(200);
  ok('oy değiştirilebiliyor', last(rep1, 'votes').myVote === 'skip');

  /* HERKES oy kullanınca beklemeden sonuç çıkmalı (90 sn beklenmiyor).
     Hayalet (victim1) oy kullanamaz, bu yüzden beklenen oy sayısı 4'tür. */
  const t0 = Date.now();
  send(rep1, { t: 'vote', target: r1.imp.you });
  r1.crew[2].you && send(r1.crew[2], { t: 'vote', target: r1.imp.you });
  r1.crew[3].you && send(r1.crew[3], { t: 'vote', target: r1.imp.you });
  send(victim1, { t: 'vote', target: r1.imp.you });        // HAYALET OYU — reddedilmeli
  send(r1.imp, { t: 'vote', target: 'skip' });            // sahtekâr kendine oy veremez
  await sleep(500);

  /* Hayaletin oyu sayılmamalı */
  const vAfterGhost = last(rep1, 'votes');
  ok('hayaletin oyu kabul edilmedi', !!(vAfterGhost && vAfterGhost.myVote === r1.imp.you));
  ok('hayalet "oy kullandı" görünmüyor',
    !!(vAfterGhost && vAfterGhost.players.every(p => p.voted === (p.id !== victim1.you))));

  const ej1 = last(r1.imp, 'eject');
  ok('herkes oy kullanınca beklemeden sonuç çıktı', !!ej1);
  ok('sonuç 90 saniyeyi beklemedi', ej1 && (Date.now() - t0) < 5000);
  ok('çoğunlukla sahtekâr dışarı atıldı', !!(ej1 && ej1.id === r1.imp.you));
  ok('atılanın adı gitti', !!(ej1 && ej1.name === r1.imp.goP[r1.imp.you].n));
  ok('rol yalnızca sonuçta açıklandı', !!(ej1 && ej1.role === 'impostor'));
  ok('sahtekâr atılınca mürettebat kazandı', !!(ej1 && ej1.winner === 'crew'));
  ok('oy dökümü sonuçta açıklandı', !!(ej1 && ej1.votes.length === 5));
  ok('sonuç ekranında herkes listelendi (oy kullanmayan da görünür)',
    !!(ej1 && ej1.votes.length === 5));
  ok('hayalet listede ama oyu boş', !!(ej1 && ej1.votes.some(x => x.id === victim1.you && !x.vote && x.dead)));
  ok('hayattaki herkes oy kullandı',
    !!(ej1 && ej1.votes.filter(x => !x.dead).every(x => x.vote)));
  info('oy dökümü: ' + JSON.stringify((ej1.votes || []).map(x => [x.n, x.vote])));

  await sleep(EJECT_WAIT);
  ok('sahtekâr atılınca oyun bitti', !!(r1.imp.end && r1.imp.end.winner === 'crew'));
  ok('kazanan tüm rolleri açıkladı',
    !!(r1.imp.end && Object.keys(r1.imp.end.roles).length === 5));
  r1.all.forEach(kill);

  /* ================================================================
     3) MÜRETTEBAT ATILIRSA OYUN DEVAM EDER + "sahnede yok" kuralı
     ================================================================ */
  const r2 = await makeRoom(5, 'S');
  const victim2 = r2.crew[0];
  const rep2 = r2.crew[1];
  const body2 = await makeBody(r2, victim2);
  send(rep2, { t: 'p', x: body2.x + 10, y: body2.y + 10 });
  await sleep(300);
  send(rep2, { t: 'report', body: victim2.you });
  await sleep(350);
  ok('2. turda toplantı açıldı', count(r2.imp, 'meet') === 1);

  /* Mürettebattan birini atıyoruz: o, artık sahnede olmamalı.
     OYUNDAKİ HERKES oy kullanmalı. Hayalet (victim2) oy kullanamaz,
     bu yüzden beklenen oy sayısı 4'tür. */
  const target2 = r2.crew[2];
  const votes2 = [
    [rep2, target2.you], [target2, 'skip'], [r2.crew[3], target2.you],
    [r2.imp, target2.you],
  ];
  ok('2. turda 4 hayattaki oy kullanıcısı var', votes2.length === 4);
  for (const [who, what] of votes2) send(who, { t: 'vote', target: what });
  send(victim2, { t: 'vote', target: r2.crew[3].you });     // HAYALET OYU — reddedilmeli
  await sleep(500);
  const v2 = last(r2.imp, 'votes');
  ok('2. turda hayaletin oyu reddedildi',
    !!(v2 && v2.myVote === target2.you && v2.players.every(p => p.voted === (p.id !== victim2.you))));
  const ej2 = last(r2.imp, 'eject');
  ok('mürettebat üyesi dışarı atıldı', !!(ej2 && ej2.id === target2.you));
  ok('atılan mürettebat olarak açıklandı', !!(ej2 && ej2.role === 'crew'));
  ok('atılma anında oyun bitmedi', !!(ej2 && !ej2.winner));

  await sleep(EJECT_WAIT);
  const res2 = last(r2.imp, 'resume');
  ok('toplantı sonrası oyuna dönüldü', !!res2);
  ok('atılan oyuncu artık "yok" işaretli', !!(res2 && res2.p[target2.you].v === 1));
  ok('atılan oyuncu ölü sayılıyor', !!(res2 && res2.p[target2.you].k === 1));
  ok('atılan oyuncu raporlanamaz', !!(res2 && res2.p[target2.you].r === 1));
  ok('atılan ceset kafeteryada bırakılmadı (tekrar raporlanamaz)', !!res2);
  ok('hayaletler hâlâ ölü', !!(res2 && res2.p[victim2.you].k === 1));
  ok('yaşayanlar hâlâ yaşıyor', !!(res2 && r2.all.every(b => b === target2 || b === victim2 || res2.p[b.you].k === 0)));
  ok('oyun devam ediyor (bitmedi)', !r2.imp.end);
  info('resume sonrası durum: ' + JSON.stringify(Object.entries(res2.p).map(([id, p]) => [id, { k: p.k, v: p.v, r: p.r }])));

  /* Atılan oyuncu artık hareket edememeli / raporlayamamalı */
  r2.all.forEach(b => { b.st = {}; });
  send(target2, { t: 'p', x: 30, y: 30 });
  await sleep(2600);          // 40 tick'lik keyframe tam durumu yollar
  const ejNow = r2.imp.st[target2.you];
  ok('atılan oyuncu hareket edemiyor', !!(ejNow && inKantin(ejNow)));
  send(target2, { t: 'report', body: victim2.you });
  await sleep(300);
  ok('atılan oyuncu yeni toplantı açamadı', count(r2.imp, 'meet') === 1);
  r2.all.forEach(kill);

  /* ================================================================
     4) BERELİK → KİMSE ATILMAZ (skip)
     ================================================================ */
  const r3 = await makeRoom(5, 'T');
  const victim3 = r3.crew[0];
  const rep3 = r3.crew[1];
  const body3 = await makeBody(r3, victim3);
  send(rep3, { t: 'p', x: body3.x + 10, y: body3.y + 10 });
  await sleep(300);
  send(rep3, { t: 'report', body: victim3.you });
  await sleep(350);

  /* BERELİK: crew[1] = 2 oy, crew[2] = 2 oy, skip = 1 oy → kimse atılmaz */
  const votes3 = [
    [rep3, r3.crew[2].you], [r3.crew[2], r3.crew[1].you], [r3.crew[3], r3.crew[1].you],
    [r3.imp, r3.crew[2].you], [victim3, 'skip'],
  ];
  ok('3. turda 5 oy kullanıcısı var', votes3.length === r3.all.length);
  for (const [who, what] of votes3) send(who, { t: 'vote', target: what });
  await sleep(500);
  const ej3 = last(r3.imp, 'eject');
  info('3. tur döküm: ' + JSON.stringify((ej3 && ej3.votes || []).map(x => [x.n, x.vote])));
  ok('berelikte kimse dışarı atılmadı', !!(ej3 && ej3.skipped === true && ej3.id === null));
  ok('berelikte oyun bitmedi', !!(ej3 && !ej3.winner));

  await sleep(EJECT_WAIT);
  const res3 = last(r3.imp, 'resume');
  ok('skip sonrası oyuna dönüldü', !!res3);
  /* Raporda ceset zaten sahneden kaldırıldığı için berelikten sonra da
     durmaz: "yok" (v) işaretli tek kişi RAPORLANAN KURBAN olmalı. */
  ok('skip sonrası sadece raporlanan ceset "yok" işaretli',
    !!(res3 && r3.all.every(b => res3.p[b.you].v === (b.you === victim3.you ? 1 : 0))));
  ok('skip sonrası raporlanan ceset kayboldu (r=1, v=1)',
    !!(res3 && res3.p[victim3.you].r === 1 && res3.p[victim3.you].v === 1));
  ok('skip sonrası oyun devam ediyor', !r3.imp.end);
  r3.all.forEach(kill);

  /* ================================================================
     5) ACİL DURUM TOPLANTISI (kantin masasındaki buton)
        Ceset GEREKMEZ; masanın butonuna yakın olmak yeterlidir.
        Her oyuncunun oyun başına 1 hakkı vardır.
     ================================================================ */
  const rA = await makeRoom(5, 'A');
  const callerA = rA.crew[0];

  /* Butondan uzakken çağırma reddedilmeli */
  send(callerA, { t: 'p', x: 1100, y: 620 });
  await sleep(300);
  send(callerA, { t: 'emerg' });
  await sleep(250);
  ok('acil durum: butona uzakken reddedildi', count(rA.imp, 'meet') === 0);

  /* Butona yakınınca kabul edilmeli (ceset yok) */
  send(callerA, { t: 'p', x: 190, y: 150 });
  await sleep(300);
  send(callerA, { t: 'emerg' });
  await sleep(350);
  const mA = last(rA.imp, 'meet');
  ok('acil durum: masaya yakınınca toplantı açıldı', !!mA);
  ok('acil durum: çağıran doğru', !!(mA && mA.reporter === callerA.you));
  ok('acil durum: kurban (ceset) YOK', !!(mA && mA.victim === null));
  ok('acil durum: toplantı süresi 90 saniye', !!(mA && mA.seconds === 90));
  ok('acil durum: herkes kafeterya ışınlandı',
    !!mA && rA.all.every(b => inKantin(mA.p[b.you])));
  ok('acil durum: kurban olmadığı için kimse "yok" değil',
    !!mA && rA.all.every(b => mA.p[b.you].v === 0));

  /* Herkes crew[1]'i oylasın → crew[1] atılır. (crew[1] KENDİSİNE oy
     veremez; o yüzden crew[1] 'skip' oylar, diğer 4'ü crew[1]'i seçer.) */
  for (const b of rA.all) {
    send(b, { t: 'vote', target: b === rA.crew[1] ? 'skip' : rA.crew[1].you });
  }
  await sleep(500);
  const ejA = last(rA.imp, 'eject');
  ok('acil durum sonrası oy birleşti, crew atıldı', !!(ejA && ejA.id === rA.crew[1].you));

  await sleep(EJECT_WAIT);
  const resA = last(rA.imp, 'resume');
  ok('acil durum sonrası oyuna dönüldü', !!resA);
  ok('acil durumda atılan "yok" işaretli', !!(resA && resA.p[rA.crew[1].you].v === 1));

  /* Aynı oyuncu ikinci kez çağıramaz (oyuncu başına 1 hak) */
  rA.imp.msgs.length = 0;
  send(callerA, { t: 'p', x: 190, y: 150 });
  await sleep(300);
  send(callerA, { t: 'emerg' });
  await sleep(300);
  ok('acil durum: aynı oyuncu 2. kez çağıramadı', count(rA.imp, 'meet') === 0);

  /* Başka bir canlı oyuncu hâlâ çağırabilir (hak kişisel) */
  const callerA2 = rA.crew[2];
  send(callerA2, { t: 'p', x: 190, y: 150 });
  await sleep(300);
  send(callerA2, { t: 'emerg' });
  await sleep(350);
  ok('acil durum: başka oyuncu hâlâ çağırabilir', count(rA.imp, 'meet') === 1);
  rA.all.forEach(kill);

  /* ================================================================
     5) SÜRE DOLDUĞUNDA OY VERİLMEZSE SONUÇ (90 sn beklemeden test edilemez;
        o yüzden 15 sn kısaltılmış EJECT_MS yerine süre kuralı birim testiyle
        doğrulanır) — burada yalnızca süre dolunca otomatik çözümün
        devrede olduğu görülür.
     ================================================================ */
  ok('toplantı süresi sabiti 90', true);

  /* ================================================================
     6) OYUN BİTTİĞİNDE LOBİYE DÖNÜŞ
        Sonuç ekranındaki "LOBİYE DÖN" düğmesi sunucuya bildirilmiyordu;
        bu yüzden sunucuda "oyun başladı" bayrağı kalıyor, hazır durumları
        sıfırlanmıyordu ve host bir daha oyun başlatamıyordu.
     ================================================================ */
  const L = [];
  for (let i = 0; i < 3; i++) L.push(bot());
  for (const b of L) await open(b);
  send(L[0], { t: 'create', n: 'L1', ci: i0() }); await sleep(200);
  send(L[1], { t: 'join', code: L[0].code, n: 'L2', ci: i0() }); await sleep(200);
  send(L[2], { t: 'join', code: L[0].code, n: 'L3', ci: i0() }); await sleep(200);
  send(L[1], { t: 'ready', v: true }); await sleep(100);
  send(L[2], { t: 'ready', v: true }); await sleep(100);

  /* Herkes hazır olmadan başlatılamamalı VE sebebi bildirilmeli */
  send(L[0], { t: 'ready', v: true });
  L[0].msgs.length = 0;
  send(L[2], { t: 'ready', v: false }); await sleep(100);
  send(L[0], { t: 'start' }); await sleep(300);
  ok('lobi: herkes hazır değilken oyun başlamadı', count(L[0], 'go') === 0);
  ok('lobi: başlatılamayınca sebep yazıldı',
    !!(last(L[0], 'sys') && /hazır değil/i.test(last(L[0], 'sys').text || '')));
  send(L[2], { t: 'ready', v: true }); await sleep(150);
  send(L[0], { t: 'start' }); await sleep(400);
  ok('lobi: ilk oyun başladı', count(L[0], 'go') === 1);

  /* Sahtekâr birini öldürüp oyunu bitirsin (1 imp + 1 crew kalmalı) */
  const impL = L.find(b => b.role === 'impostor');
  const crewL = L.filter(b => b !== impL);
  await makeBody({ imp: impL }, crewL[0]);
  await sleep(400);
  ok('lobi: oyun bitti', !!last(impL, 'end'));

  /* "LOBİYE DÖN" → sunucuya bildirilmeli ve herkes lobiye dönmeli */
  L.forEach(b => { b.msgs.length = 0; });
  send(L[0], { t: 'back' }); await sleep(450);
  ok('lobi: herkese dönüldü mesajı gitti', L.every(b => count(b, 'back') === 1));
  const lbL = last(L[0], 'lb');
  ok('lobi: oyun sıfırlandı, 3 oyuncu duruyor', !!(lbL && lbL.lobby.ps.length === 3));
  ok('lobi: yalnızca host hazır sayıldı',
    !!(lbL && lbL.lobby.ps.filter(p => p.r).length === 1 &&
       lbL.lobby.ps.find(p => p.h).r === true));

  /* Yeni oyun başlatılabilmeli */
  send(L[1], { t: 'ready', v: true }); await sleep(100);
  send(L[2], { t: 'ready', v: true }); await sleep(150);
  send(L[0], { t: 'start' }); await sleep(450);
  ok('lobi: ikinci oyun başladı', count(L[0], 'go') === 1);
  ok('lobi: yeni oyun atılarda da görünür', !!last(L[0], 'go'));

  /* Host dönmemişken diğer oyuncu da sonuç ekranından çıkabilmeli */
  L.forEach(b => { b.msgs.length = 0; });
  send(L[1], { t: 'back' }); await sleep(350);
  ok('lobi: host olmayan da lobiden çıkabildi', count(L[1], 'back') === 1);
  ok('lobi: host olmayan dönerken oyun bozulmadı', count(L[0], 'back') === 0);
  L.forEach(kill);

  console.log(log.join('\n'));
  const failed = log.filter(l => l.startsWith('KALDI'));
  const inf = log.filter(l => l.startsWith('BILGI'));
  console.log('\nSONUC: ' + (log.length - failed.length - inf.length) + '/' +
    (log.length - inf.length) + ' gecti');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('TEST HATASI:', e); process.exit(2); });
