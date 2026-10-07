// ==================== COMPATIBILIDADE E DEPURAÇÃO ====================
// roundRect não existe em navegadores mais antigos: cria uma versão equivalente.
if (typeof CanvasRenderingContext2D !== "undefined" && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    if (typeof r === "object" && r !== null) r = r[0] || 0;
    r = Math.min(r || 0, w / 2, h / 2);
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
    return this;
  };
}

// Se algum erro de JavaScript ocorrer, mostra a mensagem na tela (em vez de só ficar azul).
function showFatal(msg) {
  let box = document.getElementById("fatal-error");
  if (!box) {
    box = document.createElement("pre");
    box.id = "fatal-error";
    box.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;z-index:99;margin:0;padding:12px;" +
      "background:#300;color:#ffb4b4;font:12px/1.4 monospace;white-space:pre-wrap;border-radius:8px;" +
      "border:1px solid #f66;user-select:text;-webkit-user-select:text";
    document.body.appendChild(box);
  }
  box.textContent = "Erro no jogo: " + msg;
}
window.addEventListener("error", e => showFatal(`${e.message} (${(e.filename || "").split("/").pop()}:${e.lineno})`));
window.addEventListener("unhandledrejection", e => showFatal(String(e.reason)));

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height;

// ==================== SINTETIZADOR DE ÁUDIO WEB AUDIO API ====================
class SoundFX {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  }

  tone(type, f0, f1, dur, vol = 0.25, delay = 0) {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, now);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), now + dur);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.linearRampToValueAtTime(0.01, now + dur);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + dur);
  }

  playJump() { this.tone("sine", 160, 480, 0.12, 0.2); }
  playSuperJump() { this.tone("sine", 200, 900, 0.22, 0.25); this.tone("triangle", 400, 1200, 0.2, 0.15, 0.04); }
  playCoin() { this.tone("triangle", 987.77, 987.77, 0.08, 0.25); this.tone("triangle", 1318.51, 1318.51, 0.18, 0.25, 0.08); }
  playStomp() { this.tone("square", 220, 40, 0.15, 0.3); }
  playHurt() { this.tone("sawtooth", 180, 60, 0.25, 0.3); }
  playShieldHit() { this.tone("triangle", 800, 300, 0.2, 0.3); this.tone("sine", 1200, 600, 0.15, 0.2, 0.05); }
  playTip() { this.tone("sine", 880, 880, 0.12, 0.2); this.tone("sine", 1174.66, 1174.66, 0.2, 0.2, 0.1); }
  playHorn() { this.tone("square", 330, 330, 0.35, 0.12); this.tone("square", 415, 415, 0.35, 0.12); }
  playPower() {
    [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone("triangle", f, f, 0.14, 0.22, i * 0.06));
  }
  playPowerEnd() { this.tone("sine", 500, 250, 0.2, 0.15); }
  playWin() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone("triangle", f, f, 0.2, 0.25, i * 0.1));
  }
}

const sound = new SoundFX();

// ==================== CARREGAMENTO DE ASSETS ====================
const ASSET = "assets/actions/";
const ANIMS = {
  idle: ["idle_01.png", "idle_02.png"],
  run: ["run_01.png", "run_02.png", "run_03.png", "run_04.png", "run_05.png", "run_06.png"],
  jump: ["jump_01.png", "jump_02.png"],
  pulo: ["pulo_01.png", "pulo_02.png", "pulo_03.png", "pulo_04.png", "pulo_05.png", "pulo_06.png"],
  wave: ["wave_01.png", "wave_02.png", "wave_03.png", "wave_04.png"],
  crouch: ["crouch_01.png", "crouch_02.png", "crouch_03.png", "crouch_04.png"],
  damage: ["damage_01.png", "damage_02.png", "damage_03.png"],
  left: ["left_01.png", "left_02.png", "left_03.png"],
  right: ["right_01.png", "right_02.png", "right_03.png"]
};

const img = {};
for (const list of Object.values(ANIMS)) {
  for (const n of list) {
    if (!img[n]) {
      img[n] = new Image();
      img[n].src = ASSET + n;
    }
  }
}

// ==================== ESTADOS E CONTROLES ====================
const STATES = { MENU: 0, PLAYING: 1, PAUSED: 2, GAMEOVER: 3, WIN: 4 };
let gameState = STATES.MENU;

const keys = { left: false, right: false, down: false, jump: false, action: false };
const pressed = { jump: false, action: false };

function triggerAudioInit() { sound.init(); }

window.addEventListener("keydown", e => {
  triggerAudioInit();
  if (["ArrowLeft", "ArrowRight", "ArrowDown", "Space"].includes(e.code)) e.preventDefault();

  if (e.code === "ArrowLeft" || e.code === "KeyA") keys.left = true;
  if (e.code === "ArrowRight" || e.code === "KeyD") keys.right = true;
  if (e.code === "ArrowDown" || e.code === "KeyS") keys.down = true;

  if (e.code === "Space" || e.code === "KeyZ") {
    if (!keys.jump) pressed.jump = true;
    keys.jump = true;
  }
  if (e.code === "KeyX") {
    if (!keys.action) pressed.action = true;
    keys.action = true;
  }
  if (e.code === "KeyP") {
    if (gameState === STATES.PLAYING) gameState = STATES.PAUSED;
    else if (gameState === STATES.PAUSED) gameState = STATES.PLAYING;
  }
  if (e.code === "KeyR") reset();
});

window.addEventListener("keyup", e => {
  if (e.code === "ArrowLeft" || e.code === "KeyA") keys.left = false;
  if (e.code === "ArrowRight" || e.code === "KeyD") keys.right = false;
  if (e.code === "ArrowDown" || e.code === "KeyS") keys.down = false;
  if (e.code === "Space" || e.code === "KeyZ") keys.jump = false;
  if (e.code === "KeyX") keys.action = false;
});

