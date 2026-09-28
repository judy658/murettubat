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
  const coneLenW=330;                                  // dünya birimi
  const coneHalf=Math.PI/4.2;
  const angle=player.angle!=null?player.angle:(player.dir>0?0:Math.PI);
  /* EL FENERİ: yalnızca baktığımız yön aydınlanır. Işınlar duvarda durur;
     her ışın yürünebilir zeminden çıkana kadar yürütülür, böylece ışık
     köşeyi dönüp arkadaki odaları AYDINLATMAZ. Uç nokta ikinci geçişte
     duvara en yakın serbest noktaya ince adımlarla oturtulur; aksi halde
     kaba örnekleme duvarda DİŞLİ/TARTIKLI üçgen gölgeler yapar. */
  const RAYS=96,RAY_STEP=5;
  const path=new Path2D();
  path.moveTo(sx,sy);
  for(let i=0;i<=RAYS;i++){
    const a=angle-coneHalf+(2*coneHalf)*i/RAYS;
    const vx=Math.cos(a),vy=Math.sin(a);
    let dW=coneLenW;
    for(let rr=RAY_STEP;rr<=coneLenW;rr+=RAY_STEP){
      if(!losClear(player.x+vx*rr,player.y+vy*rr)){
        dW=rr-RAY_STEP;
        /* [dW, dW+RAY_STEP] aralığında duvarın önünü hassas bul. */
        for(let f=RAY_STEP/2;f>=1;f/=2){
          if(losClear(player.x+vx*(dW+f),player.y+vy*(dW+f)))dW+=f;
        }
        break;
      }
    }
    path.lineTo(sx+vx*dW*view.sc,sy+vy*dW*view.sc);
  }
  path.closePath();
  const cg=fogX.createRadialGradient(sx,sy,0,sx,sy,coneLenW*view.sc);
  cg.addColorStop(0,'rgba(0,0,0,1)');cg.addColorStop(.55,'rgba(0,0,0,.97)');
  cg.addColorStop(.85,'rgba(0,0,0,.55)');cg.addColorStop(1,'rgba(0,0,0,0)');
  fogX.fillStyle=cg;
  fogX.fill(path);
  /* Işığı zemine kes: duvar/boşluk arkası karanlık kalır,
     oyuncular da zaten duvar arkasında çizilmez. */
  ensureFloorMask();
  const sc=view.sc;
  fogX.globalCompositeOperation='destination-in';
  /* Zemin maskesini dünya koordinatından ekrana getir.
     Canvas CTM'si scale(sc) ile çarpıldığı için öteleme -cam + vw/(2*sc)
     olmalı; aksi halde maske haritaya göre KAYMIŞ çizilir. */
  fogX.save();
  fogX.scale(sc,sc);
  fogX.translate(-cam.x+vw/(2*sc),-cam.y+vh/(2*sc));
  fogX.drawImage(floorMask,0,0);
  fogX.restore();
  fogX.globalCompositeOperation='source-over';
  ctx.drawImage(fogC,0,0,w,h);
}

function isInView(player,target){
  if(!player||!target)return false;
  const dx=target.x-player.x,dy=target.y-player.y;
  const dist=Math.hypot(dx,dy);
  const coneLen=330;
  const coneHalf=Math.PI/4.2;
  const angle=player.angle!=null?player.angle:(player.dir>0?0:Math.PI);
  /* Yalnızca baktığımız koni aydınlanır: 360° çekirdek çevre YOK. */
  if(dist>coneLen)return false;
  const targetAngle=Math.atan2(dy,dx);
  let diff=Math.abs(targetAngle-angle);
  if(diff>Math.PI)diff=2*Math.PI-diff;
  if(diff>coneHalf)return false;
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
