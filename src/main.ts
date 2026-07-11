import "./style.css";
import { WaveField } from "./waves";
import { WaterRenderer } from "./water";
import { LilyPad, Frog } from "./entities";
import { Music } from "./audio";
import { Game, BEAT, type Judgment } from "./game";

const canvas = document.getElementById("pond") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const music = new Music();
const game = new Game(() => music.time());

/* ------------------------------------------------------------------ */
/*  world state                                                       */
/* ------------------------------------------------------------------ */

let W = window.innerWidth;
let H = window.innerHeight;
let field: WaveField;
let water: WaterRenderer;
let toCell = 1; // px → grid cells
let pads: LilyPad[] = [];
let frog: Frog;

// reflection map: pads + frog rendered at grid resolution each frame
let reflCanvas: HTMLCanvasElement;
let rctx: CanvasRenderingContext2D;

interface RainDrop {
  x: number;
  y: number;
  t: number;
  dur: number;
  sx: number; // slant (whence the streak falls), wind-driven
  sy: number;
}
let rain: RainDrop[] = [];

interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  t: number;
}
let texts: FloatText[] = [];

let windA = 0.9; // wind direction, drifts over time
let wind = { x: 0, y: 0 }; // direction · strength (0..1)
let worldT = 0;

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/** Inject a ripple in pixel coords; chaos livens every splash. */
function dropAt(x: number, y: number, radiusPx: number, amp: number): void {
  field.drop(x * toCell, y * toCell, radiusPx * toCell, amp * (1 + game.chaos * 0.35));
}

function buildWater(): void {
  // ~4.5 css px per cell, capped so huge monitors stay fast
  const cell = Math.max(4, Math.max(W, H) / 380);
  toCell = 1 / cell;
  field = new WaveField(Math.ceil(W / cell), Math.ceil(H / cell));
  water = new WaterRenderer(field);
  reflCanvas = document.createElement("canvas");
  reflCanvas.width = field.w;
  reflCanvas.height = field.h;
  rctx = reflCanvas.getContext("2d", { willReadFrequently: true })!;
}

function makePads(): LilyPad[] {
  const made: LilyPad[] = [];
  const count = 8;
  let guard = 0;
  while (made.length < count && guard++ < 5000) {
    const nr = rand(0.05, 0.088);
    const nx = rand(0.1, 0.9);
    const ny = rand(0.15, 0.88);
    const r = nr * Math.min(W, H);
    const ok = made.every(
      (p) => Math.hypot(nx * W - p.nx * W, ny * H - p.ny * H) > (r + p.r) * 1.5,
    );
    if (ok) {
      const pad = new LilyPad(nx, ny, nr);
      pad.layout(W, H);
      made.push(pad);
    }
  }
  return made;
}

function init(): void {
  W = window.innerWidth;
  H = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  buildWater();
  pads = makePads();
  rain = [];
  texts = [];

  // frog starts on the pad nearest the pond's centre
  let start = 0;
  let best = Infinity;
  pads.forEach((p, i) => {
    const d = Math.hypot(p.pos.x - W * 0.5, p.pos.y - H * 0.55);
    if (d < best) {
      best = d;
      start = i;
    }
  });
  frog = new Frog(start, BEAT);
}

/* ------------------------------------------------------------------ */
/*  judgment + feedback                                               */
/* ------------------------------------------------------------------ */

const glowEl = document.getElementById("glow") as HTMLDivElement;
const hudScore = document.getElementById("hudScore")!;
const hudHigh = document.getElementById("hudHigh")!;
const hudCombo = document.getElementById("hudCombo")!;
const hudMult = document.getElementById("hudMult")!;
const hudChaos = document.getElementById("hudChaos") as HTMLDivElement;
const hudChaosPct = document.getElementById("hudChaosPct")!;

const TIER_GLOW = [
  "rgba(0,0,0,0)",
  "rgba(79,216,196,0.30)",
  "rgba(88,168,216,0.34)",
  "rgba(242,193,132,0.36)",
  "rgba(138,108,240,0.40)",
  "rgba(196,92,216,0.46)",
];

function setGlow(tier: number, flash = false): void {
  const c = TIER_GLOW[Math.min(tier, TIER_GLOW.length - 1)];
  const size = flash ? 220 : 150;
  glowEl.style.boxShadow = tier > 0 ? `inset 0 0 ${size}px 24px ${c}` : "none";
  if (flash) {
    window.setTimeout(() => setGlow(tier), 160);
  }
}

const JUDGE_STYLE: Record<Judgment, { text: string; color: string }> = {
  perfect: { text: "PERFECT", color: "#ffd98a" },
  good: { text: "GOOD", color: "#7fe0cf" },
  miss: { text: "MISS", color: "#b8a8d8" },
};