// Suporte Multi-Touch
document.querySelectorAll("[data-key]").forEach(btn => {
  const k = btn.dataset.key;
  const down = e => {
    e.preventDefault();
    triggerAudioInit();
    if (k === "jump") { if (!keys.jump) pressed.jump = true; keys.jump = true; }
    else if (k === "action") { if (!keys.action) pressed.action = true; keys.action = true; }
    else { keys[k] = true; }
  };
  const up = e => { e.preventDefault(); keys[k] = false; };
  btn.addEventListener("pointerdown", down);
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointercancel", up);
  btn.addEventListener("pointerleave", up);
});

// Toque no canvas para iniciar / reiniciar
canvas.addEventListener("pointerdown", () => {
  triggerAudioInit();
  if (gameState === STATES.MENU || gameState === STATES.GAMEOVER || gameState === STATES.WIN) reset();
});

const soundBtn = document.getElementById("sound-toggle");
if (soundBtn) {
  soundBtn.addEventListener("click", () => {
    sound.enabled = !sound.enabled;
    soundBtn.innerText = sound.enabled ? "🔊" : "🔇";
  });
}

// ==================== ESTRUTURA DO MUNDO ====================
// Plataformas = calçadas / blocos de rua
const platforms = [
  { x: -200, y: 455, w: 620, h: 85 }, { x: 500, y: 405, w: 240, h: 135 }, { x: 820, y: 330, w: 230, h: 210 },
  { x: 1130, y: 405, w: 280, h: 135 }, { x: 1490, y: 350, w: 250, h: 190 }, { x: 1800, y: 430, w: 400, h: 110 },
  { x: 2270, y: 360, w: 270, h: 180 }, { x: 2600, y: 430, w: 480, h: 110 },
];

// Bueiros abertos nos vãos (queda = dano + volta ao último ponto seguro)
const manholes = [
  { x: 430, y: 500, w: 60, h: 40 }, { x: 750, y: 500, w: 60, h: 40 }, { x: 1060, y: 500, w: 60, h: 40 },
  { x: 1420, y: 500, w: 60, h: 40 }, { x: 1750, y: 500, w: 40, h: 40 }, { x: 2210, y: 500, w: 50, h: 40 },
  { x: 2550, y: 500, w: 40, h: 40 }
];

// Obstáculos reais sobre as calçadas
const obstacles = [
  { kind: "phone", x: 250, y: 455 - 50, w: 30, h: 50 },
  { kind: "cone", x: 960, y: 330 - 36, w: 28, h: 36 },
  { kind: "phone", x: 1560, y: 350 - 50, w: 30, h: 50 },
  { kind: "phone", x: 2330, y: 360 - 50, w: 30, h: 50 },
  { kind: "cone", x: 2630, y: 430 - 36, w: 28, h: 36 },
];

const OBSTACLE_TIPS = {
  phone: "Celular distrai! Guarde-o antes de atravessar a rua.",
  cone: "Respeite a sinalização: cones indicam perigo ou obra.",
  manhole: "Bueiro aberto! Olhe por onde anda.",
  ped: "Pedestre distraído com o celular quase te derrubou!",
  bike: "Divida o espaço com ciclistas: olhe antes de andar.",
  car: "Só atravesse com o semáforo de pedestres VERDE!"
};

const coins = [
  { x: 540, y: 350 }, { x: 600, y: 315 }, { x: 660, y: 350 }, { x: 930, y: 275 }, { x: 1000, y: 235 }, { x: 1070, y: 275 },
  { x: 1210, y: 350 }, { x: 1280, y: 310 }, { x: 1350, y: 350 }, { x: 1540, y: 295 }, { x: 1620, y: 260 }, { x: 1690, y: 295 },
  { x: 1910, y: 375 }, { x: 1980, y: 335 }, { x: 2050, y: 375 }, { x: 2350, y: 305 }, { x: 2430, y: 270 }, { x: 2510, y: 305 },
  // Moedas bônus no alto (precisam do super pulo)
  { x: 2330, y: 160 }, { x: 2400, y: 140 }, { x: 2470, y: 160 }
].map((c, i) => ({ ...c, r: 10, got: false, phase: i * 0.4 }));

// Pedestres distraídos e ciclistas
const enemies = [
  { kind: "ped", x0: 620, x: 620, y: 405 - 44, w: 44, h: 44, v: 55, min: 540, max: 690, alive: true },
  { kind: "bike", x0: 1200, x: 1200, y: 405 - 44, w: 50, h: 44, v: 90, min: 1140, max: 1360, alive: true },
  { kind: "ped", x0: 1600, x: 1600, y: 350 - 44, w: 44, h: 44, v: 50, min: 1620, max: 1690, alive: true },
  { kind: "ped", x0: 1880, x: 1880, y: 430 - 44, w: 44, h: 44, v: 60, min: 1820, max: 2100, alive: true },
  { kind: "bike", x0: 2000, x: 2000, y: 430 - 44, w: 50, h: 44, v: 110, min: 1900, max: 2140, alive: true }
];

// Placas educativas coletáveis
const signs = [
  { x: 330, y: 395, icon: "🛑", tip: "PARE: olhe para os dois lados antes de atravessar." },
  { x: 880, y: 285, icon: "🚸", tip: "Use sempre a faixa de pedestres para atravessar." },
  { x: 2130, y: 380, icon: "📵", tip: "Celular e rua não combinam: guarde-o antes de atravessar!" },
  { x: 2650, y: 370, icon: "🚦", tip: "Atravesse só quando o semáforo de pedestres estiver verde." }
].map((s, i) => ({ ...s, got: false, phase: i }));

// Poderes
const POWERS = {
  grow: { icon: "🦺", color: "#ffd43b", name: "Colete refletivo", dur: 12, tip: "Colete refletivo: você fica mais visível e mais forte!" },
  shield: { icon: "🪖", color: "#56c8f7", name: "Capacete", dur: 14, tip: "Capacete: proteção que salva vidas!" },
  jump: { icon: "👟", color: "#ff7a45", name: "Tênis de impulso", dur: 14, tip: "Calçado adequado dá firmeza e impulso: super pulo!" }
};
const powerups = [
  { type: "grow", x: 700, y: 355 },
  { type: "shield", x: 1390, y: 355 },
  { type: "jump", x: 1950, y: 335 },
  { type: "shield", x: 2560, y: 310 }
].map((u, i) => ({ ...u, got: false, phase: i * 0.7 }));

