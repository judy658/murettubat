'use strict';
/* meeting.js — raporlama, toplantı (oylama) ekranı ve uzaya atma animasyonu.
   Kararların hepsi SUNUCUDA verilir; burada yalnızca arayüz vardır. */

const REPORT_RANGE=70;   // server/index.js ile aynı değer
const EMERG_RANGE=60;    // acil durum butonu menzili — server ile aynı
const EMERG_BTN={x:190,y:150}; // kantin masası ortası
let emergUsed=false;     // oyun başına 1 acil durum hakkı (her oyunda reset)

/* Acil durum butonu hazır mı? Masaya yakın, hayatta ve hakkı duruyor. */
function emergReady(){
  const me=ME();
  if(!me||me.dead||gameOver||meeting||ejecting)return false;
  if(emergUsed)return false;
  return Math.hypot(me.x-EMERG_BTN.x,me.y-EMERG_BTN.y)<=EMERG_RANGE;
}

function tryEmergency(){
  if(!emergReady()){
    let msg='Acil durum butonuna çok uzaksın';
    if((ME()||{}).dead)msg='Ölüsün — acil durum çağıramazsın';
    else if(emergUsed)msg='Acil durum hakkını zaten kullandın';
    toast(msg,'err');sfx.err();return
  }
  sfx.report();
  if(S.mode==='online')sendMsg({t:'emerg'});
  else soloEmergency();
}

/* Raporlanabilir en yakın CESEDİ bulur. Zaten raporlanmış ceset tekrar
   seçilmez, hayaletler rapor edemez, toplantı sırasında raporlanmaz. */
function findReportTarget(){
  const me=ME();
  if(!me||me.dead||gameOver||meeting||ejecting)return null;
  let best=null,min=Infinity;
  players.forEach(p=>{
    if(p.id===myId||!p.dead||p.reported||p.gone)return;
    const d=Math.hypot(p.x-me.x,p.y-me.y);
    if(d<REPORT_RANGE&&d<min){min=d;best=p}
  });
  return best;
}

function tryReport(){
  const t=findReportTarget();
  if(!t){toast('Yakınında raporlanabilir ceset yok','err');sfx.err();return}
  sfx.report();
  if(S.mode==='online')sendMsg({t:'report',body:t.id});
  else soloReport(t);
}

/* ------------------------------------------------------------------ */
/* Toplantı ekranı                                                     */
/* ------------------------------------------------------------------ */

function openMeeting(d){
  meeting={
    reporter:d.reporter,victim:d.victim,
    endsAt:d.endsAt,players:d.players||[],myVote:d.myVote||null,
  };
  if(!d.victim&&d.reporter===myId)emergUsed=true;   // kendi acil durum çağrım
  controls=false;
  closeDeathScreen();
  $('#meetingScreen').classList.add('on');
  $('#mtMsgs').innerHTML='';
  applyState(d.p);
  snapSelfTo(d.p);
  startMeetingTimer();
  renderMeeting();
  sfx.meet();
}

function closeMeeting(){
  meeting=null;
  clearInterval(meetingTimer);meetingTimer=0;
  const el=$('#meetingScreen');if(el)el.classList.remove('on');
}

let meetingTimer=0;
function startMeetingTimer(){
  clearInterval(meetingTimer);
  meetingTimer=setInterval(()=>{
    if(!meeting){clearInterval(meetingTimer);meetingTimer=0;return}
    const left=Math.max(0,Math.ceil((meeting.endsAt-Date.now())/1000));
    const el=$('#mtTimer');
    el.textContent=left;
    el.classList.toggle('urgent',left<=15);
  },250);
}

function castVote(target){
  if(!meeting)return;
  if((players.get(myId)||{}).dead)return;   // hayaletler oy veremez
  sfx.vote();
  if(S.mode==='online')sendMsg({t:'vote',target});
  else soloVote(target);
}

