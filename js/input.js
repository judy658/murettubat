'use strict';
/* input.js — klavye, fare ve dokunmatik joystick girdileri */

const keys={};
addEventListener('keydown',e=>{if(e.target&&e.target.tagName==='INPUT')return;
  const k=e.key.toLowerCase();keys[k]=1;
  if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k))e.preventDefault();
  if(k==='escape')$('#chatBox').classList.remove('on');});
addEventListener('keyup',e=>keys[e.key.toLowerCase()]=0);
addEventListener('blur',()=>{for(const k in keys)keys[k]=0});

let joy=null;
const gameCv=$('#game'),joyB=$('#joyBase'),joyK=$('#joyKnob');
function placeJoy(){joyB.style.left=(joy.bx-56)+'px';joyB.style.top=(joy.by-56)+'px';
  joyK.style.left=(joy.bx+joy.dx-26)+'px';joyK.style.top=(joy.by+joy.dy-26)+'px';}
gameCv.addEventListener('touchstart',e=>{e.preventDefault();mouse.active=false;if(joy)return;const t=e.changedTouches[0];
  joy={id:t.identifier,bx:t.clientX,by:t.clientY,dx:0,dy:0};
  joyB.style.display=joyK.style.display='block';placeJoy();},{passive:false});
gameCv.addEventListener('touchmove',e=>{e.preventDefault();if(!joy)return;
  for(const t of e.changedTouches)if(t.identifier===joy.id){
    joy.dx=clamp(t.clientX-joy.bx,-48,48);joy.dy=clamp(t.clientY-joy.by,-48,48);placeJoy();}},{passive:false});
const joyEnd=e=>{for(const t of e.changedTouches)if(joy&&t.identifier===joy.id){
  joy=null;joyB.style.display=joyK.style.display='none';}};
gameCv.addEventListener('touchend',joyEnd);gameCv.addEventListener('touchcancel',joyEnd);

/* PC kontrolü: karakter fare imlecine bakar, yürüme yine WASD/ok tuşları.
   Fare bir kez hareket edene kadar (ve dokunmatik başlayınca) devre dışı;
   o zaman mobilde olduğu gibi yürüme yönüne bakar. */
const mouse={x:0,y:0,active:false};
const moveVec={x:0,y:0};
gameCv.addEventListener('mousemove',e=>{const r=gameCv.getBoundingClientRect();
  mouse.x=e.clientX-r.left;mouse.y=e.clientY-r.top;mouse.active=true;});
gameCv.addEventListener('mouseleave',()=>{mouse.active=false});
gameCv.addEventListener('contextmenu',e=>e.preventDefault());

