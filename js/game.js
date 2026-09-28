'use strict';
/* game.js — oyun akışı: solo için rol dağıtımı, oyuna giriş, rol açılışı,
   kill isteği, kazanma koşulları, ölüm ve sonuç ekranları.
   ÇEVRİMİÇİ oyunda bu dosyadaki kararlar sunucunun kararlarıdır; burada
   yalnızca arayüz ve SOLO (sunucusuz) mantığı yaşar. */

function assignRoles(){
  roles.clear();const ids=[...players.keys()];
  for(let i=ids.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]]}
  const impCount=ids.length>=7?2:1;
  ids.forEach((id,i)=>roles.set(id,i<impCount?'impostor':'crew'));
}
      /* Herkesi kafeterya spotuna taşır. Ölüm durumuna dokunmaz — toplantı
         sırasında da çağrılır, hayaletler hayalet olarak kalır. */
      function resetPositions(){
        const offs=[[-60,-40],[0,-50],[60,-40],[-60,40],[0,50],[60,40],[-30,0],[30,10]];let i=0;
        players.forEach(p=>{const o=offs[i++%offs.length];p.x=p.tx=SPAWN.x+o[0];p.y=p.ty=SPAWN.y+o[1];p.moving=false;});
      }
function startSolo(){
  S.mode='solo';myId='me';started=true;S.phase='game';players.clear();roles.clear();gameOver=false;killCooldown=0;
  closeMeeting();closeEject();
  players.set('me',{id:'me',name:sanitize(prefs.name),ci:prefs.ci,x:SPAWN.x,y:SPAWN.y,tx:SPAWN.x,ty:SPAWN.y,dir:1,angle:0,moving:false,ready:true,bot:false,dead:false,reported:false,gone:false});
  const used=new Set([prefs.ci]);
  ['Nova','Mercan','Arda-7'].forEach(n=>{let ci;do{ci=Math.floor(Math.random()*COLORS.length)}while(used.has(ci));used.add(ci);
    const rooms=AREAS.filter(a=>a.n);const r=pick(rooms);
    const b={id:'bot'+n,name:n,ci,x:rand(r.x+30,r.x+r.w-30),y:rand(r.y+30,r.y+r.h-30),dir:1,angle:0,moving:false,bot:true,wait:0,tx:0,ty:0,bob:rand(0,9),dead:false,reported:false,gone:false};
    botTarget(b);players.set(b.id,b);});
  assignRoles();resetPositions();enterGame();
}
function enterGame(){
  show('scr-game');$('#gMsgs').innerHTML='';controls=false;lastRoom=null;
  if(!mapReady)buildMap();
  requestAnimationFrame(()=>{resize();if(!mapReady)buildMap();});
  $('#hudCode').textContent=(S.mode==='solo')?'SOLO':(roomCode||'—');
  $('#hudBack').style.display=isHost()?'':'none';
  const rc=$('#roleChip');rc.style.display='';
  const imp=isImpostor();
  rc.className='chip role '+(imp?'imp':'crew');rc.textContent=imp?'SAHTEKÂR':'MÜRETTEBAT';
  updateCount();doReveal();
}
function updateCount(){$('#hudCount').textContent=players.size+' oyuncu'}
function doReveal(){
  const imp=isImpostor(),ov=$('#reveal');
  $('#rvWord').textContent=imp?'SAHTEKÂRSIN':'MÜRETTEBATSIN';
  $('#rvSub').textContent=imp?'Kimseye belli etme. Şimdilik masummuş gibi dolaş… 🔪 Q (ya da kırmızı buton) ile öldür!'
                             :'Gemi ekibindensin. Sahtekârlara karşı gözünü açık tut.';
  const others=[...roles.entries()].filter(([id,r])=>r==='impostor'&&id!==myId)
    .map(([id])=>(players.get(id)||{}).name).filter(Boolean);
  $('#rvTeam').textContent=imp&&others.length?'Diğer sahtekâr: '+others.join(', '):'';
  const c=$('#rvBean').getContext('2d');c.clearRect(0,0,260,290);
  // Oyun içinde göründüğün renk sunucunun verdiği renktir; aynısı burada.
  const my=ME();
  drawBean(c,130,262,3.6,my?my.ci:prefs.ci,1,false,1);
  ov.className='on '+(imp?'imp':'crew');sfx[imp?'imp':'crew']();
  setTimeout(()=>ov.className='',3300);
  setTimeout(()=>controls=true,3200);
}

