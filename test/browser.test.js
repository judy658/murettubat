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

  /* 7) konsol hataları */
  const errsA = A.errors.filter(e => !/favicon|ERR_|Failed to load resource/.test(e));
  const errsB = B.errors.filter(e => !/favicon|ERR_|Failed to load resource/.test(e));
  ok('A sekmesinde JS hatası yok', errsA.length === 0, errsA.join(' | '));
  ok('B sekmesinde JS hatası yok', errsB.length === 0, errsB.join(' | '));

  /* 8) SOLO hâlâ çalışıyor mu (sunucusuz) */
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

  console.log(log.join('\n'));
  const failed = log.filter(l => l.startsWith('KALDI'));
  const skipped = log.filter(l => l.startsWith('ATLANDI'));
  console.log('\nSONUC: ' + (log.length - failed.length - skipped.length - 1) + '/' + (log.length - 1 - skipped.length) + ' gecti'
    + (skipped.length ? '  (' + skipped.length + ' atlandi)' : ''));
  [A, B, S].forEach(t => t.close());
  edge.kill();
  await sleep(500);
  process.exit(failed.length ? 1 : 0);
})().catch(e => {
  console.error('TEST HATASI:', e && e.message || e);
  console.log('--- o ana kadar toplanan sonuclar ---');
  console.log(log.join('\n'));
  process.exit(2);
});
