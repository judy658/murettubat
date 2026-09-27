'use strict';
/* net.js — sunucu bağlantısı (WebSocket) ve mesap protokolü.
   Artık "host" diye bir şey yok: herkes eşit oyuncu, kararları sunucu verir. */

let sock=null,sockOpen=false,pendingJoin=null,pingTimer=0;

/* --- Bağlantı yardımcıları --- */
function wsUrl(){return (location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/ws'}

function canOnline(){
  if(!/^https?:$/.test(location.protocol)){
    toast('Çevrimiçi oyun için oyunu sunucu adresinden açmalısın. (Şimdilik SOLO oynayabilirsin.)','err');
    sfx.err();return false;
  }
  return true;
}
function setNetStat(kind,text){
  const el=$('#netStat');if(!el)return;
  el.className='net'+(kind?' '+kind:'');
  const label={ok:'Sunucu bağlantısı: hazır',bad:'Sunucu bağlantısı: yok',wait:'Sunucuya bağlanılıyor…'};
  el.innerHTML='<i></i>'+(text||label[kind]||'');
}
function sendMsg(obj){
  if(sockOpen&&sock&&sock.readyState===1){try{sock.send(JSON.stringify(obj))}catch(e){}}
}
function closeSocket(){
  clearInterval(pingTimer);pingTimer=0;
  const old=sock;sock=null;sockOpen=false;
  if(old){old.onopen=old.onmessage=old.onclose=old.onerror=null;try{old.close()}catch(e){}}
}

/* --- Oda kur / katıl --- */
function createRoom(){
  savePrefs();
  if(!canOnline())return;
  S.mode='online';started=false;leaving=false;roomCode=null;
  players.clear();roles.clear();
  pendingJoin={t:'create',n:prefs.name,ci:prefs.ci};
  openSocket();
}
function joinRoom(){
  const code=$('#joinCode').value.trim().toUpperCase();
  if(code.length<4){toast('Oda kodunu gir','err');sfx.err();return}
  savePrefs();
  if(!canOnline())return;
  S.mode='online';roomCode=code;leaving=false;
  players.clear();roles.clear();
  pendingJoin={t:'join',code,n:prefs.name,ci:prefs.ci};
  openSocket();
}
function openSocket(){
  closeSocket();
  setNetStat('wait');
  let ws;
  try{ws=new WebSocket(wsUrl())}catch(e){
    setNetStat('bad');pendingJoin=null;toast('Sunucuya ulaşılamadı','err');sfx.err();return;
  }
  sock=ws;
  ws.onopen=()=>{
    sockOpen=true;setNetStat('ok');sfx.click();
    if(pendingJoin){ws.send(JSON.stringify(pendingJoin));pendingJoin=null}
    // Render ücretsiz planı 15 dk hareketsizlikte uykuya dalıyor;
    // bu ping servisi uyanık tutuyor.
    clearInterval(pingTimer);
    pingTimer=setInterval(()=>sendMsg({t:'ping'}),20000);
  };
  ws.onmessage=e=>{let d;try{d=JSON.parse(e.data)}catch(err){return}serverMsg(d)};
  ws.onclose=()=>{
    sockOpen=false;setNetStat('bad');
    if(pendingJoin){pendingJoin=null;toast('Sunucuya bağlanılamadı','err');sfx.err();return}
    if(S.mode==='online'&&S.phase!=='menu'&&!leaving){
      toast('Sunucu bağlantısı koptu','err');leaveAll();
    }
  };
  ws.onerror=()=>{setNetStat('bad')};
}

/* --- Sunucudan gelen mesajlar --- */
function serverMsg(d){
  if(!d||!d.t)return;
  switch(d.t){

    case 'created': case 'joined':{
      myId=d.you;roomCode=d.code;joining=false;
      players.clear();roles.clear();
      players.set(myId,{id:myId,name:sanitize(prefs.name),ci:prefs.ci,
        x:SPAWN.x,y:SPAWN.y,tx:SPAWN.x,ty:SPAWN.y,dir:1,angle:0,moving:false,ready:false,bot:false,dead:false});
      applyState(d.p);
      LB=null;pushLobby(d.lobby);
      enterLobby();
      sysChat(d.t==='created'?'Oda kuruldu: '+d.code:'Odaya katıldın.');
      toast(d.t==='created'?'Oda kuruldu: '+d.code:'Odaya katıldın');
      sfx.join();
      break;
    }

    case 'lb':
      pushLobby(d.lobby);
      break;

    case 'deny':
      joining=false;toast(d.r,'err');sfx.err();leaveAll();
      break;

    case 'colno':
      toast('Bu renk alınmış!','err');sfx.err();
      break;

    case 'st':
      applyState(d.p);
      break;

    case 'go':{
      // ROLLERİN SİRRİ: sunucu bize yalnızca kendi rolümüzü ve (sahtekârsa)
      // diğer sahtekârların id/isimlerini gönderir.
      started=true;S.phase='game';
      roles.clear();
      roles.set(myId,d.role);
      (d.mates||[]).forEach(m=>roles.set(m.id,'impostor'));
      resetPositions();enterGame();
      break;
    }

    case 'back':
      toLobbyAll();
      break;

    case 'c':
      chatRow(curMsgs(),{n:d.n,ci:d.ci,m:d.m});sfx.chat();
      break;

    case 'killed':{
      const v=players.get(d.victim);
      if(v)v.dead=true;
      if(d.victim===myId)showDeathScreen();
      if(v)sysChat(v.name+' öldürüldü!');
      sfx.kill();
      break;
    }

    case 'cd':
      killCooldown=(d.ms||0)/1000;
      break;

    case 'end':
      if(d.roles)roles.clear();
      if(d.roles)for(const id in d.roles)roles.set(id,d.roles[id]);
      showResultScreen(d.winner);
      break;
  }
}

/* Sunucudan gelen konum/renk/isim verisini yerel oyuncu listesine işle.
   Kendi konumumuzu asla geri yazmıyoruz — yerel hareketi anında tepki verdiği
   için sunucu geri bildirimi ile çekiştirme (rubber-band) olurdu. */
function applyState(map){
  if(!map)return;
  for(const id in map){
    const i=map[id];
    let p=players.get(id);
    if(!p){
      p={id,name:i.n||'?',ci:i.c||0,
         x:i.x!=null?i.x:SPAWN.x,y:i.y!=null?i.y:SPAWN.y,
         tx:i.x!=null?i.x:SPAWN.x,ty:i.y!=null?i.y:SPAWN.y,
         dir:1,angle:0,moving:false,ready:false,bot:false,dead:false};
      players.set(id,p);
      updateCount();   // yeni oyuncu katıldı → HUD sayacı güncellensin
    }
    if(i.n!==undefined)p.name=i.n;
    if(i.c!==undefined)p.ci=i.c;
    if(i.d!==undefined)p.dir=i.d;
    if(i.m!==undefined)p.moving=!!i.m;
    if(i.a!==undefined)p.angle=i.a;
    if(i.k!==undefined)p.dead=!!i.k;
    if(id!==myId){
      if(i.x!==undefined){p.tx=i.x;p.ty=i.y}
    }
  }
}

function leaveAll(){
  leaving=true;closeSocket();
  players.clear();roles.clear();started=false;LB=null;gameOver=false;roomCode=null;
  S.phase='menu';S.mode=null;controls=false;
  $('#lbMsgs').innerHTML='';$('#gMsgs').innerHTML='';
  $('#deathScreen').classList.remove('on');$('#resultScreen').className='';
  show('scr-menu');leaving=false;
  setNetStat('');
}
