'use strict';
/* sprites.js — canvas çizim yardımcıları: yuvarlatılmış dikdörtgen ve bean (Among Us karakteri) */

function rr(g,x,y,w,h,r){g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath()}
function drawBean(g,x,y,s,ci,dir=1,moving=false,tt=0,dead=false){
  const C=COLORS[ci]||COLORS[0];
  if(dead){
    g.save();g.translate(x,y);g.globalAlpha=.6;
    g.fillStyle='rgba(0,0,0,.3)';g.beginPath();g.ellipse(0,2*s,20*s,6*s,0,0,7);g.fill();
    g.fillStyle=C.d;g.strokeStyle='rgba(10,14,26,.9)';g.lineWidth=2*s;
    rr(g,-18*s,-8*s,36*s,16*s,8*s);g.fill();g.stroke();
    g.fillStyle='#9FD9F7';g.beginPath();g.ellipse(8*s*dir,-4*s,8*s,5*s,0,0,7);g.fill();g.stroke();
    g.fillStyle='rgba(255,255,255,.7)';g.beginPath();g.ellipse(5*s*dir,-5*s,2.5*s,1.5*s,0,0,7);g.fill();
    g.restore();
    return;
  }
  const bob=moving?Math.sin(tt*13)*1.8*s:Math.sin(tt*2.2)*.8*s;
  g.save();g.translate(x,y);
  g.fillStyle='rgba(0,0,0,.35)';g.beginPath();g.ellipse(0,2*s,16*s,5.5*s,0,0,7);g.fill();
  const lp=moving?Math.sin(tt*15)*3.4*s:0;
  g.fillStyle=C.d;g.strokeStyle='rgba(10,14,26,.9)';g.lineWidth=2*s;
  rr(g,-10*s+lp*.4,-11*s,8.5*s,12*s,3*s);g.fill();g.stroke();
  rr(g,1.5*s-lp*.4,-11*s,8.5*s,12*s,3*s);g.fill();g.stroke();
  g.translate(0,bob);
  const w=14.5*s,h=33*s;
  g.fillStyle=C.d;rr(g,-dir*(w+2.5*s),-h*.74,8*s,17*s,3.5*s);g.fill();g.stroke();
  g.fillStyle=C.c;rr(g,-w,-h,w*2,h,12*s);g.fill();g.stroke();
  g.fillStyle='#9FD9F7';g.beginPath();g.ellipse(dir*6*s,-h*.62,9.5*s,6.5*s,0,0,7);g.fill();g.stroke();
  g.fillStyle='rgba(255,255,255,.85)';g.beginPath();g.ellipse(dir*3.2*s,-h*.66,3.2*s,2*s,0,0,7);g.fill();
  g.restore();
}
