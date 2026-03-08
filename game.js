(() => {
  "use strict";

  // --------------------
  // Safe localStorage
  // --------------------
  const safeBestRead = () => { try { return Number(localStorage.getItem("rr_best") || 0); } catch { return 0; } };
  const safeBestWrite = (v) => { try { localStorage.setItem("rr_best", String(v)); } catch {} };

  const safeVolRead = () => {
    try {
      const v = Number(localStorage.getItem("rr_vol"));
      if (Number.isFinite(v)) return Math.max(0, Math.min(1, v));
    } catch {}
    return 0.6;
  };
  const safeVolWrite = (v) => { try { localStorage.setItem("rr_vol", String(v)); } catch {} };

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

  // --------------------
  // Game tuning
  // --------------------
  const OBSTACLE_DELAY_MS = 5000;
  const RUNNER_GROUND_OFFSET = 20;

  const EDEL_GROUND_OFFSET = 10;
  const ALPEN_GROUND_OFFSET = 6;

  // Cow: smaller + lower by 5px
  const COW_SCALE = 0.16;
  const COW_GROUND_OFFSET = 5;

  const rand = (a, b) => a + Math.random() * (b - a);

  // --------------------
  // Sky stripes (30px each, dark -> light)
  // --------------------
  const SKY_STRIPE_H = 30;
  const SKY_TOP = { r: 12,  g: 55,  b: 150 };
  const SKY_BOT = { r: 150, g: 220, b: 255 };
  const lerp = (a, b, t) => a + (b - a) * t;
  const rgb = (c) => `rgb(${c.r|0},${c.g|0},${c.b|0})`;

  // Sky is drawn opaque in source-over so it remains visible behind transparent panorama
  function drawSkyStripes() {
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalCompositeOperation = "source-over";
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
  // Asset loading (images + audio)
  // --------------------
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
      img.src = src;
      if (img.complete && img.naturalWidth > 0) resolve(img);
    });
  }

  function loadAudio(src) {
    return new Promise((resolve, reject) => {
      const a = new Audio();
      a.preload = "auto";
      a.addEventListener("canplaythrough", () => resolve(a), { once: true });
      a.addEventListener("error", () => reject(new Error(`Failed to load audio: ${src}`)), { once: true });
      a.src = src;
      a.load();
    });
  }

  const ASSET_LIST = [
    { key: "pano",   type: "img", src: "assets/RR-Panorama.png" },
    { key: "runner", type: "img", src: "assets/runner.png" },
    { key: "edel",   type: "img", src: "assets/edelweiss.png" },
    { key: "alpen",  type: "img", src: "assets/alpenrose.png" },
    { key: "cloud",  type: "img", src: "assets/cloud.png" },
    { key: "cow",    type: "img", src: "assets/cow.png" },
    { key: "music",  type: "audio", src: "assets/RR-Song.mp3" },
  ];

  const assets = { pano:null, runner:null, edel:null, alpen:null, cloud:null, cow:null, music:null };

  // --------------------
  // Sprites (post-load)
  // --------------------
  function makeSprite({ img, frames, fps, scale, fallbackW, fallbackH }) {
    const spr = {
      img, frames, fps, scale, fallbackW, fallbackH,
      frameW: img ? Math.floor(img.width / frames) : 0,
      frameH: img ? img.height : 0,
      frame: 0, timer: 0,
    };

    spr.size = () => {
      if (spr.img && spr.frameW > 0 && spr.frameH > 0) {
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
      if (!spr.img || spr.frameW <= 0) return false;
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

  let runnerSpr=null, edelSpr=null, alpenSpr=null, cloudSpr=null, cowSpr=null;

  // --------------------
  // Modes & state
  // --------------------
  const state = {
    mode: "loading", // loading | menu | playing | gameover
    loadProgress: 0,
    loadError: "",

    t: 0,
    speed: 2.0,
    score: 0,
    best: safeBestRead(),

    panoX: 0,
    deathBy: null,

    volume: safeVolRead(), // 0..1
    draggingVol: false,
  };

  const deathMsg = {
    alpenrose: "Oops… you walked on an Alpenrose!\nRespect nature around you during your hike.",
    edelweiss: "Oops… you stepped on an Edelweiss!\nPlease protect alpine flowers.",
    cow: "Moo! You bumped into a cow.\nGive cows space and pass calmly.",
    default: "Ouch! Watch your step.",
  };

  // --------------------
  // Gameplay entities
  // --------------------
  const hero = { x: 70, y: 0, w: 42, h: 46, vy: 0, jumpsLeft: 2 };
  const obstacles = [];
  let spawnTimer = 0;

  // --------------------
  // CLOUD LAYERS
  // --------------------
  const cloudsBack = [];   // between sky and panorama
  const cloudsFront = [];  // above panorama
  let cloudBackTimer = 0;
  let cloudFrontTimer = 0;

  // FRONT clouds (smaller, rarer)
  const CLOUD_FRONT_SCALE_MIN = 0.16;
  const CLOUD_FRONT_SCALE_MAX = 0.30;
  const CLOUD_FRONT_SPEED_MIN = 0.020;
  const CLOUD_FRONT_SPEED_MAX = 0.055;
  const CLOUD_FRONT_SPAWN_MIN_MS = 5000;
  const CLOUD_FRONT_SPAWN_MAX_MS = 12000;

  // BACK clouds (bigger, more frequent, slightly slower)
  const CLOUD_BACK_SCALE_MIN = 0.24;
  const CLOUD_BACK_SCALE_MAX = 0.50;
  const CLOUD_BACK_SPEED_MIN = 0.012;
  const CLOUD_BACK_SPEED_MAX = 0.035;
  const CLOUD_BACK_SPAWN_MIN_MS = 2500;
  const CLOUD_BACK_SPAWN_MAX_MS = 6500;

  // Panorama speed
  const PANO_BASE_SPEED = 0.018;
  const PANO_SPEED_FACTOR = 0.14;
  const PANO_Y = -30;

  // --------------------
  // Volume UI geometry (menu)
  // --------------------
  function volumeSliderRect() {
    const w = 240;
    const h = 14;
    const x = Math.floor((W - w) / 2);
    const y = 360;
    return { x, y, w, h };
  }

  function setVolume(v) {
    state.volume = Math.max(0, Math.min(1, v));
    safeVolWrite(state.volume);

    if (assets.music) {
      assets.music.volume = state.volume;
      assets.music.muted = (state.volume <= 0.0001);
    }
  }

  function volumeLabel() {
    if (state.volume <= 0.0001) return "OFF";
    return `VOL ${Math.round(state.volume * 100)}%`;
  }

  function pointerToCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = LOGICAL_W / rect.width;
    const sy = LOGICAL_H / rect.height;
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sy
    };
  }

  function hitRect(p, r) {
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  }

  // --------------------
  // Controls
  // --------------------
  function jump() {
    if (state.mode !== "playing") return;
    if (hero.jumpsLeft <= 0) return;

    const groundHeroY = groundY - hero.h + RUNNER_GROUND_OFFSET;
    const onGround = hero.y >= groundHeroY - 0.5;

    hero.vy = onGround ? -14.0 : -11.5;
    hero.jumpsLeft -= 1;
  }

  async function startGameFromMenu() {
    state.mode = "playing";
    resetRun();

    if (assets.music) {
      assets.music.loop = true;
      assets.music.volume = state.volume;
      assets.music.muted = (state.volume <= 0.0001);
      try { await assets.music.play(); } catch {}
    }
  }

  function goToMenu() {
    state.mode = "menu";
    state.deathBy = null;
    state.draggingVol = false;

    if (assets.music) {
      try { assets.music.pause(); } catch {}
      try { assets.music.currentTime = 0; } catch {}
    }
  }

  canvas.addEventListener("pointerdown", async (e) => {
    e.preventDefault();
    const p = pointerToCanvas(e);

    if (state.mode === "loading") return;

    if (state.mode === "menu") {
      const r = volumeSliderRect();
      const hit = { x: r.x, y: r.y - 10, w: r.w, h: r.h + 20 };

      if (hitRect(p, hit)) {
        state.draggingVol = true;
        const t = (p.x - r.x) / r.w;
        setVolume(t);
        return;
      }

      await startGameFromMenu();
      return;
    }

    if (state.mode === "gameover") {
      goToMenu();
      return;
    }

    if (state.mode === "playing") jump();
  }, { passive:false });

  canvas.addEventListener("pointermove", (e) => {
    if (!state.draggingVol) return;
    const p = pointerToCanvas(e);
    const r = volumeSliderRect();
    const t = (p.x - r.x) / r.w;
    setVolume(t);
  });

  window.addEventListener("pointerup", () => {
    state.draggingVol = false;
  });

  // --------------------
  // Reset run
  // --------------------
  function resetRun() {
    state.t = 0;
    state.speed = 2.0;
    state.score = 0;
    state.panoX = 0;
    state.deathBy = null;

    obstacles.length = 0;
    cloudsBack.length = 0;
    cloudsFront.length = 0;

    spawnTimer = 0;
    cloudBackTimer = 0;
    cloudFrontTimer = 0;

    const hs = runnerSpr ? runnerSpr.size() : { w: 42, h: 46 };
    hero.w = hs.w;
    hero.h = hs.h;
    hero.vy = 0;
    hero.jumpsLeft = 2;
    hero.y = groundY - hero.h + RUNNER_GROUND_OFFSET;

    runnerSpr.frame = runnerSpr.timer = 0;
    edelSpr.frame = edelSpr.timer = 0;
    alpenSpr.frame = alpenSpr.timer = 0;
    cloudSpr.frame = cloudSpr.timer = 0;
    cowSpr.frame = cowSpr.timer = 0;
  }

  // --------------------
  // Collision helpers
  // --------------------
  function heroHitbox() {
    const padX = Math.floor(hero.w * 0.22);
    const padY = Math.floor(hero.h * 0.12);
    return { x: hero.x+padX, y: hero.y+padY, w: hero.w-padX*2, h: hero.h-padY*2 };
  }

  function rectHit(a,b){
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // --------------------
  // Spawning
  // --------------------
  function spawnObstacle() {
    const r = Math.random();
    const type = (r < 0.40) ? "edelweiss" : (r < 0.80 ? "alpenrose" : "cow");

    let w, h, y;

    if (type === "edelweiss") {
      ({ w, h } = edelSpr.size());
      y = groundY - h + EDEL_GROUND_OFFSET;
    } else if (type === "alpenrose") {
      ({ w, h } = alpenSpr.size());
      y = groundY - h + ALPEN_GROUND_OFFSET;
    } else {
      ({ w, h } = cowSpr.size());
      y = groundY - h + COW_GROUND_OFFSET;
    }

    obstacles.push({ type, x: W + 40, y, w, h });
  }

  function spawnCloudBack() {
    const y = rand(6, 110);
    const instScale = rand(CLOUD_BACK_SCALE_MIN, CLOUD_BACK_SCALE_MAX);
    const vx = rand(CLOUD_BACK_SPEED_MIN, CLOUD_BACK_SPEED_MAX);

    const w = Math.round((cloudSpr.frameW || cloudSpr.fallbackW) * instScale);
    const h = Math.round((cloudSpr.frameH || cloudSpr.fallbackH) * instScale);

    cloudsBack.push({ x: W + 40, y, w, h, vx });
  }

  function spawnCloudFront() {
    const y = rand(30, 210);
    const instScale = rand(CLOUD_FRONT_SCALE_MIN, CLOUD_FRONT_SCALE_MAX);
    const vx = rand(CLOUD_FRONT_SPEED_MIN, CLOUD_FRONT_SPEED_MAX);

    const w = Math.round((cloudSpr.frameW || cloudSpr.fallbackW) * instScale);
    const h = Math.round((cloudSpr.frameH || cloudSpr.fallbackH) * instScale);

    cloudsFront.push({ x: W + 40, y, w, h, vx });
  }

  // --------------------
  // Step
  // --------------------
  function step(dt) {
    if (state.mode !== "playing") return;

    state.speed = Math.min(4.8, state.speed + 0.00035);
    state.score += 0.08 * state.speed;

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

    // animate sprites
    edelSpr.tick(dt);
    alpenSpr.tick(dt);
    cowSpr.tick(dt);
    cloudSpr.tick(dt);
    if (hero.y >= groundHeroY - 0.5) runnerSpr.tick(dt);

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
        state.mode = "gameover";
        state.deathBy = o.type;

        state.best = Math.max(state.best, Math.floor(state.score));
        safeBestWrite(state.best);

        if (assets.music) { try { assets.music.pause(); } catch {} }
        break;
      }
    }

    // spawn/move BACK clouds (more often)
    cloudBackTimer -= dt;
    if (cloudBackTimer <= 0) {
      spawnCloudBack();
      cloudBackTimer = rand(CLOUD_BACK_SPAWN_MIN_MS, CLOUD_BACK_SPAWN_MAX_MS);
    }
    for (const c of cloudsBack) c.x -= dt * c.vx;
    while (cloudsBack.length && cloudsBack[0].x + cloudsBack[0].w < -120) cloudsBack.shift();

    // spawn/move FRONT clouds (less often)
    cloudFrontTimer -= dt;
    if (cloudFrontTimer <= 0) {
      spawnCloudFront();
      cloudFrontTimer = rand(CLOUD_FRONT_SPAWN_MIN_MS, CLOUD_FRONT_SPAWN_MAX_MS);
    }
    for (const c of cloudsFront) c.x -= dt * c.vx;
    while (cloudsFront.length && cloudsFront[0].x + cloudsFront[0].w < -120) cloudsFront.shift();
  }

  // --------------------
  // Drawing
  // --------------------
  function drawPanorama() {
    const img = assets.pano;
    if (!img) return false;

    const imgW = img.width || 0;
    const imgH = img.height || 0;
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
    for (; x < W; x += drawW) ctx.drawImage(img, x, PANO_Y, drawW, drawH);
    ctx.restore();
    return true;
  }

  function drawCloudArray(arr) {
    for (const c of arr) {
      const dx = Math.floor(c.x);
      const dy = Math.floor(c.y);
      cloudSpr.draw(dx, dy, c.w, c.h, 1);
    }
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
      if (o.type === "edelweiss") edelSpr.draw(ox, oy, o.w, o.h, 1);
      else if (o.type === "alpenrose") alpenSpr.draw(ox, oy, o.w, o.h, 1);
      else cowSpr.draw(ox, oy, o.w, o.h, 1);
    }
  }

  function drawRunner() {
    const hx = Math.floor(hero.x), hy = Math.floor(hero.y);
    runnerSpr.draw(hx, hy, hero.w, hero.h, 1);
  }

  function wrapText(text, maxChars = 34) {
    const raw = String(text).split("\n");
    const out = [];
    for (const para of raw) {
      const words = para.split(" ");
      let line = "";
      for (const w of words) {
        const test = line ? (line + " " + w) : w;
        if (test.length > maxChars) { if (line) out.push(line); line = w; }
        else line = test;
      }
      if (line) out.push(line);
    }
    return out;
  }

  function drawTextBox(lines, x, y, w, padding = 10) {
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    const lineH = 18;
    const hBox = padding * 2 + lines.length * lineH;
    ctx.fillStyle = "rgba(2,6,23,0.70)";
    ctx.fillRect(x, y, w, hBox);

    ctx.fillStyle = "#fff";
    ctx.font = "14px system-ui";
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], x + padding, y + padding + (i+1) * (lineH - 2));
    }
    ctx.restore();
  }

  function drawVolumeSlider() {
    const r = volumeSliderRect();
    const t = state.volume;

    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(226,232,240,0.35)";
    ctx.fillRect(r.x, r.y, r.w, r.h);

    ctx.fillStyle = "rgba(226,232,240,0.85)";
    ctx.fillRect(r.x, r.y, Math.max(0, Math.min(r.w, Math.round(r.w * t))), r.h);

    const kx = Math.round(r.x + r.w * t);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(kx - 2, r.y - 4, 4, r.h + 8);

    ctx.fillStyle = "#e2e8f0";
    ctx.font = "14px system-ui";
    ctx.fillText(`Music: ${volumeLabel()}`, r.x, r.y - 10);

    ctx.restore();
  }

  // --------------------
  // UI screens
  // --------------------
  function drawLoading() {
    drawSkyStripes();
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "rgba(2,6,23,0.55)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff";
    ctx.font = "18px system-ui";
    ctx.fillText("Loading assets…", 16, 40);
    ctx.font = "14px system-ui";
    ctx.fillText(`${Math.floor(state.loadProgress * 100)}%`, 16, 66);
    if (state.loadError) {
      ctx.fillStyle = "#fb7185";
      ctx.fillText("Load error:", 16, 96);
      ctx.fillStyle = "#fff";
      ctx.fillText(state.loadError.slice(0, 52), 16, 116);
      ctx.fillText("Check file names (case-sensitive).", 16, 140);
    }
    ctx.restore();
  }

  function drawMenu() {
    drawSkyStripes();
    drawCloudArray(cloudsBack); // ✅ behind mountains
    drawPanorama();
    drawCloudArray(cloudsFront); // ✅ in front
    drawGround();

    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "rgba(2,6,23,0.55)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff";
    ctx.font = "22px system-ui";
    ctx.fillText("Riederalp Runner", 64, 190);
    ctx.font = "14px system-ui";
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText("Tap to Start", 132, 225);
    ctx.fillText("Tap to jump", 140, 255);
    ctx.fillText("Double tap to double jump", 92, 275);
    ctx.fillText(`Best: ${state.best}`, 140, 305);
    ctx.restore();

    drawVolumeSlider();
  }

  function drawPlaying() {
    drawSkyStripes();
    drawCloudArray(cloudsBack);   // ✅ behind mountains
    drawPanorama();
    drawCloudArray(cloudsFront);  // ✅ front
    drawGround();
    drawObstacles();
    drawRunner();

    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "16px system-ui";
    ctx.fillText(`Score: ${Math.floor(state.score)}`, 16, 28);
    ctx.fillText(`Best: ${state.best}`, 16, 50);
    if (state.t < OBSTACLE_DELAY_MS) {
      const sLeft = Math.ceil((OBSTACLE_DELAY_MS - state.t) / 1000);
      ctx.font = "14px system-ui";
      ctx.fillStyle = "rgba(226,232,240,0.95)";
      ctx.fillText(`Warmup… ${sLeft}s`, 16, 78);
    }
    ctx.restore();
  }

  function drawGameOver() {
    drawSkyStripes();
    drawCloudArray(cloudsBack);
    drawPanorama();
    drawCloudArray(cloudsFront);
    drawGround();
    drawObstacles();
    drawRunner();

    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "rgba(2,6,23,0.65)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff";
    ctx.font = "22px system-ui";
    ctx.fillText("Game Over", 110, 260);
    ctx.font = "16px system-ui";
    ctx.fillText(`Score: ${Math.floor(state.score)}`, 118, 292);
    ctx.fillText(`Best: ${state.best}`, 128, 316);
    ctx.font = "14px system-ui";
    ctx.fillText("Tap to return to Menu", 106, 520);
    ctx.restore();

    const msg = deathMsg[state.deathBy] || deathMsg.default;
    drawTextBox(wrapText(msg, 34), 20, 350, W - 40, 10);
  }

  function draw() {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = false;

    if (state.mode === "loading") return drawLoading();
    if (state.mode === "menu") return drawMenu();
    if (state.mode === "playing") return drawPlaying();
    if (state.mode === "gameover") return drawGameOver();
  }

  // --------------------
  // Asset loading sequence
  // --------------------
  async function loadAllAssets() {
    state.mode = "loading";
    state.loadProgress = 0;
    state.loadError = "";

    const total = ASSET_LIST.length;
    let done = 0;
    const bump = () => { done += 1; state.loadProgress = done / total; };

    try {
      for (const item of ASSET_LIST) {
        if (item.type === "img") { assets[item.key] = await loadImage(item.src); bump(); }
        else { assets[item.key] = await loadAudio(item.src); bump(); }
      }

      runnerSpr = makeSprite({ img: assets.runner, frames: 6, fps: 6, scale: 0.25, fallbackW: 42, fallbackH: 46 });
      edelSpr   = makeSprite({ img: assets.edel, frames: 3, fps: 5, scale: 0.11, fallbackW: 42, fallbackH: 34 });
      alpenSpr  = makeSprite({ img: assets.alpen, frames: 4, fps: 3, scale: 0.20, fallbackW: 47, fallbackH: 40 });
      cloudSpr  = makeSprite({ img: assets.cloud, frames: 4, fps: 4, scale: 0.35, fallbackW: 90, fallbackH: 48 });
      cowSpr    = makeSprite({ img: assets.cow, frames: 4, fps: 4, scale: COW_SCALE, fallbackW: 48, fallbackH: 40 });

      if (assets.music) {
        assets.music.loop = true;
        assets.music.volume = state.volume;
        assets.music.muted = (state.volume <= 0.0001);
      }

      // Start in menu
      goToMenu();
    } catch (err) {
      state.loadError = String(err?.message || err);
      state.mode = "loading";
    }
  }

  // --------------------
  // Main loop
  // --------------------
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
  loadAllAssets();
})();