/* Menzildeki en yakın canlı hedefi döndürür (menzil doluysa null).
   Yalnızca butonun parlaması içindir — gerçek kararı sunucu verir. */
function findKillTarget(){
  const me=ME();
  if(!me||me.dead||gameOver)return null;
  if(!isImpostor())return null;
  let closest=null,minDist=Infinity;
  players.forEach(p=>{
    if(p.id===myId||p.dead)return;
    const dist=Math.hypot(p.x-me.x,p.y-me.y);
    if(dist<KILL_RANGE&&dist<minDist){minDist=dist;closest=p;}
  });
  return closest;
}

function tryKill(){
  const me=ME();
  if(!me||me.dead||gameOver)return;
  if(!isImpostor())return;
  if(meeting){toast('Toplantı sürüyor','err');return}
  if(killCooldown>0){toast('Kill cooldown: '+Math.ceil(killCooldown)+'s','err');return}
  const closest=findKillTarget();
  if(!closest){toast('Hedef menzilde değil','err');return}
  if(S.mode==='solo'){
    // Solo modda sunucu yok, istemci kendi otoritesidir.
    closest.dead=true;
    sysChat(closest.name+' öldürüldü!');
    sfx.kill();
    killCooldown=KILL_COOLDOWN;
    checkGameEnd();
  }else{
    // Çevrimiçi: sadece istek gönder. Menzil, rol ve cooldown kontrolünü
    // sunucu yapar; kabul ederse 'killed' + 'cd' mesajları gelir.
    sendMsg({t:'kill',target:closest.id});
    killCooldown=KILL_COOLDOWN;
  }
}

function checkGameEnd(){
  if(gameOver)return;
  const alive=[...players.values()].filter(p=>!p.dead);
  const impAlive=alive.filter(p=>roles.get(p.id)==='impostor').length;
  const crewAlive=alive.filter(p=>roles.get(p.id)==='crew').length;
  if(impAlive===0){endGame('crew');}
  else if(impAlive>=crewAlive){endGame('imp');}
}

function endGame(winner){
  // Çevrimiçi oyunda sonucu sunucu belirler ve 'end' mesajıyla duyurur.
  // Buraya yalnızca SOLO mod düşer.
  gameOver=true;
  showResultScreen(winner);
}

function showDeathScreen(){
  sfx.death();
  $('#deathScreen').classList.add('on');
}

function showResultScreen(winner){
  const rs=$('#resultScreen');
  rs.className='on '+(winner==='crew'?'crew':'imp');
  $('#rsTitle').textContent=winner==='crew'?'MÜRETTEBAT KAZANDI':'SAHTEKÂRLAR KAZANDI';
  $('#rsSub').textContent=winner==='crew'?'Tüm sahtekârlar etkisiz hale getirildi!':'Sahtekârlar gemiyi ele geçirdi!';
  sfx[winner==='crew'?'win':'lose']();
  const plist=$('#rsPlayers');plist.innerHTML='';
  [...players.values()].forEach(p=>{
    const card=document.createElement('div');
    card.className='p-card'+(p.dead?' dead':'');
    const cv=document.createElement('canvas');cv.width=48;cv.height=56;
    drawBean(cv.getContext('2d'),24,48,1.2,p.ci,1,false,0,p.dead);
    const info=document.createElement('div');info.className='info';
    const role=roles.get(p.id);
    info.innerHTML=`<div>${esc(p.name)}</div><div class="role ${role}">${role==='impostor'?'SAHTEKÂR':'MÜRETTEBAT'}</div>`;
    card.appendChild(cv);card.appendChild(info);plist.appendChild(card);
  });
}