function judgeLanding(pos: { x: number; y: number }, power: number): void {
  dropAt(pos.x, pos.y, 12, power * 0.85);
  if (!music.started) return; // pre-audio warm-up hops are free play

  const res = game.judge(music.time());
  const style = JUDGE_STYLE[res.judgment];
  const label =
    res.judgment === "miss"
      ? style.text
      : res.combo > 1
        ? `${style.text} ×${res.combo}`
        : style.text;
  texts.push({ x: pos.x, y: pos.y - 34, text: label, color: style.color, t: 0 });

  music.land(res.judgment, res.tier);
  if (res.judgment === "miss") music.miss();
  music.setTier(res.tier);
  setGlow(res.tier, res.judgment === "perfect");
}

const jumpEvents = {
  onTakeoff(pos: { x: number; y: number }, power: number) {
    dropAt(pos.x, pos.y, 8, power);
  },
  onLand(pos: { x: number; y: number }, power: number) {
    judgeLanding(pos, power);
  },
};

/* ------------------------------------------------------------------ */
/*  input                                                             */
/* ------------------------------------------------------------------ */

function padAt(x: number, y: number): number {
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    if (Math.hypot(x - p.pos.x, y - p.pos.y) < p.r + 6) return i;
  }
  return -1;
}

function startAudio(): void {
  const wasStarted = music.started;
  const anchor = music.start();
  if (!wasStarted) game.rebase(anchor);
}

canvas.addEventListener("pointerdown", (e) => {
  startAudio();
  const hit = padAt(e.clientX, e.clientY);
  if (hit >= 0) {
    if (frog.jumpTo(hit, pads)) music.jump(game.combo > 0 ? Math.min(5, game.mult - 1) : 0);
  } else {
    dropAt(e.clientX, e.clientY, 10, 0.8);
    music.land("good", 0); // free splash, no judgment
  }
});

canvas.addEventListener("pointermove", (e) => {
  canvas.style.cursor = padAt(e.clientX, e.clientY) >= 0 ? "pointer" : "default";
});

const DIRS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  w: [0, -1],
  s: [0, 1],
  a: [-1, 0],
  d: [1, 0],
};

window.addEventListener("keydown", (e) => {
  const dir = DIRS[e.key];
  if (!dir) return;
  e.preventDefault();
  startAudio();
  const from = pads[frog.padIndex].pos;
  let pick = -1;
  let best = Infinity;
  pads.forEach((p, i) => {
    if (i === frog.padIndex) return;
    const dx = p.pos.x - from.x;
    const dy = p.pos.y - from.y;
    const d = Math.hypot(dx, dy);
    if ((dx * dir[0] + dy * dir[1]) / d > 0.55 && d < best) {
      best = d;
      pick = i;
    }
  });
  if (pick >= 0 && frog.jumpTo(pick, pads)) {
    music.jump(game.combo > 0 ? Math.min(5, game.mult - 1) : 0);
  }
});

const soundBtn = document.getElementById("soundBtn") as HTMLButtonElement;
soundBtn.addEventListener("click", () => {
  const on = soundBtn.getAttribute("aria-pressed") !== "true";
  soundBtn.setAttribute("aria-pressed", String(on));
  startAudio();
  music.setEnabled(on);
});

let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(init, 160);
});

/* ------------------------------------------------------------------ */
/*  weather — rain and wind scale with chaos                          */
/* ------------------------------------------------------------------ */

let rainCarry = 0;

