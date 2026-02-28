const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const W = canvas.width, H = canvas.height;
const groundY = H - 110;

// Obstacles start after 5s
const OBSTACLE_DELAY_MS = 5000;

// Runner should sit a bit lower (touch the ground)
const RUNNER_GROUND_OFFSET = 20; // px

// --------------------
// Runner sprite sheet
// --------------------
const runnerImg = new Image();
runnerImg.src = "assets/runner.png";

// 6 frames on one row
const FRAME_COUNT = 6;

let frameW = 0;
let frameH = 0;
let runnerReady = false;

// display scale
let runnerScale = 0.25;

// animation
let animFrame = 0;
let animTimer = 0;
const ANIM_FPS = 6;

runnerImg.onload = () => {
  runnerReady = true;
  frameW = Math.floor(runnerImg.width / FRAME_COUNT);
  frameH = runnerImg.height;

  hero.w = Math.round(frameW * runnerScale);
  hero.h = Math.round(frameH * runnerScale);
  hero.y = groundY - hero.h + RUNNER_GROUND_OFFSET; // ⬅️ sit lower
};

runnerImg.onerror = () => {
  runnerReady = false;
};

// --------------------
// Game state
// --------------------
const state = {
  t: 0,       // ms
  speed: 2.0, // start slow
  score: 0,
  best: Number(localStorage.getItem("rr_best") || 0),
  over: false,
};

const hero = {
  x: 70,
  y: groundY - 28 + RUNNER_GROUND_OFFSET, // ⬅️ sit lower (fallback too)
  w: 26,
  h: 28,
  vy: 0,
  jumpsLeft: 2,
};

const obstacles = [];
let spawnTimer = 0;

const rand = (a,b)=> a + Math.random()*(b-a);

function reset() {
  state.t = 0;
  state.speed = 2.0;
  state.score = 0;
  state.over = false;

  obstacles.length = 0;
  spawnTimer = 0;

  hero.vy = 0;
  hero.jumpsLeft = 2;
  hero.y = groundY - hero.h + RUNNER_GROUND_OFFSET; // ⬅️ sit lower

  animFrame = 0;
  animTimer = 0;
}

// Double jump: main jump smaller, 2nd jump boost higher
function jump() {
  if (state.over) return;
  if (hero.jumpsLeft <= 0) return;

  const onGround = hero.y >= groundY - hero.h + RUNNER_GROUND_OFFSET - 0.5;

  if (onGround) {
    hero.vy = -14.0;   // ⬅️ main jump smaller
  } else {
    hero.vy = -19.0;   // ⬅️ second jump boost
  }

  hero.jumpsLeft -= 1;
}

canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  if (state.over) { reset(); return; }
  jump();
}, { passive:false });

function heroHitbox() {
  // slightly smaller hitbox
  const padX = Math.floor(hero.w * 0.22);
  const padY = Math.floor(hero.h * 0.12);
  return { x: hero.x+padX, y: hero.y+padY, w: hero.w-padX*2, h: hero.h-padY*2 };
}