function updateVotes(d){
  if(!meeting)return;
  const voted={};
  (d.players||[]).forEach(q=>voted[q.id]=!!q.voted);
  meeting.players.forEach(q=>{q.voted=!!voted[q.id]});
  meeting.myVote=d.myVote||null;
  if(d.endsAt)meeting.endsAt=d.endsAt;
  renderMeeting();
}

function renderMeeting(){
  if(!meeting)return;
  const rp=(players.get(meeting.reporter)||{}).name||'?';
  const vm=(players.get(meeting.victim)||{}).name||'?';
  $('#mtTitle').innerHTML=meeting.victim
    ? esc(rp)+' <b>'+esc(vm)+'</b> CESEDİNİ RAPORLADI'
    : esc(rp)+' <b>ACİL DURUM TOPLANTISI</b> ÇAĞIRDI';
  const done=meeting.players.filter(q=>q.voted&&!q.dead).length;
  const aliveN=meeting.players.filter(q=>!q.dead).length;
  const iGhost=!!(players.get(myId)||{}).dead;
  $('#mtSub').innerHTML=iGhost
    ? 'Ölüsün — toplantıyı izleyebilirsin ama <b>oy kullanamazsın</b>.'
    : meeting.myVote
    ? 'Oyunu kullandın. <b>'+done+'/'+aliveN+'</b> oy kullanıldı — istediğin an değiştirebilirsin.'
    : 'Kimi suçluyorsun? Bir kart seç ya da <b>BOŞ BIRAK</b>. Süre bitmeden oyunu değiştirebilirsin.';

  const grid=$('#mtGrid');grid.innerHTML='';
  meeting.players.forEach(q=>{
    const isMe=q.id===myId;
    const picked=meeting.myVote===q.id;
    const card=document.createElement('div');
    card.className='mt-card'+(q.dead?' dead':'')+(isMe?' mine':'')
      +(q.voted?' voted':'')+(picked?' picked':'');
    card.dataset.id=q.id;
    const cv=document.createElement('canvas');cv.width=48;cv.height=56;
    drawBean(cv.getContext('2d'),24,48,1.2,q.ci,1,false,0,q.dead);
    const info=document.createElement('div');info.className='info';
    const st=q.dead?'HAYALET':(picked?'✓ OYUNU KULLANDIN':(isMe?'SEN':(q.voted?'OY KULLANDI':'OYUNU KULLAN')));
    info.innerHTML='<div>'+esc(q.n)+'</div><div class="st">'+st+'</div>';
    const tick=document.createElement('div');tick.className='tick';tick.textContent='✓';
    card.appendChild(cv);card.appendChild(info);card.appendChild(tick);
    if(!q.dead&&!isMe)card.onclick=()=>castVote(q.id);
    grid.appendChild(card);
  });

  const sk=$('#mtSkip');
  sk.classList.toggle('picked',meeting.myVote==='skip');
  sk.classList.toggle('ready',!meeting.myVote);
  sk.classList.toggle('locked',iGhost);      // hayalet boş bırak da seçemez
}

/* ------------------------------------------------------------------ */
/* Uzaya atma animasyonu — Among Us tarzı                              */
/* ------------------------------------------------------------------ */

let ejectRaf=0;
const DRIFT_MS=3200, FLY_MS=1600, EJECT_TOTAL=6400;

/* Uzaya fırlatılan nesne: normalde astronot (drawBean), skip'te ise
   RAPOR butonundaki gibi bir MEGAFON (📢) — kimse atılmadığında
   kırmızı skinli astranot uçmamalı. */
function drawEjectObj(g,scale,ci,skip,phase){
  if(skip){
    g.save();
    g.font=Math.round(34*scale)+'px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    g.textAlign='center';g.textBaseline='middle';
    g.fillText('\u{1F4E2}',0,0);
    g.textBaseline='alphabetic';
    g.restore();
    return;
  }
  drawBean(g,0,0,scale,ci,1,false,phase,0);
}

