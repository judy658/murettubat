'use strict';
/* fog.js — karanlık/ışık sistemi: görüş konisi maskesi ve görüş hâkimiyeti testi */

const fogC=document.createElement('canvas');
const fogX=fogC.getContext('2d');
let fogW=0,fogH=0;
function drawFog(ctx,player,w,h){
  if(!player)return;
  if(w!==fogW||h!==fogH){fogC.width=Math.ceil(w*dpr);fogC.height=Math.ceil(h*dpr);fogW=w;fogH=h;}
  fogX.setTransform(dpr,0,0,dpr,0,0);
  fogX.clearRect(0,0,w,h);
  fogX.fillStyle='rgba(2,4,14,0.78)';
  fogX.fillRect(0,0,w,h);
  fogX.globalCompositeOperation='destination-out';
  const sx=w/2+(player.x-cam.x)*view.sc;
  const sy=h/2+(player.y-cam.y)*view.sc;
  const baseR=135*view.sc;
  const bg=fogX.createRadialGradient(sx,sy,baseR*.15,sx,sy,baseR);
  bg.addColorStop(0,'rgba(0,0,0,1)');bg.addColorStop(.55,'rgba(0,0,0,.95)');
  bg.addColorStop(.82,'rgba(0,0,0,.5)');bg.addColorStop(1,'rgba(0,0,0,0)');
  fogX.fillStyle=bg;
  fogX.beginPath();fogX.arc(sx,sy,baseR,0,Math.PI*2);fogX.fill();
  const coneLen=330*view.sc;
  const coneHalf=Math.PI/4.2;
  const angle=player.angle!=null?player.angle:(player.dir>0?0:Math.PI);
  const cg=fogX.createRadialGradient(sx,sy,0,sx,sy,coneLen);
  cg.addColorStop(0,'rgba(0,0,0,1)');cg.addColorStop(.45,'rgba(0,0,0,.92)');
  cg.addColorStop(.75,'rgba(0,0,0,.45)');cg.addColorStop(1,'rgba(0,0,0,0)');
  fogX.fillStyle=cg;
  fogX.beginPath();fogX.moveTo(sx,sy);
  fogX.arc(sx,sy,coneLen,angle-coneHalf,angle+coneHalf);
  fogX.closePath();fogX.fill();
  const coreR=55*view.sc;
  const cg2=fogX.createRadialGradient(sx,sy,0,sx,sy,coreR);
  cg2.addColorStop(0,'rgba(0,0,0,1)');cg2.addColorStop(1,'rgba(0,0,0,0)');
  fogX.fillStyle=cg2;
  fogX.beginPath();fogX.arc(sx,sy,coreR,0,Math.PI*2);fogX.fill();
  /* Işığı zemine kes: duvar/boşluk arkası karanlık kalır,
     oyuncular da zaten duvar arkasında çizilmez. */
  ensureFloorMask();
  const sc=view.sc;
  fogX.globalCompositeOperation='destination-in';
  fogX.save();
  fogX.scale(sc,sc);
  fogX.translate(-cam.x*sc+vw/2,-cam.y*sc+vh/2);
  fogX.drawImage(floorMask,0,0);
  fogX.restore();
  fogX.globalCompositeOperation='source-over';
  ctx.drawImage(fogC,0,0,w,h);
}

function isInView(player,target){
  if(!player||!target)return false;
  const dx=target.x-player.x,dy=target.y-player.y;
  const dist=Math.hypot(dx,dy);
  const baseR=135;
  const coneLen=330;
  const coneHalf=Math.PI/4.2;
  const angle=player.angle!=null?player.angle:(player.dir>0?0:Math.PI);
  let ok=false;
  if(dist<=baseR)ok=true;
  else if(dist<=coneLen){
    const targetAngle=Math.atan2(dy,dx);
    let diff=Math.abs(targetAngle-angle);
    if(diff>Math.PI)diff=2*Math.PI-diff;
    if(diff<=coneHalf)ok=true;
  }
  if(!ok)return false;
  /* Duvar arkasındaki oyuncu GÖRÜNMEZ: düz çizgi tüm koridorlar dahil
     yürünebilir zeminden geçmiyorsa görüş engellenir. */
  return !wallBlocks(player.x,player.y,target.x,target.y);
}

/* Oyuncunun konumundan hedefe çizilen doğru, yürünebilir zeminin DIŞINA
   çıkıyorsa duvar engeldir. Nokta örneklemesi 5px adımlarla yapılır;
   2px tolerans koridor ağızlarındaki sayısal dalgalanmaları eler. */
function losClear(x,y){
  return AREAS.some(a=>x>=a.x-2&&x<=a.x+a.w+2&&y>=a.y-2&&y<=a.y+a.h+2);
}
function wallBlocks(ax,ay,bx,by){
  const dx=bx-ax,dy=by-ay;
  const steps=Math.max(2,Math.ceil(Math.hypot(dx,dy)/5));
  for(let i=0;i<=steps;i++){
    const t=i/steps;
    if(!losClear(ax+dx*t,ay+dy*t))return true;
  }
  return false;
}

/* Yürünebilir zemin maskesi: sis ışığı yalnızca zemine düşer; duvar
   /boşluk arkası olduğu gibi karanlık kalır. */
let floorMask=null;
function ensureFloorMask(){
  if(floorMask)return;
  floorMask=document.createElement('canvas');
  floorMask.width=WORLD.w;floorMask.height=WORLD.h;
  const c=floorMask.getContext('2d');
  c.fillStyle='#fff';
  AREAS.forEach(a=>c.fillRect(a.x,a.y,a.w,a.h));
}