function rectHit(a,b){
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function step(dt) {
  if (state.over) return;

  // difficulty (slow ramp)
  state.speed = Math.min(4.8, state.speed + 0.00035);
  state.score += 0.08 * state.speed;

  // gravity
  hero.vy += 0.55;
  hero.y += hero.vy;

  // ground collision (with offset)
  const groundHeroY = groundY - hero.h + RUNNER_GROUND_OFFSET;
  if (hero.y >= groundHeroY) {
    hero.y = groundHeroY;
    hero.vy = 0;
    hero.jumpsLeft = 2;
  }

  // spawn obstacles only after delay
  const canSpawn = state.t >= OBSTACLE_DELAY_MS;

  spawnTimer -= 1;
  if (canSpawn && spawnTimer <= 0) {
    const type = Math.random() < 0.33 ? "river" : (Math.random() < 0.5 ? "rock" : "tree");

    // Slightly bigger obstacles; river a bit taller
    const w = type === "river" ? 60 : (type === "tree" ? 30 : 24);
    const h = type === "tree" ? 48 : (type === "river" ? 20 : 22); // ⬅️ river taller

    obstacles.push({ type, x: W + 40, y: groundY - h, w, h });

    spawnTimer = Math.floor(rand(75, 140) / (state.speed / 3.2));
  }

  // move obstacles
  for (const o of obstacles) o.x -= state.speed;
  while (obstacles.length && obstacles[0].x + obstacles[0].w < -40) obstacles.shift();

  // collisions
  const hb = heroHitbox();
  for (const o of obstacles) {
    if (rectHit(hb, o)) {
      state.over = true;
      state.best = Math.max(state.best, Math.floor(state.score));
      localStorage.setItem("rr_best", String(state.best));
      break;
    }
  }

  // runner animation (only on ground)
  const onGround = hero.y >= groundHeroY - 0.5;
  if (runnerReady && onGround) {
    animTimer += dt;
    const frameDuration = 1000 / ANIM_FPS;
    while (animTimer >= frameDuration) {
      animFrame = (animFrame + 1) % FRAME_COUNT;
      animTimer -= frameDuration;
    }
  }
}

function tri(x1,y1,x2,y2,x3,y3){
  ctx.beginPath();
  ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.lineTo(x3,y3);
  ctx.closePath(); ctx.fill();
}

function drawRunner() {
  const sx = animFrame * frameW;
  ctx.drawImage(runnerImg, sx, 0, frameW, frameH, hero.x, hero.y, hero.w, hero.h);
}

// 2-layer parallax background
function drawBackground() {
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0,0,W,H);

  // Layer 1: big distant mountains (slow)
  const off1 = (state.t * 0.010) % W; // uses only time for reliable parallax
  ctx.fillStyle = "#18233d";
  for (let i=0;i<4;i++){
    const x = -off1 + i*W;
    tri(x + 10,  groundY-140, x + 180, groundY-340, x + 350, groundY-140);
    tri(x + 220, groundY-120, x + 390, groundY-320, x + 560, groundY-120);
  }

  // Layer 2: closer smaller mountains (a bit faster)
  const off2 = (state.t * 0.020) % W;
  ctx.fillStyle = "#1f2a44";
  for (let i=0;i<4;i++){
    const x = -off2 + i*W;
    tri(x + 40,  groundY-120, x + 130, groundY-240, x + 220, groundY-120);
    tri(x + 180, groundY-110, x + 270, groundY-220, x + 360, groundY-110);
    tri(x + 300, groundY-125, x + 390, groundY-250, x + 480, groundY-125);
  }
}

function draw() {
  // background with 2 parallax layers
  drawBackground();

  // ground
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, groundY, W, H-groundY);
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, groundY, W, 6);

  // obstacles (placeholder rectangles)
  for (const o of obstacles) {
    ctx.fillStyle = o.type === "rock" ? "#94a3b8" : (o.type === "tree" ? "#22c55e" : "#38bdf8");
    ctx.fillRect(o.x, o.y, o.w, o.h);
  }

  // hero
  if (runnerReady) {
    drawRunner();
  } else {
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(hero.x, hero.y, hero.w, hero.h);
  }

  // UI
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "16px system-ui";
  ctx.fillText(`Score: ${Math.floor(state.score)}`, 16, 28);
  ctx.fillText(`Best: ${state.best}`, 16, 50);

  if (state.over) {
    ctx.fillStyle = "rgba(2,6,23,0.65)";
    ctx.fillRect(0,0,W,H);
    ctx.fillStyle = "#fff";
    ctx.font = "22px system-ui";
    ctx.fillText("Game Over", 120, 300);
    ctx.font = "16px system-ui";
    ctx.fillText("Tap to restart", 126, 330);
  }

  // warmup countdown
  if (!state.over && state.t < OBSTACLE_DELAY_MS) {
    const sLeft = Math.ceil((OBSTACLE_DELAY_MS - state.t) / 1000);
    ctx.fillStyle = "rgba(226,232,240,0.9)";
    ctx.font = "14px system-ui";
    ctx.fillText(`Warmup… ${sLeft}s`, 16, 72);
  }
}

let last = performance.now();
function loop(now){
  const dt = Math.min(32, now-last);
  last = now;
  state.t += dt;

  step(dt);
  draw();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
