'use strict';
/* render.js — ana döngü: yıldız arka planı, dünya çizimi, karakter interpolasyonu,
   bot yapay zekâsı, oyuncu güncellemesi ve ekran çizimi */

const bgCv=$('#bg'),bgx=bgCv.getContext('2d'),gx=gameCv.getContext('2d');
const stars=[],floaters=[];
for(let i=0;i<130;i++)stars.push({x:Math.random(),y:Math.random(),r:Math.random()<.85?1.5:2.5,
  p:Math.random()<.5?.25:.55,tw:rand(.5,2),ph:rand(0,9)});
for(let i=0;i<6;i++)floaters.push({x:rand(0,1),y:rand(0,1),vx:rand(-.02,.02),vy:rand(-.012,.012),
  s:rand(1,1.9),ci:i%COLORS.length,dir:Math.random()<.5?-1:1,ph:rand(0,9)});
function drawStars(g,w,h,ox){
  const gr=g.createLinearGradient(0,0,0,h);gr.addColorStop(0,'#05070f');gr.addColorStop(1,'#0b1224');
  g.fillStyle=gr;g.fillRect(0,0,w,h);
  const neb=(x,y,r,col)=>{const n=g.createRadialGradient(x,y,0,x,y,r);n.addColorStop(0,col);n.addColorStop(1,'transparent');
    g.fillStyle=n;g.fillRect(x-r,y-r,r*2,r*2)};
  neb(w*.78,h*.24,h*.5,'rgba(63,150,190,.07)');neb(w*.16,h*.8,h*.45,'rgba(255,140,90,.045)');
  for(const s of stars){let x=(s.x*w-ox*s.p)%w;if(x<0)x+=w;
    const al=.25+.7*Math.abs(Math.sin(T*s.tw+s.ph));
    g.fillStyle=`rgba(205,222,255,${al})`;g.fillRect(x,s.y*h,s.r,s.r);}}
function drawMenuFloaters(g,w,h){
  floaters.forEach((f,i)=>{g.save();
    if(i===0){g.shadowColor='#ff4d5e';g.shadowBlur=26;}
    g.globalAlpha=.92;drawBean(g,f.x*w,f.y*h,f.s,f.ci,f.dir,true,T+f.ph);g.restore();});}

function update(dt){
  floaters.forEach(f=>{f.x+=f.vx*dt;f.y+=f.vy*dt;
    if(f.x<-.06)f.x=1.06;if(f.x>1.06)f.x=-.06;if(f.y<-.08)f.y=1.08;if(f.y>1.08)f.y=-.08;f.dir=f.vx>=0?1:-1;});
  if(S.phase!=='game')return;
  if(killCooldown>0){
    killCooldown=Math.max(0,killCooldown-dt);
    const btn=$('#killBtn');
    if(killCooldown>0){btn.classList.add('cooldown');btn.querySelector('.cd').textContent=Math.ceil(killCooldown)+'s';}
    else{btn.classList.remove('cooldown');btn.querySelector('.cd').textContent='';}
  }
  const me=ME();
  if(me&&controls&&!me.dead){
    let ix=(keys['d']||keys['arrowright']?1:0)-(keys['a']||keys['arrowleft']?1:0);
    let iy=(keys['s']||keys['arrowdown']?1:0)-(keys['w']||keys['arrowup']?1:0);
    if(joy){ix+=joy.dx/48;iy+=joy.dy/48;}
    const len=Math.hypot(ix,iy);if(len>1){ix/=len;iy/=len;}
    if(ix||iy){
      me.dir=ix>0?1:(ix<0?-1:me.dir);
      me.angle=Math.atan2(iy,ix);
    }
    moveVec.x=ix;moveVec.y=iy;
    me.moving=!!(ix||iy);
    tryMove(me,ix*185*dt,iy*185*dt);
    const r=roomAt(me.x,me.y);
    if(r&&r.n!==lastRoom){lastRoom=r.n;const tEl=$('#roomToast');tEl.textContent=r.n;
      tEl.style.opacity=1;clearTimeout(tEl._t);tEl._t=setTimeout(()=>tEl.style.opacity=0,1400);}
    if(!r)lastRoom=null;
    if(S.mode==='online'&&sockOpen&&performance.now()-lastSend>60){
      lastSend=performance.now();
      sendMsg({t:'p',x:Math.round(me.x),y:Math.round(me.y),d:me.dir,m:me.moving?1:0,a:me.angle});}
  }
  if(S.mode==='solo')players.forEach(p=>{if(p.bot&&!p.dead)updateBot(p,dt)});
  players.forEach(p=>{
    if(p===me)return;
    // Bozuk hedef (NaN) asla konuma işlenmesin; oyuncu yerinde kalsın.
    if(!Number.isFinite(p.tx)||!Number.isFinite(p.ty)){p.tx=p.x;p.ty=p.y;return}
    /* Ceset sunucunun bildirdiği yerde durur. Eskiden ölü oyuncular
       interpolasyondan da çıkarılıyordu; ceset ölüm anındaki YARIM KALMIŞ
       konumda donup kalıyor ve kesildiği yere hiç gitmiyordu.
       Katil menzil içinde olduğu için fark etmiyor, uzaktan izleyenler
       cesedi yanlış yerde görüyordu. */
    if(p.dead){p.x=p.tx;p.y=p.ty;return}
    const dx=p.tx-p.x,dy=p.ty-p.y;
    if(dx*dx+dy*dy>20736){p.x=p.tx;p.y=p.ty}
    else{p.x+=dx*Math.min(1,dt*18);p.y+=dy*Math.min(1,dt*18);}});
  if(me){cam.x=lerp(cam.x,me.x,Math.min(1,dt*6));cam.y=lerp(cam.y,me.y,Math.min(1,dt*6));}
  const hw=vw/2/view.sc,hh=vh/2/view.sc,minX=-PAD,maxX=WORLD.w+PAD,minY=-PAD,maxY=WORLD.h+PAD;
  cam.x=(maxX-minX)<=hw*2?(minX+maxX)/2:clamp(cam.x,minX+hw,maxX-hw);
  cam.y=(maxY-minY)<=hh*2?(minY+maxY)/2:clamp(cam.y,minY+hh,maxY-hh);
  // YÖN: PC'de fare imlecine bak, mobilde yürüme yönüne bak.
  // Kamera bu noktada kilitlendiği için imlecin altındaki dünya noktası birebir oturur.
  if(me&&controls&&!me.dead&&mouse.active){
    const wpt=screenToWorld(mouse.x,mouse.y);
    const a=Math.atan2(wpt.y-me.y,wpt.x-me.x);
    me.angle=a;
    const c=Math.cos(a);if(Math.abs(c)>.15)me.dir=c>0?1:-1;
  }
}
function botTarget(b){const rooms=AREAS.filter(a=>a.n);
  for(let i=0;i<15;i++){const r=pick(rooms);const x=rand(r.x+30,r.x+r.w-30),y=rand(r.y+30,r.y+r.h-30);
    if(canMoveTo(x,y,PR)){b.tx=x;b.ty=y;return}}b.tx=b.x;b.ty=b.y;}
