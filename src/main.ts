import "./style.css";
import { WaveField } from "./waves";
import { WaterRenderer } from "./water";
import { LilyPad, Frog, Dragonfly, Fish } from "./entities";
import { SoundScape } from "./audio";

const canvas = document.getElementById("pond") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const sound = new SoundScape();

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
let flies: Dragonfly[] = [];
let fish: Fish | null = null;
let fishIn = 6;
let rain = false;
let intensity = 1;

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/** Inject a ripple, in pixel coordinates. Everything funnels through here. */
function dropAt(x: number, y: number, radiusPx: number, amp: number): void {
  field.drop(x * toCell, y * toCell, radiusPx * toCell, amp * intensity);
}

function buildWater(): void {
  // ~4.5 css px per cell, capped so huge monitors stay fast
  const cell = Math.max(4, Math.max(W, H) / 380);
  toCell = 1 / cell;
  const damping = field?.damping;
  field = new WaveField(Math.ceil(W / cell), Math.ceil(H / cell));
  if (damping !== undefined) field.damping = damping;
  water = new WaterRenderer(field);
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
  frog = new Frog(start);
  flies = [new Dragonfly(W, H), new Dragonfly(W, H)];
  fish = null;
  fishIn = rand(5, 10);
}

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

const jumpEvents = {
  onTakeoff(pos: { x: number; y: number }, power: number) {
    dropAt(pos.x, pos.y, 8, power);
    sound.plip(0.3, 1.25);
  },
  onLand(pos: { x: number; y: number }, power: number) {
    dropAt(pos.x, pos.y, 12, power * 0.85);
    sound.splash(Math.min(1, power * 0.7));
  },
};

canvas.addEventListener("pointerdown", (e) => {
  sound.ensure();
  const hit = padAt(e.clientX, e.clientY);
  if (hit >= 0) {
    frog.jumpTo(hit, pads); // hitting the frog's own pad = a hop in place
  } else {
    dropAt(e.clientX, e.clientY, 10, 0.8);
    sound.plip(0.55, rand(0.9, 1.15));
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
  sound.ensure();
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
  if (pick >= 0) frog.jumpTo(pick, pads);
});

let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(init, 160);
});

/* ------------------------------------------------------------------ */
/*  control panel                                                     */
/* ------------------------------------------------------------------ */

const rainBtn = document.getElementById("rainBtn") as HTMLButtonElement;
const soundBtn = document.getElementById("soundBtn") as HTMLButtonElement;
const dampSlider = document.getElementById("dampSlider") as HTMLInputElement;
const powerSlider = document.getElementById("powerSlider") as HTMLInputElement;
const resetBtn = document.getElementById("resetBtn") as HTMLButtonElement;

rainBtn.addEventListener("click", () => {
  rain = !rain;
  rainBtn.setAttribute("aria-pressed", String(rain));
  sound.ensure();
});

soundBtn.addEventListener("click", () => {
  const on = soundBtn.getAttribute("aria-pressed") !== "true";
  soundBtn.setAttribute("aria-pressed", String(on));
  sound.ensure();
  sound.setEnabled(on);
});

function applyDamping(): void {
  field.damping = 0.986 + (Number(dampSlider.value) / 100) * 0.0137;
}
function applyPower(): void {
  intensity = 0.3 + (Number(powerSlider.value) / 100) * 1.4;
}
dampSlider.addEventListener("input", applyDamping);
powerSlider.addEventListener("input", applyPower);

resetBtn.addEventListener("click", () => {
  field.clear();
  pads.forEach((p) => p.layout(W, H));
  fish = null;
});

/* ------------------------------------------------------------------ */
/*  ambient life                                                      */
/* ------------------------------------------------------------------ */

function ambient(dt: number): void {
  // wind: tiny pinpricks that keep the surface from ever going glassy
  if (Math.random() < dt * 9) {
    dropAt(rand(0, W), rand(0, H), 6, 0.012);
  }

  // rain
  if (rain) {
    let n = dt * 15;
    while (n > 0) {
      if (Math.random() < n) dropAt(rand(0, W), rand(0, H), 5, rand(0.05, 0.16));
      n -= 1;
    }
  }

  // fish
  if (fish) {
    fish.update(dt, dropAt, (v, p) => sound.plip(v, p));
    if (fish.done) {
      fish = null;
      fishIn = rand(9, 18);
    }
  } else {
    fishIn -= dt;
    if (fishIn <= 0) fish = new Fish(W, H);
  }

  for (const fly of flies) fly.update(dt, W, H, dropAt);
}

/* ------------------------------------------------------------------ */
/*  render                                                            */
/* ------------------------------------------------------------------ */

let vignette: CanvasGradient | null = null;
let vignetteKey = "";

function render(): void {
  water.render(ctx, W, H);

  if (fish) fish.draw(ctx);
  for (const pad of pads) pad.draw(ctx);
  frog.drawShadow(ctx);
  frog.draw(ctx);
  for (const fly of flies) fly.draw(ctx);

  // dusk vignette + a whisper of sunset glow across the top
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
    vignette.addColorStop(0, "rgba(18, 12, 34, 0)");
    vignette.addColorStop(1, "rgba(18, 12, 34, 0.42)");
    vignetteKey = key;
  }
  ctx.fillStyle = vignette!;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createLinearGradient(0, 0, 0, H * 0.35);
  glow.addColorStop(0, "rgba(255, 178, 118, 0.1)");
  glow.addColorStop(1, "rgba(255, 178, 118, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H * 0.35);
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

  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 4) {
    field.step();
    acc -= STEP;
    steps++;
  }
  if (steps === 4) acc = 0; // dropped frames: don't spiral

  ambient(dt);
  for (const pad of pads) pad.update(dt, field, toCell);
  frog.update(dt, pads, jumpEvents);

  render();
  requestAnimationFrame(frame);
}

init();
applyDamping();
applyPower();
requestAnimationFrame(frame);
