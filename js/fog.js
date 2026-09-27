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
  if(dist<=baseR)return true;
  if(dist<=coneLen){
    const targetAngle=Math.atan2(dy,dx);
    let diff=Math.abs(targetAngle-angle);
    if(diff>Math.PI)diff=2*Math.PI-diff;
    if(diff<=coneHalf)return true;
  }
  return false;
}
