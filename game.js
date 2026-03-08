(() => {
  "use strict";

  // --------------------
  // Safe localStorage
  // --------------------
  const safeBestRead = () => { try { return Number(localStorage.getItem("rr_best") || 0); } catch { return 0; } };
  const safeBestWrite = (v) => { try { localStorage.setItem("rr_best", String(v)); } catch {} };

  // --------------------
  // Canvas (logical size + pixel-perfect scaling)
  // --------------------
  const canvas = document.getElementById("game");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  const LOGICAL_W = canvas.width || 360;
  const LOGICAL_H = canvas.height || 640;

  let DPR = 1;

  function applyPixelPerfectResize() {
    DPR = Math.max(1, Math.floor(window.devicePixelRatio || 1));

    const pad = 24;
    const maxCssW = Math.max(200, window.innerWidth - pad);
    const maxCssH = Math.max(200, window.innerHeight - pad);

    const scaleW = Math.floor(maxCssW / LOGICAL_W);
    const scaleH = Math.floor(maxCssH / LOGICAL_H);
    const cssScale = Math.max(1, Math.min(scaleW, scaleH));

    const cssW = LOGICAL_W * cssScale;
    const cssH = LOGICAL_H * cssScale;

    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";

    canvas.width = Math.floor(LOGICAL_W * DPR);
    canvas.height = Math.floor(LOGICAL_H * DPR);

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  window.addEventListener("resize", applyPixelPerfectResize);
  applyPixelPerfectResize();

  const W = LOGICAL_W, H = LOGICAL_H;
  const groundY = H - 110;

  const OBSTACLE_DELAY_MS = 5000;
  const RUNNER_GROUND_OFFSET = 20;

  const EDEL_GROUND_OFFSET = 10;
  const ALPEN_GROUND_OFFSET = 6;
  const COW_GROUND_OFFSET = 0; // ajuste si la vache “flotte” ou s’enfonce

  const rand = (a, b) => a + Math.random() * (b - a);

  // --------------------
  // Sky stripes (30px each, dark -> light)
  // --------------------
  const SKY_STRIPE_H = 30;
  const SKY_TOP = { r: 12,  g: 55,  b: 150 };
  const SKY_BOT = { r: 150, g: 220, b: 255 };
  const lerp = (a, b, t) => a + (b - a) * t;
  const rgb = (c) => `rgb(${c.r|0},${c.g|0},${c.b|0})`;

  function drawSkyStripesHardClear() {
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalCompositeOperation = "copy";
    ctx.globalAlpha = 1;

    const stripes = Math.ceil(H / SKY_STRIPE_H);
    for (let i = 0; i < stripes; i++) {
      const t = stripes <= 1 ? 1 : i / (stripes - 1);
      const col = {
        r: lerp(SKY_TOP.r, SKY_BOT.r, t),
        g: lerp(SKY_TOP.g, SKY_BOT.g, t),
        b: lerp(SKY_TOP.b, SKY_BOT.b, t),
      };
      ctx.fillStyle = rgb(col);
      ctx.fillRect(0, i * SKY_STRIPE_H, W, SKY_STRIPE_H);
    }

    ctx.restore();
  }

  // --------------------
  // Panorama (RR-Panorama.png)
  // --------------------
  const panoImg = new Image();
  panoImg.onload = () => { panoImg.__ok = true; };
  panoImg.onerror = () => { panoImg.__ok = false; console.warn("Asset failed: assets/RR-Panorama.png"); };
  panoImg.src = "assets/RR-Panorama.png";

  const PANO_BASE_SPEED = 0.018;     // px/ms
  const PANO_SPEED_FACTOR = 0.14;    // linked to runner speed
  const PANO_Y = -30;

  // --------------------
  // Two-size-logic sprites
  // --------------------
  function makeSprite({ src, frames, fps, scale, fallbackW, fallbackH }) {
    const img = new Image();
    const spr = {
      img, src, frames, fps, scale, fallbackW, fallbackH,
      ready: false, frameW: 0, frameH: 0, frame: 0, timer: 0,
    };

    img.onload = () => {
      spr.ready = true;
      spr.frameW = Math.floor(img.width / frames);
      spr.frameH = img.height;
    };
    img.onerror = () => {
      spr.ready = false;
      console.warn("Asset failed:", src);
    };

    img.src = src;

    spr.size = () => {
      if (spr.ready && spr.frameW > 0 && spr.frameH > 0) {
        return { w: Math.round(spr.frameW * spr.scale), h: Math.round(spr.frameH * spr.scale) };
      }
      return { w: spr.fallbackW, h: spr.fallbackH };
    };

    spr.tick = (dt) => {
      spr.timer += dt;
      const fd = 1000 / spr.fps;
      while (spr.timer >= fd) {
        spr.frame = (spr.frame + 1) % spr.frames;
        spr.timer -= fd;
      }
    };

    spr.draw = (dx, dy, dw, dh, alpha = 1) => {
      if (!spr.ready || spr.frameW <= 0) return false;
      const sx = spr.frame * spr.frameW;

      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = alpha;
      ctx.drawImage(spr.img, sx, 0, spr.frameW, spr.frameH, dx, dy, dw, dh);
      ctx.restore();
      return true;
    };

    return spr;
  }

  const runner = makeSprite({ src:"assets/runner.png", frames:6, fps:6, scale:0.25, fallbackW:42, fallbackH:46 });
  const edel   = makeSprite({ src:"assets/edelweiss.png", frames:3, fps:5, scale:0.11, fallbackW:42, fallbackH:34 });
  const alpen  = makeSprite({ src:"assets/alpenrose.png", frames:4, fps:3, scale:0.20, fallbackW:47, fallbackH:40 });
  const cloud  = makeSprite({ src:"assets/cloud.png", frames:4, fps:4, scale:0.35, fallbackW:90, fallbackH:48 });

  // ✅ NEW obstacle: cow.png (assumed 4 frames)
  const cow    = makeSprite({ src:"assets/cow.png", frames:4, fps:4, scale:0.22, fallbackW:48, fallbackH:40 });

  // --------------------
  // Game state
  // --------------------
  const state = {
    t: 0,
    speed: 2.0,
    score: 0,
    best: safeBestRead(),
    over: false,
    panoX: 0,
  };

  const hero = { x: 70, y: 0, w: 42, h: 46, vy: 0, jumpsLeft: 2 };

  const obstacles = [];
  let spawnTimer = 0;

  // Clouds
  const clouds = [];
  let cloudSpawnTimer = 0;

  const CLOUD_INST_SCALE_MIN = 0.16;
  const CLOUD_INST_SCALE_MAX = 0.30;

  const CLOUD_LEFT_SPEED_MIN = 0.020;
  const CLOUD_LEFT_SPEED_MAX = 0.055;

  const CLOUD_SPAWN_MIN_MS = 5000;
  const CLOUD_SPAWN_MAX_MS = 12000;

  function reset() {
    state.t = 0;
    state.speed = 2.0;
    state.score = 0;
    state.over = false;
    state.panoX = 0;

    obstacles.length = 0;
    clouds.length = 0;

    spawnTimer = 0;
    cloudSpawnTimer = 0;

    const hs = runner.size();
    hero.w = hs.w;
    hero.h = hs.h;
    hero.vy = 0;
    hero.jumpsLeft = 2;
    hero.y = groundY - hero.h + RUNNER_GROUND_OFFSET;

    runner.frame = runner.timer = 0;
    edel.frame = edel.timer = 0;
    alpen.frame = alpen.timer = 0;
    cloud.frame = cloud.timer = 0;
    cow.frame = cow.timer = 0;
  }

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
  }, { passive:false });

  function heroHitbox() {
    const padX = Math.floor(hero.w * 0.22);
    const padY = Math.floor(hero.h * 0.12);
    return { x: hero.x+padX, y: hero.y+padY, w: hero.w-padX*2, h: hero.h-padY*2 };
  }

  function rectHit(a,b){
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function spawnObstacle() {
    // weights: edel 40%, alpen 40%, cow 20%
    const r = Math.random();
    const type = (r < 0.40) ? "edelweiss" : (r < 0.80 ? "alpenrose" : "cow");

    let w, h, y;

    if (type === "edelweiss") {
      ({ w, h } = edel.size());
      y = groundY - h + EDEL_GROUND_OFFSET;
    } else if (type === "alpenrose") {
      ({ w, h } = alpen.size());
      y = groundY - h + ALPEN_GROUND_OFFSET;
    } else {
      ({ w, h } = cow.size());
      y = groundY - h + COW_GROUND_OFFSET;
    }

    obstacles.push({ type, x: W + 40, y, w, h });
  }

  function spawnCloud() {
    const y = rand(20, 200);
    const instScale = rand(CLOUD_INST_SCALE_MIN, CLOUD_INST_SCALE_MAX);
    const vx = rand(CLOUD_LEFT_SPEED_MIN, CLOUD_LEFT_SPEED_MAX);

    let w, h;
    if (cloud.ready) {
      w = Math.round(cloud.frameW * instScale);
      h = Math.round(cloud.frameH * instScale);
    } else {
      w = Math.round(cloud.fallbackW * instScale);
      h = Math.round(cloud.fallbackH * instScale);
    }

    clouds.push({ x: W + 40, y, w, h, vx });
  }

  function step(dt) {
    if (state.over) return;

    // update hero size if runner loads later (only when grounded)
    const groundHeroY_old = groundY - hero.h + RUNNER_GROUND_OFFSET;
    const onGroundBefore = hero.y >= groundHeroY_old - 0.5;
    if (runner.ready && onGroundBefore) {
      const hs = runner.size();
      if (hs.w !== hero.w || hs.h !== hero.h) {
        hero.w = hs.w;
        hero.h = hs.h;
        hero.y = groundY - hero.h + RUNNER_GROUND_OFFSET;
      }
    }

    // difficulty
    state.speed = Math.min(4.8, state.speed + 0.00035);
    state.score += 0.08 * state.speed;

    // pano scroll
    const panoSpeed = PANO_BASE_SPEED + (state.speed * PANO_SPEED_FACTOR * 0.001);
    state.panoX += dt * panoSpeed;

    // physics
    hero.vy += 0.55;
    hero.y += hero.vy;

    const groundHeroY = groundY - hero.h + RUNNER_GROUND_OFFSET;
    if (hero.y >= groundHeroY) {
      hero.y = groundHeroY;
      hero.vy = 0;
      hero.jumpsLeft = 2;
    }

    // animations
    edel.tick(dt);
    alpen.tick(dt);
    cow.tick(dt);
    cloud.tick(dt);
    if (hero.y >= groundHeroY - 0.5) runner.tick(dt);

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

    // clouds spawn less often
    cloudSpawnTimer -= dt;
    if (cloudSpawnTimer <= 0) {
      spawnCloud();
      cloudSpawnTimer = rand(CLOUD_SPAWN_MIN_MS, CLOUD_SPAWN_MAX_MS);
    }

    // clouds move left independent of pano
    for (const c of clouds) c.x -= dt * c.vx;
    while (clouds.length && clouds[0].x + clouds[0].w < -80) clouds.shift();
  }

  // --------------------
  // Drawing
  // --------------------
  function drawPanorama() {
    if (!panoImg.__ok) return false;

    const imgW = panoImg.width || 0;
    const imgH = panoImg.height || 0;
    if (imgW <= 0 || imgH <= 0) return false;

    const scale = H / imgH;
    const drawW = Math.round(imgW * scale);
    const drawH = Math.round(H);

    const scrollPx = Math.floor(state.panoX * scale);
    let x = -(scrollPx % drawW);
    if (x > 0) x -= drawW;

    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    for (; x < W; x += drawW) {
      ctx.drawImage(panoImg, x, PANO_Y, drawW, drawH);
    }
    ctx.restore();

    return true;
  }

  function drawClouds() {
    for (const c of clouds) {
      const dx = Math.floor(c.x);
      const dy = Math.floor(c.y);

      if (!cloud.draw(dx, dy, c.w, c.h, 1)) {
        ctx.save();
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(dx, dy, c.w, c.h);
        ctx.restore();
      }
    }
  }

  function drawBackground() {
    // 1) sky stripes (hard clear)
    drawSkyStripesHardClear();

    // 2) panorama on top (transparent pixels show sky)
    drawPanorama();

    // 3) clouds in front moving left
    drawClouds();
  }

  function drawGround() {
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, groundY, W, H - groundY);
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, groundY, W, 6);
    ctx.restore();
  }

  function drawObstacles() {
    for (const o of obstacles) {
      const ox = Math.floor(o.x), oy = Math.floor(o.y);

      if (o.type === "edelweiss") {
        if (!edel.draw(ox, oy, o.w, o.h, 1)) {
          ctx.save();
          ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
          ctx.fillStyle = "#38bdf8";
          ctx.fillRect(ox, oy, o.w, o.h);
          ctx.restore();
        }
      } else if (o.type === "alpenrose") {
        if (!alpen.draw(ox, oy, o.w, o.h, 1)) {
          ctx.save();
          ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
          ctx.fillStyle = "#fb7185";
          ctx.fillRect(ox, oy, o.w, o.h);
          ctx.restore();
        }
      } else {
        // cow
        if (!cow.draw(ox, oy, o.w, o.h, 1)) {
          ctx.save();
          ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(ox, oy, o.w, o.h);
          ctx.restore();
        }
      }
    }
  }

  function drawRunner() {
    const hx = Math.floor(hero.x), hy = Math.floor(hero.y);
    if (!runner.draw(hx, hy, hero.w, hero.h, 1)) {
      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.fillStyle = "#fbbf24";
      ctx.fillRect(hx, hy, hero.w, hero.h);
      ctx.restore();
    }
  }

  function drawUI() {
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
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
      ctx.fillStyle = "rgba(226,232,240,0.95)";
      ctx.font = "14px system-ui";
      ctx.fillText(`Warmup… ${sLeft}s`, 16, 92);
    }

    ctx.restore();
  }

  function draw() {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = false;

    drawBackground();
    drawGround();
    drawObstacles();
    drawRunner();
    drawUI();
  }

  // --------------------
  // Start
  // --------------------
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
