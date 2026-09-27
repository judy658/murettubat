'use strict';
/* main.js — açılış: DOM bağlama (butonlar, formlar, renk seçimi) ve döngü başlatma.
   Tüm olay bağlantıları burada toplanır; diğer modüller yalnızca mantık içerir. */

function init(){
  buildMap();resize();
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(buildMap);
  $('#nameIn').value=prefs.name;
  const sws=$('#swatches');
  COLORS.forEach((c,i)=>{const b=document.createElement('button');b.className='sw'+(i===prefs.ci?' on':'');
    b.style.background=c.c;b.title=c.n;
    b.onclick=()=>{prefs.ci=i;savePrefs();sfx.click();
      document.querySelectorAll('.sw').forEach((x,j)=>x.classList.toggle('on',j===i));
      // Rengi sunucu dağıtır; çakışma varsa sunucu 'colno' döner.
      if(S.mode==='online'&&sockOpen)sendMsg({t:'col',ci:i});};
    sws.appendChild(b);});
  $('#nameIn').addEventListener('change',e=>{prefs.name=e.target.value.trim()||'Oyuncu';savePrefs()});
  $('#createBtn').onclick=()=>{prefs.name=$('#nameIn').value.trim()||'Oyuncu';sfx.click();createRoom()};
  $('#joinToggle').onclick=()=>{sfx.click();$('#joinRow').classList.toggle('on');$('#joinCode').focus()};
  $('#joinGo').onclick=()=>{prefs.name=$('#nameIn').value.trim()||'Oyuncu';sfx.click();joinRoom()};
  $('#joinCode').addEventListener('input',e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''));
  $('#joinCode').addEventListener('keydown',e=>{if(e.key==='Enter')$('#joinGo').click()});
  $('#soloBtn').onclick=()=>{prefs.name=$('#nameIn').value.trim()||'Oyuncu';savePrefs();sfx.click();startSolo()};
  $('#leaveLobby').onclick=()=>{sfx.click();leaveAll()};
  $('#lbCode').onclick=async()=>{sfx.click();try{await navigator.clipboard.writeText(roomCode);toast('Kod kopyalandı: '+roomCode)}catch(e){toast('Kod: '+roomCode)}};
  $('#readyBtn').onclick=()=>{sfx.click();
    const me0=LB&&LB.ps.find(p=>p.id===myId);
    sendMsg({t:'ready',v:!(me0&&me0.r)});};
  $('#startBtn').onclick=()=>{sfx.click();sendMsg({t:'start'})};
  $('#lbForm').onsubmit=e=>{e.preventDefault();sendChat($('#lbIn'))};
  $('#gForm').onsubmit=e=>{e.preventDefault();sendChat($('#gIn'))};
  $('#gIn').addEventListener('focus',()=>{for(const k in keys)keys[k]=0});
  $('#chatBtn').onclick=()=>{sfx.click();$('#chatBox').classList.toggle('on');$('#gIn').focus()};
  guardBtn($('#hudLeave'),()=>leaveAll());
  guardBtn($('#hudBack'),()=>{if(isHost()){sfx.click();sendMsg({t:'back'});}});
  const snd=()=>{prefs.muted=!prefs.muted;savePrefs();setSnd();if(!prefs.muted)sfx.click()};
  $('#sndBtn').onclick=snd;$('#sndBtn2').onclick=snd;setSnd();
  $('#killBtn').onclick=()=>{sfx.click();tryKill();};
  // PC kısayolu: Q (basılı tutunca tekrarlanmasın)
  addEventListener('keydown',e=>{if(e.repeat)return;if(e.target&&e.target.tagName==='INPUT')return;
    if(e.key.toLowerCase()==='q'){e.preventDefault();tryKill();}});
  $('#deathContinue').onclick=()=>{sfx.click();$('#deathScreen').classList.remove('on');};
  $('#rsBack').onclick=()=>{sfx.click();toLobbyAll();};
  requestAnimationFrame(loop);
}
init();
