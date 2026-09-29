'use strict';
/* deathfx.js — ölüm animasyonu: sahtekâr kurbanı vurur, sonra ceset düşer.
 *
   Saf GÖRSEL katman. Oyun durumu (dead, killCooldown, cooldown) burada
   HİÇ değişmez: sunucu/solo mantığı ölümü bildirdiği anda p.dead=true
   olur. Burada yalnızca "vurulma anı" görünür kılınır — animasyon
   bitince kurban normal drawBean(dead) ile ceset olarak çizilir.
 *
   Akış (Among Us): namlu ateşi → mermi kat eder → kırmızı patlama →
   kurban kırmızıya döner (flash) → ceset düşer. */

const DEATH_FX_DUR=0.85;   // toplam süre (sn)
const DEATH_FX_FLY=0.12;   // merminin kat etme süresi (sn)
const deathFx=[];          // aktif animasyonlar: {k,v,x,y,kx,ky,t0,seed}

/** Bu oyuncu için o an bir ölüm animasyonu varsa onu döndürür. */
function deathFxFor(id){
  for(const f of deathFx)if(f.v===id)return f;
  return null;
}

/** Ölüm animasyonunu başlatır. Geçersiz konum verilirse false döner
    (çağıran taraf bu durumda eski davranışa düşmelidir). */
function startDeathFx(killerId,victimId,kx,ky,vx,vy){
  if(!Number.isFinite(kx)||!Number.isFinite(ky)||!Number.isFinite(vx)||!Number.isFinite(vy))return false;
  /* Katil vuruş anında kurbana dönsün: gözlemciler için silahın nereden
     çıktığı belli olsun. Kendi istemcimizde fare nişanı zaten üstüne
     yazar, bir sonraki karede eski yöne döner. */
  const k=players.get(killerId);
  if(k){k.angle=Math.atan2(vy-ky,vx-kx);k.dir=Math.cos(k.angle)>=0?1:-1}
  deathFx.push({k:killerId,v:victimId,x:vx,y:vy,kx,ky,t0:T,seed:Math.random()*6.28});
  sfx.gun();
  /* Kurbanın kendi ekranında ölüm ekranı tam ekran bir katman; hemen
     açılırsa vuruşu gizler. Bu yüzden bir miktar geciktirilir. */
  if(victimId===myId)setTimeout(showDeathScreen,DEATH_FX_DUR*1000+60);
  return true;
}

function clearDeathFx(){deathFx.length=0}

/* Süre dolanları at. T'ye (animasyon saati) bakar, biriktirici saymaz;
   sekme kare kaçırsa bile animasyon doğru yerde biter. */
function updateDeathFx(){
  for(let i=deathFx.length-1;i>=0;i--)if(T-deathFx[i].t0>DEATH_FX_DUR)deathFx.splice(i,1);
}

/* Vurulma anındaki kurban: AYAKTA durur ve kırmızıya döner.
   drawBean(dead) değil — ceset ancak animasyon bitince çizilir. */
function drawDeathVictim(g,p,fx){
  drawBean(g,p.x,p.y,1,p.ci,p.dir,false,T+(p.bob||0),false);
  const e=T-fx.t0-DEATH_FX_FLY;          // vuruştan beri geçen süre
  if(e<0)return;
  const f=Math.min(1,e/.28);
  g.save();
  g.translate(p.x,p.y);
  g.globalAlpha=(1-f)*.85;
  g.fillStyle='#ff2b3d';
  /* drawBean'in gövde/vizör geometrisinin AYNISI: flaş karakterin
     siluetine tam oturur. (drawBean: w=14.5, h=33, vizör y=-h*.62) */
  rr(g,-14.5,-33,29,33,12);g.fill();
  g.beginPath();g.ellipse(p.dir*6,-20.5,9.5,6.5,0,0,7);g.fill();
  g.restore();
}

/* Namlu ateşi + mermi + vuruş patlaması. Kurbanın ÜSTÜNE çizilir. */
function drawDeathFx(g){
  for(const f of deathFx){
    const e=T-f.t0;
    const ang=Math.atan2(f.y-f.ky,f.x-f.kx);
    const mx=f.kx+Math.cos(ang)*19,my=f.ky+Math.sin(ang)*19;  // namlu ağzı
    const ix=f.x,iy=f.y-16;                                   // gövdeye isabet
    /* 1) TABANCA + namlu ateşi */
    if(e<0.16){
      g.save();g.translate(f.kx,f.ky);g.rotate(ang);
      g.fillStyle='#333c52';g.strokeStyle='#0a1120';g.lineWidth=1.5;
      rr(g,2,-3,16,6,2);g.fill();g.stroke();
      g.restore();
      if(e<0.09){
        const k=1-e/0.09;
        g.save();g.globalCompositeOperation='lighter';
        g.fillStyle=`rgba(255,228,140,${.85*k})`;
        g.beginPath();g.arc(mx,my,4+6*k,0,7);g.fill();
        g.restore();
      }
    }
    /* 2) MERMİ: namludan kurbana */
    if(e<DEATH_FX_FLY){
      const t=e/DEATH_FX_FLY;
      const bx=mx+(ix-mx)*t,by=my+(iy-my)*t;
      g.save();g.globalCompositeOperation='lighter';
      g.strokeStyle='rgba(255,214,110,.55)';g.lineWidth=2.4;
      g.beginPath();g.moveTo(bx-Math.cos(ang)*11,by-Math.sin(ang)*11);g.lineTo(bx,by);g.stroke();
      g.fillStyle='#fff6cf';g.beginPath();g.arc(bx,by,2.6,0,7);g.fill();
      g.restore();
    }
    /* 3) İSABET: dağılan kırmızı parçacıklar */
    if(e>=DEATH_FX_FLY){
      const t=(e-DEATH_FX_FLY)/.32;
      if(t<1){
        g.save();
        g.fillStyle='#ff2b3d';
        for(let i=0;i<9;i++){
          const a=f.seed+i*.7,d=6+t*26;
          g.globalAlpha=1-t;
          g.beginPath();g.arc(ix+Math.cos(a)*d,iy+Math.sin(a)*d,3.4*(1-t),0,7);g.fill();
        }
        g.globalAlpha=(1-t)*.45;g.fillStyle='#ff6b78';
        g.beginPath();g.arc(ix,iy,10+t*16,0,7);g.fill();
        g.restore();
      }
    }
  }
}