function updateBot(b,dt){b.wait-=dt;if(b.wait>0){b.moving=false;return}
  const dx=b.tx-b.x,dy=b.ty-b.y,d=Math.hypot(dx,dy);
  if(d<8){b.wait=rand(.4,1.8);botTarget(b);return}
  const sp=95*dt;tryMove(b,dx/d*sp,dy/d*sp);
  if(Math.abs(dx)>2)b.dir=dx>0?1:-1;b.moving=true;
  if(dx||dy)b.angle=Math.atan2(dy,dx);
  if(Math.hypot(b.x-b.tx,b.y-b.ty)<10){b.wait=rand(.2,.5);botTarget(b);}}

function render(){
  const w=vw,h=vh;
  bgx.setTransform(dpr,0,0,dpr,0,0);
  drawStars(bgx,w,h,S.phase==='game'?cam.x*.6:T*22);
  if(S.phase==='menu')drawMenuFloaters(bgx,w,h);
  if(S.phase!=='game')return;
  gx.setTransform(dpr,0,0,dpr,0,0);gx.clearRect(0,0,w,h);
  gx.save();gx.translate(w/2,h/2);gx.scale(view.sc,view.sc);gx.translate(-cam.x,-cam.y);
  if(mapC.width)gx.drawImage(mapC,-PAD,-PAD);
  const me=ME();
  const list=[...players.values()].sort((a,b)=>a.y-b.y);
  const impNames=new Set([...roles.entries()].filter(([id,r])=>r==='impostor').map(([id])=>id));
  const meImp=roles.get(myId)==='impostor';
  for(const p of list){
    if(!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;   // NaN asla çizilmez
    if(me&&!me.dead&&p.id!==myId&&!p.dead&&!isInView(me,p))continue;
    drawBean(gx,p.x,p.y,1,p.ci,p.dir,p.moving,T+(p.bob||0),p.dead);
    if(!p.dead){
      gx.font='800 12px Nunito';gx.textAlign='center';
      const nm=(p.id===myId?'★ ':'')+p.name;
      gx.lineWidth=3;gx.strokeStyle='#0a1120';gx.strokeText(nm,p.x,p.y-46);
      gx.fillStyle=(meImp&&impNames.has(p.id))?'#ff8b95':'#fff';
      gx.fillText(nm,p.x,p.y-46);}
  }
  gx.restore();
  if(me&&!me.dead)drawFog(gx,me,w,h);
  const killBtn=$('#killBtn');
  if(me&&meImp&&!me.dead&&!gameOver){
    killBtn.classList.add('show');
    killBtn.classList.toggle('ready',!!findKillTarget());
  }else{killBtn.classList.remove('show','ready');}
}

function resize(){vw=innerWidth;vh=innerHeight;dpr=Math.min(devicePixelRatio||1,2);
  [bgCv,gameCv].forEach(c=>{c.width=vw*dpr;c.height=vh*dpr});
  view.sc=clamp(Math.min(vw/(WORLD.w+PAD*2),vh/(WORLD.h+PAD*2)),.55,1.2);
  fogW=0;fogH=0;}
addEventListener('resize',resize);
let last=performance.now();
function loop(now){const dt=Math.min(.05,(now-last)/1000);last=now;T=now/1000;
  update(dt);render();requestAnimationFrame(loop);}
