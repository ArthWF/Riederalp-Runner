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

    // integer CSS scale to avoid shimmering/trails
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

    // draw in logical coordinates
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
  const COW_SCALE = 0.16;     // was ~0.22 (smaller)
  const COW_GROUND_OFFSET = 5; // lower by 5px (downwards)

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
    // HARD overwrite whole frame
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
  // Asset loading (images + audio)
  // --------------------
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
      img.src = src;
      // cached
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

  // All assets used by the game
  const ASSET_LIST = [
    { key: "pano",   type: "img", src: "assets/RR-Panorama.png" },
    { key: "runner", type: "img", src: "assets/runner.png" },
    { key: "edel",   type: "img", src: "assets/edelweiss.png" },
    { key: "alpen",  type: "img", src: "assets/alpenrose.png" },
    { key: "cloud",  type: "img", src: "assets/cloud.png" },
    { key: "cow",    type: "img", src: "assets/cow.png" },
    { key: "music",  type: "audio", src: "assets/RR-Song.mp3" },
  ];

  const assets = {
    pano: null,
    runner: null,
    edel: null,
    alpen: null,
    cloud: null,
    cow: null,
    music: null,
  };

  // --------------------
  // Sprites (post-load)
  // --------------------
  function makeSprite({ img, frames, fps, scale, fallbackW, fallbackH }) {
    const spr = {
      img,
      frames,
      fps,
      scale,
      fallbackW,
      fallbackH,
      frameW: img ? Math.floor(img.width / frames) : 0,
      frameH: img ? img.height : 0,
      frame: 0,
      timer: 0,
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

  let runnerSpr = null;
  let edelSpr = null;
  let alpenSpr = null;
  let cloudSpr = null;
  let cowSpr = null;

  // --------------------
  // Modes
  // --------------------
  const state = {
    mode: "loading", // loading | menu | playing | gameover
    loadProgress: 0,
    loadError: "",
    muted: false,

    t: 0,
    speed: 2.0,
    score: 0,
    best: safeBestRead(),

    panoX: 0,
    deathBy: null, // "edelweiss" | "alpenrose" | "cow"
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

  // Clouds
  const clouds = [];
  let cloudSpawnTimer = 0;

  const CLOUD_INST_SCALE_MIN = 0.16;
  const CLOUD_INST_SCALE_MAX = 0.30;
  const CLOUD_LEFT_SPEED_MIN = 0.020;
  const CLOUD_LEFT_SPEED_MAX = 0.055;
  const CLOUD_SPAWN_MIN_MS = 5000;
  const CLOUD_SPAWN_MAX_MS = 12000;

  // Panorama speed
  const PANO_BASE_SPEED = 0.018;     // px/ms
  const PANO_SPEED_FACTOR = 0.14;    // linked to game speed
  const PANO_Y = -30;

  // --------------------
  // Controls
  // --------------------
  function jump() {
    if (state.mode !== "playing") return;
    if (hero.jumpsLeft <= 0) return;

    const groundHeroY = groundY - hero.h + RUNNER_GROUND_OFFSET;
    const onGround = hero.y >= groundHeroY - 0.5;

    hero.vy = onGround ? -14.0 : -11.5; // 2nd jump smaller
    hero.jumpsLeft -= 1;
  }

  async function startGameFromMenu() {
    state.mode = "playing";
    resetRun();

    // Start music only after user gesture
    if (assets.music) {
      assets.music.loop = true;
      assets.music.volume = 0.6;
      assets.music.muted = state.muted;
      try { await assets.music.play(); } catch {}
    }
  }

  function goToMenu() {
    state.mode = "menu";
    state.deathBy = null;
    // keep music stopped in menu (optional)
    if (assets.music) {
      try { assets.music.pause(); } catch {}
      try { assets.music.currentTime = 0; } catch {}
    }
  }

  function toggleMute() {
    state.muted = !state.muted;
    if (assets.music) assets.music.muted = state.muted;
  }

  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "m") toggleMute();
  });

  canvas.addEventListener("pointerdown", async (e) => {
    e.preventDefault();

    if (state.mode === "loading") return;

    if (state.mode === "menu") {
      await startGameFromMenu();
      return;
    }

    if (state.mode === "gameover") {
      goToMenu();
      return;
    }

    if (state.mode === "playing") {
      jump();
      return;
    }
  }, { passive:false });

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
    clouds.length = 0;

    spawnTimer = 0;
    cloudSpawnTimer = 0;

    // hero size from runner sprite
    const hs = runnerSpr ? runnerSpr.size() : { w: 42, h: 46 };
    hero.w = hs.w;
    hero.h = hs.h;
    hero.vy = 0;
    hero.jumpsLeft = 2;
    hero.y = groundY - hero.h + RUNNER_GROUND_OFFSET;

    if (runnerSpr) runnerSpr.frame = runnerSpr.timer = 0;
    if (edelSpr) edelSpr.frame = edelSpr.timer = 0;
    if (alpenSpr) alpenSpr.frame = alpenSpr.timer = 0;
    if (cloudSpr) cloudSpr.frame = cloudSpr.timer = 0;
    if (cowSpr) cowSpr.frame = cowSpr.timer = 0;
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
    // weights: edel 40%, alpen 40%, cow 20%
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
      y = groundY - h + COW_GROUND_OFFSET + 5; // lower by 5px
    }

    obstacles.push({ type, x: W + 40, y, w, h });
  }

  function spawnCloud() {
    const y = rand(20, 200);
    const instScale = rand(CLOUD_INST_SCALE_MIN, CLOUD_INST_SCALE_MAX);
    const vx = rand(CLOUD_LEFT_SPEED_MIN, CLOUD_LEFT_SPEED_MAX);

    let w, h;
    if (cloudSpr && cloudSpr.img) {
      w = Math.round((cloudSpr.frameW || cloudSpr.fallbackW) * instScale);
      h = Math.round((cloudSpr.frameH || cloudSpr.fallbackH) * instScale);
    } else {
      w = Math.round(90 * instScale);
      h = Math.round(48 * instScale);
    }

    clouds.push({ x: W + 40, y, w, h, vx });
  }

  // --------------------
  // Step
  // --------------------
  function step(dt) {
    if (state.mode !== "playing") return;

    // difficulty
    state.speed = Math.min(4.8, state.speed + 0.00035);
    state.score += 0.08 * state.speed;

    // pano scroll
    const panoSpeed = PANO_BASE_SPEED + (state.speed * PANO_SPEED_FACTOR * 0.001);
    state.panoX += dt * panoSpeed;

    // gravity
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

        // stop music on death (optional; you can keep it playing)
        if (assets.music) {
          try { assets.music.pause(); } catch {}
        }
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
  // Drawing helpers
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

    for (; x < W; x += drawW) {
      ctx.drawImage(img, x, PANO_Y, drawW, drawH);
    }
    ctx.restore();
    return true;
  }

  function drawClouds() {
    for (const c of clouds) {
      const dx = Math.floor(c.x);
      const dy = Math.floor(c.y);

      // opaque clouds
      if (!cloudSpr.draw(dx, dy, c.w, c.h, 1)) {
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
        if (!edelSpr.draw(ox, oy, o.w, o.h, 1)) {
          ctx.save();
          ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
          ctx.fillStyle = "#38bdf8";
          ctx.fillRect(ox, oy, o.w, o.h);
          ctx.restore();
        }
      } else if (o.type === "alpenrose") {
        if (!alpenSpr.draw(ox, oy, o.w, o.h, 1)) {
          ctx.save();
          ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
          ctx.fillStyle = "#fb7185";
          ctx.fillRect(ox, oy, o.w, o.h);
          ctx.restore();
        }
      } else {
        // cow
        if (!cowSpr.draw(ox, oy, o.w, o.h, 1)) {
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
    if (!runnerSpr.draw(hx, hy, hero.w, hero.h, 1)) {
      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.fillStyle = "#fbbf24";
      ctx.fillRect(hx, hy, hero.w, hero.h);
      ctx.restore();
    }
  }

  function drawTextBox(lines, x, y, w, padding = 10) {
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    // background
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

  function wrapText(text, maxChars = 34) {
    const raw = String(text).split("\n");
    const out = [];
    for (const para of raw) {
      const words = para.split(" ");
      let line = "";
      for (const w of words) {
        const test = line ? (line + " " + w) : w;
        if (test.length > maxChars) {
          if (line) out.push(line);
          line = w;
        } else line = test;
      }
      if (line) out.push(line);
    }
    return out;
  }

  // --------------------
  // UI screens
  // --------------------
  function drawLoading() {
    drawSkyStripesHardClear();

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
      ctx.fillText(state.loadError.slice(0, 48), 16, 116);
      ctx.fillText("Check file names (case-sensitive).", 16, 140);
    }

    ctx.restore();
  }

  function drawMenu() {
    drawSkyStripesHardClear();
    drawPanorama();
    drawClouds();
    drawGround();

    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "rgba(2,6,23,0.55)";
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#fff";
    ctx.font = "22px system-ui";
    ctx.fillText("Riederalp Runner", 64, 200);

    ctx.font = "14px system-ui";
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText("Tap to Start", 132, 235);
    ctx.fillText("Tap = jump (double jump)", 86, 260);
    ctx.fillText(`Best: ${state.best}`, 140, 285);
    ctx.fillText(`Music: ${state.muted ? "Muted (press M)" : "On (press M)"}`, 102, 310);

    ctx.restore();
  }

  function drawGameOver() {
    // draw the frozen scene behind
    drawSkyStripesHardClear();
    drawPanorama();
    drawClouds();
    drawGround();
    drawObstacles();
    drawRunner();

    // overlay
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

    // death message
    const msg = deathMsg[state.deathBy] || deathMsg.default;
    const lines = wrapText(msg, 34);
    drawTextBox(lines, 20, 350, W - 40, 10);
  }

  function drawPlaying() {
    drawSkyStripesHardClear();
    drawPanorama();
    drawClouds();
    drawGround();
    drawObstacles();
    drawRunner();

    // HUD
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

  // --------------------
  // Main draw
  // --------------------
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

    function bump() {
      done += 1;
      state.loadProgress = done / total;
    }

    try {
      for (const item of ASSET_LIST) {
        if (item.type === "img") {
          const img = await loadImage(item.src);
          assets[item.key] = img;
          bump();
        } else if (item.type === "audio") {
          const a = await loadAudio(item.src);
          assets[item.key] = a;
          bump();
        }
      }

      // build sprites now that images are loaded
      runnerSpr = makeSprite({ img: assets.runner, frames: 6, fps: 6, scale: 0.25, fallbackW: 42, fallbackH: 46 });
      edelSpr   = makeSprite({ img: assets.edel,   frames: 3, fps: 5, scale: 0.11, fallbackW: 42, fallbackH: 34 });
      alpenSpr  = makeSprite({ img: assets.alpen,  frames: 4, fps: 3, scale: 0.20, fallbackW: 47, fallbackH: 40 });
      cloudSpr  = makeSprite({ img: assets.cloud,  frames: 4, fps: 4, scale: 0.35, fallbackW: 90, fallbackH: 48 });

      // cow: smaller scale + lower by 5px already via offsets
      cowSpr    = makeSprite({ img: assets.cow,    frames: 4, fps: 4, scale: COW_SCALE, fallbackW: 48, fallbackH: 40 });

      // audio defaults
      if (assets.music) {
        assets.music.loop = true;
        assets.music.volume = 0.6;
        assets.music.muted = state.muted;
      }

      // go to menu
      goToMenu();
    } catch (err) {
      state.loadError = String(err?.message || err);
      // stay in loading screen (shows error)
      state.mode = "loading";
    }
  }

  // --------------------
  // Game loop
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

  // Start everything
  requestAnimationFrame(loop);
  loadAllAssets();

})();