function playEject(d){
  closeMeeting();
  if(ejectRaf)cancelAnimationFrame(ejectRaf);   // üst üste atışta eski döngüyü kes
  ejecting=true;controls=false;
  const scr=$('#ejectScreen');
  const cv=$('#ejCanvas'),g=cv.getContext('2d');
  const size=()=>{cv.width=Math.max(1,cv.clientWidth*dpr);cv.height=Math.max(1,cv.clientHeight*dpr)};
  ensureEjectResize();
  scr.classList.add('on');
  size();                     // ÖNCE ekran açılmalı: display:none iken clientWidth=0 olur,
                              // canvas 1×1 kalır ve animasyon "renk noktacıkları" gibi görünür.
  $('#ejectScreen .ej-text').classList.remove('on');
  $('#ejFlash').classList.remove('go');
  sfx.eject();

  const isSkip=!!d.skipped;   // kimse atılmadı → megafon uçar
  const stars=[];
  for(let i=0;i<130;i++)stars.push({x:Math.random(),y:Math.random(),r:rand(.6,2.1),
    a:rand(0,6.283),sp:rand(.004,.02)});
  const name=d.name||'Oyuncu';
  const col=isSkip?{c:'#ffd23f'}:(COLORS[d.ci]||COLORS[0]);
  const t0=performance.now();
  let flashed=false;

  const step=now=>{
    if(cv.width<4||cv.height<4){size();ejectRaf=requestAnimationFrame(step);return}
    const t=now-t0;
    const W=cv.width/dpr,H=cv.height/dpr;
    g.setTransform(dpr,0,0,dpr,0,0);
    g.clearRect(0,0,W,H);

    for(const s of stars){
      s.x+=Math.cos(s.a)*s.sp*.002;s.y+=Math.sin(s.a)*s.sp*.002;
      if(s.x<-.05)s.x=1.05;if(s.x>1.05)s.x=-.05;
      if(s.y<-.05)s.y=1.05;if(s.y>1.05)s.y=-.05;
      g.fillStyle='rgba(205,222,255,'+(.28+s.r*.22)+')';
      g.beginPath();g.arc(s.x*W,s.y*H,s.r,0,7);g.fill();
    }

    const baseY=H*.42+Math.sin(t*.0016)*16;

    if(t<DRIFT_MS){
      // yatay süzülme
      const p=t/DRIFT_MS;
      const x=-80+p*(W+160);
      g.save();g.translate(x,baseY);g.rotate(isSkip?Math.sin(t*.002)*.12:t*.0011);
      g.fillStyle='rgba(0,0,0,.32)';
      g.beginPath();g.ellipse(0,32,18,5.5,0,0,7);g.fill();
      drawEjectObj(g,1.6,d.ci,isSkip,t*.001);
      g.restore();
      if(!isSkip){
        g.font='800 18px Nunito';g.textAlign='center';
        g.fillStyle='rgba(0,0,0,.65)';g.fillText(name,x+2,baseY-50);
        g.fillStyle='#fff';g.fillText(name,x,baseY-52);
      }
    }else if(t<DRIFT_MS+FLY_MS){
      // hızlanarak dönerek fırlama
      const p=(t-DRIFT_MS)/FLY_MS;
      const x=W+80+p*(W*1.5+220);
      g.save();g.translate(x,baseY);g.rotate(t*.014);
      for(let i=1;i<=7;i++){
        g.globalAlpha=.17-i*.021;
        g.fillStyle=col.c;
        g.beginPath();g.arc(-i*27,0,11,0,7);g.fill();
      }
      g.globalAlpha=1;
      drawEjectObj(g,1.6*(1-p*.3),d.ci,isSkip,t*.001);
      g.restore();
      if(p>.42&&!flashed){
        flashed=true;
        $('#ejFlash').classList.add('go');
        g.save();g.globalAlpha=.9;
        for(let i=0;i<30;i++){
          const a=i/30*Math.PI*2,rr2=rand(24,96);
          g.fillStyle=i%3===0?'#fff':col.c;
          g.beginPath();g.arc(W+46+Math.cos(a)*rr2,baseY+Math.sin(a)*rr2,rand(1,4.2),0,7);g.fill();
        }
        g.restore();
      }
    }

    if(t>=EJECT_TOTAL){finishEject(d);return}
    ejectRaf=requestAnimationFrame(step);
  };
  ejectRaf=requestAnimationFrame(step);
}

