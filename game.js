(() => {
  "use strict";

  // --------------------
  // Safe localStorage
  // --------------------
  function safeBestRead() {
    try { return Number(localStorage.getItem("rr_best") || 0); } catch { return 0; }
  }
  function safeBestWrite(v) {
    try { localStorage.setItem("rr_best", String(v)); } catch {}
  }

  // --------------------
  // Canvas
  // --------------------
  const canvas = document.getElementById("game");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;

  const W = canvas.width, H = canvas.height;
  const groundY = H - 110;

  const OBSTACLE_DELAY_MS = 5000;
  const RUNNER_GROUND_OFFSET = 20;

  const EDEL_GROUND_OFFSET  = 10;
  const ALPEN_GROUND_OFFSET = 6;

  const rand = (a, b) => a + Math.random() * (b - a);

  // --------------------
  // Robust image loader (handles cached images)
  // --------------------
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load: ${src}`));

      // set src AFTER handlers to avoid missing cached load event
      img.src = src;

      // if already cached/complete
      if (img.complete) {
        if (img.naturalWidth > 0) resolve(img);
        else reject(new Error(`Failed to load: ${src}`));
      }
    });
  }

  // --------------------
  // Sprite (scale-only)
  // --------------------
  function makeSprite(src, frames, fps, scale) {
    return {
      src,
      frames,
      fps,
      scale,
      img: null,
      frameW: 0,
      frameH: 0,
      frame: 0,
      timer: 0,

      async load() {
        const img = await loadImage(src);
        this.img = img;
        this.frameW = Math.floor(img.width / frames);
        this.frameH = img.height;
      },

      size() {
        return {
          w: Math.round(this.frameW * this.scale),
          h: Math.round(this.frameH * this.scale),
        };
      },

      tick(dt) {
        this.timer += dt;
        const fd = 1000 / this.fps;
        while (this.timer >= fd) {
          this.frame = (this.frame + 1) % this.frames;
          this.timer -= fd;
        }
      },

      draw(dx, dy, dw, dh, alpha = 1) {
        const sx = this.frame * this.frameW;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(this.img, sx, 0, this.frameW, this.frameH, dx, dy, dw, dh);
        ctx.restore();
      }
    };
  }

  // --------------------
  // Assets
  // --------------------
  const runner = makeSprite("assets/runner.png", 6, 6, 0.25);
  const edel   = makeSprite("assets/edelweiss.png", 3, 5, 0.11);
  const alpen  = makeSprite("assets/alpenrose.png", 4, 3, 0.20); // slower fps
  const cloud  = makeSprite("assets/cloud.png", 4, 4, 0.35);

  // --------------------
  // State
  // --------------------
  const state = {
    t: 0,
    speed: 2.0,
    score: 0,
    best: safeBestRead(),
    over: false,
    started: false,
    loadError: "",
  };

  const hero = {
    x: 70,
    y: 0,
    w: 0,
    h: 0,
    vy: 0,
    jumpsLeft: 2,
  };

  const obstacles = [];
  let spawnTimer = 0;

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

    runner.frame = runner.timer = 0;
    edel.frame = edel.timer = 0;
    alpen.frame = alpen.timer = 0;
    cloud.frame = cloud.timer = 0;
  }

  // Double jump: 2nd smaller
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
    if (!state.started) return;
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

  function spawnObstacle() {
    const type = Math.random() < 0.5 ? "edelweiss" : "alpenrose";
    let w, h;

    if (type === "edelweiss") ({ w, h } = edel.size());
    else ({ w, h } = alpen.size());

    let y = groundY - h;
    if (type === "edelweiss") y += EDEL_GROUND_OFFSET;
    else y += ALPEN_GROUND_OFFSET;

    obstacles.push({ type, x: W + 40, y, w, h });
  }

  function spawnCloud() {
    const instScale = rand(0.22, 0.42);
    const y = rand(40, 170);
    const speed = rand(0.15, 0.45);
    const alpha = rand(0.35, 0.8);

    const w = Math.round(cloud.frameW * instScale);
    const h = Math.round(cloud.frameH * instScale);

    clouds.push({ x: W + 30, y, w, h, speed, alpha });
  }

  function step(dt) {
    if (state.over) return;

    state.speed = Math.min(4.8, state.speed + 0.00035);
    state.score += 0.08 * state.speed;

    hero.vy += 0.55;
    hero.y += hero.vy;

    const groundHeroY = groundY - hero.h + RUNNER_GROUND_OFFSET;
    if (hero.y >= groundHeroY) {
      hero.y = groundHeroY;
      hero.vy = 0;
      hero.jumpsLeft = 2;
    }

    // animate
    edel.tick(dt);
    alpen.tick(dt);
    cloud.tick(dt);

    const onGround = hero.y >= groundHeroY - 0.5;
    if (onGround) runner.tick(dt);

    // spawn obstacles
    const canSpawn = state.t >= OBSTACLE_DELAY_MS;
    spawnTimer -= 1;
    if (canSpawn && spawnTimer <= 0) {
      spawnObstacle();
      spawnTimer = Math.floor(rand(75, 140) / (state.speed / 3.2));
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
        safeBestWrite(state.best);
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
      cloud.draw(Math.floor(c.x), Math.floor(c.y), c.w, c.h, c.alpha);
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
      if (o.type === "edelweiss") edel.draw(o.x, o.y, o.w, o.h);
      else alpen.draw(o.x, o.y, o.w, o.h);
    }
  }

  function drawRunner() {
    runner.draw(hero.x, hero.y, hero.w, hero.h);
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

  function drawLoadingOrError() {
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#e2e8f0";
    ctx.font = "16px system-ui";
    ctx.fillText("Loading assets…", 16, 28);

    if (state.loadError) {
      ctx.fillStyle = "#fb7185";
      ctx.fillText("ERROR:", 16, 60);
      ctx.fillStyle = "#e2e8f0";
      ctx.fillText(state.loadError, 16, 82);
      ctx.fillText("Check /assets filenames (case-sensitive).", 16, 108);
    }
  }

  function draw() {
    if (!state.started) {
      drawLoadingOrError();
      return;
    }
    drawBackground();
    drawGround();
    drawObstacles();
    drawRunner();
    drawUI();
  }

  // --------------------
  // Main loop runs ALWAYS (even while loading)
  // --------------------
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(32, now - last);
    last = now;

    state.t += dt;
    if (state.started) step(dt);
    draw();

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // --------------------
  // Preload, then start
  // --------------------
  (async () => {
    try {
      await Promise.all([runner.load(), edel.load(), alpen.load(), cloud.load()]);

      const hs = runner.size();
      hero.w = hs.w;
      hero.h = hs.h;
      hero.y = groundY - hero.h + RUNNER_GROUND_OFFSET;

      state.started = true;
      reset();
    } catch (err) {
      state.loadError = String(err?.message || err);
      console.error(err);
    }
  })();

})();