// Faixa de pedestres + semáforo
const CROSS = { x: 2700, w: 200, y: 430 };
const LIGHT = { green: 5.5, yellow: 1.3, red: 4.2 };
const LIGHT_CYCLE = LIGHT.green + LIGHT.yellow + LIGHT.red;
const CAR_LANE_START = 2400, CAR_LANE_END = 3150;
let cars = [];
let lastPhase = "green";

function lightPhase() {
  const t = time % LIGHT_CYCLE;
  if (t < LIGHT.green) return "green";
  if (t < LIGHT.green + LIGHT.yellow) return "yellow";
  return "red";
}

const goal = { x: 3020, y: 320, w: 48, h: 110 };

// Efeitos de Game Feel
let particles = [];
let floatingTexts = [];
let screenShake = 0;
let tip = { text: "", t: 0 };
let learned = 0;

let cameraX = 0;
let time = 0;
let best = Number(localStorage.getItem("coninhoBest") || 0);

const BASE_W = 68, BASE_H = 105;
const p = {
  x: 100, y: 320, w: BASE_W, h: BASE_H,
  vx: 0, vy: 0, speed: 280,
  grounded: false, coyote: 0, jumps: 0,
  lives: 3, coins: 0, inv: 0, hurt: 0, wave: 0,
  facing: 1, scaleX: 1, scaleY: 1,
  big: 0, shield: 0, superJump: 0,
  safeX: 100, safeY: 320
};

function showTip(text, dur = 4) { tip = { text, t: dur, max: dur }; }

function setBig(on) {
  const nw = on ? BASE_W * 1.4 : BASE_W;
  const nh = on ? BASE_H * 1.4 : BASE_H;
  p.x -= (nw - p.w) / 2;
  p.y -= (nh - p.h);
  p.w = nw; p.h = nh;
}

function reset() {
  setBig(false);
  Object.assign(p, {
    x: 100, y: 320, vx: 0, vy: 0, lives: 3, coins: 0, inv: 0, hurt: 0, wave: 0,
    facing: 1, grounded: false, coyote: 0, jumps: 0, scaleX: 1, scaleY: 1,
    big: 0, shield: 0, superJump: 0, safeX: 100, safeY: 320
  });
  cameraX = 0; time = 0; screenShake = 0; particles = []; floatingTexts = [];
  tip = { text: "", t: 0 }; learned = 0; cars = []; lastPhase = "green";
  gameState = STATES.PLAYING;
  coins.forEach(c => c.got = false);
  signs.forEach(s => s.got = false);
  powerups.forEach(u => u.got = false);
  enemies.forEach(e => Object.assign(e, { alive: true, x: e.x0, v: Math.abs(e.v) }));
  showTip("Chegue em segurança à escola! Colete as placas e use os poderes.", 4);
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function mod(v, m) { return ((v % m) + m) % m; }

function spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    particles.push({ x, y, vx: (Math.random() - 0.5) * 320, vy: (Math.random() - 1) * 280, life: 1, color });
  }
}

function spawnText(x, y, text, color) {
  floatingTexts.push({ x, y, text, color, life: 1 });
}

function currentAnim() {
  if (p.hurt > 0) return "damage";

  if (p.wave > 0) return "idle";

  if (keys.down && p.grounded) return "idle";

  if (!p.grounded) return "jump";

  if (Math.abs(p.vx) > 25) return "idle";

  return "idle";
}

function frameFor(anim) {
  const list = ANIMS[anim];
  const speed = { idle: 3, run: 15, pulo: 10, wave: 7, crouch: 7, damage: 10, left: 5, right: 5 }[anim] || 7;
  return list[Math.floor(time * speed) % list.length];
}

// ==================== RENDERIZAÇÃO DA CENA ====================
function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#56c8f7"); g.addColorStop(1, "#e4f6ff");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // Nuvens
  ctx.globalAlpha = 0.5; ctx.fillStyle = "#fff";
  for (let i = 0; i < 7; i++) {
    const x = mod(i * 230 - cameraX * 0.1, 1300) - 150;
    const y = 55 + (i % 3) * 48;
    ctx.beginPath();
    ctx.arc(x, y, 30, 0, Math.PI * 2); ctx.arc(x + 35, y - 10, 42, 0, Math.PI * 2); ctx.arc(x + 78, y, 28, 0, Math.PI * 2);
    ctx.fill();
  }

  // Prédios da cidade (parallax)
  const cols = ["#7fa6c4", "#6f95b3", "#8fb2cc", "#6489a6"];
  for (let i = 0; i < 12; i++) {
    const x = mod(i * 140 - cameraX * 0.25, 1680) - 160;
    const h = 130 + ((i * 37) % 5) * 32;
    const bw = 100;
    ctx.globalAlpha = 0.55; ctx.fillStyle = cols[i % 4];
    ctx.fillRect(x, H - 110 - h, bw, h);
    ctx.globalAlpha = 0.5; ctx.fillStyle = "#e9f6ff";
    for (let wy = H - 100 - h; wy < H - 130; wy += 26) {
      for (let wx = x + 12; wx < x + bw - 16; wx += 24) ctx.fillRect(wx, wy, 11, 14);
    }
  }
  ctx.globalAlpha = 1;
}