function finishEject(d){
  cancelAnimationFrame(ejectRaf);ejectRaf=0;
  $('#ejFlash').classList.remove('go');
  if(d.skipped){
    $('#ejTitle').textContent='KİMSE DIŞARI ATILMADI';
    $('#ejRole').textContent='SKIP';
    $('#ejRole').className='crew';
  }else{
    $('#ejTitle').innerHTML=esc(d.name)+' DIŞARI ATILDI';
    $('#ejRole').textContent=d.role==='impostor'?'SAHTEKÂR':'MÜRETTEBAT';
    $('#ejRole').className=d.role==='impostor'?'imp':'crew';
  }
  $('#ejectScreen .ej-text').classList.add('on');
}

function closeEject(){
  cancelAnimationFrame(ejectRaf);ejectRaf=0;
  ejecting=false;
  const scr=$('#ejectScreen');
  if(scr)scr.classList.remove('on');
  const tx=$('#ejectScreen .ej-text');
  if(tx)tx.classList.remove('on');
  const fl=$('#ejFlash');
  if(fl)fl.classList.remove('go');
}

/* ------------------------------------------------------------------ */
/* Yardımcılar                                                         */
/* ------------------------------------------------------------------ */

/* Kendi karakterimizi sunucunun konumuna kilitler. applyState kendi
   konumumuzu bilerek geri yazmaz (yerel hareket anında tepki versin diye),
   ama toplantıde ışınlandığımızda yerel konum da sunucuyla eşleşmeli. */
function snapSelfTo(map){
  const me=ME(),sv=map&&map[myId];
  if(!me||!sv)return;
  if(Number.isFinite(sv.x))me.x=me.tx=sv.x;
  if(Number.isFinite(sv.y))me.y=me.ty=sv.y;
  cam.x=me.x;cam.y=me.y;
}
function closeDeathScreen(){const d=$('#deathScreen');if(d)d.classList.remove('on')}
/* Cesedi "raporlandı" işaretle — artık tekrar raporlanamaz (solo mod) */
function markReported(id){const p=players.get(id);if(p){p.reported=true;p.gone=true}}
/* Pencere yeniden boyutlanınca atma canvas'ını yeniden boyutlandır.
   Tek kalıcı dinleyici: her atışta yenisini ekleyen (sızan) yapı yerine
   modül başına bir kez bağlanır, boyutlandırma yalnızca atış sırasında yapılır. */
let _ejectResizeBound=false;
function ensureEjectResize(){
  if(_ejectResizeBound)return;
  _ejectResizeBound=true;
  addEventListener('resize',()=>{
    if(!ejecting)return;
    const cv=$('#ejCanvas');
    if(cv){cv.width=Math.max(1,cv.clientWidth*dpr);cv.height=Math.max(1,cv.clientHeight*dpr)}
  });
}

/* ------------------------------------------------------------------ */
/* SOLO MOD — sunucu yok, istemci kendi otoritesidir                    */
/* ------------------------------------------------------------------ */

const MEET_SECONDS=90;      // server/index.js ile aynı değer
let soloVotes={}, soloTimers=[];

function soloClearTimers(){soloTimers.forEach(clearTimeout);soloTimers=[]}

/* Dışarı atılan oyuncu ceset bırakmaz: hem ölü hem sahneden silinir.
   Böylece hiçbir koşulda ekranda cesedi görünmez. */
function markEjected(id){
  const p=players.get(id);
  if(!p)return;
  p.reported=true;p.dead=true;p.killed=false;p.gone=true;
}

