'use strict';
/* audio.js — WebAudio ile prosedürel ses efektleri (dosya yok, hepsi sentezleniyor) */

let AC=null;
const ac=()=>AC||(AC=new(window.AudioContext||window.webkitAudioContext)());
function tone(f,dur=.08,type='square',vol=.1,delay=0){
  if(prefs.muted)return;try{const c=ac(),o=c.createOscillator(),g=c.createGain(),t0=c.currentTime+delay;
  o.type=type;o.frequency.value=f;g.gain.setValueAtTime(vol,t0);
  g.gain.exponentialRampToValueAtTime(.001,t0+dur);o.connect(g).connect(c.destination);o.start(t0);o.stop(t0+dur+.02);}catch(e){}}
const sfx={
  click:()=>tone(620,.06,'square',.06),join:()=>{tone(520,.07);tone(780,.09,'square',.08,.07)},
  chat:()=>tone(880,.05,'sine',.06),err:()=>tone(160,.18,'sawtooth',.08),
  crew:()=>[523,659,784].forEach((f,i)=>tone(f,.22,'triangle',.09,i*.12)),
  imp:()=>{tone(150,.5,'sawtooth',.11);tone(110,.6,'sawtooth',.09,.12)},
  kill:()=>{tone(180,.15,'sawtooth',.15);tone(120,.2,'sawtooth',.12,.08);tone(80,.3,'sawtooth',.1,.15)},
  /* Silah sesi: kısa, kuru ve üstüne güçlü — vuruş animasyonunun başında */
  gun:()=>{tone(1200,.045,'square',.1);tone(320,.08,'sawtooth',.09,.03);tone(90,.11,'square',.07,.06)},
  death:()=>{tone(200,.3,'sawtooth',.12);tone(150,.4,'sawtooth',.1,.1);tone(100,.5,'sawtooth',.08,.2)},
  win:()=>[523,659,784,1047].forEach((f,i)=>tone(f,.3,'triangle',.1,i*.15)),
  lose:()=>[400,350,300,250].forEach((f,i)=>tone(f,.4,'sawtooth',.1,i*.2)),
  /* Toplantı: hoparlör sesi — üç vuruş */
  meet:()=>{tone(392,.14,'square',.1);tone(392,.14,'square',.1,.2);tone(294,.3,'square',.12,.4)},
  /* Ceset rapor edildi */
  report:()=>{tone(660,.08,'square',.09);tone(880,.1,'square',.09,.09);tone(1180,.16,'square',.08,.18)},
  /* Oy kullanıldı */
  vote:()=>tone(740,.07,'square',.07),
  /* Uzaya atılma: rüzgâr + patlama */
  eject:()=>{for(let i=0;i<7;i++)tone(180+i*90,.5,'sine',.05,i*.07);
    tone(70,.7,'sawtooth',.12,.55)},
};
function setSnd(){[$('#sndBtn'),$('#sndBtn2')].forEach(b=>b.textContent=prefs.muted?'🔇':'🔊')}
