'use strict';
/* world.js — harita verisi (AREAS), çarpışma/koridor kontrolü, statik harita çizimi */

const WORLD={w:1000,h:700},PAD=90,PR=13;
const SPAWN={x:190,y:150};
const AREAS=[
  {x:50,  y:50,  w:280, h:200, n:'KANTİN'},
  {x:670, y:50,  w:280, h:200, n:'ELEKTRİK'},
  {x:50,  y:450, w:280, h:200, n:'DEPO'},
  {x:670, y:450, w:280, h:200, n:'REVİR'},
  {x:380, y:270, w:240, h:160, n:'GÜVENLİK'},
  {x:300, y:110, w:400, h:80},
  {x:300, y:510, w:400, h:80},
  {x:150, y:230, w:150, h:240},
  {x:770, y:230, w:80,  h:240},
  {x:280, y:320, w:120, h:80},
  {x:600, y:320, w:190, h:80},
];

function ptInAreas(px,py){return AREAS.some(a=>px>=a.x&&px<=a.x+a.w&&py>=a.y&&py<=a.y+a.h)}
function canMoveTo(x,y,R){
  const k=R*.707;
  return ptInAreas(x,y)&&
    ptInAreas(x,y-R)&&ptInAreas(x,y+R)&&ptInAreas(x-R,y)&&ptInAreas(x+R,y)&&
    ptInAreas(x-k,y-k)&&ptInAreas(x+k,y-k)&&ptInAreas(x-k,y+k)&&ptInAreas(x+k,y+k);
}
function tryMove(p,dx,dy){
  if(canMoveTo(p.x+dx,p.y+dy,PR)){p.x+=dx;p.y+=dy;return}
  if(dx!==0&&canMoveTo(p.x+dx,p.y,PR))p.x+=dx;
  else if(dy!==0&&canMoveTo(p.x,p.y+dy,PR))p.y+=dy;
}
function roomAt(x,y){return AREAS.find(a=>a.n&&x>a.x&&x<a.x+a.w&&y>a.y&&y<a.y+a.h)||null}

/* Ekran (fare) koordinatını dünya koordinatına çevirir — render'daki kamera
   dönüşümünün tersi: world = (screen - center)/zoom + cam */
function screenToWorld(sx,sy){return {x:(sx-vw/2)/view.sc+cam.x,y:(sy-vh/2)/view.sc+cam.y}}

const mapC=document.createElement('canvas');
let mapReady=false;
function buildMap(){
  const MW=WORLD.w+PAD*2, MH=WORLD.h+PAD*2;
  mapC.width=MW;mapC.height=MH;
  const g=mapC.getContext('2d');g.clearRect(0,0,MW,MH);
  g.save();g.translate(PAD,PAD);
  for(let i=4;i>=0;i--){const t=(i+1)*5;
    g.fillStyle=`rgba(3,5,14,${.2+i*.12})`;
    AREAS.forEach(a=>g.fillRect(a.x-t,a.y-t,a.w+t*2,a.h+t*2));}
  g.strokeStyle='#2a3a60';g.lineWidth=3;
  AREAS.forEach(a=>g.strokeRect(a.x-1,a.y-1,a.w+2,a.h+2));
  g.fillStyle='#2f3d5c';AREAS.forEach(a=>g.fillRect(a.x,a.y,a.w,a.h));
  g.strokeStyle='rgba(255,255,255,.035)';g.lineWidth=1;
  AREAS.forEach(a=>{g.save();g.beginPath();g.rect(a.x,a.y,a.w,a.h);g.clip();
    for(let x=Math.floor(a.x/32)*32;x<a.x+a.w;x+=32){g.beginPath();g.moveTo(x,a.y);g.lineTo(x,a.y+a.h);g.stroke()}
    for(let y=Math.floor(a.y/32)*32;y<a.y+a.h;y+=32){g.beginPath();g.moveTo(a.x,y);g.lineTo(a.x+a.w,y);g.stroke()}
    g.restore()});
  g.font='26px Bangers,cursive';g.textAlign='center';g.fillStyle='rgba(255,255,255,.11)';
  AREAS.forEach(a=>{if(a.n)g.fillText(a.n,a.x+a.w/2,a.y+a.h/2+9)});
  drawProps(g);
  g.strokeStyle='rgba(63,214,255,.3)';g.setLineDash([6,6]);g.lineWidth=2;
  g.beginPath();g.arc(SPAWN.x,SPAWN.y,42,0,7);g.stroke();g.setLineDash([]);
  g.font='bold 11px Nunito';g.fillStyle='rgba(63,214,255,.35)';g.textAlign='center';
  g.fillText('BAŞLANGIÇ',SPAWN.x,SPAWN.y+56);
  g.restore();
  mapReady=true;
}
function drawProps(g){
  g.strokeStyle='#0a1120';g.lineWidth=2;
  g.fillStyle='#222c49';g.beginPath();g.arc(190,150,28,0,7);g.fill();g.stroke();
  g.fillStyle='#2c3a5f';
  [[155,118],[225,118],[155,182],[225,182]].forEach(p=>{g.beginPath();g.arc(p[0],p[1],8,0,7);g.fill();g.stroke()});
  /* ACİL DURUM butonu — masa ortasındaki kırmızı buton (js/meeting.js EMERG_BTN). */
  g.beginPath();g.arc(190,150,12,0,7);g.fillStyle='#6d1220';g.fill();g.stroke();
  g.beginPath();g.arc(190,150,9.5,0,7);g.fillStyle='#ff3b30';g.fill();g.stroke();
  g.beginPath();g.arc(187,146.5,3,0,7);g.fillStyle='rgba(255,255,255,.45)';g.fill();
  g.fillStyle='#fff';g.font='bold 12px Nunito';g.textAlign='center';g.textBaseline='middle';
  g.fillText('!',190,151);
  g.textBaseline='alphabetic';
  for(let i=0;i<3;i++){const x=720+i*75;g.fillStyle='#1d2740';g.fillRect(x,70,38,50);g.strokeRect(x,70,38,50);
    g.fillStyle='#ffd23f';g.beginPath();g.moveTo(x+22,76);g.lineTo(x+13,96);g.lineTo(x+19,96);
    g.lineTo(x+15,114);g.lineTo(x+27,92);g.lineTo(x+20,92);g.closePath();g.fill();}
  g.fillStyle='#4a3b26';
  [[90,490,28],[140,520,22],[270,570,26],[250,480,20]].forEach(b=>{g.fillRect(b[0],b[1],b[2],b[2]);g.strokeRect(b[0],b[1],b[2],b[2])});
  [[710,480],[780,480]].forEach(b=>{g.fillStyle='#c9d6ea';rr(g,b[0],b[1],28,56,6);g.fill();g.stroke();
    g.fillStyle='#fff';rr(g,b[0]+3,b[1]+4,22,14,4);g.fill()});
  g.fillStyle='#222c49';g.fillRect(430,340,140,28);g.strokeRect(430,340,140,28);
  for(let i=0;i<3;i++){g.fillStyle='#0e1626';g.fillRect(445+i*42,316,34,24);g.strokeRect(445+i*42,316,34,24);
    g.fillStyle='#4fe08a';g.fillRect(450+i*42,322,16,3);g.fillRect(450+i*42,328,22,3);}
}
