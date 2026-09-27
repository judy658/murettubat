'use strict';
/* core.js — yardımcı fonksiyonlar, renk paleti, tercih saklama, ekran/toast yardımcıları */

const $=s=>document.querySelector(s);
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,t)=>a+(b-a)*t;
const rand=(a,b)=>a+Math.random()*(b-a);
const pick=a=>a[Math.floor(Math.random()*a.length)];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sanitize=s=>esc(String(s||'').replace(/[<>\r\n]/g,'').trim().slice(0,12))||'Oyuncu';

const COLORS=[
  {n:'Kırmızı',c:'#C51111',d:'#7A0B0B'},{n:'Mavi',c:'#132ED1',d:'#0C1D85'},
  {n:'Yeşil',c:'#117F2D',d:'#0A5120'},{n:'Pembe',c:'#ED54BA',d:'#A52B80'},
  {n:'Turuncu',c:'#EF7D0D',d:'#A8570A'},{n:'Sarı',c:'#F5F557',d:'#A8A82C'},
  {n:'Siyah',c:'#3F474E',d:'#1F2429'},{n:'Beyaz',c:'#D6E0F0',d:'#8E9BB4'},
  {n:'Mor',c:'#6B2FBB',d:'#451E7A'},{n:'Fıstık',c:'#50EF39',d:'#2FA322'}];

let prefs={name:'Oyuncu',ci:0,muted:false};
try{Object.assign(prefs,JSON.parse(localStorage.getItem('murettubat_v1')||'{}'))}catch(e){}
const savePrefs=()=>{try{localStorage.setItem('murettubat_v1',JSON.stringify(prefs))}catch(e){}};

function toast(m,type){const d=document.createElement('div');d.className='toast'+(type?' '+type:'');
  d.textContent=m;$('#toasts').appendChild(d);
  setTimeout(()=>{d.style.transition='opacity .3s';d.style.opacity=0;setTimeout(()=>d.remove(),350)},2600)}
function show(id){document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('on',s.id===id))}
function guardBtn(btn,fn){let arm=false;btn.addEventListener('click',()=>{
  if(!arm){arm=true;const t=btn.textContent;btn.textContent='EMİN MİSİN?';sfx.click();
    setTimeout(()=>{arm=false;btn.textContent=t},2000);return}arm=false;fn();});}
