(() => {
  "use strict";

  // --------------------
  // Safe localStorage (évite crash en mode privé)
  // --------------------
  function safeBestRead() {
    try { return Number(localStorage.getItem("rr_best") || 0); }
    catch { return 0; }
  }
  function safeBestWrite(v) {
    try { localStorage.setItem("rr_best", String(v)); } catch {}
  }

  // --------------------
  // Canvas bootstrap
  // --------------------
  const canvas = document.getElementById("game");
  if (!canvas) { console.error('Canvas "#game" introuvable.'); return; }
  const ctx = canvas.getContext("2d");
  if (!ctx) { console.error("Contexte 2D indisponible."); return; }
  ctx.imageSmoothingEnabled = false;

  const W = canvas.width, H = canvas.height;
  const groundY = H - 110;

  const OBSTACLE_DELAY_MS = 5000;
  const RUNNER_GROUND_OFFSET = 20;

  const EDEL_GROUND_OFFSET  = 10;
  const ALPEN_GROUND_OFFSET = 6;

  const rand = (a, b) => a + Math.random() * (b - a);

  // --------------------
  // Image loading helper
  // --------------------
  function makeSprite(src, frames, fps, scale) {
    const img = new Image();
    img.src = src;

    const spr = {
      img,
      ready: false,
      frames,
      fps,
      scale,
      frameW: 0,
      frameH: 0,
      frame: 0,
      timer: 0,
      onload: null,
    };

    img.onload = () => {
      spr.ready = true;
      spr.frameW = Math.floor(img.width / frames);
      spr.frameH = img.height;
      if (typeof spr.onload === "function") spr.onload();
    };
    img.onerror = () => { spr.ready = false; };

    return spr;
  }

  // --------------------
  // Sprites
  // --------------------
  const runner = makeSprite("assets/runner.png", 6, 6, 0.25);
  const edel   = makeSprite("assets/edelweiss.png", 3, 5, 0.11);
  const alpen  = makeSprite("assets/alpenrose.png", 4, 6, 0.12);
  const cloud  = makeSprite("assets/cloud.png", 4, 4, 0.35);

  // --------------------
  // Game state
  // --------------------
  const state = {
    t: 0,
    speed: 2.0,
    score: 0,
    best: safeBestRead(),
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

  runner.onload = () => {
    hero.w = Math.round(runner.frameW * runner.scale);
    hero.h = Math.round(runner.frameH * runner.scale);
    hero.y = (groundY - hero.h + RUNNER_GROUND_OFFSET);
  };

  const obstacles = [];
  let spawnTimer = 0;

  // Clouds (petits nuages qui passent de temps en temps)
  const clouds = [];
  let cloudSpawnTimer = 0;

  function reset() {
    state.t = 0;
    state.speed = 2.0;
    state.score = 0;
    state.over = false;

    obstacles.length = 0;
    spawnTimer = 0;

    clouds.length = 0;
    cloudSpawnTimer = 0;

    hero.vy = 0;
    hero.jumpsLeft = 2;
    hero.y = groundY - hero.h + RUNNER_GROUND_OFFSET;

    runner.frame = 0; runner.timer = 0;
    edel.frame = 0;   edel.timer = 0;
    alpen.frame = 0;  alpen.timer = 0;
    cloud.frame = 0;  cloud.timer = 0;
  }

  // Double jump: 2e saut plus petit
  function jump() {
    if (state.over) return;
    if (hero.jumpsLeft <= 0) return;

    const groundHeroY = groundY - hero.h + RUNNER_GROUND_OFFSET;
    const onGround = hero.y >= groundHeroY - 0.5;

    hero.vy = onGround ? -14.0 : -11.5;
    hero.jumpsLeft -= 1;
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

  function animSprite(spr, dt) {
    if (!spr.ready) return;
    spr.timer += dt;
    const fd = 1000 / spr.fps;
    while (spr.timer >= fd) {
      spr.frame = (spr.frame + 1) % spr.frames;
      spr.timer -= fd;
    }
  }

  function spawnObstacle() {
    const r = Math.random();
    const type =
      r < 0.25 ? "edelweiss" :
      r < 0.50 ? "alpenrose" :
      (Math.random() < 0.5 ? "rock" : "tree");

    let w, h;

    if (type === "edelweiss") {
      if (edel.ready) {
        w = Math.round(edel.frameW * edel.scale);
        h = Math.round(edel.frameH * edel.scale);
      } else { w = 42; h = 34; }
    } else if (type === "alpenrose") {
      if (alpen.ready) {
        w = Math.round(alpen.frameW * alpen.scale);
        h = Math.round(alpen.frameH * alpen.scale);
      } else { w = 44; h = 36; }
    } else {
      w = (type === "tree" ? 30 : 24);
      h = (type === "tree" ? 48 : 22);
    }

    let y = groundY - h;
    if (type === "edelweiss") y = groundY - h + EDEL_GROUND_OFFSET;
    if (type === "alpenrose") y = groundY - h + ALPEN_GROUND_OFFSET;

    obstacles.push({ type, x: W + 40, y, w, h });
  }

  function spawnCloud() {
    // nuage “devant les montagnes”, pas au niveau du sol
    const scale = rand(0.22, 0.42);
    const y = rand(40, 170);
    const speed = rand(0.15, 0.45); // px/frame approx, multiplié par dt
    const alpha = rand(0.35, 0.8);

    let w = 60, h = 32;
    if (cloud.ready) {
      w = Math.round(cloud.frameW * scale);
      h = Math.round(cloud.frameH * scale);
    }
    clouds.push({ x: W + 30, y, w, h, speed, alpha, scale });
  }

  function step(dt) {
    if (state.over) return;

    // ramp difficulty
    state.speed = Math.min(4.8, state.speed + 0.00035);
    state.score += 0.08 * state.speed;

    // gravity
    hero.vy += 0.55;
    hero.y += hero.vy;

    // ground collision
    const groundHeroY = groundY - hero.h + RUNNER_GROUND_OFFSET;
    if (hero.y >= groundHeroY) {
      hero.y = groundHeroY;
      hero.vy = 0;
      hero.jumpsLeft = 2;
    }

    // animate sprites
    animSprite(edel, dt);
    animSprite(alpen, dt);
    animSprite(cloud, dt);

    // runner anim only on ground
    const onGround = hero.y >= groundHeroY - 0.5;
    if (runner.ready && onGround) animSprite(runner, dt);

    // obstacle spawning
    const canSpawn = state.t >= OBSTACLE_DELAY_MS;
    spawnTimer -= 1;
    if (canSpawn && spawnTimer <= 0) {
      spawnObstacle();
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
        safeBestWrite(state.best);
        break;
      }
    }

    // cloud spawn timing (occasionnel)
    cloudSpawnTimer -= dt;
    if (cloudSpawnTimer <= 0) {
      // spawn un nuage puis attend 1.8s–4.5s
      spawnCloud();
      cloudSpawnTimer = rand(1800, 4500);
    }

    // move clouds (parallax doux)
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

  function drawSpriteFrame(spr, frameIndex, dx, dy, dw, dh, alpha = 1) {
    if (!spr.ready) return false;
    const sx = frameIndex * spr.frameW;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(spr.img, sx, 0, spr.frameW, spr.frameH, dx, dy, dw, dh);
    ctx.restore();
    return true;
  }

  function drawBackground() {
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, W, H);

    // mountains far layer
    const off1 = (state.t * 0.010) % W;
    ctx.fillStyle = "#18233d";
    for (let i = 0; i < 4; i++) {
      const x = -off1 + i * W;
      tri(x + 10,  groundY - 140, x + 180, groundY - 340, x + 350, groundY - 140);
      tri(x + 220, groundY - 120, x + 390, groundY - 320, x + 560, groundY - 120);
    }

    // mountains near layer
    const off2 = (state.t * 0.020) % W;
    ctx.fillStyle = "#1f2a44";
    for (let i = 0; i < 4; i++) {
      const x = -off2 + i * W;
      tri(x + 40,  groundY - 120, x + 130, groundY - 240, x + 220, groundY - 120);
      tri(x + 180, groundY - 110, x + 270, groundY - 220, x + 360, groundY - 110);
      tri(x + 300, groundY - 125, x + 390, groundY - 250, x + 480, groundY - 125);
    }

    // clouds in front of mountains (occasionnels)
    for (const c of clouds) {
      if (!cloud.ready) {
        ctx.fillStyle = "rgba(226,232,240,0.35)";
        ctx.fillRect(c.x, c.y, c.w, c.h);
      } else {
        drawSpriteFrame(cloud, cloud.frame, Math.floor(c.x), Math.floor(c.y), c.w, c.h, c.alpha);
      }
    }
  }

  function drawObstacles() {
    for (const o of obstacles) {
      if (o.type === "edelweiss") {
        if (!drawSpriteFrame(edel, edel.frame, o.x, o.y, o.w, o.h)) {
          ctx.fillStyle = "#38bdf8";
          ctx.fillRect(o.x, o.y, o.w, o.h);
        }
      } else if (o.type === "alpenrose") {
        if (!drawSpriteFrame(alpen, alpen.frame, o.x, o.y, o.w, o.h)) {
          ctx.fillStyle = "#fb7185";
          ctx.fillRect(o.x, o.y, o.w, o.h);
        }
      } else {
        ctx.fillStyle = o.type === "rock" ? "#94a3b8" : "#22c55e";
        ctx.fillRect(o.x, o.y, o.w, o.h);
      }
    }
  }

  function drawRunner() {
    if (!runner.ready) {
      ctx.fillStyle = "#fbbf24";
      ctx.fillRect(hero.x, hero.y, hero.w, hero.h);
      return;
    }
    drawSpriteFrame(runner, runner.frame, hero.x, hero.y, hero.w, hero.h);
  }

  function drawUI() {
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "16px system-ui";
    ctx.fillText(`Score: ${Math.floor(state.score)}`, 16, 28);
    ctx.fillText(`Best: ${state.best}`, 16, 50);

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
      ctx.fillText(`Warmup… ${sLeft}s`, 16, 72);
    }
  }

  function drawGround() {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, groundY, W, H - groundY);
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, groundY, W, 6);
  }

  function draw() {
    drawBackground();
    drawGround();
    drawObstacles();
    drawRunner();
    drawUI();
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(32, now - last);
    last = now;

    state.t += dt;
    step(dt);
    draw();

    requestAnimationFrame(loop);
  }

  // Start
  requestAnimationFrame(loop);
})();