function weather(dt: number): void {
  const chaos = game.chaos;

  // wind: direction wanders, strength follows chaos
  windA += (Math.sin(worldT * 0.11) * 0.35 + 0.12) * dt;
  wind.x = Math.cos(windA) * chaos;
  wind.y = Math.sin(windA) * chaos;

  // micro-ripples: glassy when calm, constantly pricked when stormy
  const microRate = 3 + chaos * 42;
  if (Math.random() < dt * microRate) {
    dropAt(rand(0, W), rand(0, H), 6, 0.008 + 0.02 * chaos);
  }

  // rain: density rises steeply with chaos; trajectories lean with the wind
  const rate = chaos < 0.04 ? 0 : chaos * chaos * 95;
  rainCarry += rate * dt;
  while (rainCarry >= 1) {
    rainCarry -= 1;
    const slantLen = 34 + 60 * chaos;
    rain.push({
      x: rand(0, W),
      y: rand(0, H),
      t: 0,
      dur: rand(0.16, 0.26),
      sx: (wind.x * 2.2 + 0.3) * slantLen,
      sy: (wind.y * 2.2 - 1) * slantLen,
    });
  }
  for (let i = rain.length - 1; i >= 0; i--) {
    const d = rain[i];
    d.t += dt;
    if (d.t >= d.dur) {
      dropAt(d.x, d.y, 5, rand(0.05, 0.16));
      rain.splice(i, 1);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  render                                                            */
/* ------------------------------------------------------------------ */

function drawBeatRing(): void {
  const p = game.phase();
  const cx = W / 2;
  const cy = H / 2;
  const chaos = game.chaos;
  const r = 16 + p * 52;
  const a = (1 - p) * (0.22 + chaos * 0.12);
  ctx.strokeStyle = `rgba(${Math.round(255 - chaos * 90)}, ${Math.round(226 - chaos * 60)}, ${Math.round(
    190 + chaos * 50,
  )}, ${a})`;
  ctx.lineWidth = 2 + (1 - p) * 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  // bright pulse right on the beat
  if (p < 0.1) {
    ctx.fillStyle = `rgba(255, 240, 210, ${(0.1 - p) * 1.6})`;
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTexts(dt: number): void {
  ctx.textAlign = "center";
  for (let i = texts.length - 1; i >= 0; i--) {
    const ft = texts[i];
    ft.t += dt;
    const k = ft.t / 0.95;
    if (k >= 1) {
      texts.splice(i, 1);
      continue;
    }
    const pop = k < 0.18 ? 0.7 + (k / 0.18) * 0.45 : 1.15 - (k - 0.18) * 0.12;
    const alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    ctx.save();
    ctx.translate(ft.x, ft.y - k * 30);
    ctx.scale(pop, pop);
    ctx.font = "italic 700 24px Fraunces, Georgia, serif";
    ctx.globalAlpha = alpha;
    ctx.fillStyle = ft.color;
    ctx.shadowColor = "rgba(10,10,30,0.7)";
    ctx.shadowBlur = 10;
    ctx.fillText(ft.text, 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

let vignette: CanvasGradient | null = null;
let vignetteKey = "";

function render(dt: number): void {
  // reflection map for this frame
  rctx.clearRect(0, 0, field.w, field.h);
  for (const pad of pads) pad.drawReflection(rctx, toCell);
  frog.drawReflection(rctx, toCell);
  const refl = rctx.getImageData(0, 0, field.w, field.h).data;

  water.render(ctx, W, H, game.chaos, dt, wind, refl);

  drawBeatRing();
  for (const pad of pads) pad.draw(ctx);
  frog.drawShadow(ctx);
  frog.draw(ctx);

  // rain streaks fall in front of everything
  if (rain.length > 0) {
    ctx.strokeStyle = "rgba(205, 228, 246, 0.5)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const d of rain) {
      const k = d.t / d.dur;
      const x1 = d.x - d.sx * (1 - k);
      const y1 = d.y - d.sy * (1 - k);
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 + d.sx * 0.3, y1 + d.sy * 0.3);
    }
    ctx.stroke();
  }

  drawTexts(dt);

  // dusk vignette deepens with the storm
  const key = `${W}x${H}`;
  if (key !== vignetteKey) {
    vignette = ctx.createRadialGradient(
      W * 0.5,
      H * 0.46,
      Math.min(W, H) * 0.42,
      W * 0.5,
      H * 0.5,
      Math.hypot(W, H) * 0.62,
    );
    vignette.addColorStop(0, "rgba(16, 12, 34, 0)");
    vignette.addColorStop(1, "rgba(16, 12, 34, 0.5)");
    vignetteKey = key;
  }
  ctx.globalAlpha = 0.82 + game.chaos * 0.36;
  ctx.fillStyle = vignette!;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  if (game.chaos > 0.02) {
    ctx.fillStyle = `rgba(66, 56, 128, ${game.chaos * 0.07})`;
    ctx.fillRect(0, 0, W, H);
  }
}

/* ------------------------------------------------------------------ */
/*  HUD                                                               */
/* ------------------------------------------------------------------ */

let lastScore = -1;
let lastHigh = -1;
let lastCombo = -1;
let lastMult = -1;
let lastChaosPct = -1;

function updateHud(): void {
  if (game.score !== lastScore) {
    lastScore = game.score;
    hudScore.textContent = String(game.score);
  }
  if (game.high !== lastHigh) {
    lastHigh = game.high;
    hudHigh.textContent = String(game.high);
  }
  if (game.combo !== lastCombo) {
    lastCombo = game.combo;
    hudCombo.textContent = String(game.combo);
  }
  if (game.mult !== lastMult) {
    lastMult = game.mult;
    hudMult.textContent = `×${game.mult}`;
  }
  const pct = Math.round(game.chaos * 100);
  if (pct !== lastChaosPct) {
    lastChaosPct = pct;
    hudChaos.style.width = `${pct}%`;
    hudChaosPct.textContent = `${pct}%`;
  }
}

/* ------------------------------------------------------------------ */
/*  main loop — fixed-step physics, per-frame rendering               */
/* ------------------------------------------------------------------ */

const STEP = 1 / 60;
let acc = 0;
let last = performance.now();

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  worldT += dt;

  game.update(dt);
  const chaos = game.chaos;
  field.damping = 0.9945 + chaos * 0.003;
  field.c2 = 0.28 + chaos * 0.14;
  music.setChaos(chaos);

  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 4) {
    field.step();
    acc -= STEP;
    steps++;
  }
  if (steps === 4) acc = 0; // dropped frames: don't spiral

  weather(dt);
  for (const pad of pads) pad.update(dt, worldT, field, toCell, chaos, wind);
  frog.update(dt, pads, jumpEvents);

  render(dt);
  updateHud();
  requestAnimationFrame(frame);
}

init();
setGlow(0);
requestAnimationFrame(frame);
