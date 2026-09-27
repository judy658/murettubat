'use strict';
/* Senkronizasyon testi: 5 sekme aynı odada oynar, sonra her istemcinin
   HER oyuncuyu (isim, renk, konum) dogru gördüğü denetlenir.
   Sunucu: once "npm start" calistir. */
const WebSocket = require('ws');
const { spawn } = require('child_process');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SITE = 'http://localhost:3000/Among3.html';
const PORT = 9335;
const N = 5;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = [];
const ok = (n, v, extra) => log.push((v ? 'GECTI  ' : 'KALDI  ') + n + (extra ? '  -> ' + extra : ''));

class Tab {
  constructor(ws, tag) { this.ws = ws; this.tag = tag; this.id = 0; this.waiting = new Map(); this.errors = []; }
  static async open(url, tag) {
    const r = await fetch(`http://localhost:${PORT}/json/new?about:blank`, { method: 'PUT' });
    const t0 = await r.json();
    const ws = new WebSocket(t0.webSocketDebuggerUrl, { maxPayload: 64e6 });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    const t = new Tab(ws, tag);
    ws.on('message', raw => {
      const d = JSON.parse(raw);
      if (d.id && t.waiting.has(d.id)) { const { res, rej } = t.waiting.get(d.id); t.waiting.delete(d.id); d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result); return; }
      if (d.method === 'Runtime.exceptionThrown') {
        const e = d.params.exceptionDetails;
        t.errors.push((e.exception && (e.exception.description || e.exception.value)) || e.text);
      }
    });
    await t.send('Runtime.enable');
    await t.send('Page.enable');
    await t.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await t.send('Page.navigate', { url });
    return t;
  }
  send(method, params) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((res, rej) => { this.waiting.set(id, { res, rej }); setTimeout(() => rej(new Error(method + ' zaman asimi')), 20000); });
  }
  async js(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('JS hatasi: ' + JSON.stringify((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result.value;
  }
  async until(expr, ms = 25000, label = expr) {
    const t0 = Date.now(); let last = null;
    for (;;) {
      let v; try { v = await this.js(expr); } catch (e) { v = false; last = e.message; }
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error('zaman asimi: ' + label + (last ? ' | ' + last : ''));
      await sleep(200);
    }
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

/* Her oyuncunun gideceği bilinen, birbirinden uzak noktalar */
const SPOTS = [
  { x: 190, y: 150 }, { x: 520, y: 210 }, { x: 300, y: 430 },
  { x: 760, y: 330 }, { x: 640, y: 560 },
];

(async () => {
  try { await fetch('http://localhost:3000/health'); }
  catch (e) { console.error('Sunucu ayakta degil. Once "npm start" calistir.'); process.exit(2); }

  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + process.env.TEMP + '\\opencode\\edge-sync-' + Date.now(),
    '--remote-debugging-port=' + PORT, 'about:blank'], { stdio: 'ignore' });

  for (let i = 0; i < 40; i++) { await sleep(500); try { await fetch(`http://localhost:${PORT}/json/version`); break; } catch (e) {} }

  const tabs = [];
  for (let i = 0; i < N; i++) {
    const t = await Tab.open(SITE, 'T' + i);
    await t.until('document.readyState==="complete" && typeof createRoom==="function"', 25000, t.tag);
    tabs.push(t);
  }
  log.push('BILGI  ' + N + ' sekme acildi');

  // Hepsinin tarayici tercihi ayni renk (ci=0) olsun: renk cakismasi sunucunun isi
  const names = ['Kaptan', 'Arda', 'Nova', 'Efe', 'Yaman'];
  await tabs[0].js(`(()=>{const i=document.querySelector('#nameIn');i.value=${JSON.stringify(names[0])};i.dispatchEvent(new Event('input'));})()`);
  await tabs[0].js(`document.querySelector('#createBtn').click()`);
  await tabs[0].until('S.mode==="online" && !!roomCode', 20000, 'oda kurulamadi');
  const code = await tabs[0].js('roomCode');

  for (let i = 1; i < N; i++) {
    await tabs[i].js(`(()=>{const i=document.querySelector('#nameIn');i.value=${JSON.stringify(names[i])};i.dispatchEvent(new Event('input'));})()`);
    await tabs[i].js(`document.querySelector('#joinToggle').click()`);
    await sleep(150);
    await tabs[i].js(`(()=>{const i=document.querySelector('#joinCode');i.value=${JSON.stringify(code)};})()`);
    await tabs[i].js(`document.querySelector('#joinGo').click()`);
    await tabs[i].until('S.mode==="online" && roomCode', 20000, 'katililamadi T' + i);
  }
  await tabs[0].until(`LB && LB.ps.length===${N}`, 20000, 'lobi tam dolmadi');
  log.push('BILGI  oda kuruldu: ' + code + ', ' + N + ' oyuncu');

  // Hazir + baslat
  for (let i = 1; i < N; i++) await tabs[i].js(`document.querySelector('#readyBtn').click()`);
  await tabs[0].until(`LB.ps.every(p=>p.r)`, 20000, 'hazir olmadi');
  await tabs[0].js(`document.querySelector('#startBtn').click()`);
  for (const t of tabs) await t.until('S.phase==="game" && controls===true', 25000, t.tag + ' oyuna girmedi');
  log.push('BILGI  oyun basladi');

  // Herkes bildigi bir noktaya gitsin. DOGRUDAN ME() taşınır: oyuncu kendi
  // konumunu rAF döngüsünde sürekli sunucuya bildirdiği için tek seferlik
  // sendMsg hemen ezilirdi (kendi konumu hiç değişmiyordu).
  for (let i = 0; i < N; i++) {
    const s = SPOTS[i];
    await tabs[i].js(`(()=>{const m=ME();m.x=${s.x};m.y=${s.y};m.moving=false;})()`);
  }
  await sleep(2500);   // deltalar yerlesin

  // --- DENetim ---
  const truth = {};   // id -> {n, ci, x, y}
  for (let i = 0; i < N; i++) {
    const id = await tabs[i].js('myId');
    const me = JSON.parse(await tabs[i].js(`(()=>{const p=ME();return JSON.stringify({n:p.name,ci:p.ci,x:Math.round(p.x),y:Math.round(p.y)})})()`));
    truth[id] = { n: names[i], ci: me.ci, x: SPOTS[i].x, y: SPOTS[i].y, tab: i, self: id };
  }
  const ids = Object.keys(truth);
  log.push('BILGI  sunucu renkleri: ' + JSON.stringify(ids.map(i => truth[i].ci)));

  // 1) Renkler benzersiz mi
  const cis = ids.map(i => truth[i].ci);
  ok('her oyuncu farkli renk', new Set(cis).size === N, 'renkler=' + JSON.stringify(cis));

  // 2) Her istemci tum oyunculari biliyor mu
  let sizeBad = [];
  for (let i = 0; i < N; i++) {
    const size = await tabs[i].js('players.size');
    if (size !== N) sizeBad.push('T' + i + ':' + size);
  }
  ok('her istemci ' + N + ' oyuncuyu da goruyor', sizeBad.length === 0, sizeBad.join(','));

  // 3) Renk/isim uyumu: her istemci herkesi dogru renkte gormeli
  const colorBad = [], nameBad = [];
  for (let i = 0; i < N; i++) {
    const selfId = await tabs[i].js('myId');
    const view = JSON.parse(await tabs[i].js(
      `JSON.stringify([...players.values()].map(p=>({id:p.id,n:p.name,ci:p.ci,tx:Math.round(p.tx),ty:Math.round(p.ty),x:Math.round(p.x)})))`));
    for (const v of view) {
      const t = truth[v.id];
      if (!t) { colorBad.push('T' + i + ' bilinmeyen oyuncu ' + v.id); continue; }
      if (v.id !== selfId && v.ci !== t.ci) colorBad.push(`T${i} ${v.n}: renk ${v.ci} != ${t.ci}`);
      if (v.n !== t.n) nameBad.push(`T${i}: isim ${v.n} != ${t.n}`);
    }
  }
  ok('herkes herkesi ayni renkte goruyor', colorBad.length === 0, colorBad.slice(0, 6).join(' | '));
  ok('herkes herkesin dogru ismini goruyor', nameBad.length === 0, nameBad.slice(0, 6).join(' | '));

  // 4) Konum uyumu: sunucu konumu her istemcide ayni hedefe (tx) ulasmali
  const posBad = [];
  for (let i = 0; i < N; i++) {
    const selfId = await tabs[i].js('myId');
    const view = JSON.parse(await tabs[i].js(
      `JSON.stringify([...players.values()].map(p=>({id:p.id,tx:Math.round(p.tx),ty:Math.round(p.ty),x:Math.round(p.x),y:Math.round(p.y)})))`));
    for (const v of view) {
      const t = truth[v.id];
      if (!t || v.id === selfId) continue;
      if (!Number.isFinite(v.tx) || !Number.isFinite(v.ty))
        posBad.push(`T${i} ${t.tab}: HEDEF NaN (${v.tx},${v.ty})`);
      else if (Math.abs(v.tx - t.x) > 40 || Math.abs(v.ty - t.y) > 40)
        posBad.push(`T${i} ${t.tab}: hedef(${v.tx},${v.ty}) != gercek(${t.x},${t.y})`);
    }
  }
  ok('her istemci dogru hedef konumlari aliyor', posBad.length === 0, posBad.slice(0, 6).join(' | '));

  // 5) CIZILEN konum (x,y) de gercek konuma yakin olmali; aksi halde oyuncu
  //    haritada yanlis yerde durur ve gorunmez.
  const drawnBad = [];
  for (let i = 0; i < N; i++) {
    const view = JSON.parse(await tabs[i].js(
      `JSON.stringify((()=>{const me=ME();return [...players.values()].map(p=>({id:p.id,me:me.id,x:Math.round(p.x),y:Math.round(p.y)}))})())`));
    for (const v of view) {
      if (v.id === v.me) continue;
      const t = truth[v.id];
      const d = Math.hypot(v.x - t.x, v.y - t.y);
      if (d > 45) drawnBad.push(`T${i} ${t.tab}: cizilen(${v.x},${v.y}) gercek(${t.x},${t.y}) sapma=${Math.round(d)}`);
    }
  }
  ok('cizilen konumlar gercek konumlara yakin', drawnBad.length === 0, drawnBad.slice(0, 6).join(' | '));

  // 6) YATAY HAREKET REGRESYONU — asıl hatanın tetikleyicisi.
  //    Dikey koordinat hiç değişmediği için sunucu delta'da yalnızca x yollar.
  //    İstemci x geldi diye y'ı da sıfırlarsa ty=NaN olur ve oyuncu
  //    NaN koordinatta çizilemediği için EKRANDAN KAYBOLUR.
  for (let i = 0; i < N; i++) {
    await tabs[i].js(`(()=>{const m=ME();m.x=m.x+120;m.angle=0.5;})()`);
  }
  await sleep(2000);
  const nanBad = [];
  for (let i = 0; i < N; i++) {
    const view = JSON.parse(await tabs[i].js(
      `JSON.stringify([...players.values()].map(p=>({id:p.id,tx:Math.round(p.tx),ty:Math.round(p.ty),x:Math.round(p.x),y:Math.round(p.y)})))`));
    for (const v of view) {
      const bad = [v.x, v.y, v.tx, v.ty].some(n => !Number.isFinite(n));
      if (bad) {
        const t = truth[v.id];
        nanBad.push(`T${i} ${t ? t.tab : v.id}: cizilen(${v.x},${v.y}) hedef(${v.tx},${v.ty})`);
      }
    }
  }
  ok('yatay hareket sonrasi hicbir oyuncuda NaN yok', nanBad.length === 0, nanBad.slice(0, 6).join(' | '));

  // 8) CESET KONUMU: ölünce ceset kesildiği yerde durmalı. Eskiden ceset
  //    ölüm anındaki yarım kalmış çizim konumunda donuyordu; katil menzil
  //    içinde olduğu için fark etmiyor, uzaktakiler yanlış yerde görüyordu.
  const roleList = [];
  for (let i = 0; i < N; i++) roleList.push(await tabs[i].js('roles.get(myId)'));
  const impIdx = roleList.indexOf('impostor');
  ok('odada bir sahtekar var', impIdx >= 0, 'roller=' + JSON.stringify(roleList));

  // Herkesi bir noktaya topla ki sahtekar menzilde bir kurban bulsun
  for (let i = 0; i < N; i++) {
    await tabs[i].js(`(()=>{const m=ME();m.x=190+(m.x%7);m.y=150+(m.y%5);m.moving=false;})()`);
  }
  await sleep(2000);

  if (impIdx >= 0) {
    const tgt = await tabs[impIdx].js('(()=>{const t=findKillTarget();return t?t.id:null})()');
    ok('sagtekar menzilde kurban buldu', !!tgt);
    if (tgt) {
      const tj = JSON.stringify(tgt);
      await tabs[impIdx].js(`(()=>{sendMsg({t:'kill',target:${tj}});})()`);
      await sleep(700);

      // Cesedin sunucu konumu (tx,ty) ve ÇİZİLEN konumu (x,y) her istemcide
      // aynı olmalı; çizilen konum sunucu konumuna oturmuş olmalı.
      const corpseBad = [];
      let ref = null;
      for (let i = 0; i < N; i++) {
        const c = JSON.parse(await tabs[i].js(
          `(()=>{const p=players.get(${tj});if(!p)return JSON.stringify({gone:1});` +
          `return JSON.stringify({x:Math.round(p.x),y:Math.round(p.y),tx:Math.round(p.tx),ty:Math.round(p.ty),dead:!!p.dead})})()`));
        if (c.gone) { corpseBad.push('T' + i + ': kurban listede yok'); continue; }
        if (!c.dead) { corpseBad.push('T' + i + ': ceset isaretlenmedi'); continue; }
        const drawn = Math.hypot(c.x - c.tx, c.y - c.ty);
        if (drawn > 2) corpseBad.push(`T${i}: ceset sunucu yerinde degil cizilen(${c.x},${c.y}) hedef(${c.tx},${c.ty}) sapma=${drawn.toFixed(1)}`);
        if (!ref) ref = { tx: c.tx, ty: c.ty };
        else {
          const d = Math.hypot(c.tx - ref.tx, c.ty - ref.ty);
          if (d > 2) corpseBad.push(`T${i}: ceset baskalarindan farkli yerde (${c.tx},${c.ty}) != (${ref.tx},${ref.ty}) sapma=${d.toFixed(1)}`);
        }
      }
      log.push('BILGI  cesedin sunucu konumu: ' + (ref ? `(${ref.tx},${ref.ty})` : '?') + ' — olum yeri: ' + (truth[tgt] ? `oyuncu ${truth[tgt].tab}` : tgt));
      ok('her istemci ceseti ayni, kesildigi yerde goruyor', corpseBad.length === 0, corpseBad.slice(0, 6).join(' | '));

      // 9) GÖRÜŞ KONİSİ CESEDLER İÇİN DE GEÇERLİ OLMALI.
      //    Ceset koni dışındayken render() onu ÇİZMEMELİ.
      //    Asıl render() çağrılır, drawBean sarmalanıp gerçekten çizilip
      //    çizilmediği sayılır — sadece isInView() sorgusuna bakılmaz.
      const tj2 = JSON.stringify(tgt);
      const seenBad = [];
      for (let i = 0; i < N; i++) {
        const selfId = await tabs[i].js('myId');
        if (selfId === tgt) continue;   // kurban kendi cesedini her görür
        const r = JSON.parse(await tabs[i].js(`(()=>{
          const me=ME(),c=players.get(${tj2});
          if(!me||!c||c.dead!==true)return JSON.stringify({skip:1});
          const sx=me.x,sy=me.y;
          const R=200;   // koni içinde (330) ama yakınlık çemberi dışında (135)
          const probe=ang=>{
            me.x=c.x+R; me.y=c.y; me.angle=ang; me.dead=false;
            let hits=0; const orig=drawBean;
            drawBean=function(g,x,y){if(g===gx&&Math.abs(x-c.x)<6&&Math.abs(y-c.y)<6)hits++;return orig.apply(this,arguments)};
            render();
            drawBean=orig;
            return {inView:isInView(me,c),drawn:hits>0};
          };
          const front=probe(Math.PI);   // cesede dönük  -> gorunmeli
          const back=probe(0);         // ters yön      -> gorunmemeli
          me.x=sx; me.y=sy;
          return JSON.stringify({front,back});
        })()`));
        if (r.skip) { seenBad.push('T' + i + ': ceset bulunamadi'); continue; }
        if (!r.front.inView || !r.front.drawn)
          seenBad.push(`T${i}: koni icindeki ceset cizilmedi (inView=${r.front.inView} drawn=${r.front.drawn})`);
        if (r.back.inView || r.back.drawn)
          seenBad.push(`T${i}: koni disindaki ceset gorundu (inView=${r.back.inView} drawn=${r.back.drawn})`);
      }
      ok('ceset yalnizca gorus konisi icindeyken gorunuyor', seenBad.length === 0, seenBad.slice(0, 6).join(' | '));
    }
  }

  // 10) Oyun ici konsol hatalari
  const errs = tabs.flatMap(t => t.errors.map(e => t.tag + ':' + e)).filter(e => !/favicon|ERR_|Failed to load resource/.test(e));
  ok('hicbir sekmede JS hatasi yok', errs.length === 0, errs.slice(0, 4).join(' | '));

  console.log(log.join('\n'));
  const failed = log.filter(l => l.startsWith('KALDI'));
  console.log('\nSONUC: ' + (log.length - failed.length - log.filter(l => l.startsWith('BILGI')).length) + '/' + (log.length - log.filter(l => l.startsWith('BILGI')).length) + ' gecti');
  tabs.forEach(t => t.close());
  edge.kill();
  await sleep(500);
  process.exit(failed.length ? 1 : 0);
})().catch(e => {
  console.error('TEST HATASI:', e && e.message || e);
  console.log(log.join('\n'));
  process.exit(2);
});
