'use strict';
/* lobby.js — lobi ekranı: oyuncu listesi gönderimi/alımı, slot çizimi, hazır durumu */

function pushLobby(L){
  LB=L;
  // Sunucudan gelen lobi, kimlerin hâlâ odada olduğunu da söyler:
  // listede olmayan oyuncuları (ayrılanları) temizle.
  if(L&&L.ps){
    const ids=new Set(L.ps.map(p=>p.id));
    [...players.keys()].forEach(id=>{if(id!==myId&&!ids.has(id))players.delete(id)});
  }
  renderLobby();
}
function enterLobby(){S.phase='lobby';started=false;roles.clear();gameOver=false;show('scr-lobby');
  renderLobby();}
function renderLobby(){
  if(!LB)return;
  $('#lbCode').childNodes[0].textContent=LB.code;
  $('#lbCount').textContent=LB.ps.length+'/8 oyuncu';
  const slots=$('#slots');slots.innerHTML='';
  for(let i=0;i<8;i++){
    const p=LB.ps[i],el=document.createElement('div');
    if(!p){el.className='slot empty';el.textContent='BOŞ SLOT — KODU PAYLAŞ';slots.appendChild(el);continue}
    el.className='slot'+(p.id===myId?' me':'');
    const cv=document.createElement('canvas');cv.width=64;cv.height=76;
    drawBean(cv.getContext('2d'),32,68,1.5,p.ci,1,false,Math.random()*9);
    const info=document.createElement('div');info.className='info';
    info.innerHTML=`<div class="nm">${esc(p.n)}${p.id===myId?' (sen)':''}</div>
      ${p.h?'<span class="bdg host">👑 HOST</span>':'<span class="bdg '+(p.r?'rdy">HAZIR ✓':'wait">BEKLİYOR…')+'</span>'}`;
    el.appendChild(cv);el.appendChild(info);slots.appendChild(el);}
  const me=LB.ps.find(p=>p.id===myId);const host=!!(me&&me.h);
  $('#readyBtn').style.display=host?'none':'';
  $('#readyBtn').textContent=(me&&me.r)?'⏳ BEKLEMEDE':'✅ HAZIRIM';
  $('#startBtn').style.display=host?'':'none';
  if(host){const nr=LB.ps.filter(p=>!p.r&&!p.h).length;const ok=LB.ps.length>=2&&nr===0;
    $('#startBtn').disabled=!ok;
    $('#startHint').textContent=LB.ps.length<2?'En az 2 oyuncu gerekli':nr?nr+' oyuncu hazır değil':'Herkes hazır — fırlat! 🚀';
  }else $('#startHint').textContent="Host'un başlatması bekleniyor…";}
function toLobbyAll(){started=false;S.phase='lobby';gameOver=false;killCooldown=0;
  closeMeeting();closeEject();
  players.forEach(p=>{p.ready=false;p.dead=false;p.gone=false;p.reported=false});roles.clear();controls=false;
  /* LB sunucudan gelen son lobi olup oyun öncesi "herkes hazır" halini
     taşıyor. Sunucu hazır durumunu sıfırladığı için anında aynı hale
     getiriyoruz, yoksa başlat butonu yanlış açık görünür. */
  if(LB&&LB.ps)LB.ps.forEach(p=>{p.r=!!p.h});
  $('#deathScreen').classList.remove('on');$('#resultScreen').className='';
  show('scr-lobby');renderLobby();
  sysChat('Oyun bitti, lobiye dönüldü.');}
