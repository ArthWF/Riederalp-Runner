const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const W = canvas.width, H = canvas.height;
const groundY = H - 110;

// Obstacles start after 5s
const OBSTACLE_DELAY_MS = 5000;

// Runner should sit a bit lower (touch the ground)
const RUNNER_GROUND_OFFSET = 20; // px

// Obstacle offsets
const EDEL_GROUND_OFFSET = 10;   // px (sit a bit lower)
const ALPEN_GROUND_OFFSET = 6;   // px (tweak if needed)

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
  hero.y = groundY - hero.h + RUNNER_GROUND_OFFSET;
};

runnerImg.onerror = () => {
  runnerReady = false;
};

// --------------------
// Edelweiss sprite sheet (3 frames)
// --------------------
const edelImg = new Image();
edelImg.src = "assets/edelweiss.png";

const EDEL_FRAMES = 3;
let edelFrameW = 0;
let edelFrameH = 0;
let edelReady = false;

let edelFrame = 0;
let edelTimer = 0;
const EDEL_FPS = 5;
const EDEL_SCALE = 0.11;

edelImg.onload = () => {
  edelReady = true;
  edelFrameW = Math.floor(edelImg.width / EDEL_FRAMES);
  edelFrameH = edelImg.height;
};
edelImg.onerror = () => {
  edelReady = false;
};

// --------------------
// Alpenrose sprite sheet (4 frames)
// --------------------
const alpenImg = new Image();
alpenImg.src = "assets/alpenrose.png";

const ALPEN_FRAMES = 4;
let alpenFrameW = 0;
let alpenFrameH = 0;
let alpenReady = false;

let alpenFrame = 0;
let alpenTimer = 0;
const ALPEN_FPS = 6;
const ALPEN_SCALE = 0.12;

alpenImg.onload = () => {
  alpenReady = true;
  alpenFrameW = Math.floor(alpenImg.width / ALPEN_FRAMES);
  alpenFrameH = alpenImg.height;
};
alpenImg.onerror = () => {
  alpenReady = false;
};

// --------------------
// Cloud sprite sheet (4 frames) - background decor
// --------------------
const cloudImg = new Image();
cloudImg.src = "assets/cloud.png";

const CLOUD_FRAMES = 4;
let cloudFrameW = 0;
let cloudFrameH = 0;
let cloudReady = false;

let cloudFrame = 0;
let cloudTimer = 0;
const CLOUD_FPS = 4;
const CLOUD_SCALE = 0.35;

// parallax speeds (px/ms)
const CLOUD_SPEED_NEAR = 0.030;
const CLOUD_SPEED_FAR  = 0.015;

cloudImg.onload = () => {
  cloudReady = true;
  cloudFrameW = Math.floor(cloudImg.width / CLOUD_FRAMES);
  cloudFrameH = cloudImg.height;
};
cloudImg.onerror = () => {
  cloudReady = false;
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
  y: groundY - 28 + RUNNER_GROUND_OFFSET,
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
  hero.y = groundY - hero.h + RUNNER_GROUND_OFFSET;

  animFrame = 0;
  animTimer = 0;

  edelFrame = 0;
  edelTimer = 0;

  alpenFrame = 0;
  alpenTimer = 0;

  cloudFrame = 0;
  cloudTimer = 0;
}

// Double jump: 2nd jump smaller
function jump() {
  if (state.over) return;
  if (hero.jumpsLeft <= 0) return;

  const groundHeroY = groundY - hero.h + RUNNER_GROUND_OFFSET;
  const onGround = hero.y >= groundHeroY - 0.5;

  // 1st jump strong, 2nd jump smaller
  hero.vy = onGround ? -14.0 : -11.5;

  hero.jumpsLeft -= 1;
}

canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  if (state.over) { reset(); return; }
  jump();
}, { passive:false });

