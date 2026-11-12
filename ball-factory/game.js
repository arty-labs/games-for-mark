// Ball Factory: a glowing ball machine for little hands.
// Tap the truck to dump balls, tap anywhere to drop a ball, tap the machines to make them move.
// Melt enough balls before the trucks run out. Faster means more stars.
(() => {
  'use strict';

  const W = 1600, H = 1000;          // logical world size
  const GRAV = 1500;
  const BIG = 16, SMALL = 7;         // ball radii
  const MAX_BALLS = 420;
  const NEON = '#3fdcff';
  const TAU = Math.PI * 2;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let scale = 1, offX = 0, offY = 0, dpr = 1;

  // ======================================================================
  // Moving parts. Each part has update(dt), a list of kinematic segments
  // (ksegs) and circles (kcircs) that balls bump into, draw(), and tap().
  // A kinematic segment: {ax,ay,bx,by,t, vx,vy, om,px,py, surf, grip, e}
  // Its velocity at point (x,y) is (vx - om*(y-py), vy + om*(x-px)).
  // ======================================================================
  const rot = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

  function glowStroke(c, w, col = NEON, blur = 12) {
    c.strokeStyle = col; c.lineWidth = w; c.shadowColor = '#19c8ff'; c.shadowBlur = blur;
    c.lineCap = 'round'; c.lineJoin = 'round';
  }

  // Spinning paddle wheel / pinwheel
  function Rotor(x, y, arms, len, om, opts = {}) {
    const p = { x, y, arms, len, om0: om, om, angle: opts.angle || 0, boost: 0, ksegs: [], kcircs: [{ x, y, r: 12, vx: 0, vy: 0 }] };
    p.update = dt => {
      p.boost = Math.max(0, p.boost - dt);
      p.om = p.om0 * (p.boost > 0 ? 3 : 1);
      p.angle += p.om * dt;
      p.ksegs = [];
      for (let i = 0; i < arms; i++) {
        const a = p.angle + i * TAU / arms;
        p.ksegs.push({ ax: x, ay: y, bx: x + Math.cos(a) * len, by: y + Math.sin(a) * len, t: 6, vx: 0, vy: 0, om: p.om, px: x, py: y, grip: 0.04, e: 0.3 });
      }
    };
    p.draw = () => {
      ctx.save();
      glowStroke(ctx, 12, p.boost > 0 ? '#bff8ff' : '#2bc4e6', p.boost > 0 ? 22 : 12);
      for (const s of p.ksegs) { ctx.beginPath(); ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.bx, s.by); ctx.stroke(); }
      ctx.fillStyle = '#0a1a26'; ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(x, y, 12, 0, TAU); ctx.fill();
      ctx.lineWidth = 4; ctx.stroke();
      ctx.restore();
    };
    p.tap = (tx, ty) => {
      if (Math.hypot(tx - x, ty - y) > len + 20) return false;
      p.boost = 2.5; sfx.whirr(); burst(x, y, '#9ff3ff', 10, 220, 0.4, 3); return true;
    };
    p.update(0);
    return p;
  }

  // Conveyor belt: a static segment whose surface moves along a->b
  function Conveyor(ax, ay, bx, by, speed) {
    const p = { phase: 0, boost: 0, ksegs: [], kcircs: [] };
    const seg = { ax, ay, bx, by, t: 7, vx: 0, vy: 0, om: 0, px: 0, py: 0, surf: speed, grip: 0.3, e: 0.05 };
    p.ksegs = [seg];
    const len = Math.hypot(bx - ax, by - ay), dx = (bx - ax) / len, dy = (by - ay) / len;
    p.update = dt => {
      p.boost = Math.max(0, p.boost - dt);
      seg.surf = speed * (p.boost > 0 ? 2.2 : 1);
      p.phase = (p.phase + seg.surf * dt) % 30;
    };
    p.draw = () => {
      ctx.save();
      glowStroke(ctx, 16, '#1b8fb3', 10);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = p.boost > 0 ? '#fff3a0' : '#9ff3ff';
      for (let s = p.phase; s < len; s += 30) {
        ctx.beginPath(); ctx.arc(ax + dx * s, ay + dy * s, 3, 0, TAU); ctx.fill();
      }
      ctx.strokeStyle = '#2bc4e6'; ctx.lineWidth = 4;
      for (const [cx, cy] of [[ax, ay], [bx, by]]) {
        ctx.beginPath(); ctx.arc(cx, cy, 8, 0, TAU); ctx.stroke();
      }
      ctx.restore();
    };
    p.tap = (tx, ty) => {
      const u = Math.max(0, Math.min(1, ((tx - ax) * dx + (ty - ay) * dy) / len));
      if (Math.hypot(tx - (ax + dx * u * len), ty - (ay + dy * u * len)) > 30) return false;
      p.boost = 3; sfx.whirr(); return true;
    };
    return p;
  }

  // Bucket that fills up, then tips over and dumps (dir +1 = tips right)
  function TipBucket(x, y, w, h, dir, opts = {}) {
    const local = [[-w / 2, -h, -w / 2, 0], [-w / 2, 0, w / 2, 0], [w / 2, 0, w / 2, -h]];
    const maxA = (opts.tip || 2.0) * dir;
    const need = opts.need || 8;
    const p = { angle: 0, om: 0, state: 'wait', timer: 0, firstBall: -1, ksegs: [], kcircs: [], count: 0 };
    p.update = (dt, balls) => {
      let n = 0;
      if (p.state === 'wait') {
        for (const b of balls) {
          if (b.melt || b.pop) continue;
          const [lx, ly] = rot(b.x - x, b.y - y, -p.angle);
          if (lx > -w / 2 && lx < w / 2 && ly < 0 && ly > -h - 10) n++;
        }
        p.count = n;
        p.timer = n ? p.timer + dt : 0;
        if (n >= need || (n > 0 && p.timer > 5)) p.tipNow();
      }
      const target = p.state === 'tipping' || p.state === 'hold' ? maxA : 0;
      const speed = p.state === 'tipping' ? 3.2 : 1.6;
      const diff = target - p.angle;
      const stepA = Math.sign(diff) * Math.min(Math.abs(diff), speed * dt);
      p.om = dt > 0 ? stepA / dt : 0;
      p.angle += stepA;
      if (p.state === 'tipping' && Math.abs(diff) < 0.01) { p.state = 'hold'; p.timer = 0; }
      else if (p.state === 'hold') { p.timer += dt; if (p.timer > 1.3) p.state = 'back'; }
      else if (p.state === 'back' && Math.abs(p.angle) < 0.01) { p.state = 'wait'; p.timer = 0; }
      p.ksegs = local.map(([a1, a2, b1, b2]) => {
        const [ax, ay] = rot(a1, a2, p.angle), [bx, by] = rot(b1, b2, p.angle);
        return { ax: x + ax, ay: y + ay, bx: x + bx, by: y + by, t: 6, vx: 0, vy: 0, om: p.om, px: x, py: y, grip: 0.02, e: 0.1 };
      });
    };
    p.tipNow = () => { if (p.state === 'wait') { p.state = 'tipping'; sfx.tip(); } };
    p.draw = () => {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(p.angle);
      ctx.fillStyle = 'rgba(25,120,170,0.18)';
      ctx.fillRect(-w / 2, -h, w, h);
      glowStroke(ctx, 12);
      ctx.beginPath(); ctx.moveTo(-w / 2, -h); ctx.lineTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.lineTo(w / 2, -h); ctx.stroke();
      // fill gauge dots
      ctx.shadowBlur = 0;
      for (let i = 0; i < need; i++) {
        ctx.fillStyle = i < p.count ? '#fff36b' : 'rgba(63,220,255,0.3)';
        ctx.beginPath(); ctx.arc(-w / 2 + 12 + i * ((w - 24) / Math.max(1, need - 1)), 14, 4, 0, TAU); ctx.fill();
      }
      ctx.restore();
      ctx.save(); ctx.fillStyle = '#0a1a26'; glowStroke(ctx, 4);
      ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.fill(); ctx.stroke(); ctx.restore();
    };
    p.tap = (tx, ty) => {
      const [lx, ly] = rot(tx - x, ty - y, -p.angle);
      if (lx < -w / 2 - 25 || lx > w / 2 + 25 || ly < -h - 25 || ly > 35) return false;
      p.tipNow(); return true;
    };
    p.update(0, []);
    return p;
  }

  // Piston: a plate that slides from xa towards xb and back, pushing balls ahead of it
  function Piston(xa, xb, yTop, yBot, period) {
    const sd = Math.sign(xb - xa) || 1;
    const p = { x: xa, phase: 0, boost: 0, ksegs: [], kcircs: [] };
    p.update = dt => {
      p.boost = Math.max(0, p.boost - dt);
      p.phase += dt * TAU / period * (p.boost > 0 ? 2.5 : 1);
      const k = 0.5 - 0.5 * Math.cos(p.phase);
      const nx = xa + (xb - xa) * k;
      const vx = dt > 0 ? (nx - p.x) / dt : 0;
      p.x = nx;
      p.ksegs = [{ ax: p.x, ay: yTop, bx: p.x, by: yBot, t: 7, vx, vy: 0, om: 0, px: 0, py: 0, grip: 0, e: 0.2, oneSide: sd }];
    };
    p.draw = () => {
      ctx.save();
      const my = (yTop + yBot) / 2;
      glowStroke(ctx, 8, '#1b8fb3', 6);
      ctx.beginPath(); ctx.moveTo(xa - 40 * sd, my); ctx.lineTo(p.x, my); ctx.stroke();
      ctx.fillStyle = 'rgba(25,120,170,0.35)';
      glowStroke(ctx, 5);
      ctx.beginPath(); ctx.rect(sd > 0 ? xa - 70 : xa + 36, yTop - 4, 34, yBot - yTop + 8); ctx.fill(); ctx.stroke();
      glowStroke(ctx, 14, p.boost > 0 ? '#bff8ff' : NEON);
      ctx.beginPath(); ctx.moveTo(p.x, yTop); ctx.lineTo(p.x, yBot); ctx.stroke();
      ctx.restore();
    };
    p.tap = (tx, ty) => {
      const lo = Math.min(xa, xb) - 80, hi = Math.max(xa, xb) + 30;
      if (tx < lo || tx > hi || ty < yTop - 30 || ty > yBot + 30) return false;
      p.boost = 3; sfx.whirr(); return true;
    };
    p.update(0);
    return p;
  }

  // Ball lift: shelves ride up a shaft and wrap back to the bottom
  function Lift(xL, xR, yBot, yTop, count, speed) {
    const span = yBot - yTop;
    const p = { shelves: [], boost: 0, ksegs: [], kcircs: [] };
    for (let i = 0; i < count; i++) p.shelves.push(yBot - i * span / count);
    p.update = dt => {
      p.boost = Math.max(0, p.boost - dt);
      const v = speed * (p.boost > 0 ? 2.2 : 1);
      p.ksegs = [];
      for (let i = 0; i < p.shelves.length; i++) {
        let y = p.shelves[i] - v * dt;
        if (y < yTop) y += span;
        p.shelves[i] = y;
        // tilted down to the right so balls slide out at the top
        p.ksegs.push({ ax: xL + 6, ay: y - 7, bx: xR - 6, by: y + 7, t: 5, vx: 0, vy: -v, om: 0, px: 0, py: 0, grip: 0.02, e: 0.05 });
      }
    };
    p.draw = () => {
      ctx.save();
      // chain
      ctx.strokeStyle = 'rgba(63,220,255,0.25)'; ctx.lineWidth = 3; ctx.setLineDash([8, 8]);
      ctx.lineDashOffset = (performance.now() / 1000 * speed) % 16;
      ctx.beginPath(); ctx.moveTo((xL + xR) / 2, yBot + 15); ctx.lineTo((xL + xR) / 2, yTop - 20); ctx.stroke();
      ctx.setLineDash([]);
      glowStroke(ctx, 10, p.boost > 0 ? '#fff3a0' : '#7fe9ff', 10);
      for (const s of p.ksegs) {
        const fade = Math.min(1, (yBot + 20 - s.ay) / 40, (s.ay - yTop) / 40);
        ctx.globalAlpha = Math.max(0, fade);
        ctx.beginPath(); ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.bx, s.by); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // pulleys
      ctx.fillStyle = '#0a1a26'; glowStroke(ctx, 5);
      for (const yy of [yTop - 20, yBot + 15]) { ctx.beginPath(); ctx.arc((xL + xR) / 2, yy, 14, 0, TAU); ctx.fill(); ctx.stroke(); }
      ctx.restore();
    };
    p.tap = (tx, ty) => {
      if (tx < xL - 20 || tx > xR + 20 || ty < yTop - 40 || ty > yBot + 40) return false;
      p.boost = 3; sfx.whirr(); return true;
    };
    p.update(0);
    return p;
  }

  // Trapdoor: hinged at (hx,hy), swings down to let the balls fall
  function Trapdoor(hx, hy, len, dir, every, openAngle = 1.35) {
    const p = { angle: 0, om: 0, state: 'closed', timer: 0, ksegs: [], kcircs: [] };
    const openA = openAngle * dir;
    p.update = dt => {
      p.timer += dt;
      if (p.state === 'closed' && p.timer > every) p.openNow();
      else if (p.state === 'open' && p.timer > 1.4) { p.state = 'closing'; }
      const target = p.state === 'opening' || p.state === 'open' ? openA : 0;
      const diff = target - p.angle;
      const stepA = Math.sign(diff) * Math.min(Math.abs(diff), (p.state === 'opening' ? 6 : 2) * dt);
      p.om = dt > 0 ? stepA / dt : 0;
      p.angle += stepA;
      if (p.state === 'opening' && Math.abs(diff) < 0.01) { p.state = 'open'; p.timer = 0; }
      if (p.state === 'closing' && Math.abs(p.angle) < 0.01) { p.state = 'closed'; p.timer = 0; }
      const ex = hx + Math.cos(p.angle) * len * (dir > 0 ? 1 : -1);
      const ey = hy + Math.sin(Math.abs(p.angle)) * len;
      p.ksegs = [{ ax: hx, ay: hy, bx: ex, by: ey, t: 6, vx: 0, vy: 0, om: dir > 0 ? p.om : -p.om, px: hx, py: hy, grip: 0.02, e: 0.1 }];
    };
    p.openNow = () => { if (p.state === 'closed') { p.state = 'opening'; p.timer = 0; sfx.creak(); } };
    p.draw = () => {
      const s = p.ksegs[0];
      ctx.save();
      glowStroke(ctx, 12, p.state === 'closed' ? NEON : '#fff3a0');
      ctx.beginPath(); ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.bx, s.by); ctx.stroke();
      // warning stripes while it waits
      if (p.state === 'closed' && every - p.timer < 1) {
        ctx.shadowBlur = 0; ctx.fillStyle = (p.timer * 6 | 0) % 2 ? '#ffd02b' : '#ff6b3d';
        ctx.beginPath(); ctx.arc((s.ax + s.bx) / 2, s.ay + 18, 6, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = '#0a1a26'; ctx.lineWidth = 4; ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(hx, hy, 9, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.restore();
    };
    p.tap = (tx, ty) => {
      const s = p.ksegs[0];
      if (tx < Math.min(s.ax, s.bx) - 25 || tx > Math.max(s.ax, s.bx) + 25 || ty < hy - 80 || ty > Math.max(s.ay, s.by) + 30) return false;
      p.openNow(); return true;
    };
    p.update(0);
    return p;
  }

  // Swinging hammer on a rod
  function Pendulum(px, py, len, amp, speed, headR, rodCollides = true) {
    const p = { t: 0, angle: 0, om: 0, boost: 0, ksegs: [], kcircs: [] };
    p.update = dt => {
      p.boost = Math.max(0, p.boost - dt);
      p.t += dt * (p.boost > 0 ? 1.8 : 1);
      p.angle = amp * Math.sin(p.t * speed);
      p.om = amp * speed * Math.cos(p.t * speed) * (p.boost > 0 ? 1.8 : 1);
      // angle 0 = hanging straight down
      const hx = px + Math.sin(p.angle) * len, hy = py + Math.cos(p.angle) * len;
      const om = -p.om; // screen-space angular velocity
      p.ksegs = rodCollides ? [{ ax: px, ay: py, bx: hx, by: hy, t: 5, vx: 0, vy: 0, om, px, py, grip: 0, e: 0.3 }] : [];
      p.rod = [px, py, hx, hy];
      p.kcircs = [{ x: hx, y: hy, r: headR, vx: -om * (hy - py), vy: om * (hx - px), e: 0.6 }];
      p.head = [hx, hy];
    };
    p.draw = () => {
      const [hx, hy] = p.head;
      ctx.save();
      glowStroke(ctx, 8);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.fillStyle = p.boost > 0 ? '#fff3a0' : '#2bc4e6';
      ctx.beginPath(); ctx.arc(hx, hy, headR, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath(); ctx.arc(hx - headR * 0.35, hy - headR * 0.35, headR * 0.3, 0, TAU); ctx.fill();
      ctx.fillStyle = '#0a1a26'; ctx.strokeStyle = NEON; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(px, py, 10, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.restore();
    };
    p.tap = (tx, ty) => {
      const [hx, hy] = p.head;
      if (Math.hypot(tx - hx, ty - hy) > headR + 40 && Math.hypot(tx - px, ty - py) > 40) return false;
      p.boost = 3; sfx.bonk(); return true;
    };
    p.update(0);
    return p;
  }

  // Pinball flipper. side = 1 (left flipper, points right) or -1 (right flipper)
  function Flipper(px, py, len, side, every, offset) {
    const rest = 0.45, up = -0.4;
    const p = { a: rest, om: 0, state: 'rest', timer: offset || 0, ksegs: [], kcircs: [] };
    p.update = dt => {
      p.timer += dt;
      if (p.state === 'rest' && p.timer > every) p.flip();
      const target = p.state === 'up' || p.state === 'hold' ? up : rest;
      const diff = target - p.a;
      const stepA = Math.sign(diff) * Math.min(Math.abs(diff), (p.state === 'up' ? 16 : 5) * dt);
      p.a += stepA;
      const omLocal = dt > 0 ? stepA / dt : 0;
      if (p.state === 'up' && Math.abs(diff) < 0.01) { p.state = 'hold'; p.timer = 0; }
      if (p.state === 'hold' && p.timer > 0.15) p.state = 'down';
      if (p.state === 'down' && Math.abs(p.a - rest) < 0.01) { p.state = 'rest'; p.timer = 0; }
      const ang = side > 0 ? p.a : Math.PI - p.a;
      const om = side > 0 ? omLocal : -omLocal;
      p.ksegs = [{ ax: px, ay: py, bx: px + Math.cos(ang) * len, by: py + Math.sin(ang) * len, t: 9, vx: 0, vy: 0, om, px, py, grip: 0.02, e: 0.3 }];
      p.kcircs = [{ x: px, y: py, r: 14, vx: 0, vy: 0, e: 0.3 }];
    };
    p.flip = () => { if (p.state === 'rest') { p.state = 'up'; p.timer = 0; sfx.flip(); } };
    p.draw = () => {
      const s = p.ksegs[0];
      ctx.save();
      glowStroke(ctx, 20, p.state === 'rest' ? NEON : '#fff3a0', 14);
      ctx.beginPath(); ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.bx, s.by); ctx.stroke();
      ctx.fillStyle = '#0a1a26'; ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(px, py, 9, 0, TAU); ctx.fill();
      ctx.restore();
    };
    p.tap = (tx, ty) => {
      const s = p.ksegs[0];
      if (tx < Math.min(s.ax, s.bx) - 40 || tx > Math.max(s.ax, s.bx) + 40 || ty < py - 120 || ty > py + 100) return false;
      p.flip(); return true;
    };
    p.update(0);
    return p;
  }

  // ======================================================================
  // Levels
  // ======================================================================
  function baseLevel(name) {
    const L = { name, walls: [], decor: [], pegs: [], bumpers: [], gears: [], parts: [], lava: null };
    L.wall = (ax, ay, bx, by, t = 5) => L.walls.push({ ax, ay, bx, by, t });
    L.pegRow = (x0, x1, y, dx) => { for (let x = x0; x <= x1; x += dx) L.pegs.push({ x, y, r: 7, flash: 0, note: L.pegs.length % 7, last: 0 }); };
    L.pit = (x0, x1, top, bottom = 990) => { L.lava = { x0, x1, top, bottom }; };
    // shared: truck rail and funnel
    L.parts.push(Conveyor(1600, 160, 318, 160, 260));
    L.wall(60, 100, 172, 212, 6);
    L.wall(318, 160, 288, 212, 6);
    return L;
  }

  function level1() {
    const L = baseLevel('The Crusher');
    const r1y = x => 270 + (x - 130) * 130 / 1000;
    L.wall(130, 225, 130, 270);
    L.wall(130, 270, 520, r1y(520));
    L.walls.push({ ax: 520, ay: r1y(520), bx: 900, by: r1y(900), t: 5, sieve: true });
    L.wall(900, r1y(900), 1130, 400);
    L.wall(955, 395, 950, 440);
    L.wall(950, 440, 300, 520);
    L.gears.push({ x: 1195, y: 500, r: 46, dir: 1, angle: 0, boost: 0 }, { x: 1309, y: 500, r: 46, dir: -1, angle: 0.2, boost: 0 });
    L.wall(1135, 405, 1146, 498);
    L.wall(1400, 300, 1400, 440, 6);
    L.wall(1400, 440, 1356, 498, 6);
    L.wall(1385, 555, 1380, 610);
    L.wall(1380, 610, 560, 700);
    // peg board
    L.wall(110, 420, 110, 760, 6); L.wall(420, 525, 420, 760, 6);
    L.wall(110, 760, 236, 806, 6); L.wall(420, 760, 292, 806, 6);
    for (let row = 0; row < 5; row++) L.pegRow(150 + (row % 2 ? 26 : 0), 392, 565 + row * 44, 52);
    L.bumpers.push({ x: 512, y: 790, r: 20, flash: 0, spin: 0 });
    L.wall(178, 800, 180, 842); L.wall(180, 842, 640, 892);
    L.wall(640, 892, 652, 900); L.wall(652, 900, 652, 990, 6); L.wall(652, 990, 1198, 990, 6); L.wall(1198, 990, 1198, 770, 6);
    L.pit(652, 1198, 920);
    // a little pinwheel the balls fall past on the way to the lava
    L.parts.push(Rotor(1290, 760, 4, 55, 1.6));
    L.decor = [
      [[40, 300], [40, 900], [80, 960], [560, 960], [600, 930]],
      [[60, 320], [60, 880], [92, 930], [540, 930]],
      [[460, 560], [460, 760], [520, 830]],
      [[700, 420], [700, 600], [760, 650], [1000, 650], [1040, 610], [1040, 560]],
      [[1000, 740], [1100, 740], [1140, 780], [1140, 900]],
      [[300, 330], [300, 420], [340, 460], [340, 500]],
      [[1290, 870], [1290, 960], [1480, 960], [1480, 700]],
    ];
    return L;
  }

  function level2() {
    const L = baseLevel('Wheels & Belts');
    L.wall(130, 220, 130, 262);
    L.parts.push(Conveyor(130, 262, 520, 300, 200));
    // spinning paddle chamber
    L.wall(520, 200, 520, 245); L.wall(520, 312, 520, 470);
    L.wall(520, 200, 760, 200); L.wall(760, 200, 760, 470);
    L.wall(520, 470, 615, 520); L.wall(760, 470, 665, 520);
    L.parts.push(Rotor(640, 375, 4, 75, 1.8));
    // tipping bucket
    L.parts.push(TipBucket(640, 650, 110, 70, 1, { need: 8, tip: 2.1 }));
    // belt to the piston
    L.wall(500, 690, 500, 722); L.wall(500, 722, 700, 772);
    L.parts.push(Conveyor(700, 772, 1080, 772, 180));
    // piston floor
    L.wall(1050, 800, 1050, 880); L.wall(1050, 880, 1250, 880);
    L.parts.push(Piston(1062, 1165, 822, 872, 2.6));
    // lava pit
    L.wall(1255, 885, 1255, 990, 6); L.wall(1255, 990, 1525, 990, 6); L.wall(1525, 990, 1525, 700, 6);
    L.pit(1255, 1525, 910);
    // a peg wall and spinner on the left for tapped balls
    L.wall(110, 400, 110, 900, 6); L.wall(110, 900, 300, 960, 6); L.wall(300, 960, 470, 960, 6); L.wall(470, 960, 470, 860, 6);
    for (let row = 0; row < 6; row++) L.pegRow(150 + (row % 2 ? 26 : 0), 440, 470 + row * 60, 70);
    L.parts.push(Rotor(330, 860, 3, 50, -1.4));
    L.bumpers.push({ x: 900, y: 520, r: 22, flash: 0, spin: 0 }, { x: 1300, y: 420, r: 22, flash: 0, spin: 0 });
    L.wall(820, 600, 980, 600); L.wall(1180, 500, 1420, 520);
    L.decor = [
      [[800, 240], [1500, 240], [1500, 640]],
      [[820, 260], [1480, 260], [1480, 640]],
      [[560, 560], [560, 700], [600, 740]],
      [[880, 960], [1200, 960]],
    ];
    return L;
  }

  function level3() {
    const L = baseLevel('Lift & Hammer');
    // ramp to the zig-zag chute
    L.wall(330, 240, 150, 285);
    L.wall(40, 180, 40, 850, 6); L.wall(150, 300, 150, 800, 6);
    L.wall(40, 380, 95, 400); L.wall(150, 460, 95, 480); L.wall(40, 540, 95, 560); L.wall(150, 620, 95, 640); L.wall(40, 700, 95, 720);
    L.wall(40, 850, 420, 890, 6);
    // lift shaft
    L.wall(420, 200, 420, 830, 6); L.wall(420, 890, 510, 905, 6); L.wall(510, 330, 510, 905, 6);
    L.parts.push(Lift(420, 510, 925, 235, 7, 120));
    // top ramp to the trapdoor box
    L.wall(515, 338, 890, 385);
    L.wall(893, 390, 900, 466); L.wall(1100, 330, 1100, 470);
    L.parts.push(Trapdoor(900, 470, 195, 1, 4.5));
    // hammer ramp
    L.wall(895, 650, 900, 690); L.wall(900, 690, 1380, 750);
    L.parts.push(Pendulum(1230, 430, 270, 0.6, 1.7, 28));
    L.wall(1440, 640, 1440, 860, 6);
    // back to the left, past a spinner
    L.wall(1445, 830, 735, 900);
    L.parts.push(Rotor(1080, 800, 3, 45, 2));
    // lava pit
    L.wall(525, 880, 525, 990, 6); L.wall(525, 990, 730, 990, 6); L.wall(730, 915, 730, 990, 6);
    L.pit(525, 730, 925);
    L.bumpers.push({ x: 300, y: 600, r: 20, flash: 0, spin: 0 });
    L.wall(250, 700, 380, 720);
    L.decor = [
      [[200, 340], [200, 560], [260, 600]],
      [[600, 460], [800, 460], [840, 500], [840, 600]],
      [[1300, 260], [1500, 260], [1500, 960], [900, 960]],
      [[1280, 280], [1480, 280], [1480, 940], [920, 940]],
    ];
    return L;
  }

  function level4() {
    const L = baseLevel('Flipper Fun');
    L.parts.push(TipBucket(240, 320, 120, 70, 1, { need: 10, tip: 1.95 }));
    L.wall(100, 225, 100, 442, 6);
    L.wall(40, 440, 40, 990, 6); L.wall(40, 990, 300, 990, 6);
    L.parts.push(Conveyor(100, 442, 860, 442, 240));
    L.gears.push({ x: 940, y: 520, r: 46, dir: 1, angle: 0, boost: 0 }, { x: 1054, y: 520, r: 46, dir: -1, angle: 0.2, boost: 0 });
    L.wall(862, 450, 890, 515);
    L.wall(1140, 330, 1140, 460, 6); L.wall(1140, 460, 1101, 518, 6);
    // ramp under the crusher with a spinner
    L.wall(1155, 600, 1150, 640);
    L.wall(1150, 640, 760, 690);
    L.parts.push(Rotor(900, 625, 3, 40, 2));
    // flipper zone over the lava
    L.wall(300, 560, 300, 990, 6); L.wall(900, 720, 900, 990, 6); L.wall(300, 990, 900, 990, 6);
    L.pit(305, 895, 945);
    L.parts.push(Flipper(330, 820, 190, 1, 1.9, 0));
    L.parts.push(Flipper(870, 820, 190, -1, 1.9, 0.95));
    L.bumpers.push({ x: 480, y: 690, r: 22, flash: 0, spin: 0 }, { x: 620, y: 590, r: 22, flash: 0, spin: 0 }, { x: 740, y: 760, r: 22, flash: 0, spin: 0 });
    // right side: pegs and a pinwheel for tapped balls
    L.wall(1200, 700, 1200, 900, 6); L.wall(1200, 900, 1300, 960, 6); L.wall(1300, 960, 1500, 960, 6); L.wall(1500, 960, 1500, 300, 6);
    for (let row = 0; row < 5; row++) L.pegRow(1240 + (row % 2 ? 30 : 0), 1470, 360 + row * 60, 60);
    L.parts.push(Rotor(1380, 820, 4, 60, -1.5));
    L.decor = [
      [[60, 480], [60, 960], [260, 960]],
      [[80, 500], [80, 940], [260, 940]],
      [[960, 760], [1100, 760], [1140, 800], [1140, 960]],
    ];
    return L;
  }

  // ======================================================================
  // Levels 5-20 are built from machine modules laid out in three rows.
  // Row A runs right under the truck, row B comes back left, row C runs
  // right into the lava. Each module takes balls falling in at its start
  // and drops them off its end. u = distance along the row.
  // ======================================================================
  const belt = (L, X, u0, y0, u1, y1, speed = 210) => L.parts.push(Conveyor(X(u0), y0, X(u1), y1, speed));
  const MODULES = {
    ramp: { w: 200, build(L, X, y0, w) { belt(L, X, 0, y0, w, y0 + 4); return y0 + 4; } },
    conv: { w: 320, build(L, X, y0, w) { belt(L, X, 0, y0, w, y0 + 4); return y0 + 4; } },
    rotor: { w: 260, build(L, X, y0, w, dir) {
      belt(L, X, 0, y0, w, y0 + 4);
      L.parts.push(Rotor(X(w / 2), y0 - 57, 4, 28, -2.6 * dir));
      return y0 + 4;
    } },
    bumpers: { w: 300, build(L, X, y0, w) {
      belt(L, X, 0, y0, w, y0 + 4);
      for (const f of [0.3, 0.72]) L.bumpers.push({ x: X(w * f), y: y0 - 54, r: 17, flash: 0, spin: 0 });
      return y0 + 4;
    } },
    pendulum: { w: 300, build(L, X, y0, w) {
      belt(L, X, 0, y0, w, y0 + 4);
      L.parts.push(Pendulum(X(w / 2), y0 - 115, 70, 0.8, 2.0, 19, false));
      return y0 + 4;
    } },
    piston: { w: 300, build(L, X, y0, w) {
      L.wall(X(0), y0, X(w), y0 + 4);
      L.parts.push(Piston(X(16), X(130), y0 - 48, y0 - 7, 2.2));
      return y0 + 4;
    } },
    crusher: { w: 240, build(L, X, y0, w) {
      const gy = y0 + 48, xa = X(72), xb = X(168);
      L.gears.push({ x: Math.min(xa, xb), y: gy, r: 36, dir: 1, angle: 0, boost: 0 }, { x: Math.max(xa, xb), y: gy, r: 36, dir: -1, angle: 0.2, boost: 0 });
      L.wall(X(0), y0 + 6, X(42), y0 + 22);
      L.wall(X(w), y0 - 30, X(w), y0 + 10, 6); L.wall(X(w), y0 + 10, X(200), y0 + 24, 6);
      L.wall(X(0), y0 + 60, X(0), y0 + 104);
      belt(L, X, 0, y0 + 104, w, y0 + 108);
      return y0 + 108;
    } },
    bucket: { w: 200, build(L, X, y0, w, dir) {
      L.parts.push(TipBucket(X(80), y0 + 45, 90, 40, dir, { need: 6, tip: 2.1 }));
      L.wall(X(0), y0 + 15, X(0), y0 + 110);
      belt(L, X, 0, y0 + 114, w, y0 + 118);
      return y0 + 118;
    } },
    trapdoor: { w: 190, build(L, X, y0, w, dir) {
      L.wall(X(0), y0 + 8, X(0), y0 + 120);
      L.wall(X(110), y0 - 30, X(110), y0 + 40, 6);
      L.parts.push(Trapdoor(X(6), y0 + 40, 96, dir, 3.2, 0.95));
      belt(L, X, 0, y0 + 124, w, y0 + 128);
      return y0 + 128;
    } },
    pegs: { w: 260, build(L, X, y0, w) {
      L.wall(X(0), y0 - 6, X(0), y0 + 100);
      for (let r = 0; r < 2; r++) for (let u = 50 + (r % 2) * 30; u < w - 20; u += 60) {
        L.pegs.push({ x: X(u), y: y0 + 16 + r * 36, r: 6, flash: 0, note: L.pegs.length % 7, last: 0 });
      }
      belt(L, X, 0, y0 + 104, w, y0 + 108);
      return y0 + 108;
    } },
    sieve: { w: 420, build(L, X, y0, w) {
      const up = u => y0 + 0.06 * u;
      L.wall(X(0), y0, X(40), up(40));
      L.walls.push({ ax: X(40), ay: up(40), bx: X(w - 110), by: up(w - 110), t: 5, sieve: true });
      L.wall(X(w - 110), up(w - 110), X(w - 70), up(w - 70));
      L.wall(X(18), y0 + 30, X(18), y0 + 62);
      belt(L, X, 18, y0 + 66, w, y0 + 70);
      return y0 + 70;
    } },
  };

  const ROWS = [
    { x0: 130, len: 1310, dir: 1 },
    { x0: 1505, len: 1380, dir: -1 },
    { x0: 72, len: 1078, dir: 1 },
  ];

  function modularLevel(spec) {
    const L = baseLevel(spec.name);
    L.wall(130, 215, 130, 262);
    let y = 262;
    const ends = [];
    spec.rows.forEach((mods, ri) => {
      const row = ROWS[ri];
      const list = mods.map(m => Array.isArray(m) ? { name: m[0], w: m[1] } : { name: m, w: MODULES[m].w });
      const used = list.reduce((a, m) => a + m.w, 0);
      const spare = row.len - used;
      if (spare >= 60) list.push({ name: 'ramp', w: spare });
      else list[0].w += spare;
      if (ri === 1) y = Math.max(470, y + 50);
      if (ri === 2) y = Math.max(750, y + 50);
      let u = 0;
      list.forEach((m, i) => {
        if (i > 0) y += 16;
        const base = row.x0 + row.dir * u;
        const X = v => base + row.dir * v;
        y = MODULES[m.name].build(L, X, y, m.w, row.dir);
        u += m.w;
      });
      ends.push(y);
    });
    // chutes between rows
    L.wall(1518, 166, 1518, 990, 6);
    L.wall(60, 300, 60, Math.max(750, ends[1] + 50) + 8, 6);
    // lava pit
    L.wall(1158, ends[2] + 18, 1158, 990, 6); L.wall(1158, 990, 1518, 990, 6);
    L.pit(1163, 1513, 950);
    if (spec.flippers) {
      L.parts.push(Flipper(1186, 885, 125, 1, 1.7, 0));
      L.parts.push(Flipper(1497, 885, 125, -1, 1.7, 0.85));
      L.wall(1158, 846, 1174, 874); L.wall(1518, 846, 1509, 874);
    }
    L.maxY = Math.max(...ends);
    L.ends = ends;
    L.bad = ends[0] > 450 || ends[1] > 690 || ends[2] > (spec.flippers ? 860 : 920);
    L.decor = [
      [[20, 960], [1140, 960]],
      [[20, 980], [1140, 980]],
      [[1545, 180], [1545, 700]],
    ];
    return L;
  }

  const SPECS = [
    { name: 'Bumper Alley', rows: [['conv', 'bumpers'], ['ramp', 'bumpers'], ['ramp', 'rotor']] },
    { name: 'Belt Run', rows: [['conv', 'conv', 'rotor'], ['conv', 'pegs'], ['conv', 'rotor']] },
    { name: 'The Sifter', rows: [['conv', 'sieve'], ['ramp', 'bucket'], ['ramp', 'rotor']] },
    { name: 'Gear Grinder', rows: [['conv', 'crusher'], ['conv', 'bumpers'], ['pegs', 'rotor']] },
    { name: 'Push It', rows: [['conv', 'piston'], ['ramp', 'piston', 'rotor'], ['conv', 'bumpers']] },
    { name: 'Trap Time', rows: [['conv', 'trapdoor'], ['ramp', 'conv', 'rotor'], ['bucket', 'rotor']] },
    { name: 'Hammer Row', rows: [['conv', 'sieve'], ['ramp', 'pendulum'], ['piston', 'pendulum']] },
    { name: 'Flipper Pit', rows: [['conv', 'crusher'], ['conv', 'rotor'], ['ramp', 'bumpers']], flippers: true },
    { name: 'Bucket Brigade', rows: [['conv', 'bucket', 'rotor'], ['trapdoor', 'conv', 'pendulum'], ['pegs', 'piston']] },
    { name: 'Sort & Smash', rows: [['conv', 'sieve', 'rotor'], ['crusher', 'conv', 'bumpers'], ['ramp', 'pendulum']], flippers: true },
    { name: 'Busy Belts', rows: [['conv', 'trapdoor', 'bumpers'], ['piston', 'pegs', 'rotor'], ['conv', 'pendulum']] },
    { name: 'Crunch Time', rows: [['conv', 'crusher', 'rotor'], ['bucket', 'conv', 'pendulum'], ['piston', 'rotor']], flippers: true },
    { name: 'Pinball Plant', rows: [['conv', 'pegs', 'bumpers'], ['crusher', 'piston', 'bumpers'], ['ramp', 'rotor', 'bumpers']], flippers: true },
    { name: 'Double Trouble', rows: [['conv', 'trapdoor', 'rotor'], ['bucket', 'pendulum', 'pendulum'], ['pegs', 'piston', 'rotor']] },
    { name: 'Mega Mill', rows: [['conv', 'sieve', 'pendulum'], ['crusher', 'conv', 'rotor', 'bumpers'], ['piston', 'conv']], flippers: true },
    { name: 'The Big Machine', rows: [['conv', 'crusher', 'piston'], ['trapdoor', 'conv', 'pendulum', 'rotor'], ['bucket', 'piston', 'rotor']] },
  ];

  const LEVELS = [level1, level2, level3, level4, ...SPECS.map(sp => () => modularLevel(sp))];
  let levelIndex = 0;
  let L = null;

  // ======================================================================
  // State, rules and saved progress
  // ======================================================================
  let balls = [];
  let idc = 0;
  let sparks = [];
  let melted = 0;
  let stuckPops = 0;
  let celebrating = 0;
  let banner = { text: '', sub: '', t: 0 };
  let time = 0;
  let mode = 'title';            // title | levels | play | done | fail
  let demo = true;               // the machine running behind the menus
  const THERMO = { x: 1565, top: 260, bottom: 900, bulb: 26 };
  const truck = { state: 'arriving', x: 1750, parkX: 300, bed: 0, timer: 0, load: [], spawnT: 0, bob: 0, hurry: 0 };
  const HUES = [0, 30, 52, 120, 175, 205, 260, 300, 330];
  const ballColor = h => `hsl(${h} 95% 60%)`;

  // Per level: trucks you get, balls to melt, and the times for 3 and 2 stars (seconds).
  // Tuned by simulating every level (see README).
  const TUNING = [
    [3, 160, 30, 39], [3, 80, 32, 42], [3, 80, 49, 63], [3, 160, 33, 43], [3, 80, 51, 66],
    [3, 95, 46, 60], [3, 95, 45, 59], [3, 200, 43, 56], [3, 95, 46, 59], [3, 95, 54, 67],
    [3, 95, 41, 54], [3, 200, 43, 56], [3, 110, 48, 60], [3, 225, 45, 56], [3, 110, 70, 81],
    [3, 225, 46, 55], [3, 220, 45, 54], [3, 110, 58, 66], [3, 225, 47, 53], [3, 230, 45, 55],
  ];
  const STARS_NEEDED = i => (i === 0 ? 0 : i <= 4 ? 1 : i <= 11 ? 2 : 3);

  const run = { level: 0, target: 60, trucksLeft: 3, timer: 0, timing: false, score: 0, finished: false, turbo: 0, endT: 0, result: null };

  const SAVE_KEY = 'bf-save-v1';
  function defaultSave() {
    return { stars: Array(20).fill(0), best: Array(20).fill(null), boosters: { truck: 3, turbo: 3 }, players: ['Mark'], player: 'Mark', runs: [] };
  }
  let save = defaultSave();
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) save = Object.assign(defaultSave(), JSON.parse(raw));
  } catch (e) {}
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }
  const unlocked = i => i === 0 || save.stars[i - 1] >= STARS_NEEDED(i);

  function refillTruck() {
    truck.load = [];
    for (let i = 0; i < 22; i++) truck.load.push({ r: BIG, h: HUES[(Math.random() * HUES.length) | 0] });
    for (let i = 0; i < 18; i++) truck.load.push({ r: SMALL, h: HUES[(Math.random() * HUES.length) | 0] });
    truck.load.sort(() => Math.random() - 0.5);
  }

  function loadLevel(i, asDemo = false) {
    levelIndex = (i + LEVELS.length) % LEVELS.length;
    L = LEVELS[levelIndex]();
    demo = asDemo;
    balls = []; sparks = []; melted = 0; celebrating = 0;
    const [trucks, target, t3, t2] = TUNING[levelIndex];
    Object.assign(run, { level: levelIndex, target, t3, t2, trucksLeft: trucks, timer: 0, timing: false, score: 0, finished: false, turbo: 0, endT: 0, result: null });
    truck.state = 'arriving'; truck.x = 1750; truck.bed = 0; truck.hurry = 0; refillTruck();
    banner = asDemo ? { text: '', sub: '', t: 0 } : { text: `Level ${levelIndex + 1}: ${L.name}`, sub: `Melt ${target} balls with ${trucks} trucks`, t: 3.2 };
    if (canvas.width) buildStatic();
    if (typeof updateHud === 'function') updateHud();
  }

  function addBall(x, y, r, h, vx = 0, vy = 0, free = false) {
    if (balls.length >= MAX_BALLS) {
      const old = balls.find(b => !b.melt && !b.pop && b.free) || balls.find(b => !b.melt && !b.pop);
      if (old) old.pop = 0.001;
    }
    balls.push({ id_: idc++, x, y, vx, vy, r, h, col: ballColor(h), still: 0, melt: 0, pop: 0, age: 0, free });
  }

  function burst(x, y, color, n = 10, speed = 260, life = 0.6, size = 3) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = speed * (0.3 + Math.random() * 0.7);
      sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size: size * (0.6 + Math.random() * 0.8), g: 600 });
    }
  }

  // ======================================================================
  // Sound
  // ======================================================================
  let ac = null, master = null, muted = false, soundBudget = 0;
  function initAudio() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.6;
    master.connect(ac.destination);
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
    tip: () => { tone(300, 0.4, 'triangle', 0.12, 150); noise(0.5, 0.15, 600, 0.6); },
    creak: () => tone(140, 0.35, 'sawtooth', 0.08, 90),
    bonk: () => tone(220, 0.2, 'sine', 0.2, 110),
    flip: () => tone(500, 0.08, 'square', 0.06, 900),
    yay: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.4, 'triangle', 0.16, 0, i * 0.11)); },
    boom: () => { noise(0.6, 0.4, 300, 0.7); tone(80, 0.5, 'sine', 0.2, 40); },
  };

  // ======================================================================
  // Physics
  // ======================================================================
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
      return -vn;
    }
    return 0;
  }

  // moving segment: response uses the velocity of the segment at the contact point
  function collideKSeg(b, s) {
    if (s.oneSide && (b.x - s.ax) * s.oneSide < 0) return 0;
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
    const wvx = s.vx - s.om * (cy - s.py), wvy = s.vy + s.om * (cx - s.px);
    const rvx = b.vx - wvx, rvy = b.vy - wvy;
    const vn = rvx * nx + rvy * ny;
    let hit = 0.0001;
    if (vn < 0) {
      const e = vn < -200 ? s.e : 0.05;
      b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny;
      hit = -vn;
    }
    if (s.grip) {
      const len = Math.sqrt(len2), tx = dx / len, ty = dy / len;
      const target = wvx * tx + wvy * ty + (s.surf || 0);
      const vt = b.vx * tx + b.vy * ty;
      const dv = (target - vt) * s.grip;
      b.vx += dv * tx; b.vy += dv * ty;
    }
    return hit;
  }

  function collideCircle(b, c, rest, surfX = 0, surfY = 0, grip = 0) {
    let nx = b.x - c.x, ny = b.y - c.y;
    const d2 = nx * nx + ny * ny, min = b.r + c.r;
    if (d2 >= min * min) return 0;
    const d = Math.sqrt(d2) || 0.0001;
    nx /= d; ny /= d;
    b.x = c.x + nx * min; b.y = c.y + ny * min;
    const rvx = b.vx - (c.vx || 0), rvy = b.vy - (c.vy || 0);
    const vn = rvx * nx + rvy * ny;
    let hit = 0;
    if (vn < 0) { b.vx -= (1 + rest) * vn * nx; b.vy -= (1 + rest) * vn * ny; hit = -vn; }
    if (grip) {
      const tx = -ny, ty = nx;
      const vt = b.vx * tx + b.vy * ty, st = surfX * tx + surfY * ty;
      const dv = (st - vt) * grip;
      b.vx += dv * tx; b.vy += dv * ty;
    }
    return hit || 0.0001;
  }

  const CELL = 40, GW = Math.ceil(W / CELL) + 4;
  const grid = new Map();
  function ballCollisions() {
    grid.clear();
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.melt || b.pop) continue;
      const gx = Math.max(-1, Math.min(GW - 3, (b.x / CELL) | 0)) + 1;
      const gy = Math.max(-1, (b.y / CELL) | 0) + 1;
      const k = gx + gy * GW;
      let arr = grid.get(k);
      if (!arr) grid.set(k, arr = []);
      arr.push(b);
    }
    for (const [k, arr] of grid) {
      const cx = k % GW, cy = (k / GW) | 0;
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        if (ox < 0 || (ox === 0 && oy < 0)) continue;
        const other = grid.get(cx + ox + (cy + oy) * GW);
        if (!other) continue;
        const same = other === arr;
        for (const a of arr) for (const b of other) {
          if (a === b || (same && a.id_ > b.id_)) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const min = a.r + b.r, d2 = dx * dx + dy * dy;
          if (d2 >= min * min || d2 === 0) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
          const ma = a.r * a.r, mb = b.r * b.r, tot = ma + mb;
          const over = min - d;
          a.x -= nx * over * mb / tot; a.y -= ny * over * mb / tot;
          b.x += nx * over * ma / tot; b.y += ny * over * ma / tot;
          const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rv < 0) {
            const j = -1.15 * rv / (1 / ma + 1 / mb);
            a.vx -= j * nx / ma; a.vy -= j * ny / ma;
            b.vx += j * nx / mb; b.vy += j * ny / mb;
          }
        }
      }
    }
  }

  function splitBall(b) {
    b.pop = 0.001;
    for (let i = 0; i < 3; i++) {
      addBall(b.x + (i - 1) * 6, b.y + 10 + i * 2, SMALL, HUES[(HUES.indexOf(b.h) + i) % HUES.length], (i - 1) * 40, 120, b.free);
    }
    burst(b.x, b.y + 10, b.col, 14, 300, 0.5, 3);
    sfx.crunch();
    if (!b.free) addScore(3);
  }

  function step(dt) {
    const sub = 4, h = dt / sub;
    for (const g of L.gears) {
      g.boost = Math.max(0, g.boost - dt);
      g.omega = g.dir * (2.2 + (g.boost > 0 ? 7 : 0));
      g.angle += g.omega * dt;
    }
    for (const bp of L.bumpers) { bp.flash = Math.max(0, bp.flash - dt * 3); bp.spin += dt * (0.6 + bp.flash * 8); }
    for (const p of L.pegs) p.flash = Math.max(0, p.flash - dt * 2.5);
    const lava = L.lava;

    for (let s = 0; s < sub; s++) {
      for (const part of L.parts) part.update(h, balls);
      for (const b of balls) {
        if (b.pop) continue;
        if (b.melt) { b.vy = 30; b.vx *= 0.9; b.y += b.vy * h; continue; }
        b.vy += GRAV * h;
        b.x += b.vx * h; b.y += b.vy * h;
        let maxHit = 0;
        for (const w of L.walls) {
          if (w.sieve && b.r <= SMALL + 1) continue;
          const minx = (w.ax < w.bx ? w.ax : w.bx) - b.r - w.t, maxx = (w.ax > w.bx ? w.ax : w.bx) + b.r + w.t;
          if (b.x < minx || b.x > maxx) continue;
          const miny = (w.ay < w.by ? w.ay : w.by) - b.r - w.t, maxy = (w.ay > w.by ? w.ay : w.by) + b.r + w.t;
          if (b.y < miny || b.y > maxy) continue;
          const hit = collideSeg(b, w);
          if (hit > maxHit) maxHit = hit;
        }
        for (const part of L.parts) {
          for (const k of part.ksegs) {
            const minx = Math.min(k.ax, k.bx) - b.r - k.t, maxx = Math.max(k.ax, k.bx) + b.r + k.t;
            if (b.x < minx || b.x > maxx) continue;
            const miny = Math.min(k.ay, k.by) - b.r - k.t, maxy = Math.max(k.ay, k.by) + b.r + k.t;
            if (b.y < miny || b.y > maxy) continue;
            const hit = collideKSeg(b, k);
            if (hit > maxHit) maxHit = hit;
          }
          for (const c of part.kcircs) {
            const hit = collideCircle(b, c, c.e || 0.3);
            if (hit > 300 && part.tap && c.r > 20) { burst(b.x, b.y, '#fff3a0', 5, 200, 0.3, 2.5); sfx.bonk(); }
          }
        }
        for (const p of L.pegs) {
          const hit = collideCircle(b, p, 0.45);
          if (hit > 60 && time - p.last > 0.12) { p.flash = 1; p.last = time; sfx.peg(p.note + (p.x / 100 | 0)); if (!b.free) addScore(1); }
        }
        for (const bp of L.bumpers) {
          const hit = collideCircle(b, bp, 0.2);
          if (hit) {
            const nx = b.x - bp.x, ny = b.y - bp.y, d = Math.hypot(nx, ny) || 1;
            b.vx += nx / d * 260 * h * 20; b.vy += ny / d * 120 * h * 20;
            if (bp.flash < 0.5) { sfx.bumper(); burst(b.x, b.y, '#ffe36b', 6, 200, 0.35, 2.5); if (!b.free) addScore(2); }
            bp.flash = 1;
          }
        }
        let touching = 0;
        for (const g of L.gears) {
          const rx = b.x - g.x, ry = b.y - g.y;
          if (collideCircle(b, g, 0.1, -g.omega * ry, g.omega * rx, 0.25)) touching++;
        }
        if (touching === 2 && b.r > SMALL + 1) { splitBall(b); continue; }
        // keep things sane if something squeezes a ball very fast
        const sp2 = b.vx * b.vx + b.vy * b.vy;
        if (sp2 > 2500 * 2500) { const k = 2500 / Math.sqrt(sp2); b.vx *= k; b.vy *= k; }
        if (maxHit > 120 && soundBudget < 10) sfx.clack(maxHit, b.r);

        if (lava && b.x > lava.x0 && b.x < lava.x1 && b.y > lava.top + 4) {
          b.melt = 0.001; sfx.sizzle();
          burst(b.x, lava.top, '#ffb020', 8, 180, 0.7, 3);
        }
      }
      ballCollisions();
    }

    for (const b of balls) {
      b.age += dt;
      if (b.melt) {
        b.melt += dt;
        if (b.melt > 0.8) {
          b.dead = true;
          if (!b.free) { melted++; addScore(b.r > 10 ? 10 : 5); if (melted >= run.target && !run.finished && !demo) finishLevel(); }
        }
        continue;
      }
      if (b.pop) { b.pop += dt; if (b.pop > 0.25) b.dead = true; continue; }
      if (b.sx === undefined || Math.hypot(b.x - b.sx, b.y - b.sy) > 10) { b.sx = b.x; b.sy = b.y; b.still = 0; }
      else b.still += dt;
      if (b.still > 12 || b.y > H + 60 || b.x < -60 || b.x > W + 60) {
        b.pop = 0.001; stuckPops++; if (window.__pops) window.__pops.push([b.x | 0, b.y | 0, b.r]); burst(b.x, b.y, b.col, 8, 160, 0.4, 2.5); sfx.pop();
      }
    }
    balls = balls.filter(b => !b.dead);

    for (const p of sparks) { p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    sparks = sparks.filter(p => p.life > 0);

    updateTruck(dt);
    if (banner.t > 0) banner.t -= dt;
    if (run.timing) run.timer += dt;
    if (run.turbo > 0) {
      run.turbo -= dt;
      for (const part of L.parts) if ('boost' in part) part.boost = Math.max(part.boost, 0.3);
      for (const g of L.gears) g.boost = Math.max(g.boost, 0.3);
      truck.hurry = Math.max(truck.hurry, 0.3);
    }
    if (celebrating > 0) {
      celebrating -= dt;
      if (Math.random() < dt * 5) firework();
    }
    if (run.finished && mode === 'play') {
      run.endT += dt;
      if (run.endT > 3) showDone();
    }
    // out of trucks and no balls left: level failed
    if (!demo && mode === 'play' && !run.finished && run.trucksLeft === 0 && truck.state === 'out' && !balls.some(b => !b.free && !b.pop)) {
      showFail();
    }
    // the menu background keeps the factory busy on its own
    if (demo && truck.state === 'parked' && truck.timer > 1.5) dumpTruck();
    if (demo && truck.state === 'out') { run.trucksLeft = 3; truck.state = 'away'; truck.timer = 0; }
    if (!demo && mode === 'play' && (frame % 10) === 0) updateHud();
  }

  function addScore(n) { if (!demo && !run.finished) run.score += n; }

  function finishLevel() {
    run.finished = true;
    run.timing = false;
    const t = run.timer;
    const stars = t <= run.t3 ? 3 : t <= run.t2 ? 2 : 1;
    const bonus = stars * 100 + Math.max(0, Math.round((run.t2 - t) * 10));
    run.score += bonus;
    const i = run.level;
    const prevStars = save.stars[i];
    const wasUnlocked = i + 1 < 20 && unlocked(i + 1);
    save.stars[i] = Math.max(save.stars[i], stars);
    const best = save.best[i];
    const newBest = !best || run.score > best.score;
    if (newBest) save.best[i] = { score: run.score, time: Math.round(t * 10) / 10 };
    const earned = [];
    if (stars === 3) { save.boosters.truck++; earned.push('🚚'); }
    if (stars >= 2) { save.boosters.turbo++; earned.push('⚡'); }
    save.runs.push({ name: save.player, level: i + 1, score: run.score, stars, time: Math.round(t * 10) / 10, date: Date.now() });
    save.runs.sort((a, b) => b.score - a.score);
    save.runs = save.runs.slice(0, 50);
    persist();
    run.result = { stars, t, bonus, newBest, earned, unlockedNext: i + 1 < 20 && !wasUnlocked && unlocked(i + 1), prevStars };
    celebrating = 3;
    banner = { text: 'Hooray! 🎉', sub: '', t: 3 };
    sfx.yay();
    updateHud();
  }

  function firework() {
    const x = 300 + Math.random() * 1000, y = 120 + Math.random() * 300;
    burst(x, y, ballColor(HUES[(Math.random() * HUES.length) | 0]), 40, 420, 1.2, 4);
    sfx.boom();
  }

  // ======================================================================
  // Truck
  // ======================================================================
  function updateTruck(dt) {
    const t = truck;
    t.bob += dt;
    t.hurry = Math.max(0, t.hurry - dt);
    const fast = t.hurry > 0 ? 2.5 : 1;
    if (t.state === 'arriving') {
      const dx = t.parkX - t.x;
      t.x += Math.sign(dx) * Math.min(Math.abs(dx), 380 * fast * dt);
      if (Math.abs(dx) < 1) { t.state = 'parked'; t.timer = 0; sfx.horn(); }
    } else if (t.state === 'parked') {
      t.timer += dt;
    } else if (t.state === 'dumping') {
      t.timer += dt * fast;
      t.bed = Math.min(1, t.bed + dt * 1.6 * fast);
      if (t.bed > 0.55 && t.load.length) {
        t.spawnT -= dt * fast;
        while (t.spawnT <= 0 && t.load.length) {
          const l = t.load.pop();
          addBall(t.x - 30 + Math.random() * 14, 128 + Math.random() * 10, l.r, l.h, -90 - Math.random() * 120, 40);
          t.spawnT += 0.045;
        }
      }
      if (!t.load.length && t.timer > 1.6) t.state = 'lowering';
    } else if (t.state === 'lowering') {
      t.bed = Math.max(0, t.bed - dt * 1.4 * fast);
      if (t.bed === 0) t.state = 'leaving';
    } else if (t.state === 'leaving') {
      t.x += 420 * fast * dt;
      if (t.x > 1800) { t.timer = 0; refillTruck(); t.state = run.trucksLeft > 0 ? 'away' : 'out'; }
    } else if (t.state === 'away') {
      t.timer += dt * fast;
      if (t.timer > 1.2) t.state = 'arriving';
    }
  }
  const truckHit = (x, y) => x > truck.x - 30 && x < truck.x + 270 && y > 40 && y < 175;
  function dumpTruck() {
    if (truck.state !== 'parked' || run.trucksLeft <= 0) return false;
    run.trucksLeft--;
    if (!demo && !run.finished) run.timing = true;
    truck.state = 'dumping'; truck.timer = 0; truck.spawnT = 0;
    sfx.dump(); sfx.whirr();
    updateHud();
    return true;
  }
  function hurryTruck() {
    if (truck.state === 'out') return;
    truck.hurry = 2; sfx.horn();
  }

  // ======================================================================
  // Rendering
  // ======================================================================
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
    for (const p of L.decor) {
      for (const [wdt, col] of [[16, 'rgba(40,170,215,0.22)'], [6, 'rgba(5,7,13,1)']]) {
        c.strokeStyle = col; c.lineWidth = wdt; c.beginPath();
        p.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke();
      }
    }
    c.shadowColor = '#19c8ff'; c.shadowBlur = 14;
    c.strokeStyle = NEON;
    for (const w of L.walls) {
      if (w.sieve) {
        c.save(); c.setLineDash([12, 20]); c.lineCap = 'butt';
        c.lineWidth = w.t * 2; c.beginPath(); c.moveTo(w.ax, w.ay); c.lineTo(w.bx, w.by); c.stroke();
        c.restore(); continue;
      }
      c.lineWidth = w.t * 2; c.beginPath(); c.moveTo(w.ax, w.ay); c.lineTo(w.bx, w.by); c.stroke();
    }
    c.shadowBlur = 0;
    c.strokeStyle = 'rgba(200,250,255,0.55)';
    for (const w of L.walls) {
      if (w.sieve) continue;
      c.lineWidth = Math.max(1.5, w.t * 0.5); c.beginPath(); c.moveTo(w.ax, w.ay); c.lineTo(w.bx, w.by); c.stroke();
    }
    // thermometer tube
    c.strokeStyle = 'rgba(63,220,255,0.8)'; c.lineWidth = 5;
    c.shadowColor = '#19c8ff'; c.shadowBlur = 12;
    c.beginPath();
    c.arc(THERMO.x, THERMO.bottom + THERMO.bulb * 0.6, THERMO.bulb, -Math.PI / 2 + 0.55, Math.PI * 1.5 - 0.55, false);
    c.stroke();
    c.beginPath();
    c.moveTo(THERMO.x - 14, THERMO.bottom); c.lineTo(THERMO.x - 14, THERMO.top);
    c.arc(THERMO.x, THERMO.top, 14, Math.PI, 0); c.lineTo(THERMO.x + 14, THERMO.bottom);
    c.stroke();
    c.shadowBlur = 0;

    const lv = L.lava;
    lavaCanvas = document.createElement('canvas');
    lavaCanvas.width = Math.ceil((lv.x1 - lv.x0) / LAVA_PX);
    lavaCanvas.height = Math.ceil((lv.bottom - lv.top + 12) / LAVA_PX);
    lavaCtx = lavaCanvas.getContext('2d');
    lavaImg = lavaCtx.createImageData(lavaCanvas.width, lavaCanvas.height);
  }

  function updateLava() {
    const d = lavaImg.data, w = lavaCanvas.width, hgt = lavaCanvas.height;
    const heat = Math.min(1, melted / run.target);
    for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const n = Math.sin(x * 0.35 + time * 2.1) * Math.sin(y * 0.6 - time * 1.3) + Math.sin((x + y) * 0.17 + time * 1.7);
      const v = Math.max(0, Math.min(1, 0.5 + n * 0.25 + Math.random() * 0.35 + heat * 0.15));
      d[i] = 255; d[i + 1] = 40 + v * 215; d[i + 2] = v > 0.85 ? (v - 0.85) * 900 : 10; d[i + 3] = 255;
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
      const a = i / (teeth * 2) * TAU, rr = i % 2 ? g.r - 8 : g.r + 4;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0a1a26';
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, TAU); ctx.fill();
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
      const a = i / 16 * TAU, rr = i % 2 ? bp.r * 0.55 : bp.r * 1.15;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawTruck() {
    const t = truck;
    if (t.x > 1760) return;
    const bounce = t.state === 'arriving' || t.state === 'leaving' ? Math.sin(t.bob * 30) * 1.5 : 0;
    const baseY = 154;
    ctx.save();
    ctx.translate(t.x, bounce);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.shadowColor = '#19c8ff'; ctx.shadowBlur = 12;
    ctx.strokeStyle = NEON; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(0, baseY - 22); ctx.lineTo(250, baseY - 22); ctx.stroke();
    ctx.fillStyle = 'rgba(25,120,170,0.35)';
    ctx.beginPath();
    ctx.moveTo(185, baseY - 22); ctx.lineTo(185, baseY - 92); ctx.lineTo(228, baseY - 92);
    ctx.quadraticCurveTo(258, baseY - 70, 258, baseY - 40); ctx.lineTo(258, baseY - 22); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(190,245,255,0.5)'; ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.moveTo(200, baseY - 80); ctx.lineTo(226, baseY - 80); ctx.quadraticCurveTo(244, baseY - 66, 246, baseY - 52); ctx.lineTo(200, baseY - 52); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#05070d';
    ctx.beginPath(); ctx.arc(215, baseY - 66, 4, 0, TAU); ctx.arc(233, baseY - 66, 4, 0, TAU); ctx.fill();
    ctx.save();
    ctx.translate(4, baseY - 26);
    ctx.rotate(-t.bed * 0.85);
    if (t.load.length) {
      ctx.save();
      ctx.beginPath(); ctx.rect(4, -66, 162, 62); ctx.clip();
      let i = 0;
      for (const l of t.load) {
        const col = i % 9, row = (i / 9) | 0;
        ctx.fillStyle = ballColor(l.h);
        ctx.beginPath(); ctx.arc(18 + col * 17 + (row % 2) * 8, -14 - row * 13, l.r > 10 ? 10 : 6, 0, TAU); ctx.fill();
        i++;
      }
      ctx.restore();
    }
    ctx.shadowBlur = 12; ctx.shadowColor = '#19c8ff';
    ctx.strokeStyle = NEON; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(0, -70); ctx.lineTo(0, 0); ctx.lineTo(170, 0); ctx.lineTo(176, -70); ctx.stroke();
    ctx.restore();
    ctx.shadowBlur = 10;
    for (const wx of [40, 120, 220]) {
      ctx.fillStyle = '#0a1a26'; ctx.strokeStyle = NEON; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(wx, baseY - 14, 14, 0, TAU); ctx.fill(); ctx.stroke();
      const r = t.x * 0.07;
      ctx.beginPath(); ctx.moveTo(wx, baseY - 14); ctx.lineTo(wx + Math.cos(r) * 10, baseY - 14 + Math.sin(r) * 10); ctx.stroke();
    }
    ctx.restore();

    if (t.state === 'parked') {
      const p = (time * 1.2) % 1;
      ctx.save();
      ctx.strokeStyle = `rgba(255,230,120,${1 - p})`; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(t.x + 110, 95, 40 + p * 50, 0, TAU); ctx.stroke();
      ctx.font = '54px sans-serif'; ctx.textAlign = 'center';
      ctx.globalAlpha = Math.min(1, t.timer);
      ctx.fillText('👆', t.x + 110, 120 + Math.sin(time * 6) * 8);
      ctx.restore();
    }
  }

  function drawThermo() {
    const full = Math.min(1, melted / run.target);
    const topY = THERMO.bottom - (THERMO.bottom - THERMO.top) * full;
    const grad = ctx.createLinearGradient(0, THERMO.bottom, 0, THERMO.top);
    grad.addColorStop(0, '#ff3b1f'); grad.addColorStop(0.6, '#ffae00'); grad.addColorStop(1, '#fff36b');
    ctx.fillStyle = grad;
    ctx.shadowColor = '#ff7a00'; ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.arc(THERMO.x, THERMO.bottom + THERMO.bulb * 0.6, THERMO.bulb - 8, 0, TAU); ctx.fill();
    ctx.fillRect(THERMO.x - 7, topY, 14, THERMO.bottom - topY + 10);
    ctx.shadowBlur = 0;
  }

  function drawBanner() {
    if (banner.t <= 0) return;
    const a = Math.max(0, Math.min(1, banner.t * 2, (3.4 - banner.t) * 3));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(5,7,13,0.75)';
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(W / 2 - 460, 410, 920, banner.sub ? 170 : 120, 30) : ctx.rect(W / 2 - 460, 410, 920, 150); ctx.fill();
    ctx.font = '700 64px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#bff3ff'; ctx.shadowColor = '#19c8ff'; ctx.shadowBlur = 30;
    ctx.fillText(banner.text, W / 2, 470);
    if (banner.sub) {
      ctx.font = '600 36px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
      ctx.shadowBlur = 10; ctx.fillStyle = '#fff3a0';
      ctx.fillText(banner.sub, W / 2, 540);
    }
    ctx.restore();
  }

  let frame = 0;
  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(staticLayer, 0, 0);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offX * dpr, offY * dpr);

    const lv = L.lava;
    if ((frame & 1) === 0) updateLava();
    ctx.save();
    ctx.beginPath(); ctx.rect(lv.x0 + 6, lv.top, lv.x1 - lv.x0 - 12, lv.bottom - lv.top - 6); ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(lavaCanvas, lv.x0, lv.top - 4, lavaCanvas.width * LAVA_PX, lavaCanvas.height * LAVA_PX);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,140,30,0.12)';
    ctx.fillRect(lv.x0 + 6, lv.top - 40, lv.x1 - lv.x0 - 12, 40);

    for (const p of L.pegs) {
      ctx.fillStyle = p.flash > 0.05 ? `hsl(${50 + p.note * 40} 100% ${60 + p.flash * 30}%)` : NEON;
      ctx.shadowColor = p.flash > 0.05 ? '#fff' : '#19c8ff'; ctx.shadowBlur = 8 + p.flash * 20;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r + p.flash * 4, 0, TAU); ctx.fill();
    }
    ctx.shadowBlur = 0;
    for (const g of L.gears) drawGear(g);
    for (const bp of L.bumpers) drawStar(bp);
    for (const part of L.parts) part.draw();

    for (const b of balls) {
      let r = b.r, alpha = 1;
      if (b.melt) r *= Math.max(0.05, 1 - b.melt / 0.8);
      if (b.pop) { r *= 1 + b.pop * 3; alpha = Math.max(0, 1 - b.pop / 0.25); }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = b.melt ? `hsl(${30 - b.melt * 20} 100% ${60 + b.melt * 30}%)` : b.col;
      ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.fill();
      if (b.free && !b.melt) { ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2.5; ctx.stroke(); }
      if (r > 5) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath(); ctx.arc(b.x - r * 0.35, b.y - r * 0.35, r * 0.3, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    drawTruck();
    drawThermo();
    for (const p of sparks) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    drawBanner();
  }

  // ======================================================================
  // Input
  // ======================================================================
  const toWorld = e => ({ x: (e.clientX - offX) / scale, y: (e.clientY - offY) / scale });
  function onTap(x, y) {
    if (truckHit(x, y)) { if (!dumpTruck()) hurryTruck(); return; }
    for (const part of L.parts) if (part.tap && part.tap(x, y)) return;
    for (const g of L.gears) if (Math.hypot(x - g.x, y - g.y) < g.r + 20) {
      g.boost = 2.5; sfx.whirr(); burst(g.x, g.y, '#9ff3ff', 12, 260, 0.5, 3); return;
    }
    for (const bp of L.bumpers) if (Math.hypot(x - bp.x, y - bp.y) < bp.r + 25) {
      bp.flash = 1; sfx.bumper(); burst(bp.x, bp.y, '#ffe36b', 12, 260, 0.5, 3); return;
    }
    for (const p of L.pegs) if (Math.hypot(x - p.x, y - p.y) < 24) { p.flash = 1; sfx.peg(p.note + (p.x / 100 | 0)); return; }
    if (x < 0 || x > W || y < 0 || y > H) return;
    // tapped balls count toward the goal just like truck balls; the timer starts with them too
    addBall(x, y, Math.random() < 0.55 ? BIG : SMALL, HUES[(Math.random() * HUES.length) | 0]);
    if (!demo && !run.finished) run.timing = true;
    burst(x, y, '#ffffff', 6, 140, 0.3, 2);
    sfx.pop();
  }
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    initAudio();
    if (mode !== 'play') return;
    const p = toWorld(e);
    onTap(p.x, p.y);
  });
  ['gesturestart', 'gesturechange', 'contextmenu', 'dblclick'].forEach(ev =>
    document.addEventListener(ev, e => e.preventDefault(), { passive: false }));
  document.addEventListener('touchmove', e => { if (!e.target.closest('.scroll')) e.preventDefault(); }, { passive: false });

  // ======================================================================
  // Screens and HUD
  // ======================================================================
  const $ = id => document.getElementById(id);
  const tap = (el, fn) => el.addEventListener('pointerup', e => { e.preventDefault(); e.stopPropagation(); initAudio(); fn(e); });
  ['pointerdown', 'touchstart'].forEach(ev => document.querySelectorAll('.panel, #hud, #boosters').forEach(el => el.addEventListener(ev, e => e.stopPropagation())));
  const screens = ['start', 'levelsel', 'board', 'done', 'fail'];
  function show(id) {
    for (const s of screens) $(s).classList.toggle('hidden', s !== id);
    const playing = id === null;
    $('hud').classList.toggle('hidden', !playing);
    $('boosters').classList.toggle('hidden', !playing);
  }
  const fmtTime = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const starStr = n => '★'.repeat(n) + '☆'.repeat(3 - n);

  function updateHud() {
    $('hud-level').textContent = `${run.level + 1}`;
    $('hud-time').textContent = fmtTime(run.timer);
    $('hud-score').textContent = String(run.score);
    $('hud-goal').textContent = `${Math.min(melted, run.target)}/${run.target}`;
    const left = run.trucksLeft + (truck.state === 'parked' || truck.state === 'arriving' || truck.state === 'away' ? 0 : 0);
    $('hud-trucks').textContent = left > 0 ? '🚚'.repeat(Math.min(left, 5)) + (left > 5 ? `+${left - 5}` : '') : '—';
    $('b-truck-n').textContent = save.boosters.truck;
    $('b-turbo-n').textContent = save.boosters.turbo;
    $('b-truck').disabled = save.boosters.truck <= 0 || run.finished;
    $('b-turbo').disabled = save.boosters.turbo <= 0 || run.turbo > 0 || run.finished;
  }

  function play(i) {
    loadLevel(i);
    mode = 'play';
    show(null);
    updateHud();
  }

  function buildLevelGrid() {
    const grid = $('grid');
    grid.innerHTML = '';
    let total = 0;
    for (let i = 0; i < 20; i++) {
      total += save.stars[i];
      const open = unlocked(i);
      const b = document.createElement('button');
      b.className = 'tile' + (open ? '' : ' locked');
      if (open) {
        b.innerHTML = `<span class="num">${i + 1}</span><span class="st">${starStr(save.stars[i])}</span>`;
        tap(b, () => play(i));
      } else {
        b.innerHTML = `<span class="lock">🔒</span><span class="need">${'★'.repeat(STARS_NEEDED(i))} on ${i}</span>`;
        tap(b, () => { sfx.bonk(); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); });
      }
      grid.appendChild(b);
    }
    $('total-stars').textContent = `★ ${total} / 60`;
    $('lv-player').textContent = save.player;
    $('lv-boost').textContent = `🚚 ${save.boosters.truck}   ⚡ ${save.boosters.turbo}`;
  }
  function openLevels() {
    mode = 'levels';
    buildLevelGrid();
    show('levelsel');
    if (!demo) loadLevel(levelIndex, true);
  }

  function buildPlayers() {
    const box = $('players');
    box.innerHTML = '';
    for (const name of save.players) {
      const b = document.createElement('button');
      b.className = 'chip' + (name === save.player ? ' on' : '');
      b.textContent = name;
      tap(b, () => { save.player = name; persist(); buildPlayers(); });
      box.appendChild(b);
    }
    const add = document.createElement('button');
    add.className = 'chip add'; add.textContent = '+';
    tap(add, () => {
      const name = (prompt('Player name?') || '').trim().slice(0, 14);
      if (name && !save.players.includes(name)) { save.players.push(name); save.player = name; persist(); buildPlayers(); }
    });
    box.appendChild(add);
  }

  function buildBoard() {
    const rows = save.runs.slice(0, 10);
    $('board-list').innerHTML = rows.length ? rows.map((r, k) =>
      `<tr><td>${k + 1}</td><td>${escapeHtml(r.name)}</td><td>Lv ${r.level}</td><td class="gold">${starStr(r.stars)}</td><td>${r.score}</td><td>${fmtTime(r.time)}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">Play a level to get on the board!</td></tr>';
    const per = {};
    for (const r of save.runs) {
      per[r.name] = per[r.name] || { best: 0, levels: new Set() };
      per[r.name].best = Math.max(per[r.name].best, r.score);
      per[r.name].levels.add(r.level);
    }
    $('board-players').innerHTML = Object.entries(per).sort((a, b) => b[1].levels.size - a[1].levels.size || b[1].best - a[1].best)
      .map(([n, v]) => `<tr><td>${escapeHtml(n)}</td><td>${v.levels.size} ${v.levels.size === 1 ? "level" : "levels"}</td><td>best ${v.best}</td></tr>`).join('');
  }
  const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function showDone() {
    mode = 'done';
    const r = run.result;
    $('done-stars').innerHTML = [1, 2, 3].map(n => `<span class="${n <= r.stars ? 'on' : ''}" style="animation-delay:${n * 0.25}s">★</span>`).join('');
    $('done-time').textContent = fmtTime(r.t);
    $('done-score').textContent = String(run.score);
    $('done-best').textContent = r.newBest ? 'New best!' : `Best ${save.best[run.level].score}`;
    const notes = [];
    if (r.earned.length) notes.push(`You earned ${r.earned.join(' ')}`);
    if (r.stars < 3) notes.push(`3 stars: finish in ${fmtTime(run.t3)}${r.stars < 2 ? `, 2 stars: ${fmtTime(run.t2)}` : ''}`);
    if (r.unlockedNext) notes.push(`Level ${run.level + 2} unlocked!`);
    else if (run.level + 1 < 20 && !unlocked(run.level + 1)) notes.push(`Level ${run.level + 2} needs ${'★'.repeat(STARS_NEEDED(run.level + 1))}`);
    $('done-note').innerHTML = notes.map(escapeHtml).join('<br>');
    $('done-next').classList.toggle('hidden', !(run.level + 1 < 20 && unlocked(run.level + 1)));
    show('done');
  }
  function showFail() {
    mode = 'fail';
    $('fail-count').textContent = `${melted} of ${run.target} balls melted`;
    $('fail-boost').classList.toggle('hidden', save.boosters.truck <= 0);
    $('fail-boost-n').textContent = save.boosters.truck;
    show('fail');
    sfx.bonk();
  }

  function useTruckBooster() {
    if (save.boosters.truck <= 0 || run.finished) return;
    save.boosters.truck--; persist();
    run.trucksLeft++;
    if (truck.state === 'out') { truck.state = 'away'; truck.timer = 0; }
    burst(1400, 120, '#fff3a0', 20, 300, 0.6, 3); sfx.horn();
    updateHud();
  }
  function useTurbo() {
    if (save.boosters.turbo <= 0 || run.turbo > 0 || run.finished) return;
    save.boosters.turbo--; persist();
    run.turbo = 10;
    sfx.whirr(); banner = { text: '⚡ Turbo! ⚡', sub: '', t: 1.6 };
    updateHud();
  }

  tap($('play'), () => openLevels());
  tap($('lv-back'), () => { mode = 'title'; buildPlayers(); show('start'); });
  tap($('lv-board'), () => { buildBoard(); show('board'); });
  tap($('board-back'), () => openLevels());
  tap($('hud-menu'), () => openLevels());
  tap($('b-truck'), useTruckBooster);
  tap($('b-turbo'), useTurbo);
  tap($('done-retry'), () => play(run.level));
  tap($('done-levels'), () => openLevels());
  tap($('done-next'), () => play(run.level + 1));
  tap($('fail-retry'), () => play(run.level));
  tap($('fail-levels'), () => openLevels());
  tap($('fail-boost'), () => { useTruckBooster(); mode = 'play'; show(null); });

  const muteBtn = $('mute');
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
    else { if (ac) ac.resume(); last = performance.now(); }
  });

  // ======================================================================
  // Loop
  // ======================================================================
  let last = performance.now();
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
  loadLevel(0, true);
  buildPlayers();
  show('start');
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  resize();
  requestAnimationFrame(loop);

  // test hook (harmless in production)
  window.__bf = {
    get balls() { return balls; }, get melted() { return melted; }, get level() { return levelIndex; }, get L() { return L; },
    get stuckPops() { return stuckPops; }, get mode() { return mode; }, run, save, truck, dumpTruck, onTap, step, loadLevel, play, addBall,
    setDemo(v) { demo = v; },
  };
})();
