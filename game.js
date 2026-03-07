(() => {
  "use strict";

  // --------------------
  // Safe localStorage
  // --------------------
  const safeBestRead = () => { try { return Number(localStorage.getItem("rr_best") || 0); } catch { return 0; } };
  const safeBestWrite = (v) => { try { localStorage.setItem("rr_best", String(v)); } catch {} };

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

  // obstacle offsets (visual)
  const EDEL_GROUND_OFFSET = 10;
  const ALPEN_GROUND_OFFSET = 6;

  const rand = (a,b)=> a + Math.random()*(b-a);

  // --------------------
  // Panorama (new background)
  // --------------------
  const panoImg = new Image();
  panoImg.onload = () => { panoImg.__ok = true; };
  panoImg.onerror = () => { panoImg.__ok = false; console.warn("Asset failed: assets/RR-Panorama.png"); };
  panoImg.src = "assets/RR-Panorama.png";

  // pano scrolling speed (px per ms). Tune to taste.
  // If you want it linked to game speed, we combine both.
  const PANO_BASE_SPEED = 0.018;     // constant drift
  const PANO_SPEED_FACTOR = 0.14;    // how much the pano follows runner speed

  // vertical placement of pano (it is 640px high, same as canvas height)
  // If your pano is exactly 640px tall and you want it full screen: set 0.
  const PANO_Y = 0;

  // --------------------
  // TWO size logics:
  // - if sprite loaded: size from sprite frame * scale
  // - else: fallback pixel size
  // --------------------
  function makeSprite({ src, frames, fps, scale, fallbackW, fallbackH }) {
    const img = new Image();
    const spr = {
      img,
      src,
      frames,
      fps,
      scale,
      fallbackW,
      fallbackH,
      ready: false,
      frameW: 0,
      frameH: 0,
      frame: 0,
      timer: 0,
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

    // set src AFTER handlers
    img.src = src;

    // size getter
    spr.size = () => {
      if (spr.ready && spr.frameW > 0 && spr.frameH > 0) {
        return {
          w: Math.round(spr.frameW * spr.scale),
          h: Math.round(spr.frameH * spr.scale),
        };
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
      ctx.globalAlpha = alpha;
      ctx.drawImage(spr.img, sx, 0, spr.frameW, spr.frameH, dx, dy, dw, dh);
      ctx.restore();
      return true;
    };

    return spr;
  }

  // --------------------
  // Sprites
  // --------------------
  const runner = makeSprite({
    src:"assets/runner.png", frames:6, fps:6, scale:0.25,
    fallbackW:42, fallbackH:46
  });

  const edel = makeSprite({
    src:"assets/edelweiss.png", frames:3, fps:5, scale:0.11,
    fallbackW:42, fallbackH:34
  });

  const alpen = makeSprite({
    src:"assets/alpenrose.png", frames:4, fps:3, scale:0.20, // slower anim
    fallbackW:47, fallbackH:40
  });

  const cloud = makeSprite({
    src:"assets/cloud.png", frames:4, fps:4, scale:0.35,
    fallbackW:90, fallbackH:48
  });

  // --------------------
  // State
  // --------------------
  const state = {
    t: 0,        // ms
    speed: 2.0,
    score: 0,
    best: safeBestRead(),
    over: false,
    panoX: 0,    // panorama scroll offset in pixels (source space)
  };

  const hero = {
    x: 70,
    y: 0,
    w: 42,
    h: 46,
    vy: 0,
    jumpsLeft: 2,
  };

  const obstacles = [];
  let spawnTimer = 0;

  // occasional clouds
  const clouds = [];
  let cloudSpawnTimer = 0;

  function reset() {
    state.t = 0;
    state.speed = 2.0;
    state.score = 0;
    state.over = false;
    state.panoX = 0;

    obstacles.length = 0;
    spawnTimer = 0;

    clouds.length = 0;
    cloudSpawnTimer = 0;

    // hero adopts runner size (scale if ready else fallback)
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
  }

  function jump() {
    if (state.over) return;
    if (hero.jumpsLeft <= 0) return;

    const groundHeroY = groundY - hero.h + RUNNER_GROUND_OFFSET;
    const onGround = hero.y >= groundHeroY - 0.5;

    // double jump: 2nd smaller
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
    if (type === "edelweiss") y += EDEL_GROUND_OFFSET;
    else y += ALPEN_GROUND_OFFSET;

    obstacles.push({ type, x: W + 40, y, w, h });
  }

  function spawnCloud() {
    const y = rand(40, 170);
    const speed = rand(0.15, 0.45);
    const alpha = rand(0.35, 0.8);

    const instScale = rand(0.22, 0.42);
    let w, h;

    if (cloud.ready) {
      w = Math.round(cloud.frameW * instScale);
      h = Math.round(cloud.frameH * instScale);
    } else {
      w = Math.round(cloud.fallbackW * instScale);
      h = Math.round(cloud.fallbackH * instScale);
    }

    clouds.push({ x: W + 30, y, w, h, speed, alpha });
  }

  function tri(x1,y1,x2,y2,x3,y3){
    ctx.beginPath();
    ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.lineTo(x3,y3);
    ctx.closePath(); ctx.fill();
  }

  function step(dt) {
    if (state.over) return;

    // if runner loads later, update hero size ONCE when grounded (avoid mid-air pop)
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

    // difficulty ramp
    state.speed = Math.min(4.8, state.speed + 0.00035);
    state.score += 0.08 * state.speed;

    // panorama scrolling (independent + linked to speed)
    // move in "source pixels" per ms
    const panoSpeed = PANO_BASE_SPEED + (state.speed * PANO_SPEED_FACTOR * 0.001);
    state.panoX += dt * panoSpeed;

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

    // animate sprites (no blocking)
    edel.tick(dt);
    alpen.tick(dt);
    cloud.tick(dt);

    // runner anim only on ground
    const onGround = hero.y >= groundHeroY - 0.5;
    if (onGround) runner.tick(dt);

    // spawn obstacles after delay
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

    // clouds spawn
    cloudSpawnTimer -= dt;
    if (cloudSpawnTimer <= 0) {
      spawnCloud();
      cloudSpawnTimer = rand(1800, 4500);
    }
    for (const c of clouds) c.x -= (c.speed + state.speed * 0.10) * (dt / 16.67);
    while (clouds.length && clouds[0].x + clouds[0].w < -60) clouds.shift();
  }

  // --------------------
  // Draw panorama (looping)
  // --------------------
  function drawPanorama() {
    if (!panoImg.__ok) return false;

    const imgW = panoImg.width || 0;
    const imgH = panoImg.height || 0;
    if (imgW <= 0 || imgH <= 0) return false;

    // Scale pano to canvas height (640 -> H). Keeps aspect by scaling width accordingly.
    const scale = H / imgH;
    const drawW = imgW * scale;
    const drawH = H;

    // Looping offset in draw space
    let x = -(state.panoX * scale) % drawW;
    if (x > 0) x -= drawW;

    // Draw enough copies to cover screen
    for (; x < W; x += drawW) {
      ctx.drawImage(panoImg, Math.floor(x), PANO_Y, Math.ceil(drawW), Math.ceil(drawH));
    }
    return true;
  }

  // fallback background if pano not loaded
  function drawFallbackMountains() {
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0,0,W,H);

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

  function drawBackground() {
    const ok = drawPanorama();
    if (!ok) drawFallbackMountains();

    // clouds in front (on top of pano)
    for (const c of clouds) {
      if (!cloud.draw(Math.floor(c.x), Math.floor(c.y), c.w, c.h, c.alpha)) {
        ctx.fillStyle = `rgba(226,232,240,${c.alpha})`;
        ctx.fillRect(c.x, c.y, c.w, c.h);
      }
    }
  }

  function drawGround() {
    // If your panorama already includes ground, you can comment this out.
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, groundY, W, H-groundY);
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, groundY, W, 6);
  }

  function drawObstacles() {
    for (const o of obstacles) {
      if (o.type === "edelweiss") {
        if (!edel.draw(o.x, o.y, o.w, o.h)) {
          ctx.fillStyle = "#38bdf8";
          ctx.fillRect(o.x, o.y, o.w, o.h);
        }
      } else {
        if (!alpen.draw(o.x, o.y, o.w, o.h)) {
          ctx.fillStyle = "#fb7185";
          ctx.fillRect(o.x, o.y, o.w, o.h);
        }
      }
    }
  }

  function drawRunner() {
    if (!runner.draw(hero.x, hero.y, hero.w, hero.h)) {
      ctx.fillStyle = "#fbbf24";
      ctx.fillRect(hero.x, hero.y, hero.w, hero.h);
    }
  }

  function drawUI() {
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "16px system-ui";
    ctx.fillText(`Score: ${Math.floor(state.score)}`, 16, 28);
    ctx.fillText(`Best: ${state.best}`, 16, 50);

    // debug assets load state (useful on GitHub Pages)
    ctx.font = "12px system-ui";
    ctx.fillText(
      `assets: pano:${panoImg.__ok?"ok":".."} runner:${runner.ready?"ok":".."} edel:${edel.ready?"ok":".."} alpen:${alpen.ready?"ok":".."} cloud:${cloud.ready?"ok":".."}`
    , 16, 70);

    if (state.over) {
      ctx.fillStyle = "rgba(2,6,23,0.65)";
      ctx.fillRect(0,0,W,H);
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

  // --------------------
  // Start immediately (no loading gate)
  // --------------------
  reset();

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

})();
