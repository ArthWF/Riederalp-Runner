(() => {
  "use strict";

  // --------------------
  // Safe localStorage
  // --------------------
  const safeBestRead = () => { try { return Number(localStorage.getItem("rr_best") || 0); } catch { return 0; } };
  const safeBestWrite = (v) => { try { localStorage.setItem("rr_best", String(v)); } catch {} };

  // --------------------
  // Canvas (logical size)
  // --------------------
  const canvas = document.getElementById("game");
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  // Logical game resolution
  const LOGICAL_W = canvas.width || 360;
  const LOGICAL_H = canvas.height || 640;

  // Pixel-perfect + DPR
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

  const rand = (a, b) => a + Math.random() * (b - a);

  // --------------------
  // SKY: horizontal stripes (30px each)
  // --------------------
  const SKY_STRIPE_H = 30;

  // pick 2 blues (top darker -> bottom lighter)
  const SKY_TOP = { r: 10,  g: 35,  b: 110 };
  const SKY_BOT = { r: 110, g: 190, b: 255 };

  function lerp(a, b, t) { return a + (b - a) * t; }
  function rgb({r,g,b}) { return `rgb(${r|0},${g|0},${b|0})`; }

  function drawSkyStripesHardClear() {
    // Hard overwrite entire frame (prevents any trails)
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalCompositeOperation = "copy";
    ctx.globalAlpha = 1;

    // draw stripes top->bottom
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
  // Panorama
  // --------------------
  const panoImg = new Image();
  panoImg.onload = () => { panoImg.__ok = true; };
  panoImg.onerror = () => { panoImg.__ok = false; console.warn("Asset failed: assets/RR-Panorama.png"); };
  panoImg.src = "assets/RR-Panorama.png";

  const PANO_BASE_SPEED = 0.018;     // px/ms
  const PANO_SPEED_FACTOR = 0.14;    // linked to runner speed
  const PANO_Y = -30;                // raise pano by 30px

  // --------------------
  // TWO size logics sprites
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

    spr.draw = (dx, dy, dw, dh) => {
      if (!spr.ready || spr.frameW <= 0) return false;
      const sx = spr.frame * spr.frameW;
      ctx.save();
      ctx.globalAlpha = 1; // clouds must be opaque too
      ctx.globalCompositeOperation = "source-over";
      ctx.imageSmoothingEnabled = false;
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

  // --------------------
  // State
  // --------------------
  const state = {
    t: 0,
    speed: 2.0,
    score: 0,
    best: safeBestRead(),
    over: false,
    panoX: 0, // source px
  };

  const hero = { x: 70, y: 0, w: 42, h: 46, vy: 0, jumpsLeft: 2 };
  const obstacles = [];
  let spawnTimer = 0;

  // clouds now have layer: "behind" or "front"
  const clouds = [];
  let cloudSpawnTimer = 0;

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
    hero.w = hs.w; hero.h = hs.h;
    hero.vy = 0;
    hero.jumpsLeft = 2;
    hero.y = groundY - hero.h + RUNNER_GROUND_OFFSET;

    runner.frame = runner.timer = 0;
    edel.frame = edel.timer = 0;
    alpen.frame = alpen.timer = 0;
    cloud.frame = cloud.timer = 0;
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
    const type = Math.random() < 0.5 ? "edelweiss" : "alpenrose";
    const s = (type === "edelweiss") ? edel.size() : alpen.size();
    const w = s.w, h = s.h;

    let y = groundY - h;
    y += (type === "edelweiss") ? EDEL_GROUND_OFFSET : ALPEN_GROUND_OFFSET;

    obstacles.push({ type, x: W + 40, y, w, h });
  }

  function spawnCloud() {
    // clouds should be behind pano sometimes
    const layer = Math.random() < 0.55 ? "behind" : "front";

    const y = rand(30, 190);
    const speed = rand(0.10, 0.30); // slightly slower
    const instScale = rand(0.22, 0.42);

    let w, h;
    if (cloud.ready) {
      w = Math.round(cloud.frameW * instScale);
      h = Math.round(cloud.frameH * instScale);
    } else {
      w = Math.round(cloud.fallbackW * instScale);
      h = Math.round(cloud.fallbackH * instScale);
    }

    // opaque: no alpha
    clouds.push({ x: W + 30, y, w, h, speed, layer });
  }

  function step(dt) {
    if (state.over) return;

    // update hero size if runner loads later (only when grounded)
    const groundHeroY_old = groundY - hero.h + RUNNER_GROUND_OFFSET;
    const onGroundBefore = hero.y >= groundHeroY_old - 0.5;
    if (runner.ready && onGroundBefore) {
      const hs = runner.size();
      if (hs.w !== hero.w || hs.h !== hero.h) {
        hero.w = hs.w; hero.h = hs.h;
        hero.y = groundY - hero.h + RUNNER_GROUND_OFFSET;
      }
    }

    state.speed = Math.min(4.8, state.speed + 0.00035);
    state.score += 0.08 * state.speed;

    // panorama scroll
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
    cloud.tick(dt);
    if (hero.y >= groundHeroY - 0.5) runner.tick(dt);

    // obstacles
    if (state.t >= OBSTACLE_DELAY_MS) {
      spawnTimer -= 1;
      if (spawnTimer <= 0) {
        spawnObstacle();
        spawnTimer = Math.floor(rand(75, 140) / (state.speed / 3.2));
      }
    }

    for (const o of obstacles) o.x -= state.speed;
    while (obstacles.length && obstacles[0].x + obstacles[0].w < -40) obstacles.shift();

    const hb = heroHitbox();
    for (const o of obstacles) {
      if (rectHit(hb, o)) {
        state.over = true;
        state.best = Math.max(state.best, Math.floor(state.score));
        safeBestWrite(state.best);
        break;
      }
    }

    // spawn fewer clouds: increase delay range
    cloudSpawnTimer -= dt;
    if (cloudSpawnTimer <= 0) {
      spawnCloud();
      cloudSpawnTimer = rand(3500, 9000); // ⬅️ fewer clouds
    }

    // move clouds
    for (const c of clouds) {
      // clouds move slower than obstacles (parallax)
      c.x -= (c.speed + state.speed * 0.06) * (dt / 16.67);
    }
    while (clouds.length && clouds[0].x + clouds[0].w < -80) clouds.shift();
  }

  // --------------------
  // Drawing
  // --------------------
  function tri(x1,y1,x2,y2,x3,y3){
    ctx.beginPath();
    ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.lineTo(x3,y3);
    ctx.closePath(); ctx.fill();
  }

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

  function drawFallbackMountains() {
    // if pano missing, draw simple dark silhouettes on top of sky
    const off1 = (state.t * 0.010) % W;
    ctx.fillStyle = "#18233d";
    for (let i=0;i<4;i++){
      const x = -off1 + i*W;
      tri(x + 10,  groundY-140, x + 180, groundY-340, x + 350, groundY-140);
      tri(x + 220, groundY-120, x + 390, groundY-320, x + 560, groundY-120);
    }

    const off2 = (state.t * 0.020) % W;
    ctx.fillStyle = "#1f2a44";
    for (let i=0;i<4;i++){
      const x = -off2 + i*W;
      tri(x + 40,  groundY-120, x + 130, groundY-240, x + 220, groundY-120);
      tri(x + 180, groundY-110, x + 270, groundY-220, x + 360, groundY-110);
      tri(x + 300, groundY-125, x + 390, groundY-250, x + 480, groundY-125);
    }
  }

  function drawClouds(layer) {
    for (const c of clouds) {
      if (c.layer !== layer) continue;

      const dx = Math.floor(c.x);
      const dy = Math.floor(c.y);

      if (!cloud.draw(dx, dy, c.w, c.h)) {
        // opaque fallback
        ctx.fillStyle = "#e2e8f0";
        ctx.fillRect(dx, dy, c.w, c.h);
      }
    }
  }

  function drawBackground() {
    // 1) hard overwrite sky stripes (prevents any trails)
    drawSkyStripesHardClear();

    // 2) clouds BEHIND pano
    drawClouds("behind");

    // 3) pano (or fallback mountains)
    const ok = drawPanorama();
    if (!ok) drawFallbackMountains();

    // 4) clouds FRONT
    drawClouds("front");
  }

  function drawGround() {
    // If your pano already includes the ground, comment this out
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, groundY, W, H - groundY);
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, groundY, W, 6);
  }

  function drawObstacles() {
    for (const o of obstacles) {
      if (o.type === "edelweiss") {
        if (!edel.draw(Math.floor(o.x), Math.floor(o.y), o.w, o.h)) {
          ctx.fillStyle = "#38bdf8";
          ctx.fillRect(o.x, o.y, o.w, o.h);
        }
      } else {
        if (!alpen.draw(Math.floor(o.x), Math.floor(o.y), o.w, o.h)) {
          ctx.fillStyle = "#fb7185";
          ctx.fillRect(o.x, o.y, o.w, o.h);
        }
      }
    }
  }

  function drawRunner() {
    if (!runner.draw(Math.floor(hero.x), Math.floor(hero.y), hero.w, hero.h)) {
      ctx.fillStyle = "#fbbf24";
      ctx.fillRect(hero.x, hero.y, hero.w, hero.h);
    }
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
      ctx.fillStyle = "rgba(226,232,240,0.95)";
      ctx.font = "14px system-ui";
      ctx.fillText(`Warmup… ${sLeft}s`, 16, 92);
    }
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
  function loop(now){
    const dt = Math.min(32, now - last);
    last = now;

    state.t += dt;
    step(dt);
    draw();

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