function drawPlatform(r) {
  const x = r.x - cameraX;
  if (x + r.w < 0 || x > W) return;
  // Asfalto/concreto por baixo
  ctx.fillStyle = "#3f4651"; ctx.fillRect(x, r.y, r.w, r.h);
  ctx.fillStyle = "#4d5561"; ctx.fillRect(x, r.y + 18, r.w, r.h - 18);
  ctx.fillStyle = "#59616e";
  for (let i = 12; i < r.w - 20; i += 56) ctx.fillRect(x + i, r.y + 34, 30, 4);
  // Calçada
  ctx.fillStyle = "#c9d0d8"; ctx.fillRect(x, r.y, r.w, 14);
  ctx.fillStyle = "#e7ecf1"; ctx.fillRect(x, r.y, r.w, 5);
  ctx.fillStyle = "#98a2ad"; ctx.fillRect(x, r.y + 14, r.w, 4);
  // Piso tátil amarelo
  ctx.fillStyle = "#f2c230";
  for (let i = 6; i < r.w - 12; i += 40) ctx.fillRect(x + i, r.y + 5, 16, 4);
}

function drawCrosswalk() {
  const x = CROSS.x - cameraX;
  if (x + CROSS.w < 0 || x > W) return;
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < CROSS.w; i += 28) ctx.fillRect(x + i, CROSS.y, 16, 14);
  ctx.font = "700 12px system-ui"; ctx.textAlign = "center";
  ctx.fillStyle = "#fff"; ctx.fillText("FAIXA DE PEDESTRES", x + CROSS.w / 2, CROSS.y - 8);
  ctx.textAlign = "left";
}

function drawTrafficLight(worldX) {
  const x = worldX - cameraX;
  if (x < -50 || x > W + 50) return;
  const phase = lightPhase();
  ctx.fillStyle = "#2a2f38"; ctx.fillRect(x - 3, CROSS.y - 130, 6, 130);
  ctx.fillStyle = "#171b22"; ctx.beginPath(); ctx.roundRect(x - 15, CROSS.y - 175, 30, 52, 6); ctx.fill();
  const lamps = [["red", "#ff3b3b", CROSS.y - 160], ["yellow", "#ffd43b", CROSS.y - 148], ["green", "#3dde6b", CROSS.y - 136]];
  lamps.forEach(([n, c, y]) => {
    ctx.fillStyle = n === phase ? c : "#33373f";
    if (n === phase) { ctx.shadowColor = c; ctx.shadowBlur = 14; }
    ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  });
}

function drawManhole(m) {
  const x = m.x - cameraX;
  if (x + m.w < 0 || x > W) return;
  ctx.fillStyle = "#0b0d11"; ctx.fillRect(x, m.y, m.w, m.h);
  ctx.fillStyle = "#555d69"; ctx.fillRect(x, m.y, m.w, 5);
  // Barra de aviso
  ctx.fillStyle = "#ffcf33";
  for (let i = 0; i < m.w; i += 16) ctx.fillRect(x + i, m.y + 5, 8, 5);
}

