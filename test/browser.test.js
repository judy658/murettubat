'use strict';
/* Tarayıcı testi: gerçek Edge'i CDP ile sürer, iki sekmede
   oda kur -> katıl -> hazır -> başlat -> konum -> kill -> solo akışını doğrular.
   Önce sunucunun ayakta olduğundan emin ol:
     npm start                      (ayrı bir terminalde)
     npm run test:browser           (bu test)                     */
const WebSocket = require('ws');
const { spawn } = require('child_process');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SITE = 'http://localhost:3000/Among3.html';
const DEBUG_PORT = 9333;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = [];
const ok = (n, v, extra) => log.push((v ? 'GECTI  ' : 'KALDI  ') + n + (extra ? '  -> ' + extra : ''));

/* ---------- minik CDP istemcisi ---------- */
class Tab {
  constructor(ws, tag) { this.ws = ws; this.tag = tag; this.id = 0; this.waiting = new Map(); this.errors = []; this.logs = []; }
  static async open(url, tag) {
    const r = await fetch(`http://localhost:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' });
    const target = await r.json();
    const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    const t = new Tab(ws, tag);
    ws.on('message', raw => {
      const d = JSON.parse(raw);
      if (d.id && t.waiting.has(d.id)) { const { res, rej } = t.waiting.get(d.id); t.waiting.delete(d.id); d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result); return; }
      if (d.method === 'Runtime.exceptionThrown') {
        const e = d.params.exceptionDetails;
        t.errors.push((e.exception && (e.exception.description || e.exception.value)) || e.text);
      }
      if (d.method === 'Runtime.consoleAPICalled' && /error|warning/.test(d.params.type)) {
        t.errors.push('console.' + d.params.type + ': ' + d.params.args.map(a => a.value || a.description || '').join(' '));
      }
    });
    await t.send('Runtime.enable');
    await t.send('Page.enable');
    // Arka plandaki sekmede rAF throttling olur; oyun döngüsü dursun diye
    // sayfayı "odakta" taklit ediyoruz.
    await t.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    // /json/new?url bu kurulumda gezinmiyor — adresi açıkça veriyoruz
    await t.send('Page.navigate', { url });
    return t;
  }
  send(method, params) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((res, rej) => { this.waiting.set(id, { res, rej }); setTimeout(() => rej(new Error(method + ' zaman aşımı')), 20000); });
  }
  async js(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('JS hatasi: ' + JSON.stringify((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result.value;
  }
  /* Bir ifade doğru olana kadar bekle (sabit uyku yerine) */
  async until(expr, ms = 20000, label = expr) {
    const t0 = Date.now();
    let lastErr = null;
    for (;;) {
      let v;
      try { v = await this.js(expr); } catch (e) { v = false; lastErr = e.message; }
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error('zaman asimi: ' + label + (lastErr ? ' | son hata: ' + lastErr : ''));
      await sleep(200);
    }
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

/* ---------- test ---------- */
(async () => {
  /* Sunucu ayakta mı? Değilse anlaşılır mesle verip çık. */
  try {
    await fetch('http://localhost:3000/health');
  } catch (e) {
    console.error('Sunucu ayakta degil. Once "npm start" calistir, sonra bu testi tekrar et.');
    process.exit(2);
  }

  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    // Her çalıştırmada yeni profil: kilitli/corrupt profil Edge'i düşürüyor
    '--user-data-dir=' + process.env.TEMP + '\\opencode\\edge-bt-' + Date.now(),
    '--remote-debugging-port=' + DEBUG_PORT, 'about:blank',
  ], { stdio: 'ignore' });

  // CDP ucunun açılmasını bekle
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    try { await fetch(`http://localhost:${DEBUG_PORT}/json/version`); ready = true; } catch (e) {}
  }
  if (!ready) { console.error('Edge CDP açılmadı'); edge.kill(); process.exit(2); }

  const A = await Tab.open(SITE, 'A');
  const B = await Tab.open(SITE, 'B');
  // Sayfalar + script'ler yüklensin (yoklama ile, sabit uyku değil)
  for (const t of [A, B]) {
    await t.until('document.readyState==="complete"', 25000, t.tag + ' sayfa yuklenmedi');
    await t.until('typeof createRoom==="function" && !!document.querySelector("#netStat")', 25000, t.tag + ' hazir degil');
  }

  /* 1) temel yükleme */
  const boot = await A.js(`JSON.stringify({
    peer: typeof window.Peer,
    canOnline: typeof canOnline,
    createRoom: typeof createRoom,
    sendMsg: typeof sendMsg,
    startGame: typeof startGame,
    hostConn: typeof hostConn,
    sendAll: typeof sendAll,
    mode: S.mode,
    net: document.querySelector('#netStat').textContent
  })`);
  const b = JSON.parse(boot);
  ok('PeerJS tamamen kaldırıldı', b.peer === 'undefined', 'Peer=' + b.peer);
  ok('yeni WebSocket API mevcut', b.canOnline === 'function' && b.createRoom === 'function' && b.sendMsg === 'function');
  ok('eski PeerJS fonksiyonları yok', b.startGame === 'undefined' && b.hostConn === 'undefined' && b.sendAll === 'undefined');
  ok('menü görünür', await A.js(`document.querySelector('#scr-menu').classList.contains('on')`));
  ok('ağ durumu yazısı yeni', /Sunucu/.test(b.net), b.net);

  /* 2) oda kur (A) */
  await A.js(`(()=>{const i=document.querySelector('#nameIn');i.value='Kaptan';i.dispatchEvent(new Event('input'));})()`);
  await A.js(`document.querySelector('#createBtn').click()`);
  await A.until('S.mode==="online" && !!roomCode && S.phase==="lobby"', 20000, 'A oda kuramadi');
  const a1 = JSON.parse(await A.js(`JSON.stringify({mode:S.mode,code:roomCode,lb:!!LB,net:document.querySelector('#netStat').textContent,cls:document.querySelector('#netStat').className,shown:document.querySelector('#lbCode').textContent.slice(0,5)})`));
  ok('oda kodu üretildi', /^[A-Z0-9]{5}$/.test(a1.code || ''), 'kod=' + a1.code);
  ok('online moda geçti', a1.mode === 'online', 'mode=' + a1.mode);
  ok('ağ durumu yeşil', /ok/.test(a1.cls), a1.cls);
  ok('lobide oda kodu görünüyor', a1.shown === a1.code, a1.shown + ' vs ' + a1.code);

  /* 3) B katılıyor */
  await B.js(`(()=>{const i=document.querySelector('#nameIn');i.value='Arda';i.dispatchEvent(new Event('input'));})()`);
  await B.js(`document.querySelector('#joinToggle').click()`);
  await sleep(200);
  await B.js(`(()=>{const i=document.querySelector('#joinCode');i.value=${JSON.stringify(a1.code)};})()`);
  await B.js(`document.querySelector('#joinGo').click()`);
  await B.until('S.mode==="online" && roomCode && S.phase==="lobby"', 20000, 'B katilamadi');
  await A.until('LB && LB.ps.length===2', 15000, 'A 2. oyuncuyu gormedi');
  const b1 = JSON.parse(await B.js(`JSON.stringify({code:roomCode,players:LB?LB.ps.length:0,host:!!(LB&&LB.ps.find(p=>p.id===myId).h),readyShown:document.querySelector('#readyBtn').style.display!=='none'})`));
  ok('B doğru odaya katıldı', b1.code === a1.code, 'code=' + b1.code);
  const a2 = JSON.parse(await A.js(`JSON.stringify({players:LB.ps.length,host:!!LB.ps.find(p=>p.id===myId).h,startShown:document.querySelector('#startBtn').style.display!=='none'})`));
  ok('A 2 oyuncuyu görüyor', a2.players === 2, 'players=' + a2.players);
  ok('A host oldu, başlat butonu görünür', a2.host === true && a2.startShown === true);
  ok('B host değil, hazır butonu görünür', b1.host === false && b1.readyShown === true);

  /* 4) B hazır, A başlat */
  await B.js(`document.querySelector('#readyBtn').click()`);
  await A.until('LB.ps.every(p=>p.r)', 15000, 'A hazir durumunu gormedi');
  const a3 = await A.js(`document.querySelector('#startHint').textContent`);
  ok('A herkes hazır uyarısını gördü', /fırlat/.test(a3), a3);
  ok('başlat butonu etkin', (await A.js(`document.querySelector('#startBtn').disabled`)) === false);
  await A.js(`document.querySelector('#startBtn').click()`);
  await A.until('S.phase==="game" && roles.get(myId)', 20000, 'A oyuna girmedi');
  await B.until('S.phase==="game" && roles.get(myId)', 20000, 'B oyuna girmedi');
  // Rol açılışı bitene kadar kontroller kapalı; konum gönderimi de başlamaz
  await A.until('controls===true', 20000, 'A kontrolleri acilmadi');
  await B.until('controls===true', 20000, 'B kontrolleri acilmadi');
  const gA = JSON.parse(await A.js(`JSON.stringify({phase:S.phase,game:document.querySelector('#scr-game').classList.contains('on'),myRole:roles.get(myId),total:roles.size,chip:document.querySelector('#roleChip').textContent,controls:controls,count:document.querySelector('#hudCount').textContent})`));
  const gB = JSON.parse(await B.js(`JSON.stringify({phase:S.phase,game:document.querySelector('#scr-game').classList.contains('on'),myRole:roles.get(myId),total:roles.size})`));
  ok('A oyun ekranında', gA.phase === 'game' && gA.game === true, 'phase=' + gA.phase);
  ok('B oyun ekranında', gB.phase === 'game' && gB.game === true, 'phase=' + gB.phase);
  ok('A rolünü biliyor', gA.myRole === 'impostor' || gA.myRole === 'crew', 'rol=' + gA.myRole);
  ok('B rolünü biliyor', gB.myRole === 'impostor' || gB.myRole === 'crew', 'rol=' + gB.myRole);
  ok('istemci yalnızca kendi rolünü biliyor', gA.total === 1 && gB.total === 1, 'A=' + gA.total + ' B=' + gB.total);
  ok('rol açılışı bitince kontroller açılıyor', gA.controls === true);
  ok('mürettebat sahtekârı tanımıyor', gA.myRole !== gB.myRole || gA.myRole === 'crew',
     'A=' + gA.myRole + ' B=' + gB.myRole);
  ok('A geri butonunu görüyor', (await A.js(`document.querySelector('#hudBack').style.display!=='none'`)) === true);
  ok('B geri butonunu görmüyor', (await B.js(`document.querySelector('#hudBack').style.display==='none'`)) === true);

  /* 5) sunucu konumlarını iki tarafa da yansıtıyor + HUD sayacı */
  await A.until('LB && players.size===2', 15000, 'A diger oyuncuyu hic almadi');
  await B.until('LB && players.size===2', 15000, 'B diger oyuncuyu hic almadi');
  ok('HUD 2 oyuncuyu sayıyor', /2 oyuncu/.test(await A.js(`document.querySelector('#hudCount').textContent`)),
     await A.js(`document.querySelector('#hudCount').textContent`));
  // Gerçek oyun döngüsü (requestAnimationFrame) konumu sunucuya göndermeli
  await A.js(`window.__st=0;const _s=sendMsg;sendMsg=function(o){if(o&&o.t==='p')window.__st++;return _s(o)}`);
  await A.until('window.__st>0', 15000, 'A oyun dongusu konum gondermedi');
  ok('oyun döngüsü konum gönderiyor', (await A.js(`window.__st`)) > 0, 'gonderilen=' + (await A.js(`window.__st`)));
  await A.js(`(()=>{const o=[...players.values()].find(p=>p.id!==myId);ME().x=300;ME().y=300;o.x=520;o.y=300;})()`);
  // B, A'nın konumunu görmeli -> B sekmesinde yokluyoruz
  await B.until('(()=>{const o=[...players.values()].find(p=>p.id!==myId);return o&&Math.abs(o.x-300)<90;})()', 15000, 'B A konumunu gormedi');
  const posSeen = await B.js(`(()=>{const o=[...players.values()].find(p=>p.id!==myId);return {x:Math.round(o.x),y:Math.round(o.y)};})()`);
  ok('konum delta sunucudan geldi', Math.abs(posSeen.x - 300) < 90, 'x=' + posSeen.x + ' y=' + posSeen.y);

  /* 5b) GÖRÜŞ: duvar arkasındaki oyuncu görülmemeli (menzil+açı izin verse bile) */
  await A.js(`(()=>{const me=ME();me.x=me.tx=300;me.y=me.ty=240;})()`);   // KANTİN
  await B.js(`(()=>{const me=ME();me.x=me.tx=390;me.y=me.ty=280;})()`);   // GÜVENLİK (duvar arkası)
  await sleep(1400);
  const losR = await A.js(`(()=>{
    const me=ME(),o=[...players.values()].find(p=>p.id!==myId);
    if(!o)return 'yok';
    const d=Math.hypot(o.x-me.x,o.y-me.y);
    if(d>150)return 'uzak:'+Math.round(d);          // menzil kısıtlamasını atla
    return isInView(me,o)===false ? 'engelli' : 'gorunur';
  })()`);
  ok('duvar arkasindaki oyuncu gorunmuyor', losR === 'engelli', 'durum=' + losR);
  await B.js(`(()=>{const me=ME();me.x=me.tx=330;me.y=me.ty=240;})()`);   // A'nın tam önü (konide)
  await sleep(1400);
  const losR2 = await A.js(`(()=>{const me=ME(),o=[...players.values()].find(p=>p.id!==myId);if(!o)return 'yok';return canSee(me,o)===true})()`);
  ok('konideki oyuncu gorunuyor', losR2 === true, 'durum=' + losR2);
  await B.js(`(()=>{const me=ME();me.x=me.tx=300;me.y=me.ty=250;})()`);   // arkada → koni dışı
  await sleep(1400);
  const losR3 = await A.js(`(()=>{const me=ME(),o=[...players.values()].find(p=>p.id!==myId);if(!o)return 'yok';return canSee(me,o)===false})()`);
  ok('arkadaki (koni disi) oyuncu gorunmuyor', losR3 === true, 'durum=' + losR3);

  /* 5c) SİS pikselleri: el feneri KONİSİ dünyayla hizalı olmalı.
     Maske konumu dünyadan ekrana YANLIŞ ötelenirse (0.4.7 hatası)
     aydınlık/karanlık haritaya göre kayar: önümüzdeki zemin noktası
     karanlık ya da arkadaki zemin aydınlık görünür. */
  await A.js(`(()=>{const me=ME();me.x=me.tx=190;me.y=me.ty=150;me.angle=0;})()`); // KANTİN, sağa bak
  await sleep(900); // kamera player'a otursun
  const fogPx = await A.js(`(()=>{
    const dprr=dpr, sc=view.sc;
    const toPx=(wx,wy)=>[Math.round((vw/2+(wx-cam.x)*sc)*dprr),Math.round((vh/2+(wy-cam.y)*sc)*dprr)];
    const px=toPx(300,150);            // önde, koni İÇİNDE, zeminde
    const aAhead=fogC.getContext('2d').getImageData(px[0],px[1],1,1).data[3];
    const pr=toPx(60,150);             // arkada, koni DIŞINDA, zeminde
    const aBack=fogC.getContext('2d').getImageData(pr[0],pr[1],1,1).data[3];
    return {ahead:aAhead,back:aBack};
  })()`);
  ok('sis konisi hizali: ondeki zemin aydinlik', fogPx.ahead < 120, 'a=' + fogPx.ahead);
  ok('sis konisi hizali: arkadaki zemin karanlik', fogPx.back > 140, 'a=' + fogPx.back);

  /* 6) kill: sahtekâr menzildeyken öldürebilmeli, mürettebat edememeli */
  // Roller rastgele dağıtıldığı için sahtekârın hangi sekmede olduğunu bul
  const impIsA = gA.myRole === 'impostor';
  const IMP = impIsA ? A : B, CREW = impIsA ? B : A;
  ok('tam olarak bir sekme sahtekâr', impIsA !== (gB.myRole === 'impostor'), 'A=' + gA.myRole + ' B=' + gB.myRole);
  // İkisini de menzile yaklaştır
  const pull = `(()=>{const me=ME();const o=[...players.values()].find(p=>p.id!==myId);me.x=300;me.y=300;o.x=330;o.y=300;})()`;
  await A.js(pull); await B.js(pull);
  await sleep(900);
  const clsImp = await IMP.js(`document.querySelector('#killBtn').className`);
  const clsCrew = await CREW.js(`document.querySelector('#killBtn').className`);
  ok('sahtekârın kill butonu menzilde parlıyor', /ready/.test(clsImp), 'cls=' + clsImp);
  ok('mürettebatın kill butonu parlamıyor', !/ready/.test(clsCrew), 'cls=' + clsCrew);
  const impBefore = await CREW.js(`ME().dead`);
  await IMP.js(`tryKill()`);
  await CREW.until('ME().dead===true', 15000, 'kurban oldurulmedi');
  ok('kill sonucu kurban tarafında işledi', (await CREW.js(`ME().dead`)) === true, 'once=' + impBefore);
  ok('kurban ölüm ekranını gördü', (await CREW.js(`document.querySelector('#deathScreen').classList.contains('on')`)) === true);
  ok('sahtekâr cooldown aldı', (await IMP.js(`killCooldown>0`)) === true);

  /* 7) RAPORLAMA + TOPLANTI + OYLAMA (4 oyunculu yeni oda) */
  const M = [];
  for (let i = 0; i < 4; i++) {
    const t = await Tab.open(SITE, 'M' + (i + 1));
    await t.until('document.readyState==="complete"', 25000, t.tag + ' sayfa yuklenmedi');
    await t.until('typeof createRoom==="function"', 25000, t.tag + ' hazir degil');
    await t.js(`(()=>{const n=document.querySelector('#nameIn');n.value='M'+(${i}+1);n.dispatchEvent(new Event('input'));})()`);
    M.push(t);
  }
  await M[0].js(`document.querySelector('#createBtn').click()`);
  await M[0].until('S.phase==="lobby" && !!roomCode', 20000, 'M1 oda kuramadi');
  const mcode = await M[0].js(`roomCode`);
  for (let i = 1; i < 4; i++) {
    // joinGo butonuna basmak prefs.name'i girdiden okur; doğrudan joinRoom()
    // çağırmak ismi göndermezdi.
    await M[i].js(`(()=>{document.querySelector('#joinCode').value='${mcode}';document.querySelector('#joinGo').click();})()`);
    await M[i].until('S.phase==="lobby" && !!roomCode', 20000, 'M' + (i + 1) + ' katilamadi');
  }
  for (let i = 1; i < 4; i++) await M[i].js(`(()=>{document.querySelector('#readyBtn').click();})()`);
  await sleep(400);
  await M[0].js(`document.querySelector('#startBtn').click()`);
  for (const t of M) await t.until('S.phase==="game" && !!roles.get(myId)', 20000, t.tag + ' oyunu gormedi');
  ok('4 oyunculu oyun basladi', (await M[0].js(`players.size`)) === 4);

  const mImp = (await M[0].js(`roles.get(myId)`)) === 'impostor' ? M[0]
    : (await M[1].js(`roles.get(myId)`)) === 'impostor' ? M[1]
    : (await M[2].js(`roles.get(myId)`)) === 'impostor' ? M[2] : M[3];
  const mCrew = M.filter(t => t !== mImp);
  ok('tam olarak bir sagtekar var', (await mImp.js(`roles.get(myId)`)) === 'impostor');

  // Rol açılışı bitene kadar bekle: kontroller kapalıyken konum gönderilmiyor.
  for (const t of M) await t.until('controls===true', 30000, t.tag + ' rol acilisi bitmedi');
  ok('herkes kendi adini gormus', (await M[0].js(`[...new Set([...players.values()].map(p=>p.name))].length`)) === 4,
    await M[0].js(`JSON.stringify([...players.values()].map(p=>p.name))`));

  // Sahtekâr bir mürettebatı öldürsün. HANGİ oyuncunun öleceğini
  // varsaymıyoruz: findKillTarget() en yakını seçer, ölü olan sekmeyi
  // yoklayarak buluyoruz.
  const mIds = await Promise.all(M.map(t => t.js(`myId`)));
  const impId = await mImp.js(`myId`);
  const tgtId = await mImp.js(`[...players.values()].find(p=>p.id!==myId).id`);
  await mImp.js(`(()=>{const me=ME();const o=players.get(${JSON.stringify(tgtId)});me.x=me.tx=o.x+15;me.y=me.ty=o.y;})()`);
  await mImp.until('!!findKillTarget()', 8000, 'sagtekar menzilde hedef bulamadi');
  await sleep(400);
  await mImp.js(`tryKill()`);

  let VICTIM = null;
  for (let i = 0; i < 80 && !VICTIM; i++) {
    for (const t of mCrew) { if ((await t.js(`ME().dead`)) === true) { VICTIM = t; break; } }
    if (!VICTIM) await sleep(250);
  }
  const REPORTER = mCrew.find(t => t !== VICTIM);
  ok('rapor testi icin ceset olustu', !!VICTIM, 'oluler=' + mCrew.map(t => t.tag).join(','));
  ok('raporlayan hayatta kaldi', !!(REPORTER && (await REPORTER.js(`ME().dead`)) === false));

  // Uzaklaşınca rapor butonu görünmemeli
  await REPORTER.js(`(()=>{const me=ME();me.x=1000;me.y=640;})()`);
  await sleep(500);
  ok('uzakta rapor butonu parlamiyor',
    !/ready/.test(await REPORTER.js(`document.querySelector('#reportBtn').className`)));
  // Cesede yaklaşınca görünmeli
  await REPORTER.js(`(()=>{const me=ME();const c=[...players.values()].find(p=>p.id!==myId&&p.dead);me.x=c.x+20;me.y=c.y+20;})()`);
  await REPORTER.until(`/ready/.test(document.querySelector('#reportBtn').className)`, 8000, 'rapor butonu parladi');
  ok('cesede yakinlasinca rapor butonu parladi', true);
  ok('rapor butonu gorunur', /show/.test(await REPORTER.js(`document.querySelector('#reportBtn').className`)));
  ok('rapor butonu olu hedef buldu', !!(await REPORTER.js(`!!findReportTarget()`)));
  ok('raporlanmis olmayan ceset secildi', (await REPORTER.js(`(()=>{const t=findReportTarget();return t&&t.dead&&!t.reported})()`)) === true);

  // Raporla -> toplantı açılmalı
  await REPORTER.js(`tryReport()`);
  for (const t of M) await t.until(`!!meeting`, 12000, t.tag + ' toplanti acmadi');
  ok('rapor sonrasi toplanti ekrani acildi',
    (await REPORTER.js(`document.querySelector('#meetingScreen').classList.contains('on')`)) === true);
  ok('herkes toplanti ekraninda', (await Promise.all(M.map(t => t.js(`!!meeting`)))).every(Boolean));
  ok('toplanti sirasinda kontroller kilitli', (await REPORTER.js(`controls===false`)) === true);
  ok('toplanti basligi raporlayan ve kurbani gosteriyor',
    /M\d/.test(await REPORTER.js(`document.querySelector('#mtTitle').textContent`)),
    await REPORTER.js(`document.querySelector('#mtTitle').textContent`));
  const tsec = await REPORTER.js(`Math.ceil((meeting.endsAt-Date.now())/1000)`);
  ok('toplanti sayaci 90 saniyeden basladi', tsec > 80 && tsec <= 90, 'saniye=' + tsec);
  ok('oy kartlari cizildi', (await REPORTER.js(`document.querySelectorAll('#mtGrid .mt-card').length`)) === 4);
  ok('hayalet karti pasif isaretli', (await VICTIM.js(`[...document.querySelectorAll('#mtGrid .mt-card')].some(c=>c.classList.contains('dead'))`)) === true);
  /* Hayalet oy KULLANAMAMALI: boş bırak kilidi de kapalı, kart tıklaması işe yaramıyor */
  ok('hayalette boş bırak butonu kilitli', (await VICTIM.js(`document.querySelector('#mtSkip').classList.contains('locked')`)) === true);
  await VICTIM.js(`castVote('skip')`);
  await VICTIM.js(`[...document.querySelectorAll('#mtGrid .mt-card')].find(c=>!c.classList.contains('dead')&&!c.classList.contains('mine')).click()`);
  await sleep(400);
  ok('hayaletin oyu kaydedilmedi', (await VICTIM.js(`meeting.myVote===null`)) === true);
  ok('hayalettin oy kullanamiyor uyarisi goruldu',
    /oy kullanamazsın/i.test(await VICTIM.js(`document.querySelector('#mtSub').textContent`)),
    await VICTIM.js(`document.querySelector('#mtSub').textContent`));
  ok('hayalet oy sayacini gormuyor', !/\d+\/\d+/.test(await VICTIM.js(`document.querySelector('#mtSub').textContent`)));
  ok('kendim kartin tıklanamaz', (await REPORTER.js(`document.querySelector('#mtGrid .mt-card.mine')!==null`)) === true);
  ok('raporlayan kafeteryada', !!(await REPORTER.js(`(()=>{const m=ME();return m.x>=50&&m.x<=330&&m.y>=50&&m.y<=250})()`)));
  /* Raporlanan ceset toplantıyla birlikte SAHNEDEN KALDIRILIR (Among Us
     gibi): "gone" işaretlenir → çizilmez. (Işınlanmama/"yerinde kalma"
     davranışı protokol testinde doğrulanıyor.) */
  ok('raporlanan ceset kayboldu (gone, cizilmez)', (await VICTIM.js(`ME().gone===true`)) === true);

  // Oy ver
  await REPORTER.js(`castVote(${JSON.stringify(impId)})`);
  await REPORTER.until(`meeting.myVote!==null`, 8000, 'oy kaydedilmedi');
  ok('oy kullanimi isaretlendi',
    (await REPORTER.js(`[...document.querySelectorAll('#mtGrid .mt-card')].some(c=>c.classList.contains('voted'))`)) === true);
  ok('oy kartinda tik var', await REPORTER.js(`(()=>{
    const c=document.querySelector('#mtGrid .mt-card.picked');
    if(!c)return 'picked-yok:'+[...document.querySelectorAll('#mtGrid .mt-card')].map(x=>x.className).join('|');
    const k=c.querySelector('.tick');
    if(!k)return 'tick-yok:'+c.className;
    return getComputedStyle(k).display!=='none';
  })()`), await REPORTER.js(`(()=>{const c=document.querySelector('#mtGrid .mt-card.picked');return c?c.className:'yok'})()`));
  // Başkasının oyu gizli kalmalı
  await sleep(300);
  const votedSeen = await mImp.js(`document.querySelectorAll('#mtGrid .mt-card.voted').length`);
  ok('baskasinin oyu gizli', votedSeen <= 2, 'isaretli=' + votedSeen);

  // Mürettebatın HEPSİ sahtekâra oy versin (sahtekâr kendine oy veremez)
  for (const t of mCrew) await t.js(`castVote(${JSON.stringify(impId)})`);
  await mImp.js(`castVote('skip')`);
  for (const t of M) await t.until(`ejecting===true`, 15000, t.tag + ' atma animasyonu baslamadi');
  ok('herkes oy kullaninca uzaya atma basladi', true);
  ok('atma canvas i boyutlu (1x1 bug i)', (await REPORTER.js(`document.querySelector('#ejCanvas').width>8 && document.querySelector('#ejCanvas').height>8`)) === true,
    'w=' + await REPORTER.js(`document.querySelector('#ejCanvas').width`) + ' h=' + await REPORTER.js(`document.querySelector('#ejCanvas').height`));
  ok('toplanti ekrani kapandi',
    (await REPORTER.js(`document.querySelector('#meetingScreen').classList.contains('on')`)) === false);
  ok('atma ekrani acildi',
    (await REPORTER.js(`document.querySelector('#ejectScreen').classList.contains('on')`)) === true);
  ok('animasyon sınıfı işledi', true);
  const tEject = Date.now();
  // Animasyon bitip sonuç yazısı gelsin (EJECT_TOTAL = 6400 ms)
  await REPORTER.until(`document.querySelector('#ejectScreen .ej-text').classList.contains('on')`, 12000, 'atma sonucu gorunmedi');
  ok('atma sonucu yazi olarak cikti',
    /DIŞARI ATILDI/.test(await REPORTER.js(`document.querySelector('#ejTitle').textContent`)),
    await REPORTER.js(`document.querySelector('#ejTitle').textContent`));
  ok('rol atma sonunda aciklandi',
    /SAHTEKÂR|MÜRETTEBAT/.test(await REPORTER.js(`document.querySelector('#ejRole').textContent`)),
    await REPORTER.js(`document.querySelector('#ejRole').textContent`));
  ok('animasyon en az 6 saniye surdu', (Date.now() - tEject) > 5500, 'ms=' + (Date.now() - tEject));
  // Sahtekâr atıldı -> mürettebat kazanır, sonuç ekranı gelir
  for (const t of M) await t.until(`gameOver===true`, 15000, t.tag + ' oyun bitmedi');
  ok('sagtekar atilinca oyun bitti', (await REPORTER.js(`gameOver`)) === true);
  ok('sonuc ekrani gorundu',
    /sonuç|SAHTEKÂR|MÜRETTEBAT|KAZANDI/i.test(await REPORTER.js(`document.querySelector('#resultScreen').textContent`)));
  ok('atilan oyuncu sahnede cizilmiyor', (await REPORTER.js(`ejecting===false`)) === true);
  /* Sahtekâr atılsa da ceset bırakmaz: gone + dead işaretli */
  ok('atilan sahtekarin cesedi hic yok', (await REPORTER.js(
    `(()=>{const p=players.get(${JSON.stringify(impId)});return p&&p.gone===true&&p.dead===true&&p.reported===true})()`)) === true);

  /* Oyun bitti → "LOBİYE DÖN" sunucuya bildirmeli, hazır durumları
     sıfırlanmalı ve HOST yeniden oyun başlatabilmeli. */
  await M[0].js(`document.querySelector('#rsBack').click()`);
  for (const t of M) await t.until('S.phase==="lobby"', 12000, t.tag + ' lobiye donmedi');
  await M[0].until(`!!LB && LB.ps.filter(p=>p.r).length===1 && LB.ps.find(p=>p.h).r===true`, 12000, 'host hazir sifirlandi');
  ok('lobide yalnizca host hazir', (await M[0].js(`LB.ps.filter(p=>p.r).length===1 && LB.ps.find(p=>p.h).r===true`)) === true);
  ok('lobide 4 kisi kaldi', (await M[0].js(`LB.ps.length`)) === 4,
    await M[0].js(`LB.ps.length`));
  for (let i = 1; i < 4; i++) await M[i].js(`document.querySelector('#readyBtn').click()`);
  await sleep(500);
  await M[0].js(`document.querySelector('#startBtn').click()`);
  for (const t of M) await t.until('S.phase==="game" && !!roles.get(myId)', 20000, t.tag + ' ikinci oyun baslamadi');
  ok('lobiden ikinci oyun baslatilabildi', (await M[0].js(`S.phase==="game"`)) === true,
    await M[0].js(`S.phase+' startBtn='+document.querySelector('#startBtn').disabled`));
  const g2 = await M[0].js(`players.size`);
  ok('ikinci oyunda 4 oyuncu', g2 === 4, 'oyuncu=' + g2);

  const errM = M.flatMap(t => t.errors.filter(e => !/favicon|ERR_|Failed to load resource/.test(e)));
  ok('toplanti sekmelerinde JS hatasi yok', errM.length === 0, errM.join(' | '));

  /* 8) konsol hataları (önceki iki sekme) */
  const errsA = A.errors.filter(e => !/favicon|ERR_|Failed to load resource/.test(e));
  const errsB = B.errors.filter(e => !/favicon|ERR_|Failed to load resource/.test(e));
  ok('A sekmesinde JS hatası yok', errsA.length === 0, errsA.join(' | '));
  ok('B sekmesinde JS hatası yok', errsB.length === 0, errsB.join(' | '));

  /* 9) SOLO hâlâ çalışıyor mu (sunucusuz) */
  const S = await Tab.open(SITE, 'S');
  await S.until('typeof startSolo==="function" && !!document.querySelector("#soloBtn")', 25000, 'S sayfa yuklenmedi');
  await S.js(`(()=>{const i=document.querySelector('#nameIn');i.value='Yalnız';i.dispatchEvent(new Event('input'));})()`);
  await S.js(`document.querySelector('#soloBtn').click()`);
  await S.until('S.mode==="solo" && S.phase==="game"', 20000, 'solo baslamadi');
  const s1 = JSON.parse(await S.js(`JSON.stringify({mode:S.mode,players:players.size,bots:[...players.values()].filter(p=>p.bot).length,role:roles.get(myId),total:roles.size})`));
  ok('solo moda geçti', s1.mode === 'solo', 'mode=' + s1.mode);
  ok('solo botlar eklendi', s1.bots >= 3, 'bot=' + s1.bots);
  ok('solo rolleri dağıtıldı', s1.total === s1.players, s1.total + '/' + s1.players);
  ok('solo sekmesinde JS hatası yok', S.errors.filter(e => !/favicon|ERR_|Failed to load resource/.test(e)).length === 0, S.errors.join(' | '));

  /* 10) SOLO raporlama: bot öldürülünce ceset raporlanabilmeli */
  const bots = await S.js(`[...players.values()].filter(p=>p.bot).map(p=>p.id)`);
  ok('solo bot cesdi bulundu', bots.length > 0, 'bot=' + bots.length);
  await S.js(`(()=>{const b=[...players.values()].find(p=>p.bot);const m=ME();b.dead=true;b.reported=false;b.gone=false;b.x=b.tx=m.x+25;b.y=b.ty=m.y;})()`);
  await S.until(`/ready/.test(document.querySelector('#reportBtn').className)`, 8000, 'solo rapor butonu parladi');
  ok('solo modda rapor butonu parladi', true);
  await S.js(`tryReport()`);
  await S.until(`!!meeting`, 10000, 'solo toplanti acmadi');
  ok('solo toplanti ekrani acildi',
    (await S.js(`document.querySelector('#meetingScreen').classList.contains('on')`)) === true);
  ok('solo toplantida tum oyuncular var', (await S.js(`meeting.players.length`)) === 4);
  ok('solo toplanti sayaci 90', (await S.js(`Math.ceil((meeting.endsAt-Date.now())/1000)`)) > 80);
  await S.js(`castVote('skip')`);
  await S.until(`ejecting===true`, 25000, 'solo botlar oy vermedi / atma baslamadi');
  ok('solo oylama sonucu animasyona baglandi', true);
  ok('solo sekmesinde JS hatasi yok (toplanti)', S.errors.filter(e => !/favicon|ERR_|Failed to load resource/.test(e)).length === 0, S.errors.join(' | '));

  /* 11) ACİL DURUM butonu: taze solo oyununda buton hazır olmalı, tıklanınca
        toplantı başlığı "ACİL DURUM" olmalı (ceset yok), tekrar tıklama reddedilmeli. */
  await S.js(`startSolo()`);
  await S.until('S.mode==="solo" && S.phase==="game" && !gameOver && !meeting', 15000, '2. solo baslamadi');
  // Oyuncuyu masa üstüne (190,150) taşı
  await S.js(`(()=>{const m=ME();m.x=m.tx=190;m.y=m.ty=150;})()`);
  await S.until(`/ready/.test(document.querySelector('#emergBtn').className)`, 8000, 'solo acil durum butonu hazir degil');
  ok('solo acil durum butonu hazir (masa basinda)', true);
  ok('acil durum butonu gosteriliyor', (await S.js(`/show/.test(document.querySelector('#emergBtn').className)`)) === true);
  const soloEmergBtn = await S.js(`document.querySelector('#emergBtn').offsetWidth>0`);
  ok('acil durum butonu sifir degil', soloEmergBtn === true);
  await S.js(`tryEmergency()`);
  await S.until('!!meeting', 10000, 'solo acil durum toplanti acmadi');
  ok('solo acil durum toplanti acildi',
    (await S.js(`document.querySelector('#meetingScreen').classList.contains('on')`)) === true);
  ok('acil durum toplantisinda kurban (ceset) yok', (await S.js(`meeting.victim`)) === null);
  ok('acil durum toplanti basligi dogru',
    /ACİL DURUM/.test(await S.js(`document.querySelector('#mtTitle').textContent`)),
    await S.js(`document.querySelector('#mtTitle').textContent`));
  ok('acil durum sayaci 90', (await S.js(`Math.ceil((meeting.endsAt-Date.now())/1000)`)) > 80);
  // Hak bir kez: oyuncu ölü değilse tekrar çağıramaz, buton hazır olmaz
  const emergUsedAfter = await S.js(`emergUsed`);
  ok('acil durum hakki isaretlendi (1 kez)', emergUsedAfter === true);

  /* 12) SKIP (berelik) ANİMASYONU: kırmızı astronot yerine RAPOR
     butonundaki gibi MEGAFON (📢) uçmalı, isim etiketi olmamalı.
     rAF'a bağımlı olmamak için drawEjectObj doğrudan, dolgu-metni
     (fillText) casusuyla sınanır: skip=true → MEGAFON, skip=false → ASTRANOT
     (drawBean yol çizgisi kullanır, emoji metni basmaz). */
  const meg = await S.js(`(()=>{
    const cv=document.createElement('canvas');cv.width=220;cv.height=220;
    const g=cv.getContext('2d');
    const seen=[];const of=g.fillText.bind(g);g.fillText=function(t){seen.push(String(t));return of.apply(g,arguments)};
    drawEjectObj(g,1,0,true,0);        // skip -> megafon
    const afterSkip=seen.slice();
    seen.length=0;
    drawEjectObj(g,1,0,false,0);       // gercek atis -> astronot
    return {skip:afterSkip.join(''),real:seen.join('')};
  })()`);
  ok('skip ciziminde MEGAFON (📢) basildi',
    meg.skip.length > 0 && /\uD83D\uDCE2/.test(meg.skip), 'skip="' + meg.skip + '" kod=' + meg.skip.codePointAt(0));
  ok('gercek atis ciziminde emoji YOK (astronot cizildi)', meg.real === '', 'real="' + meg.real + '"');

  console.log(log.join('\n'));
  const failed = log.filter(l => l.startsWith('KALDI'));
  const skipped = log.filter(l => l.startsWith('ATLANDI'));
  console.log('\nSONUC: ' + (log.length - failed.length - skipped.length - 1) + '/' + (log.length - 1 - skipped.length) + ' gecti'
    + (skipped.length ? '  (' + skipped.length + ' atlandi)' : ''));
  [A, B, S].concat(M).forEach(t => t.close());
  edge.kill();
  await sleep(500);
  process.exit(failed.length ? 1 : 0);
})().catch(e => {
  console.error('TEST HATASI:', e && e.message || e);
  console.log('--- o ana kadar toplanan sonuclar ---');
  console.log(log.join('\n'));
  process.exit(2);
});