function soloReport(victim){
  if(!victim)return;
  soloClearTimers();soloVotes={};
  markReported(victim.id);
  resetPositions();
  cam.x=SPAWN.x;cam.y=SPAWN.y;
  openMeeting({
    reporter:myId,victim:victim.id,endsAt:Date.now()+MEET_SECONDS*1000,
    players:[...players.values()].map(p=>({id:p.id,n:p.name,ci:p.ci,dead:p.dead,voted:false})),
    p:null,myVote:null,
  });
  /* Yalnızca HAYATTAKİ botlar oy kullanır; cesedi raporlanan hayalet oy kullanmaz. */
  [...players.values()].filter(p=>p.bot&&!p.dead).forEach((b,i)=>{
    soloTimers.push(setTimeout(()=>{
      if(!meeting)return;
      const others=[...players.values()].filter(p=>!p.dead&&p.id!==b.id).map(p=>p.id);
      if(!others.length)return;
      soloCastVote(b.id,Math.random()<.3?'skip':pick(others));
    },2600+i*2100+rand(0,1700)));
  });
}

function soloEmergency(){
  soloClearTimers();soloVotes={};
  resetPositions();
  cam.x=SPAWN.x;cam.y=SPAWN.y;
  openMeeting({
    reporter:myId,victim:null,endsAt:Date.now()+MEET_SECONDS*1000,
    players:[...players.values()].map(p=>({id:p.id,n:p.name,ci:p.ci,dead:p.dead,voted:false})),
    p:null,myVote:null,
  });
  /* Yalnızca HAYATTAKİ botlar oy kullanır. */
  [...players.values()].filter(p=>p.bot&&!p.dead).forEach((b,i)=>{
    soloTimers.push(setTimeout(()=>{
      if(!meeting)return;
      const others=[...players.values()].filter(p=>!p.dead&&p.id!==b.id).map(p=>p.id);
      if(!others.length)return;
      soloCastVote(b.id,Math.random()<.3?'skip':pick(others));
    },2600+i*2100+rand(0,1700)));
  });
}

function soloVote(target){soloCastVote(myId,target)}

function soloCastVote(voter,target){
  if(!meeting)return;
  const pv=players.get(voter);
  if(!pv||pv.dead||pv.gone)return;          // hayaletler oy veremez
  soloVotes[voter]=target;
  const q=meeting.players.find(x=>x.id===voter);
  if(q)q.voted=true;
  if(voter===myId)meeting.myVote=target;
  renderMeeting();
  /* Herkes oy kullandıysa beklemeden sonuca geç (yalnızca hayattakiler). */
  const voters=meeting.players.filter(x=>!x.dead);
  if(voters.length&&voters.every(x=>x.voted))setTimeout(soloResolve,1000);
}

function soloResolve(){
  if(!meeting)return;
  const tally={};
  for(const id in soloVotes){const t=soloVotes[id];tally[t]=(tally[t]||0)+1}
  let best='skip',bn=-1,tied=false;
  for(const k in tally){const n=tally[k];if(n>bn){best=k;bn=n;tied=false}else if(n===bn)tied=true}
  if(tied||bn<=0)best='skip';
  const v=best==='skip'?null:players.get(best);
  const role=v?roles.get(best):null;
  if(v)markEjected(v.id);
  closeMeeting();
  playEject({id:v?v.id:null,name:v?v.name:null,ci:v?v.ci:0,role,skipped:!v});
  soloTimers.push(setTimeout(soloAfterEject,EJECT_TOTAL+1800));
}

function soloAfterEject(){
  soloClearTimers();
  closeEject();
  if(gameOver)return;
  const alive=[...players.values()].filter(p=>!p.dead&&!p.gone);
  const imp=alive.filter(p=>roles.get(p.id)==='impostor').length;
  const crew=alive.filter(p=>roles.get(p.id)==='crew').length;
  if(imp===0)return endGame('crew');
  if(imp>=crew)return endGame('imp');
  resetPositions();
  players.forEach(p=>{p.x=p.tx;p.y=p.ty});
  cam.x=SPAWN.x;cam.y=SPAWN.y;
  killCooldown=0;controls=true;
  toast('Toplantı bitti — oyuna dönüyorsun');
}

