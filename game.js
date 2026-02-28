const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const W = canvas.width, H = canvas.height;
const groundY = H - 110;

// --------------------
// Runner sprite sheet
// --------------------
const runnerImg = new Image();
runnerImg.src = "assets/runner.png";

// 6 frames sur une ligne
const FRAME_COUNT = 6;

// On calcule frameW/frameH une fois chargée
let frameW = 0;
let frameH = 0;
let runnerReady = false;

// scale d’affichage (à ajuster)
let runnerScale = 0.25; // si trop grand: 0.20 ; trop petit: 0.30

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
  hero.y = groundY - hero.h;
};

runnerImg.onerror = () => {
  runnerReady = false; // le jeu continue en carré jaune
};

// --------------------
// Game state
// --------------------
const state = {
  t: 0,
  speed: 2.4,
  score: 0,
  best: Number(localStorage.getItem("rr_best") || 0),
  over: false,
};

const hero = {
  x: 70,
  y: groundY - 28,
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
  state.speed = 2.4;
  state.score = 0;
  state.over = false;

  obstacles.length = 0;
  spawnTimer = 0;

  hero.vy = 0;
  hero.jumpsLeft = 2;
  hero.y = groundY - hero.h;

  animFrame = 0;
  animTimer = 0;
}

function jump() {
  if (state.over) return;
  if (hero.jumpsLeft <= 0) return;
  hero.vy = -13.5;
  hero.jumpsLeft -= 1;
}

canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  if (state.over) { reset(); return; }
  jump();
}, { passive:false });

function heroHitbox() {
  // hitbox un peu plus petite (plus agréable)
  const padX = Math.floor(hero.w * 0.22);
  const padY = Math.floor(hero.h * 0.12);
  return { x: hero.x+padX, y: hero.y+padY, w: hero.w-padX*2, h: hero.h-padY*2 };
}

function rectHit(a,b){
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function step(dt) {
  if (state.over) return;

  // difficulté
  state.speed = Math.min(7.2, state.speed + 0.0009);
  state.score += 0.08 * state.speed;

  // gravité
  hero.vy += 0.55;
  hero.y += hero.vy;

  // sol
  if (hero.y >= groundY - hero.h) {
    hero.y = groundY - hero.h;
    hero.vy = 0;
    hero.jumpsLeft = 2;
  }

  // spawn obstacles
  spawnTimer -= 1;
  if (spawnTimer <= 0) {
    const type = Math.random() < 0.33 ? "river" : (Math.random() < 0.5 ? "rock" : "tree");
    const w = type === "river" ? 68 : (type === "tree" ? 36 : 30);
    const h = type === "tree" ? 62 : (type === "river" ? 18 : 28);

    obstacles.push({ type, x: W + 40, y: groundY - h, w, h });

    // prochaine apparition (plus speed => spawn plus fréquent)
    spawnTimer = Math.floor(rand(75, 140) / (state.speed / 3.2));
  }

  // déplacement obstacles
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

  // animation runner (seulement au sol)
  const onGround = hero.y >= groundY - hero.h - 0.5;
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

function draw() {
  // fond
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0,0,W,H);

  // montagnes parallax (simple)
  const mOff = (state.t * state.speed * 0.12) % W;
  ctx.fillStyle = "#1f2a44";
  for (let i=0;i<3;i++){
    const x = -mOff + i*W;
    tri(x+40, groundY-160, x+170, groundY-300, x+300, groundY-160);
    tri(x+220, groundY-140, x+340, groundY-260, x+460, groundY-140);
  }

  // sol
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, groundY, W, H-groundY);
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, groundY, W, 6);

  // obstacles (placeholder rectangles)
  for (const o of obstacles) {
    ctx.fillStyle = o.type === "rock" ? "#94a3b8" : (o.type === "tree" ? "#22c55e" : "#38bdf8");
    ctx.fillRect(o.x, o.y, o.w, o.h);
  }

  // héros
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
