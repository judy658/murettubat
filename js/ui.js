'use strict';
/* ui.js — sohbet satırları, mesaj gönderimi, aktif mesaj listesi seçimi */

const curMsgs=()=>S.phase==='game'?$('#gMsgs'):$('#lbMsgs');

function chatRow(list,msg){
  const d=document.createElement('div');d.className='msg'+(msg.sys?' sys':'');
  d.innerHTML=msg.sys?('<i>'+esc(msg.m)+'</i>')
    :('<b style="color:'+COLORS[clamp(msg.ci,0,9)].c+'">'+esc(msg.n)+'</b>'+esc(msg.m));
  list.appendChild(d);list.scrollTop=1e6;while(list.children.length>60)list.firstChild.remove();}
function sysChat(m){chatRow($('#lbMsgs'),{sys:true,m});chatRow($('#gMsgs'),{sys:true,m});chatRow($('#mtMsgs'),{sys:true,m})}
function sendChat(inp){
  const m=inp.value.trim();if(!m)return;inp.value='';
  const msg={n:sanitize(prefs.name),ci:prefs.ci,m:m.slice(0,120)};
  chatRow(curMsgs(),msg);
  if(meeting)chatRow($('#mtMsgs'),msg);
  sfx.chat();
  // Mesaj sunucuya gider, sunucu herkese kendi kaydından isim/renkle yayar.
  if(S.mode==='online')sendMsg({t:'c',m:msg.m});}
