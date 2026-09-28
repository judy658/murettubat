'use strict';
/* state.js — oyunun paylaşılan durumu (modüller arası tek gerçek kaynak) */

const S={phase:'menu',mode:null};   // mode: null | 'online' | 'solo'
let myId=null,roomCode=null,started=false,LB=null;
const players=new Map(),roles=new Map();
let controls=false,joining=false,leaving=false,lastRoom=null,lastSend=0,T=0;
const cam={x:190,y:150};let vw=innerWidth,vh=innerHeight,dpr=1;const view={sc:1};

const KILL_RANGE=60;
const KILL_COOLDOWN=25;
let killCooldown=0;
let gameOver=false;
/* Raporlama / toplantı durumu (js/meeting.js kullanır) */
let meeting=null;      // etkin toplantı: {reporter,victim,endsAt,players[],myVote}
let ejecting=false;    // uzaya atma animasyonu oynuyor

const ME=()=>players.get(myId);
/* Lobi verisinden "bu oyuncu host mu" bilgisi */
const isHost=()=>!!(LB&&LB.ps&&(LB.ps.find(p=>p.id===myId)||{}).h);
const isImpostor=()=>roles.get(myId)==='impostor';
