(() => {
  "use strict";

  // ---- status overlay
  const statusEl = document.getElementById("status");
  const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };

  // ---- canvas
  const canvas = document.getElementById("game");
  if (!canvas) { console.error("Canvas #game not found"); setStatus("Canvas missing ❌"); return; }
  const ctx = canvas.getContext("2d");
  if (!ctx) { console.error("2D ctx not available"); setStatus("2D context missing ❌"); return; }
  ctx.imageSmoothingEnabled = false;

  setStatus("game.js running ✅");

  const W = canvas.width, H = canvas.height;
  const groundY = H - 110;

  const OBSTACLE_DELAY_MS = 2500; // shorter so you see it quickly
  const RUNNER_GROUND_OFFSET = 20;

  // --------------------
  // PIXELS-ONLY sizes (single size logic)
  // --------------------
  const RUNNER_W = 42, RUNNER_H = 46;       // adjust to your runner sprite look
  const EDEL_W   = 42, EDEL_H   = 34;
  const ALPEN_W  = 47, ALPEN_H  = 40;       // based on your ratio request
  const CLOUD_W  = 90, CLOUD_H  = 48;

  // --------------------
  // Images (optional)
  // --------------------
  function loadImg(src) {
    const img = new Image();
    img.onload = () => { img.__ok = true; };
    img.onerror = () => { img.__ok = false; console.warn("Asset failed:", src); };
    img.src = src;
    return img;
  }

  // spritesheets (frames horizontally)
  const runnerImg = loadImg("assets/runner.png");     // 6 frames
  const edelImg   = loadImg("assets/edelweiss.png");  // 3 frames
  const alpenImg  = loadImg("assets/alpenrose.png");  // 4 frames
  const cloudImg  = loadImg("assets/cloud.png");      // 4 frames

  // frame counts
  const RUNNER_FRAMES = 6;
  const EDEL_FRAMES = 3;
  const ALPEN_FRAMES = 4;
  const CLOUD_FRAMES = 4;

  // anim fps
  const RUNNER_FPS = 6;
  const EDEL_FPS = 5;
  const ALPEN_FPS = 3; // slower
  const CLOUD_FPS = 4;

  // --------------------
  // state
  // --------------------
  const state = {
    t: 0,
    speed: 2.0,
    score: 0,
    best: (() => { try { return Number(localStorage.getItem("rr_best") || 0); } catch { return 0; } })(),
    over: false,
  };

  const hero = {
    x: 70,
    w: RUNNER_W,
    h: RUNNER_H,
    y: groundY - RUNNER_H + RUNNER_GROUND_OFFSET,
    vy: 0,
    jumpsLeft: 2,
  };

  const obstacles = [];
  let spawnTimer = 0;

  // clouds that pass sometimes
  const clouds = [];
  let cloudSpawnTimer = 0;

  // animation timers
  let runnerFrame = 0, runnerTimer = 0;
  let edelFrame = 0, edelTimer = 0;
  let alpenFrame = 0, alpenTimer = 0;
  let cloudFrame = 0, cloudTimer = 0;

  const rand = (a, b) => a + Math.random() * (b - a);

  function reset() {
    state.t = 0;
    state.speed = 2.0;
    state.score = 0;
    state.over = false;

    obstacles.length = 0;
    clouds.length = 0;

    hero.vy = 0;
    hero.jumpsLeft = 2;
    hero.y = groundY - hero.h + RUNNER_GROUND_OFFSET;

    runnerFrame = edelFrame = alpenFrame = cloudFrame = 0;
    runnerTimer = edelTimer = alpenTimer = cloudTimer = 0;

    spawnTimer = 30;
    cloudSpawnTimer = 700;
  }

  function jump() {
    if (state.over) return;
    if (hero.jumpsLeft <= 0) return;

    const groundHeroY = groundY - hero.h + RUNNER_GROUND_OFFSET;
    const onGround = hero.y >= groundHeroY - 0.5;

    hero.vy = onGround ? -14.0 : -11.5; // second jump smaller
    hero.jumpsLeft--;
  }

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (state.over) { reset(); return; }
    jump();
  }, { passive: false });

  function heroHitbox() {
    const padX = Math.floor(hero.w * 0.22);
    const padY = Math.floor(hero.h * 0.12);
    return { x: hero.x + padX, y: hero.y + padY, w: hero.w - padX * 2, h: hero.h - padY * 2 };
  }

  function rectHit(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function tickAnim(dt) {
    // edel
    edelTimer += dt;
    for (let fd = 1000 / EDEL_FPS; edelTimer >= fd; edelTimer -= fd) edelFrame = (edelFrame + 1) % EDEL_FRAMES;

    // alpen
    alpenTimer += dt;
    for (let fd = 1000 / ALPEN_FPS; alpenTimer >= fd; alpenTimer -= fd) alpenFrame = (alpenFrame + 1) % ALPEN_FRAMES;

    // cloud
    cloudTimer += dt;
    for (let fd = 1000 / CLOUD_FPS; cloudTimer >= fd; cloudTimer -= fd) cloudFrame = (cloudFrame + 1) % CLOUD_FRAMES;

    // runner only on ground
    const groundHeroY = groundY - hero.h + RUNNER_GROUND_OFFSET;
    const onGround = hero.y >= groundHeroY - 0.5;
    if (onGround) {
      runnerTimer += dt;
      for (let fd = 1000 / RUNNER_FPS; runnerTimer >= fd; runnerTimer -= fd) runnerFrame = (runnerFrame + 1) % RUNNER_FRAMES;
    }
  }

  function spawnObstacle() {
    const type = Math.random() < 0.5 ? "edelweiss" : "alpenrose";
    const w = type === "edelweiss" ? EDEL_W : ALPEN_W;
    const h = type === "edelweiss" ? EDEL_H : ALPEN_H;

    let y = groundY - h;
    if (type === "edelweiss") y += 10;
    else y += 6;

    obstacles.push({ type, x: W + 40, y, w, h });
  }

  function spawnCloud() {
    const y = rand(40, 170);
    const speed = rand(0.15, 0.45);
    const alpha = rand(0.35, 0.8);

    // small variation in size but still pixel-based
    const s = rand(0.75, 1.25);
    const w = Math.round(CLOUD_W * s);
    const h = Math.round(CLOUD_H * s);

    clouds.push({ x: W + 30, y, w, h, speed, alpha });
  }

  function step(dt) {
    if (state.over) return;

    state.speed = Math.min(4.8, state.speed + 0.00035);
    state.score += 0.08 * state.speed;

    // gravity
    hero.vy += 0.55;
    hero.y += hero.vy;

    // ground
    const groundHeroY = groundY - hero.h + RUNNER_GROUND_OFFSET;
    if (hero.y >= groundHeroY) {
      hero.y = groundHeroY;
      hero.vy = 0;
      hero.jumpsLeft = 2;
    }

    tickAnim(dt);

    // spawn obstacles
    if (state.t >= OBSTACLE_DELAY_MS) {
      spawnTimer -= 1;
      if (spawnTimer <= 0) {
        spawnObstacle();
        spawnTimer = Math.floor(rand(75, 140) / (state.speed / 3.2));
      }
    }

    // move obstacles
    for (const o of obstacles) o.x -= state.speed;
    while (obstacles.length && obstacles[0].x + obstacles[0].w < -40) obstacles.shift();

    // collision
    const hb = heroHitbox();
    for (const o of obstacles) {
      if (rectHit(hb, o)) {
        state.over = true;
        state.best = Math.max(state.best, Math.floor(state.score));
        try { localStorage.setItem("rr_best", String(state.best)); } catch {}
        break;
      }
    }

    // clouds
    cloudSpawnTimer -= dt;
    if (cloudSpawnTimer <= 0) {
      spawnCloud();
      cloudSpawnTimer = rand(1800, 4500);
    }
    for (const c of clouds) c.x -= (c.speed + state.speed * 0.10) * (dt / 16.67);
    while (clouds.length && clouds[0].x + clouds[0].w < -60) clouds.shift();
  }

  function tri(x1, y1, x2, y2, x3, y3) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.closePath();
    ctx.fill();
  }

  function drawSpritesheet(img, frameIndex, frames, dx, dy, dw, dh, alpha = 1) {
    if (!img.__ok) return false;
    const fw = Math.floor(img.width / frames);
    const fh = img.height;
    const sx = frameIndex * fw;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, sx, 0, fw, fh, dx, dy, dw, dh);
    ctx.restore();
    return true;
  }

  function drawBackground() {
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, W, H);

    const off1 = (state.t * 0.010) % W;
    ctx.fillStyle = "#18233d";
    for (let i = 0; i < 4; i++) {
      const x = -off1 + i * W;
      tri(x + 10,  groundY - 140, x + 180, groundY - 340, x + 350, groundY - 140);
      tri(x + 220, groundY - 120, x + 390, groundY - 320, x + 560, groundY - 120);
    }

    const off2 = (state.t * 0.020) % W;
    ctx.fillStyle = "#1f2a44";
    for (let i = 0; i < 4; i++) {
      const x = -off2 + i * W;
      tri(x + 40,  groundY - 120, x + 130, groundY - 240, x + 220, groundY - 120);
      tri(x + 180, groundY - 110, x + 270, groundY - 220, x + 360, groundY - 110);
      tri(x + 300, groundY - 125, x + 390, groundY - 250, x + 480, groundY - 125);
    }

    // clouds in front
    for (const c of clouds) {
      if (!drawSpritesheet(cloudImg, cloudFrame, CLOUD_FRAMES, Math.floor(c.x), Math.floor(c.y), c.w, c.h, c.alpha)) {
        ctx.fillStyle = `rgba(226,232,240,${c.alpha})`;
        ctx.fillRect(c.x, c.y, c.w, c.h);
      }
    }
  }

  function drawGround() {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, groundY, W, H - groundY);
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, groundY, W, 6);
  }

  function drawObstacles() {
    for (const o of obstacles) {
      if (o.type === "edelweiss") {
        if (!drawSpritesheet(edelImg, edelFrame, EDEL_FRAMES, o.x, o.y, o.w, o.h)) {
          ctx.fillStyle = "#38bdf8";
          ctx.fillRect(o.x, o.y, o.w, o.h);
        }
      } else {
        if (!drawSpritesheet(alpenImg, alpenFrame, ALPEN_FRAMES, o.x, o.y, o.w, o.h)) {
          ctx.fillStyle = "#fb7185";
          ctx.fillRect(o.x, o.y, o.w, o.h);
        }
      }
    }
  }

  function drawRunner() {
    if (!drawSpritesheet(runnerImg, runnerFrame, RUNNER_FRAMES, hero.x, hero.y, hero.w, hero.h)) {
      ctx.fillStyle = "#fbbf24";
      ctx.fillRect(hero.x, hero.y, hero.w, hero.h);
    }
  }

  function drawUI() {
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "16px system-ui";
    ctx.fillText(`Score: ${Math.floor(state.score)}`, 16, 28);
    ctx.fillText(`Best: ${state.best}`, 16, 50);

    // asset debug (helps you see 404 issues immediately)
    ctx.font = "12px system-ui";
    ctx.fillText(
      `assets: runner:${runnerImg.__ok? "ok":".."} edel:${edelImg.__ok? "ok":".."} alpen:${alpenImg.__ok? "ok":".."} cloud:${cloudImg.__ok? "ok":".."}`
    , 16, 70);

    if (state.over) {
      ctx.fillStyle = "rgba(2,6,23,0.65)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#fff";
      ctx.font = "22px system-ui";
      ctx.fillText("Game Over", 110, 300);
      ctx.font = "16px system-ui";
      ctx.fillText("Tap to restart", 112, 330);
    }

    if (!state.over && state.t < OBSTACLE_DELAY_MS) {
      const sLeft = Math.ceil((OBSTACLE_DELAY_MS - state.t) / 1000);
      ctx.fillStyle = "rgba(226,232,240,0.9)";
      ctx.font = "14px system-ui";
      ctx.fillText(`Warmup… ${sLeft}s`, 16, 92);
    }
  }

  function draw() {
    drawBackground();
    drawGround();
    drawObstacles();
    drawRunner();
    drawUI();
  }

  // ---- start immediately (no blocking)
  reset();

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(32, now - last);
    last = now;

    state.t += dt;
    step(dt);
    draw();

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