function heroHitbox() {
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

  // Edelweiss animation timer
  if (edelReady) {
    edelTimer += dt;
    const fd = 1000 / EDEL_FPS;
    while (edelTimer >= fd) {
      edelFrame = (edelFrame + 1) % EDEL_FRAMES;
      edelTimer -= fd;
    }
  }

  // Alpenrose animation timer
  if (alpenReady) {
    alpenTimer += dt;
    const fd = 1000 / ALPEN_FPS;
    while (alpenTimer >= fd) {
      alpenFrame = (alpenFrame + 1) % ALPEN_FRAMES;
      alpenTimer -= fd;
    }
  }

  // Cloud animation timer
  if (cloudReady) {
    cloudTimer += dt;
    const fd = 1000 / CLOUD_FPS;
    while (cloudTimer >= fd) {
      cloudFrame = (cloudFrame + 1) % CLOUD_FRAMES;
      cloudTimer -= fd;
    }
  }

  // spawn obstacles only after delay
  const canSpawn = state.t >= OBSTACLE_DELAY_MS;

  spawnTimer -= 1;
  if (canSpawn && spawnTimer <= 0) {
    // weights: edelweiss 25%, alpenrose 25%, rock/tree 50%
    const r = Math.random();
    const type =
      r < 0.25 ? "edelweiss" :
      r < 0.50 ? "alpenrose" :
      (Math.random() < 0.5 ? "rock" : "tree");

    let w, h;

    if (type === "edelweiss") {
      if (edelReady) {
        w = Math.round(edelFrameW * EDEL_SCALE);
        h = Math.round(edelFrameH * EDEL_SCALE);
      } else { w = 42; h = 34; }
    } else if (type === "alpenrose") {
      if (alpenReady) {
        w = Math.round(alpenFrameW * ALPEN_SCALE);
        h = Math.round(alpenFrameH * ALPEN_SCALE);
      } else { w = 44; h = 36; }
    } else {
      w = (type === "tree" ? 30 : 24);
      h = (type === "tree" ? 48 : 22);
    }

    // y placement (offset applied ONCE here)
    let y = groundY - h;
    if (type === "edelweiss") y = groundY - h + EDEL_GROUND_OFFSET;
    if (type === "alpenrose") y = groundY - h + ALPEN_GROUND_OFFSET;

    obstacles.push({ type, x: W + 40, y, w, h });

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

function drawEdelweiss(o) {
  if (!edelReady) {
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(o.x, o.y, o.w, o.h);
    return;
  }
  const sx = edelFrame * edelFrameW;
  ctx.drawImage(edelImg, sx, 0, edelFrameW, edelFrameH, o.x, o.y, o.w, o.h);
}

function drawAlpenrose(o) {
  if (!alpenReady) {
    ctx.fillStyle = "#fb7185";
    ctx.fillRect(o.x, o.y, o.w, o.h);
    return;
  }
  const sx = alpenFrame * alpenFrameW;
  ctx.drawImage(alpenImg, sx, 0, alpenFrameW, alpenFrameH, o.x, o.y, o.w, o.h);
}

// Animated cloud layer (repeat tile)
function drawCloudLayer(speedPxPerMs, y, alpha, scale) {
  if (!cloudReady) return;

  const tileW = Math.round(cloudFrameW * scale);
  const tileH = Math.round(cloudFrameH * scale);

  const off = (state.t * speedPxPerMs) % tileW;
  const sx = cloudFrame * cloudFrameW;

  ctx.save();
  ctx.globalAlpha = alpha;

  // draw enough tiles to cover screen
  for (let x = -off - tileW; x < W + tileW; x += tileW) {
    ctx.drawImage(
      cloudImg,
      sx, 0, cloudFrameW, cloudFrameH,
      Math.floor(x), Math.floor(y), tileW, tileH
    );
  }

  ctx.restore();
}

// 2-layer parallax background + cloud decor
function drawBackground() {
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0,0,W,H);

  // FAR clouds
  drawCloudLayer(CLOUD_SPEED_FAR, 60, 0.55, CLOUD_SCALE * 0.85);

  const off1 = (state.t * 0.010) % W;
  ctx.fillStyle = "#18233d";
  for (let i=0;i<4;i++){
    const x = -off1 + i*W;
    tri(x + 10,  groundY-140, x + 180, groundY-340, x + 350, groundY-140);
    tri(x + 220, groundY-120, x + 390, groundY-320, x + 560, groundY-120);
  }

  // NEAR clouds
  drawCloudLayer(CLOUD_SPEED_NEAR, 95, 0.70, CLOUD_SCALE);

  const off2 = (state.t * 0.020) % W;
  ctx.fillStyle = "#1f2a44";
  for (let i=0;i<4;i++){
    const x = -off2 + i*W;
    tri(x + 40,  groundY-120, x + 130, groundY-240, x + 220, groundY-120);
    tri(x + 180, groundY-110, x + 270, groundY-220, x + 360, groundY-110);
    tri(x + 300, groundY-125, x + 390, groundY-250, x + 480, groundY-125);
  }
}