function drawObstacle(o) {
  const x = o.x - cameraX;
  if (x + o.w < 0 || x > W) return;
  if (o.kind === "phone") {
    ctx.fillStyle = "#14171d"; ctx.beginPath(); ctx.roundRect(x, o.y, o.w, o.h, 5); ctx.fill();
    const flick = 0.75 + Math.sin(time * 8) * 0.25;
    ctx.fillStyle = `rgba(86,200,247,${flick})`; ctx.fillRect(x + 3, o.y + 5, o.w - 6, o.h - 14);
    ctx.fillStyle = "#fff"; ctx.fillRect(x + 6, o.y + 10, o.w - 12, 4); ctx.fillRect(x + 6, o.y + 18, o.w - 18, 4);
    ctx.fillStyle = "#e94343"; ctx.beginPath(); ctx.arc(x + o.w - 3, o.y + 4, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = "800 9px system-ui"; ctx.textAlign = "center";
    ctx.fillText("!", x + o.w - 3, o.y + 7); ctx.textAlign = "left";
  } else if (o.kind === "cone") {
    ctx.fillStyle = "#e5e9ee"; ctx.fillRect(x - 2, o.y + o.h - 5, o.w + 4, 5);
    ctx.fillStyle = "#ff6a1f";
    ctx.beginPath(); ctx.moveTo(x + 3, o.y + o.h - 5); ctx.lineTo(x + o.w / 2, o.y); ctx.lineTo(x + o.w - 3, o.y + o.h - 5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillRect(x + 7, o.y + 15, o.w - 14, 6);
  }
}

function drawCoin(c) {
  if (c.got) return;
  const x = c.x - cameraX;
  const y = c.y + Math.sin(time * 5 + c.phase) * 5;
  ctx.fillStyle = "#ffbd1a"; ctx.strokeStyle = "#d88700"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(x, y, 10, 14, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#ffe77a"; ctx.fillRect(x - 2, y - 8, 3, 16);
}

function drawBadge(x, y, icon, color, r) {
  ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.strokeStyle = color; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.font = `${Math.round(r * 1.15)}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#000"; ctx.fillText(icon, x, y + 1);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
}

function drawSign(s) {
  if (s.got) return;
  const x = s.x - cameraX;
  if (x < -40 || x > W + 40) return;
  const y = s.y + Math.sin(time * 3 + s.phase) * 4;
  drawBadge(x, y, s.icon, "#1a64c8", 22);
}

function drawPowerup(u) {
  if (u.got) return;
  const x = u.x - cameraX;
  if (x < -40 || x > W + 40) return;
  const def = POWERS[u.type];
  const y = u.y + Math.sin(time * 4 + u.phase) * 6;
  ctx.globalAlpha = 0.35 + Math.sin(time * 6) * 0.15;
  ctx.fillStyle = def.color; ctx.beginPath(); ctx.arc(x, y, 34, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  drawBadge(x, y, def.icon, def.color, 24);
}

function drawEnemy(e) {
  if (!e.alive) return;
  const x = e.x - cameraX, y = e.y;
  if (x + e.w < 0 || x > W) return;
  const dir = e.v >= 0 ? 1 : -1;
  const bob = Math.sin(time * 12) * 2;

  if (e.kind === "ped") {
    ctx.fillStyle = "#2b3b5c"; ctx.fillRect(x + 12, y + 30 + bob * 0.3, 8, 14); ctx.fillRect(x + 24, y + 30 - bob * 0.3, 8, 14);
    ctx.fillStyle = "#e0903a"; ctx.fillRect(x + 8, y + 12, 28, 22);
    ctx.fillStyle = "#f2c9a0"; ctx.beginPath(); ctx.arc(x + 22, y + 8 + bob * 0.4, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#4a2d1a"; ctx.fillRect(x + 14, y, 16, 5);
    // celular na mão (cabeça baixa)
    ctx.fillStyle = "#14171d"; ctx.fillRect(x + (dir > 0 ? 34 : 4), y + 18, 7, 12);
    ctx.fillStyle = "#56c8f7"; ctx.fillRect(x + (dir > 0 ? 35 : 5), y + 20, 5, 8);
    ctx.fillStyle = "#e94343"; ctx.font = "800 13px system-ui"; ctx.fillText("!", x + 19, y - 4);
  } else {
    // ciclista
    ctx.strokeStyle = "#191d24"; ctx.lineWidth = 3;
    const spin = time * 14;
    [x + 9, x + 40].forEach(cx => {
      ctx.beginPath(); ctx.arc(cx, y + 34, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, y + 34); ctx.lineTo(cx + Math.cos(spin) * 8, y + 34 + Math.sin(spin) * 8); ctx.stroke();
    });
    ctx.strokeStyle = "#e94343"; ctx.beginPath();
    ctx.moveTo(x + 9, y + 34); ctx.lineTo(x + 24, y + 22); ctx.lineTo(x + 40, y + 34); ctx.moveTo(x + 24, y + 22); ctx.lineTo(x + 20, y + 34); ctx.stroke();
    ctx.fillStyle = "#3d8f4a"; ctx.fillRect(x + 18, y + 6, 14, 16);
    ctx.fillStyle = "#f2c9a0"; ctx.beginPath(); ctx.arc(x + 25, y + 2, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffd43b"; ctx.beginPath(); ctx.arc(x + 25, y, 7, Math.PI, 0); ctx.fill();
  }
}

function drawCar(c) {
  const x = c.x - cameraX;
  const alpha = clamp((c.x - CAR_LANE_START) / 120, 0, 1);
  if (alpha <= 0 || x + 130 < 0 || x > W) return;
  const y = CROSS.y - 54;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = c.color; ctx.beginPath(); ctx.roundRect(x, y + 14, 120, 34, 8); ctx.fill();
  ctx.beginPath(); ctx.roundRect(x + 24, y, 66, 24, 8); ctx.fill();
  ctx.fillStyle = "#bfe6ff"; ctx.fillRect(x + 30, y + 5, 25, 15); ctx.fillRect(x + 59, y + 5, 25, 15);
  ctx.fillStyle = "#ffeb8a"; ctx.fillRect(x + 112, y + 24, 8, 8);
  ctx.fillStyle = "#171b22";
  [x + 26, x + 94].forEach(cx => { ctx.beginPath(); ctx.arc(cx, y + 48, 11, 0, Math.PI * 2); ctx.fill(); });
  ctx.fillStyle = "#9aa3ad";
  [x + 26, x + 94].forEach(cx => { ctx.beginPath(); ctx.arc(cx, y + 48, 4, 0, Math.PI * 2); ctx.fill(); });
  ctx.globalAlpha = 1;
}

function drawGoal() {
  const x = goal.x - cameraX;
  ctx.fillStyle = "#5a351d"; ctx.fillRect(x, goal.y, 7, goal.h);
  ctx.fillStyle = "#ffdf3e"; ctx.beginPath();
  ctx.moveTo(x + 7, goal.y); ctx.lineTo(x + 57, goal.y + 20); ctx.lineTo(x + 7, goal.y + 40);
  ctx.closePath(); ctx.fill();
  ctx.font = "700 14px system-ui"; ctx.fillStyle = "#fff"; ctx.textAlign = "center";
  ctx.fillText("🏫 ESCOLA", x + 3, goal.y - 10); ctx.textAlign = "left";
}

function drawPlayer() {
  const anim = currentAnim();
  const f = img[frameFor(anim)];
  if (!f || !f.complete || !f.naturalWidth) return;

  const scale = p.h / (f.naturalHeight || f.height);
  const dw = (f.naturalWidth || f.width) * scale;
  const dh = (f.naturalHeight || f.height) * scale;
  const x = p.x - cameraX + p.w / 2;
  const y = p.y + p.h;

  // Escudo
  if (p.shield > 0 && (p.shield > 2 || Math.floor(time * 10) % 2 === 0)) {
    const cx = x, cy = p.y + p.h / 2;
    const r = Math.max(p.w, p.h) * 0.68 + Math.sin(time * 6) * 3;
    ctx.fillStyle = "rgba(86,200,247,0.22)"; ctx.strokeStyle = "rgba(160,230,255,0.95)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  if (p.inv > 0 && Math.floor(time * 20) % 2 === 0) return;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(p.scaleX, p.scaleY);

  if (p.wave > 0) { ctx.shadowColor = "#fff"; ctx.shadowBlur = 18; }
  else if (p.big > 0) { ctx.shadowColor = "#ffd43b"; ctx.shadowBlur = 16; }
  else if (p.superJump > 0) { ctx.shadowColor = "#ff7a45"; ctx.shadowBlur = 14; }

  if (p.facing < 0 && anim !== "left" && anim !== "right") ctx.scale(-1, 1);

  ctx.drawImage(f, -dw / 2, -dh, dw, dh);
  ctx.restore();
}

function drawEffects() {
  particles.forEach(pt => {
    ctx.globalAlpha = Math.max(0, pt.life);
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - cameraX, pt.y, 6, 6);
  });
  ctx.globalAlpha = 1;

  ctx.font = "bold 20px system-ui";
  floatingTexts.forEach(ft => {
    ctx.globalAlpha = Math.max(0, ft.life);
    ctx.fillStyle = ft.color;
    ctx.fillText(ft.text, ft.x - cameraX, ft.y);
  });
  ctx.globalAlpha = 1;
}

// ==================== LÓGICA DO JOGO ====================
function activatePower(type) {
  const def = POWERS[type];
  if (type === "grow") { if (!p.big) setBig(true); p.big = def.dur; }
  if (type === "shield") p.shield = def.dur;
  if (type === "jump") p.superJump = def.dur;
  sound.playPower();
  spawnParticles(p.x + p.w / 2, p.y + p.h / 2, def.color, 14);
  spawnText(p.x, p.y - 10, def.name + "!", def.color);
  showTip(def.tip, 4);
}

function hurt(reason) {
  if (p.inv > 0 || gameState !== STATES.PLAYING) return false;
  if (reason && OBSTACLE_TIPS[reason]) showTip(OBSTACLE_TIPS[reason], 4.5);

  if (p.shield > 0) {
    p.shield = 0; p.inv = 1.0;
    sound.playShieldHit();
    spawnParticles(p.x + p.w / 2, p.y + p.h / 2, "#56c8f7", 14);
    spawnText(p.x, p.y - 10, "Protegido!", "#9be7ff");
    p.vy = -300;
    return false;
  }
  if (p.big > 0) {
    p.big = 0; setBig(false); p.inv = 1.5;
    sound.playHurt();
    spawnText(p.x, p.y - 10, "Colete perdido", "#ffd43b");
    p.vx = -250 * p.facing; p.vy = -330;
    screenShake = 8;
    return false;
  }

  p.lives--; p.hurt = 0.55; p.inv = 1.5;
  p.vx = -250 * p.facing; p.vy = -380;
  screenShake = 14;
  sound.playHurt();
  if (p.lives <= 0) gameState = STATES.GAMEOVER;
  return true;
}

function respawn() {
  p.x = p.safeX; p.y = p.safeY - (p.h - BASE_H);
  p.vx = 0; p.vy = 0; p.grounded = false;
}

function update(dt) {
  if (gameState !== STATES.PLAYING) {
    if ((gameState === STATES.MENU || gameState === STATES.GAMEOVER || gameState === STATES.WIN) && (pressed.jump || pressed.action)) {
      reset();
    }
    pressed.jump = false; pressed.action = false;
    return;
  }

  time += dt;

  // Squash/Stretch
  p.scaleX += (1 - p.scaleX) * dt * 10;
  p.scaleY += (1 - p.scaleY) * dt * 10;

  // Efeitos visuais
  screenShake = Math.max(0, screenShake - dt * 50);
  particles.forEach(pt => { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 800 * dt; pt.life -= dt * 1.5; });
  particles = particles.filter(pt => pt.life > 0);
  floatingTexts.forEach(ft => { ft.y -= 45 * dt; ft.life -= dt; });
  floatingTexts = floatingTexts.filter(ft => ft.life > 0);
  tip.t = Math.max(0, tip.t - dt);

  p.inv = Math.max(0, p.inv - dt); p.hurt = Math.max(0, p.hurt - dt);
  p.wave = Math.max(0, p.wave - dt);

  // Duração dos poderes
  if (p.big > 0) { p.big -= dt; if (p.big <= 0) { p.big = 0; setBig(false); sound.playPowerEnd(); } }
  if (p.shield > 0) { p.shield -= dt; if (p.shield <= 0) { p.shield = 0; sound.playPowerEnd(); } }
  if (p.superJump > 0) { p.superJump -= dt; if (p.superJump <= 0) { p.superJump = 0; sound.playPowerEnd(); } }

  // Movimento horizontal
  const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  if (dir !== 0 && p.hurt === 0) p.facing = dir;

  const target = (p.hurt > 0) ? 0 : dir * p.speed;
  p.vx += (target - p.vx) * Math.min(1, dt * 12);
  if (!dir && p.grounded) p.vx *= Math.pow(0.001, dt);

  if (pressed.action && p.grounded) { p.wave = 0.7; p.vx = 0; }

  // Pulo (super pulo com o tênis)
  if (pressed.jump && (p.grounded || p.coyote > 0 || p.jumps < 2)) {
    const sj = p.superJump > 0;
    p.vy = sj ? -960 : -630;
    p.grounded = false; p.coyote = 0; p.jumps++;
    p.scaleX = 0.8; p.scaleY = 1.25;
    spawnParticles(p.x + p.w / 2, p.y + p.h, sj ? "#ff7a45" : "#fff", sj ? 12 : 6);
    if (sj) sound.playSuperJump(); else sound.playJump();
  }

  // Pulo variável
  if (!keys.jump && p.vy < 0 && p.superJump <= 0) p.vy *= 0.88;
  else if (!keys.jump && p.vy < -300) p.vy *= 0.94;

  pressed.jump = false; pressed.action = false;
  p.vy += 1800 * dt;

  // Colisão eixo X
  p.x += p.vx * dt;
  p.x = clamp(p.x, 0, goal.x + 100);
  for (const r of platforms) {
    if (rectsOverlap(p, r)) {
      if (p.vx > 0) { p.x = r.x - p.w; p.vx = 0; }
      else if (p.vx < 0) { p.x = r.x + r.w; p.vx = 0; }
    }
  }

  // Colisão eixo Y
  const wasGrounded = p.grounded;
  p.y += p.vy * dt;
  p.grounded = false;
  for (const r of platforms) {
    if (rectsOverlap(p, r)) {
      if (p.vy >= 0) {
        p.y = r.y - p.h; p.vy = 0;
        p.grounded = true; p.coyote = 0.15; p.jumps = 0;
        p.safeX = clamp(p.x, r.x + 8, r.x + r.w - p.w - 8);
        p.safeY = r.y - BASE_H;
        if (!wasGrounded) { p.scaleX = 1.25; p.scaleY = 0.8; }
      } else if (p.vy < 0) {
        p.y = r.y + r.h; p.vy = 0;
      }
    }
  }
  if (!p.grounded) p.coyote = Math.max(0, p.coyote - dt);

  // Bueiros abertos
  for (const m of manholes) {
    if (rectsOverlap({ x: p.x + 14, y: p.y + 14, w: p.w - 28, h: p.h - 14 }, m)) {
      hurt("manhole");
      if (gameState === STATES.PLAYING) respawn();
      break;
    }
  }

  // Obstáculos (celular, cone)
  for (const o of obstacles) {
    if (rectsOverlap({ x: p.x + 12, y: p.y + 14, w: p.w - 24, h: p.h - 14 }, o)) hurt(o.kind);
  }

  // Pedestres e ciclistas
  for (const e of enemies) {
    if (!e.alive) continue;
    e.x += e.v * dt;
    if (e.x < e.min || e.x > e.max) e.v *= -1;

    if (rectsOverlap({ x: p.x + 8, y: p.y + 10, w: p.w - 16, h: p.h - 12 }, e)) {
      const stomp = p.vy > 50 && p.y + p.h < e.y + e.h / 2 + 12;
      if (stomp || p.big > 0) {
        e.alive = false; p.vy = stomp ? -460 : p.vy;
        spawnParticles(e.x + e.w / 2, e.y + e.h / 2, e.kind === "ped" ? "#e0903a" : "#3d8f4a", 16);
        spawnText(e.x, e.y, "+200", "#fff");
        screenShake = 6;
        sound.playStomp();
      } else {
        hurt(e.kind);
      }
    }
  }

  // Semáforo e carros
  const phase = lightPhase();
  if (phase === "red" && lastPhase !== "red") {
    for (let i = 0; i < 3; i++) {
      cars.push({ x: CAR_LANE_START - i * 300, v: 400, color: ["#d94141", "#3b7bd9", "#e8b52c"][i % 3] });
    }
    sound.playHorn();
  }
  lastPhase = phase;
  cars.forEach(c => c.x += c.v * dt);
  cars = cars.filter(c => c.x < CAR_LANE_END);
  const inCross = p.x + p.w > CROSS.x && p.x < CROSS.x + CROSS.w;
  if (inCross) {
    for (const c of cars) {
      if (c.x < CAR_LANE_START) continue;
      if (c.x < p.x + p.w && c.x + 120 > p.x) { hurt("car"); break; }
    }
  }

  // Moedas
  for (const c of coins) {
    if (!c.got && Math.hypot((p.x + p.w / 2) - c.x, (p.y + p.h / 2) - c.y) < p.w / 2 + 15) {
      c.got = true; p.coins++;
      spawnParticles(c.x, c.y, "#ffbd1a", 8);
      spawnText(c.x - 12, c.y - 12, "+1", "#ffe77a");
      sound.playCoin();
    }
  }

  // Placas educativas
  for (const s of signs) {
    if (!s.got && Math.hypot((p.x + p.w / 2) - s.x, (p.y + p.h / 2) - s.y) < p.w / 2 + 28) {
      s.got = true; learned++;
      spawnParticles(s.x, s.y, "#4aa3ff", 12);
      spawnText(s.x - 20, s.y - 20, "+150", "#9fd0ff");
      showTip(s.tip, 5);
      sound.playTip();
    }
  }

  // Poderes
  for (const u of powerups) {
    if (!u.got && Math.hypot((p.x + p.w / 2) - u.x, (p.y + p.h / 2) - u.y) < p.w / 2 + 30) {
      u.got = true;
      activatePower(u.type);
    }
  }

  // Chegada
  if (rectsOverlap(p, goal)) {
    gameState = STATES.WIN;
    sound.playWin();
    const score = p.coins * 100 + learned * 150 + p.lives * 100 + Math.max(0, 90 - Math.floor(time)) * 10;
    p.score = score;
    if (score > best) { best = score; localStorage.setItem("coninhoBest", best); }
  }

  // Queda no vazio
  if (p.y > H + 120) {
    hurt("manhole");
    if (gameState === STATES.PLAYING) respawn();
  }

  // Câmera
  const targetCam = clamp(p.x - W / 2 + p.w / 2, 0, Math.max(0, goal.x - W + 200));
  cameraX += (targetCam - cameraX) * Math.min(1, dt * 8);
}

// ==================== INTERFACE E MENUS ====================
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

function hud() {
  ctx.fillStyle = "rgba(3,24,50,.82)"; roundRect(18, 15, 235, 82, 18); ctx.fill();
  ctx.font = "800 22px system-ui"; ctx.fillStyle = "#fff"; ctx.fillText("❤️ ".repeat(Math.max(0, p.lives)), 30, 47);
  ctx.fillStyle = "#ffd43b"; ctx.font = "800 20px system-ui"; ctx.fillText(`🪙 ${p.coins}`, 30, 78);
  ctx.fillStyle = "#9fd0ff"; ctx.fillText(`🪧 ${learned}/${signs.length}`, 130, 78);

  ctx.fillStyle = "rgba(3,24,50,.82)"; roundRect(W - 180, 15, 162, 54, 16); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = "800 20px system-ui"; ctx.fillText("🚸 FASE 1-1", W - 170, 50);

  ctx.fillStyle = "rgba(3,24,50,.72)"; roundRect(W / 2 - 120, 15, 240, 42, 14); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = "700 16px system-ui"; ctx.textAlign = "center";
  ctx.fillText(`TEMPO ${Math.floor(time).toString().padStart(2, "0")}s`, W / 2, 42);
  ctx.textAlign = "left";

  // Poderes ativos
  let py = 108;
  [["big", "grow"], ["shield", "shield"], ["superJump", "jump"]].forEach(([field, type]) => {
    if (p[field] <= 0) return;
    const def = POWERS[type];
    ctx.fillStyle = "rgba(3,24,50,.82)"; roundRect(18, py, 150, 30, 12); ctx.fill();
    ctx.font = "18px system-ui"; ctx.fillStyle = "#fff"; ctx.fillText(def.icon, 26, py + 22);
    ctx.fillStyle = "rgba(255,255,255,.2)"; roundRect(54, py + 10, 100, 10, 5); ctx.fill();
    ctx.fillStyle = def.color; roundRect(54, py + 10, 100 * clamp(p[field] / def.dur, 0, 1), 10, 5); ctx.fill();
    py += 36;
  });

  // Aviso do semáforo perto da faixa
  if (p.x > 2300 && p.x < 2950) {
    const ph = lightPhase();
    const label = { green: "PEDESTRE: PODE ATRAVESSAR", yellow: "ATENÇÃO: SINAL VAI FECHAR", red: "PARE! CARROS PASSANDO" }[ph];
    const color = { green: "#3dde6b", yellow: "#ffd43b", red: "#ff4d4d" }[ph];
    ctx.fillStyle = "rgba(3,24,50,.82)"; roundRect(W / 2 - 150, 66, 300, 30, 12); ctx.fill();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(W / 2 - 128, 81, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = "700 13px system-ui"; ctx.textAlign = "center";
    ctx.fillText(label, W / 2 + 10, 86); ctx.textAlign = "left";
  }

  // Dica educativa
  if (tip.t > 0) {
    const a = clamp(tip.t / 0.5, 0, 1);
    ctx.globalAlpha = a;
    ctx.font = "700 17px system-ui";
    const tw = Math.min(W - 60, ctx.measureText(tip.text).width + 50);
    ctx.fillStyle = "rgba(10,60,120,.92)"; roundRect(W / 2 - tw / 2, H - 150, tw, 44, 14); ctx.fill();
    ctx.strokeStyle = "#7fc0ff"; ctx.lineWidth = 2; roundRect(W / 2 - tw / 2, H - 150, tw, 44, 14); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.textAlign = "center";
    ctx.fillText("💡 " + tip.text, W / 2, H - 122);
    ctx.textAlign = "left"; ctx.globalAlpha = 1;
  }
}

function overlay() {
  ctx.textAlign = "center";

  if (gameState === STATES.MENU) {
    ctx.fillStyle = "rgba(2,14,28,.84)"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff"; ctx.font = "900 48px system-ui";
    ctx.fillText("🚸 CONINHO NO TRÂNSITO", W / 2, 150);
    ctx.font = "600 20px system-ui"; ctx.fillStyle = "#9fd0ff";
    ctx.fillText("Chegue à escola em segurança!", W / 2, 192);
    ctx.font = "600 17px system-ui"; ctx.fillStyle = "#fff";
    ctx.fillText("📱 Celular distrai   🦺 Colete: cresce   🪖 Capacete: escudo   👟 Tênis: super pulo", W / 2, 250);
    ctx.fillText("🚦 Atravesse só no sinal verde   🪧 Colete as placas e aprenda", W / 2, 282);
    ctx.font = "700 22px system-ui"; ctx.fillStyle = "#ffd43b";
    ctx.fillText("Pressione ESPAÇO ou Toque para Iniciar", W / 2, 350);
  } else if (gameState === STATES.PAUSED) {
    ctx.fillStyle = "rgba(2,14,28,.65)"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff"; ctx.font = "900 48px system-ui";
    ctx.fillText("JOGO PAUSADO", W / 2, 250);
    ctx.font = "600 20px system-ui";
    ctx.fillText("Pressione P para Continuar", W / 2, 300);
  } else if (gameState === STATES.GAMEOVER) {
    ctx.fillStyle = "rgba(20,4,4,.85)"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#e94343"; ctx.font = "900 52px system-ui";
    ctx.fillText("GAME OVER", W / 2, 200);
    ctx.fillStyle = "#fff"; ctx.font = "600 20px system-ui";
    ctx.fillText("No trânsito, atenção e cuidado salvam vidas!", W / 2, 250);
    ctx.font = "600 22px system-ui";
    ctx.fillText("Pressione R ou Toque para Tentar Novamente", W / 2, 305);
  } else if (gameState === STATES.WIN) {
    ctx.fillStyle = "rgba(2,14,28,.84)"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff"; ctx.font = "900 44px system-ui";
    ctx.fillText("🏫 VOCÊ CHEGOU À ESCOLA!", W / 2, 160);
    ctx.font = "700 22px system-ui";
    ctx.fillText(`Moedas: ${p.coins}   •   Placas: ${learned}/${signs.length}   •   Vidas: ${p.lives}   •   Tempo: ${Math.floor(time)}s`, W / 2, 215);
    ctx.fillStyle = "#9fd0ff"; ctx.font = "600 19px system-ui";
    ctx.fillText("Lembre-se: olhe, espere o sinal verde e guarde o celular ao atravessar.", W / 2, 262);
    ctx.fillStyle = "#fff"; ctx.font = "600 18px system-ui";
    ctx.fillText("Pressione R ou Toque para Jogar Novamente", W / 2, 312);
    ctx.fillStyle = "#ffd43b"; ctx.font = "800 22px system-ui";
    ctx.fillText(`Pontos: ${p.score || 0}   •   Recorde: ${best}`, W / 2, 360);
  }

  ctx.textAlign = "left";
}

// ==================== LOOP PRINCIPAL ====================
let last = performance.now();

function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  update(dt);

  ctx.save();
  if (screenShake > 0) {
    ctx.translate((Math.random() - 0.5) * screenShake, (Math.random() - 0.5) * screenShake);
  }

  drawBackground();
  for (const r of platforms) drawPlatform(r);
  drawCrosswalk();
  for (const m of manholes) drawManhole(m);
  for (const c of cars) drawCar(c);
  drawTrafficLight(2680);
  drawTrafficLight(2920);
  for (const o of obstacles) drawObstacle(o);
  for (const c of coins) drawCoin(c);
  for (const s of signs) drawSign(s);
  for (const u of powerups) drawPowerup(u);
  for (const e of enemies) drawEnemy(e);

  drawGoal();
  drawPlayer();
  drawEffects();

  ctx.restore();

  hud();
  overlay();

  requestAnimationFrame(loop);
}

gameState = STATES.MENU;
loop(last);
