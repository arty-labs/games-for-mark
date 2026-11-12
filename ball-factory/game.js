// Ball Factory: a glowing ball machine for little hands.
// Tap the truck to dump balls, tap anywhere to drop a ball, tap gears to spin them fast.
(() => {
  'use strict';

  const W = 1600, H = 1000;          // logical world size
  const GRAV = 1500;
  const BIG = 16, SMALL = 7;         // ball radii
  const MAX_BALLS = 420;
  const NEON = '#3fdcff';
  const CELEBRATE_AT = 60;           // melted balls before fireworks

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let scale = 1, offX = 0, offY = 0, dpr = 1;

  // ---------- World layout ----------
  const walls = [];   // {ax,ay,bx,by,t}
  const wall = (ax, ay, bx, by, t = 5) => walls.push({ ax, ay, bx, by, t });
  const poly = (pts, t) => { for (let i = 0; i < pts.length - 1; i++) wall(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], t); };

  // Truck rail along the top
  wall(318, 160, 1600, 160, 6);
  // Funnel under the truck
  wall(60, 100, 172, 212, 6);
  wall(318, 160, 288, 212, 6);

  // Ramp 1: long slope to the right, with a sieve in the middle
  const r1 = { x0: 130, y0: 270, x1: 1130, y1: 400 };
  const r1y = x => r1.y0 + (x - r1.x0) * (r1.y1 - r1.y0) / (r1.x1 - r1.x0);
  const SIEVE_A = 520, SIEVE_B = 900;
  wall(130, 225, 130, 270, 5);                        // back stop
  wall(r1.x0, r1.y0, SIEVE_A, r1y(SIEVE_A), 5);
  // The sieve: solid for big balls, small balls slip through the holes
  const sieve = { ax: SIEVE_A, ay: r1y(SIEVE_A), bx: SIEVE_B, by: r1y(SIEVE_B), t: 5, sieve: true };
  walls.push(sieve);
  wall(SIEVE_B, r1y(SIEVE_B), r1.x1, r1.y1, 5);

  // Ramp 1b: catches small balls under the sieve, rolls them left to the peg board
  wall(955, 395, 950, 440, 5);
  wall(950, 440, 300, 520, 5);

  // Crusher: two gears that turn inwards
  const gears = [
    { x: 1195, y: 500, r: 46, dir: 1, angle: 0, boost: 0 },
    { x: 1309, y: 500, r: 46, dir: -1, angle: 0.2, boost: 0 },
  ];
  wall(1135, 405, 1146, 498, 5);                     // left hopper wall
  wall(1400, 300, 1400, 440, 6);                     // right hopper wall
  wall(1400, 440, 1356, 498, 6);

  // Ramp 2: under the crusher, rolls left
  wall(1385, 555, 1380, 610, 5);
  wall(1380, 610, 560, 700, 5);

  // Peg board on the left
  wall(110, 420, 110, 760, 6);
  wall(420, 525, 420, 760, 6);
  wall(110, 760, 236, 806, 6);
  wall(420, 760, 292, 806, 6);
  const pegs = [];
  for (let row = 0; row < 5; row++) {
    const y = 565 + row * 44;
    const off = row % 2 ? 26 : 0;
    for (let x = 150 + off; x <= 392; x += 52) pegs.push({ x, y, r: 7, flash: 0, note: row, last: 0 });
  }

  // Bumper star under ramp 2
  const bumpers = [{ x: 512, y: 790, r: 20, flash: 0, spin: 0 }];

  // Ramp 3: to the lava
  wall(178, 800, 180, 842, 5);
  wall(180, 842, 640, 892, 5);

  // Lava pit
  const LAVA = { x0: 652, x1: 1198, top: 920, bottom: 990 };
  wall(640, 892, 652, 900, 5);
  wall(652, 900, 652, 990, 6);
  wall(652, 990, 1198, 990, 6);
  wall(1198, 990, 1198, 770, 6);

  // Thermometer (decor + progress)
  const THERMO = { x: 1440, top: 640, bottom: 930, bulb: 34 };

  // Decorative background pipes (no collisions)
  const decor = [
    [[40, 300], [40, 900], [80, 960], [560, 960], [600, 930]],
    [[60, 320], [60, 880], [92, 930], [540, 930]],
    [[460, 560], [460, 760], [520, 830]],
    [[1240, 560], [1240, 590]],
    [[1540, 200], [1540, 980], [1240, 980]],
    [[1520, 220], [1520, 960], [1250, 960]],
    [[700, 420], [700, 600], [760, 650], [1000, 650], [1040, 610], [1040, 560]],
    [[1000, 740], [1100, 740], [1140, 780], [1140, 900]],
    [[300, 330], [300, 420], [340, 460], [340, 500]],
  ];

  // ---------- State ----------
  let balls = [];
  let idc = 0;
  let sparks = [];
  let melted = 0;
  let celebrating = 0;
  let time = 0;
  let started = false;
  const truck = {
    state: 'arriving', x: 1750, parkX: 300, bed: 0, timer: 0, load: [], spawnT: 0, bob: 0,
  };
  const HUES = [0, 30, 52, 120, 175, 205, 260, 300, 330];
  const ballColor = h => `hsl(${h} 95% 60%)`;

  function refillTruck() {
    truck.load = [];
    for (let i = 0; i < 22; i++) truck.load.push({ r: BIG, h: HUES[(Math.random() * HUES.length) | 0] });
    for (let i = 0; i < 18; i++) truck.load.push({ r: SMALL, h: HUES[(Math.random() * HUES.length) | 0] });
    truck.load.sort(() => Math.random() - 0.5);
  }
  refillTruck();

  function addBall(x, y, r, h, vx = 0, vy = 0) {
    if (balls.length >= MAX_BALLS) {
      const old = balls.find(b => !b.melt && !b.pop);
      if (old) old.pop = 0.001;
    }
    balls.push({ id_: idc++, x, y, vx, vy, r, h, col: ballColor(h), still: 0, melt: 0, pop: 0, age: 0 });
  }

  function burst(x, y, color, n = 10, speed = 260, life = 0.6, size = 3) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size: size * (0.6 + Math.random() * 0.8), g: 600 });
    }
  }

  // ---------- Sound ----------
  let ac = null, master = null, muted = false, soundBudget = 0;
  function initAudio() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.6;
    master.connect(ac.destination);
    // iOS unlock: play a silent buffer
    const b = ac.createBuffer(1, 1, 22050), s = ac.createBufferSource();
    s.buffer = b; s.connect(master); s.start(0);
  }
  function canPlay(cost = 1) {
    if (!ac || muted || ac.state !== 'running') return false;
    if (soundBudget > 24) return false;
    soundBudget += cost;
    return true;
  }
  function tone(freq, dur, type = 'sine', vol = 0.2, slideTo = 0, delay = 0) {
    if (!canPlay()) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  let noiseBuf = null;
  function noise(dur, vol, filterFreq, q = 1, type = 'bandpass') {
    if (!canPlay(2)) return;
    if (!noiseBuf) {
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = ac.currentTime;
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; f.type = type; f.frequency.value = filterFreq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  const PENTA = [523, 587, 659, 784, 880, 1047, 1175];
  const sfx = {
    clack: (sp, r) => tone(r > 10 ? 300 + Math.random() * 80 : 700 + Math.random() * 200, 0.05, 'triangle', Math.min(0.12, sp / 3000)),
    peg: n => tone(PENTA[n % PENTA.length], 0.35, 'sine', 0.18),
    bumper: () => tone(440, 0.25, 'square', 0.08, 880),
    crunch: () => { noise(0.18, 0.5, 900, 0.8); tone(120, 0.12, 'sawtooth', 0.1, 60); },
    sizzle: () => { noise(0.45, 0.25, 4000, 0.5, 'highpass'); tone(200, 0.3, 'sine', 0.06, 90); },
    pop: () => tone(600, 0.12, 'sine', 0.15, 1400),
    horn: () => { tone(392, 0.18, 'square', 0.08); tone(392, 0.25, 'square', 0.08, 0, 0.25); },
    dump: () => noise(1.1, 0.25, 500, 0.6),
    whirr: () => tone(180, 0.6, 'sawtooth', 0.06, 520),
    yay: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.4, 'triangle', 0.16, 0, i * 0.11)); },
    boom: () => { noise(0.6, 0.4, 300, 0.7); tone(80, 0.5, 'sine', 0.2, 40); },
  };

  // ---------- Physics ----------
  function collideSeg(b, s) {
    const dx = s.bx - s.ax, dy = s.by - s.ay;
    const len2 = dx * dx + dy * dy;
    let u = ((b.x - s.ax) * dx + (b.y - s.ay) * dy) / len2;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const cx = s.ax + dx * u, cy = s.ay + dy * u;
    let nx = b.x - cx, ny = b.y - cy;
    const d2 = nx * nx + ny * ny, min = b.r + s.t;
    if (d2 >= min * min) return 0;
    const d = Math.sqrt(d2) || 0.0001;
    nx /= d; ny /= d;
    b.x = cx + nx * min; b.y = cy + ny * min;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      const e = vn < -200 ? 0.35 : 0.05;
      b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny;
      b.vx *= 0.9995; b.vy *= 0.9995;
      return -vn;
    }
    return 0;
  }

  function collideCircle(b, c, rest, surfX = 0, surfY = 0, grip = 0) {
    let nx = b.x - c.x, ny = b.y - c.y;
    const d2 = nx * nx + ny * ny, min = b.r + c.r;
    if (d2 >= min * min) return 0;
    const d = Math.sqrt(d2) || 0.0001;
    nx /= d; ny /= d;
    b.x = c.x + nx * min; b.y = c.y + ny * min;
    let vn = b.vx * nx + b.vy * ny;
    let hit = 0;
    if (vn < 0) { b.vx -= (1 + rest) * vn * nx; b.vy -= (1 + rest) * vn * ny; hit = -vn; }
    if (grip) { // drag along the gear surface
      const tx = -ny, ty = nx;
      const vt = b.vx * tx + b.vy * ty, st = surfX * tx + surfY * ty;
      const dv = (st - vt) * grip;
      b.vx += dv * tx; b.vy += dv * ty;
    }
    return hit || 0.0001;
  }

  const CELL = 40, GW = Math.ceil(W / CELL) + 2, GH = Math.ceil(H / CELL) + 2;
  const grid = new Map();
  function ballCollisions() {
    grid.clear();
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.melt || b.pop) continue;
      const k = ((b.x / CELL) | 0) + 1 + (((b.y / CELL) | 0) + 1) * GW;
      let arr = grid.get(k);
      if (!arr) grid.set(k, arr = []);
      arr.push(b);
    }
    for (const [k, arr] of grid) {
      const cx = k % GW, cy = (k / GW) | 0;
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const other = grid.get(cx + ox + (cy + oy) * GW);
        if (!other) continue;
        for (const a of arr) for (const b of other) {
          if (a === b || (other === arr && a.id_ > b.id_)) continue;
          if (other !== arr && (ox < 0 || (ox === 0 && oy < 0))) continue;
          let dx = b.x - a.x, dy = b.y - a.y;
          const min = a.r + b.r, d2 = dx * dx + dy * dy;
          if (d2 >= min * min || d2 === 0) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
          const ma = a.r * a.r, mb = b.r * b.r, tot = ma + mb;
          const over = min - d;
          a.x -= nx * over * mb / tot; a.y -= ny * over * mb / tot;
          b.x += nx * over * ma / tot; b.y += ny * over * ma / tot;
          const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rv < 0) {
            const j = -(1.15) * rv / (1 / ma + 1 / mb);
            a.vx -= j * nx / ma; a.vy -= j * ny / ma;
            b.vx += j * nx / mb; b.vy += j * ny / mb;
          }
        }
      }
    }
  }

  function splitBall(b) {
    b.pop = 0.001; b.silent = true;
    for (let i = 0; i < 3; i++) {
      addBall(b.x + (i - 1) * 6, b.y + 10 + i * 2, SMALL, HUES[(HUES.indexOf(b.h) + i) % HUES.length], (i - 1) * 40, 120);
    }
    burst(b.x, b.y + 10, b.col, 14, 300, 0.5, 3);
    sfx.crunch();
  }

  function step(dt) {
    const sub = 4, h = dt / sub;
    for (const g of gears) {
      g.boost = Math.max(0, g.boost - dt);
      g.omega = g.dir * (2.2 + (g.boost > 0 ? 7 : 0));
      g.angle += g.omega * dt;
    }
    for (const bp of bumpers) { bp.flash = Math.max(0, bp.flash - dt * 3); bp.spin += dt * (0.6 + bp.flash * 8); }
    for (const p of pegs) p.flash = Math.max(0, p.flash - dt * 2.5);

    for (let s = 0; s < sub; s++) {
      for (const b of balls) {
        if (b.pop) continue;
        if (b.melt) { b.vy = 30; b.vx *= 0.9; b.y += b.vy * h; continue; }
        b.vy += GRAV * h;
        b.x += b.vx * h; b.y += b.vy * h;
        let maxHit = 0;
        for (let i = 0; i < walls.length; i++) {
          const w = walls[i];
          if (w.sieve && b.r <= SMALL + 1) continue;
          // quick bounding reject
          const minx = Math.min(w.ax, w.bx) - b.r - w.t, maxx = Math.max(w.ax, w.bx) + b.r + w.t;
          if (b.x < minx || b.x > maxx) continue;
          const miny = Math.min(w.ay, w.by) - b.r - w.t, maxy = Math.max(w.ay, w.by) + b.r + w.t;
          if (b.y < miny || b.y > maxy) continue;
          const hit = collideSeg(b, w);
          if (hit > maxHit) maxHit = hit;
        }
        for (const p of pegs) {
          const hit = collideCircle(b, p, 0.45);
          if (hit > 60 && time - p.last > 0.12) { p.flash = 1; p.last = time; sfx.peg(p.note + (p.x / 100 | 0)); }
        }
        for (const bp of bumpers) {
          const hit = collideCircle(b, bp, 0.2);
          if (hit) {
            const nx = (b.x - bp.x), ny = (b.y - bp.y), d = Math.hypot(nx, ny) || 1;
            b.vx += nx / d * 260 * h * 20; b.vy += ny / d * 120 * h * 20;
            if (bp.flash < 0.5) { sfx.bumper(); burst(b.x, b.y, '#ffe36b', 6, 200, 0.35, 2.5); }
            bp.flash = 1;
          }
        }
        let touching = 0;
        for (const g of gears) {
          const rx = b.x - g.x, ry = b.y - g.y;
          const hit = collideCircle(b, g, 0.1, -g.omega * ry, g.omega * rx, 0.25);
          if (hit) touching++;
        }
        if (touching === 2 && b.r > SMALL + 1) { splitBall(b); continue; }
        if (maxHit > 120 && soundBudget < 10) sfx.clack(maxHit, b.r);

        // lava
        if (b.x > LAVA.x0 && b.x < LAVA.x1 && b.y > LAVA.top + 4) {
          b.melt = 0.001; sfx.sizzle();
          burst(b.x, LAVA.top, '#ffb020', 8, 180, 0.7, 3);
        }
      }
      ballCollisions();
    }

    // bookkeeping
    for (const b of balls) {
      b.age += dt;
      if (b.melt) {
        b.melt += dt;
        if (b.melt > 0.8) { b.dead = true; melted++; if (melted % CELEBRATE_AT === 0) celebrate(); }
        continue;
      }
      if (b.pop) {
        b.pop += dt;
        if (b.pop > 0.25) b.dead = true;
        continue;
      }
      if (b.sx === undefined || Math.hypot(b.x - b.sx, b.y - b.sy) > 10) { b.sx = b.x; b.sy = b.y; b.still = 0; }
      else b.still += dt;
      if (b.still > 5 || b.y > H + 60 || b.x < -60 || b.x > W + 60) {
        b.pop = 0.001; burst(b.x, b.y, b.col, 8, 160, 0.4, 2.5); sfx.pop();
      }
    }
    balls = balls.filter(b => !b.dead);

    for (const p of sparks) { p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    sparks = sparks.filter(p => p.life > 0);

    updateTruck(dt);
    if (celebrating > 0) {
      celebrating -= dt;
      if (Math.random() < dt * 5) firework();
    }
  }

  function celebrate() {
    celebrating = 3.2;
    sfx.yay();
  }
  function firework() {
    const x = 300 + Math.random() * 1000, y = 120 + Math.random() * 300;
    const h = HUES[(Math.random() * HUES.length) | 0];
    burst(x, y, ballColor(h), 40, 420, 1.2, 4);
    sfx.boom();
  }

  // ---------- Truck ----------
  function updateTruck(dt) {
    const t = truck;
    t.bob += dt;
    if (t.state === 'arriving') {
      const dx = t.parkX - t.x;
      t.x += Math.sign(dx) * Math.min(Math.abs(dx), 380 * dt);
      if (Math.abs(dx) < 1) { t.state = 'parked'; t.timer = 0; sfx.horn(); }
    } else if (t.state === 'parked') {
      t.timer += dt;
    } else if (t.state === 'dumping') {
      t.timer += dt;
      t.bed = Math.min(1, t.bed + dt * 1.6);
      if (t.bed > 0.55 && t.load.length) {
        t.spawnT -= dt;
        while (t.spawnT <= 0 && t.load.length) {
          const l = t.load.pop();
          addBall(t.x - 22 + Math.random() * 16, 128 + Math.random() * 10, l.r, l.h, -40 - Math.random() * 120, 40);
          t.spawnT += 0.045;
        }
      }
      if (!t.load.length && t.timer > 1.6) { t.state = 'lowering'; }
    } else if (t.state === 'lowering') {
      t.bed = Math.max(0, t.bed - dt * 1.4);
      if (t.bed === 0) { t.state = 'leaving'; }
    } else if (t.state === 'leaving') {
      t.x += 420 * dt;
      if (t.x > 1800) { t.state = 'away'; t.timer = 0; refillTruck(); }
    } else if (t.state === 'away') {
      t.timer += dt;
      if (t.timer > 1.2) t.state = 'arriving';
    }
  }
  function truckHit(x, y) {
    const t = truck;
    return x > t.x - 30 && x < t.x + 270 && y > 40 && y < 175;
  }
  function dumpTruck() {
    if (truck.state !== 'parked') return false;
    truck.state = 'dumping'; truck.timer = 0; truck.spawnT = 0;
    sfx.dump(); sfx.whirr();
    return true;
  }

  // ---------- Rendering ----------
  let staticLayer = null, lavaCanvas = null, lavaCtx = null, lavaImg = null;
  const LAVA_PX = 4;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = window.innerWidth, ch = window.innerHeight;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    scale = Math.min(cw / W, ch / H);
    offX = (cw - W * scale) / 2; offY = (ch - H * scale) / 2;
    buildStatic();
  }

  function buildStatic() {
    staticLayer = document.createElement('canvas');
    staticLayer.width = canvas.width; staticLayer.height = canvas.height;
    const c = staticLayer.getContext('2d');
    c.setTransform(scale * dpr, 0, 0, scale * dpr, offX * dpr, offY * dpr);
    c.lineCap = 'round'; c.lineJoin = 'round';
    // decorative double-line pipes, dim
    for (const p of decor) {
      for (const [wdt, col] of [[16, 'rgba(40,170,215,0.22)'], [6, 'rgba(5,7,13,1)']]) {
        c.strokeStyle = col; c.lineWidth = wdt; c.beginPath();
        p.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke();
      }
    }
    // glowing walls
    c.shadowColor = '#19c8ff'; c.shadowBlur = 14;
    c.strokeStyle = NEON;
    for (const w of walls) {
      if (w.sieve) {
        c.save(); c.setLineDash([12, 20]); c.lineCap = 'butt';
        c.lineWidth = w.t * 2; c.beginPath(); c.moveTo(w.ax, w.ay); c.lineTo(w.bx, w.by); c.stroke();
        c.restore(); continue;
      }
      c.lineWidth = w.t * 2; c.beginPath(); c.moveTo(w.ax, w.ay); c.lineTo(w.bx, w.by); c.stroke();
    }
    c.shadowBlur = 0;
    // inner highlight
    c.strokeStyle = 'rgba(200,250,255,0.55)';
    for (const w of walls) {
      if (w.sieve) continue;
      c.lineWidth = Math.max(1.5, w.t * 0.5); c.beginPath(); c.moveTo(w.ax, w.ay); c.lineTo(w.bx, w.by); c.stroke();
    }
    // thermometer tube
    c.strokeStyle = 'rgba(63,220,255,0.8)'; c.lineWidth = 6;
    c.shadowColor = '#19c8ff'; c.shadowBlur = 12;
    c.beginPath();
    c.arc(THERMO.x, THERMO.bottom + THERMO.bulb * 0.6, THERMO.bulb, -Math.PI / 2 + 0.55, Math.PI * 1.5 - 0.55, false);
    c.stroke();
    c.beginPath();
    c.moveTo(THERMO.x - 18, THERMO.bottom); c.lineTo(THERMO.x - 18, THERMO.top);
    c.arc(THERMO.x, THERMO.top, 18, Math.PI, 0); c.lineTo(THERMO.x + 18, THERMO.bottom);
    c.stroke();
    c.shadowBlur = 0;

    lavaCanvas = document.createElement('canvas');
    lavaCanvas.width = Math.ceil((LAVA.x1 - LAVA.x0) / LAVA_PX);
    lavaCanvas.height = Math.ceil((LAVA.bottom - LAVA.top + 12) / LAVA_PX);
    lavaCtx = lavaCanvas.getContext('2d');
    lavaImg = lavaCtx.createImageData(lavaCanvas.width, lavaCanvas.height);
  }

  function updateLava() {
    const d = lavaImg.data, w = lavaCanvas.width, hgt = lavaCanvas.height;
    const heat = Math.min(1, (melted % CELEBRATE_AT) / CELEBRATE_AT);
    for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const n = Math.sin(x * 0.35 + time * 2.1) * Math.sin(y * 0.6 - time * 1.3) + Math.sin((x + y) * 0.17 + time * 1.7);
      const r = Math.random();
      const v = Math.max(0, Math.min(1, 0.5 + n * 0.25 + r * 0.35 + heat * 0.15));
      d[i] = 255;
      d[i + 1] = 40 + v * 215;
      d[i + 2] = v > 0.85 ? (v - 0.85) * 900 : 10;
      d[i + 3] = 255;
    }
    lavaCtx.putImageData(lavaImg, 0, 0);
  }

  function drawGear(g) {
    const teeth = 14;
    ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.angle);
    ctx.fillStyle = g.boost > 0 ? '#9ff3ff' : '#2bc4e6';
    ctx.shadowColor = '#19c8ff'; ctx.shadowBlur = g.boost > 0 ? 24 : 10;
    ctx.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const a = i / (teeth * 2) * Math.PI * 2, rr = i % 2 ? g.r - 8 : g.r + 4;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0a1a26';
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#0a1a26'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(-g.r + 14, 0); ctx.lineTo(g.r - 14, 0); ctx.stroke();
    ctx.restore();
  }

  function drawStar(bp) {
    ctx.save(); ctx.translate(bp.x, bp.y); ctx.rotate(bp.spin);
    const s = 1 + bp.flash * 0.25;
    ctx.scale(s, s);
    ctx.fillStyle = bp.flash > 0.1 ? '#fff3a0' : '#2bc4e6';
    ctx.shadowColor = bp.flash > 0.1 ? '#ffd02b' : '#19c8ff'; ctx.shadowBlur = 16;
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2, rr = i % 2 ? bp.r * 0.55 : bp.r * 1.15;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawTruck() {
    const t = truck;
    if (t.x > 1760) return;
    const bounce = t.state === 'arriving' || t.state === 'leaving' ? Math.sin(t.bob * 30) * 1.5 : 0;
    const baseY = 160 - 6; // rail top
    ctx.save();
    ctx.translate(t.x, bounce);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.shadowColor = '#19c8ff'; ctx.shadowBlur = 12;
    ctx.strokeStyle = NEON; ctx.lineWidth = 6;
    // chassis
    ctx.beginPath(); ctx.moveTo(0, baseY - 22); ctx.lineTo(250, baseY - 22); ctx.stroke();
    // cab
    ctx.fillStyle = 'rgba(25,120,170,0.35)';
    ctx.beginPath();
    ctx.moveTo(185, baseY - 22); ctx.lineTo(185, baseY - 92); ctx.lineTo(228, baseY - 92);
    ctx.quadraticCurveTo(258, baseY - 70, 258, baseY - 40); ctx.lineTo(258, baseY - 22); ctx.closePath();
    ctx.fill(); ctx.stroke();
    // window
    ctx.fillStyle = 'rgba(190,245,255,0.5)'; ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.moveTo(200, baseY - 80); ctx.lineTo(226, baseY - 80); ctx.quadraticCurveTo(244, baseY - 66, 246, baseY - 52); ctx.lineTo(200, baseY - 52); ctx.closePath(); ctx.fill();
    // eyes on the cab: a friendly face
    ctx.fillStyle = '#05070d';
    ctx.beginPath(); ctx.arc(215, baseY - 66, 4, 0, 7); ctx.arc(233, baseY - 66, 4, 0, 7); ctx.fill();
    // bed (tips around rear pivot)
    const ang = -t.bed * 0.85;
    ctx.save();
    ctx.translate(4, baseY - 26);
    ctx.rotate(ang);
    // balls in bed
    if (t.load.length) {
      ctx.save();
      ctx.beginPath(); ctx.rect(4, -66, 162, 62); ctx.clip();
      let i = 0;
      for (const l of t.load) {
        const col = i % 9, row = (i / 9) | 0;
        const bx = 18 + col * 17 + (row % 2) * 8, by = -14 - row * 13;
        ctx.fillStyle = ballColor(l.h);
        ctx.beginPath(); ctx.arc(bx, by, l.r > 10 ? 10 : 6, 0, 7); ctx.fill();
        i++;
      }
      ctx.restore();
    }
    ctx.shadowBlur = 12; ctx.shadowColor = '#19c8ff';
    ctx.strokeStyle = NEON; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(0, -70); ctx.lineTo(0, 0); ctx.lineTo(170, 0); ctx.lineTo(176, -70); ctx.stroke();
    ctx.restore();
    // wheels
    ctx.shadowBlur = 10;
    for (const wx of [40, 120, 220]) {
      ctx.fillStyle = '#0a1a26'; ctx.strokeStyle = NEON; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(wx, baseY - 14, 14, 0, 7); ctx.fill(); ctx.stroke();
      const rot = t.x * 0.07;
      ctx.beginPath(); ctx.moveTo(wx, baseY - 14); ctx.lineTo(wx + Math.cos(rot) * 10, baseY - 14 + Math.sin(rot) * 10); ctx.stroke();
    }
    ctx.restore();

    // tap hint
    if (t.state === 'parked') {
      const p = (time * 1.2) % 1;
      ctx.save();
      ctx.strokeStyle = `rgba(255,230,120,${1 - p})`; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(t.x + 110, 95, 40 + p * 50, 0, 7); ctx.stroke();
      // little hand
      const hy = 60 + Math.sin(time * 6) * 8;
      ctx.font = '54px sans-serif'; ctx.textAlign = 'center';
      ctx.globalAlpha = t.timer > 1 ? 1 : t.timer;
      ctx.fillText('👆', t.x + 110, hy + 60);
      ctx.restore();
    }
  }

  function drawThermo() {
    const heat = (melted % CELEBRATE_AT) / CELEBRATE_AT;
    const full = celebrating > 0 ? 1 : heat;
    const topY = THERMO.bottom - (THERMO.bottom - THERMO.top) * full;
    const grad = ctx.createLinearGradient(0, THERMO.bottom, 0, THERMO.top);
    grad.addColorStop(0, '#ff3b1f'); grad.addColorStop(0.6, '#ffae00'); grad.addColorStop(1, '#fff36b');
    ctx.fillStyle = grad;
    ctx.shadowColor = '#ff7a00'; ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.arc(THERMO.x, THERMO.bottom + THERMO.bulb * 0.6, THERMO.bulb - 9, 0, 7); ctx.fill();
    ctx.fillRect(THERMO.x - 10, topY, 20, THERMO.bottom - topY + 10);
    ctx.shadowBlur = 0;
    // ticks
    ctx.strokeStyle = 'rgba(63,220,255,0.5)'; ctx.lineWidth = 3;
    for (let i = 1; i < 6; i++) {
      const y = THERMO.bottom - (THERMO.bottom - THERMO.top) * i / 6;
      ctx.beginPath(); ctx.moveTo(THERMO.x + 26, y); ctx.lineTo(THERMO.x + 40, y); ctx.stroke();
    }
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(staticLayer, 0, 0);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offX * dpr, offY * dpr);

    // lava
    if ((frame & 1) === 0) updateLava();
    ctx.save();
    ctx.beginPath();
    ctx.rect(LAVA.x0 + 6, LAVA.top, LAVA.x1 - LAVA.x0 - 12, LAVA.bottom - LAVA.top - 6);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(lavaCanvas, LAVA.x0, LAVA.top - 4, lavaCanvas.width * LAVA_PX, lavaCanvas.height * LAVA_PX);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,140,30,0.12)';
    ctx.fillRect(LAVA.x0 + 6, LAVA.top - 40, LAVA.x1 - LAVA.x0 - 12, 40);

    for (const p of pegs) {
      ctx.fillStyle = p.flash > 0.05 ? `hsl(${50 + p.note * 40} 100% ${60 + p.flash * 30}%)` : NEON;
      ctx.shadowColor = p.flash > 0.05 ? '#fff' : '#19c8ff'; ctx.shadowBlur = 8 + p.flash * 20;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r + p.flash * 4, 0, 7); ctx.fill();
    }
    ctx.shadowBlur = 0;
    for (const g of gears) drawGear(g);
    for (const bp of bumpers) drawStar(bp);

    // balls
    for (const b of balls) {
      let r = b.r, alpha = 1;
      if (b.melt) { r *= Math.max(0.05, 1 - b.melt / 0.8); }
      if (b.pop) { r *= 1 + b.pop * 3; alpha = Math.max(0, 1 - b.pop / 0.25); }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = b.melt ? `hsl(${30 - b.melt * 20} 100% ${60 + b.melt * 30}%)` : b.col;
      ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, 7); ctx.fill();
      if (r > 5) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath(); ctx.arc(b.x - r * 0.35, b.y - r * 0.35, r * 0.3, 0, 7); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    drawTruck();
    drawThermo();

    for (const p of sparks) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Input ----------
  function toWorld(e) {
    return { x: (e.clientX - offX) / scale, y: (e.clientY - offY) / scale };
  }
  function onTap(x, y) {
    if (truckHit(x, y)) { if (!dumpTruck()) sfx.horn(); return; }
    for (const g of gears) if (Math.hypot(x - g.x, y - g.y) < g.r + 20) {
      g.boost = 2.5; sfx.whirr(); burst(g.x, g.y, '#9ff3ff', 12, 260, 0.5, 3); return;
    }
    for (const bp of bumpers) if (Math.hypot(x - bp.x, y - bp.y) < bp.r + 25) {
      bp.flash = 1; sfx.bumper(); burst(bp.x, bp.y, '#ffe36b', 12, 260, 0.5, 3); return;
    }
    for (const p of pegs) if (Math.hypot(x - p.x, y - p.y) < 24) {
      p.flash = 1; sfx.peg(p.note + (p.x / 100 | 0)); return;
    }
    if (x < 0 || x > W || y < 0 || y > H) return;
    const big = Math.random() < 0.55;
    addBall(x, y, big ? BIG : SMALL, HUES[(Math.random() * HUES.length) | 0]);
    burst(x, y, '#ffffff', 6, 140, 0.3, 2);
    sfx.pop();
  }
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    initAudio();
    if (!started) return;
    const p = toWorld(e);
    onTap(p.x, p.y);
  });
  // stop iOS long-press menus and pinch zoom
  ['gesturestart', 'gesturechange', 'contextmenu', 'dblclick'].forEach(ev =>
    document.addEventListener(ev, e => e.preventDefault(), { passive: false }));
  document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

  const startEl = document.getElementById('start');
  function start() {
    initAudio();
    if (started) return;
    started = true;
    startEl.style.display = 'none';
  }
  startEl.addEventListener('pointerup', start);
  startEl.addEventListener('touchend', e => { e.preventDefault(); start(); }, { passive: false });

  const muteBtn = document.getElementById('mute');
  try { muted = localStorage.getItem('bf-muted') === '1'; } catch (e) {}
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.addEventListener('pointerdown', e => {
    e.stopPropagation(); e.preventDefault();
    initAudio();
    muted = !muted;
    muteBtn.textContent = muted ? '🔇' : '🔊';
    if (master) master.gain.value = muted ? 0 : 0.6;
    try { localStorage.setItem('bf-muted', muted ? '1' : '0'); } catch (e) {}
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (ac) ac.suspend(); }
    else { if (ac && started) ac.resume(); last = performance.now(); }
  });

  // ---------- Loop ----------
  let last = performance.now(), frame = 0;
  function loop(now) {
    let dt = (now - last) / 1000; last = now;
    if (dt > 1 / 30) dt = 1 / 30;
    if (dt <= 0) dt = 1 / 60;
    time += dt; frame++;
    soundBudget = Math.max(0, soundBudget - dt * 40);
    step(dt);
    draw();
    requestAnimationFrame(loop);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  resize();
  requestAnimationFrame(loop);

  // test hook (harmless in production)
  window.__bf = { get balls() { return balls; }, get melted() { return melted; }, truck, dumpTruck, onTap, step };
})();
