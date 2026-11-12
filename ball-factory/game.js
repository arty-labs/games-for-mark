// Ball Factory: a glowing ball machine for little hands.
// Tap the truck to dump balls, tap anywhere to drop a ball, tap the machines to make them move.
// Fill the thermometer with melted balls to get fireworks and the next factory.
(() => {
  'use strict';

  const W = 1600, H = 1000;          // logical world size
  const GRAV = 1500;
  const BIG = 16, SMALL = 7;         // ball radii
  const MAX_BALLS = 420;
  const NEON = '#3fdcff';
  const CELEBRATE_AT = 60;           // melted balls before fireworks + next level
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

  // Piston: a plate that slides back and forth pushing balls along a floor
  function Piston(x0, x1, yTop, yBot, period) {
    const p = { x: x0, phase: 0, boost: 0, ksegs: [], kcircs: [] };
    p.update = dt => {
      p.boost = Math.max(0, p.boost - dt);
      p.phase += dt * TAU / period * (p.boost > 0 ? 2.5 : 1);
      const k = 0.5 - 0.5 * Math.cos(p.phase);
      const nx = x0 + (x1 - x0) * k;
      const vx = dt > 0 ? (nx - p.x) / dt : 0;
      p.x = nx;
      p.ksegs = [{ ax: p.x, ay: yTop, bx: p.x, by: yBot, t: 7, vx, vy: 0, om: 0, px: 0, py: 0, grip: 0, e: 0.2, oneSide: 1 }];
    };
    p.draw = () => {
      ctx.save();
      // rod back to the cylinder
      glowStroke(ctx, 8, '#1b8fb3', 6);
      ctx.beginPath(); ctx.moveTo(x0 - 40, (yTop + yBot) / 2); ctx.lineTo(p.x, (yTop + yBot) / 2); ctx.stroke();
      ctx.fillStyle = 'rgba(25,120,170,0.35)';
      glowStroke(ctx, 5);
      ctx.beginPath(); ctx.rect(x0 - 70, yTop - 4, 34, yBot - yTop + 8); ctx.fill(); ctx.stroke();
      glowStroke(ctx, 14, p.boost > 0 ? '#bff8ff' : NEON);
      ctx.beginPath(); ctx.moveTo(p.x, yTop); ctx.lineTo(p.x, yBot); ctx.stroke();
      ctx.restore();
    };
    p.tap = (tx, ty) => {
      if (tx < x0 - 80 || tx > x1 + 30 || ty < yTop - 30 || ty > yBot + 30) return false;
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
  function Trapdoor(hx, hy, len, dir, every) {
    const p = { angle: 0, om: 0, state: 'closed', timer: 0, ksegs: [], kcircs: [] };
    const openA = 1.35 * dir;
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
  function Pendulum(px, py, len, amp, speed, headR) {
    const p = { t: 0, angle: 0, om: 0, boost: 0, ksegs: [], kcircs: [] };
    p.update = dt => {
      p.boost = Math.max(0, p.boost - dt);
      p.t += dt * (p.boost > 0 ? 1.8 : 1);
      p.angle = amp * Math.sin(p.t * speed);
      p.om = amp * speed * Math.cos(p.t * speed) * (p.boost > 0 ? 1.8 : 1);
      // angle 0 = hanging straight down
      const hx = px + Math.sin(p.angle) * len, hy = py + Math.cos(p.angle) * len;
      const om = -p.om; // screen-space angular velocity
      p.ksegs = [{ ax: px, ay: py, bx: hx, by: hy, t: 5, vx: 0, vy: 0, om, px, py, grip: 0, e: 0.3 }];
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
    L.wall(318, 160, 1600, 160, 6);
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

  const LEVELS = [level1, level2, level3, level4];
  let levelIndex = 0;
  let L = null;

  // ======================================================================
  // State
  // ======================================================================
  let balls = [];
  let idc = 0;
  let sparks = [];
  let melted = 0;
  let stuckPops = 0;
  let celebrating = 0;
  let advancing = false;
  let banner = { text: '', t: 0 };
  let time = 0;
  let started = false;
  const THERMO = { x: 1565, top: 260, bottom: 900, bulb: 26 };
  const truck = { state: 'arriving', x: 1750, parkX: 300, bed: 0, timer: 0, load: [], spawnT: 0, bob: 0 };
  const HUES = [0, 30, 52, 120, 175, 205, 260, 300, 330];
  const ballColor = h => `hsl(${h} 95% 60%)`;

  function refillTruck() {
    truck.load = [];
    for (let i = 0; i < 22; i++) truck.load.push({ r: BIG, h: HUES[(Math.random() * HUES.length) | 0] });
    for (let i = 0; i < 18; i++) truck.load.push({ r: SMALL, h: HUES[(Math.random() * HUES.length) | 0] });
    truck.load.sort(() => Math.random() - 0.5);
  }

  function loadLevel(i) {
    levelIndex = (i + LEVELS.length) % LEVELS.length;
    L = LEVELS[levelIndex]();
    balls = []; sparks = []; melted = 0; celebrating = 0; advancing = false;
    truck.state = 'arriving'; truck.x = 1750; truck.bed = 0; refillTruck();
    banner = { text: `${levelIndex + 1}. ${L.name}`, t: 2.8 };
    if (canvas.width) buildStatic();
    updateLevelButtons();
    try { localStorage.setItem('bf-level', String(levelIndex)); } catch (e) {}
  }

  function addBall(x, y, r, h, vx = 0, vy = 0) {
    if (balls.length >= MAX_BALLS) {
      const old = balls.find(b => !b.melt && !b.pop);
      if (old) old.pop = 0.001;
    }
    balls.push({ id_: idc++, x, y, vx, vy, r, h, col: ballColor(h), still: 0, melt: 0, pop: 0, age: 0 });
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
      addBall(b.x + (i - 1) * 6, b.y + 10 + i * 2, SMALL, HUES[(HUES.indexOf(b.h) + i) % HUES.length], (i - 1) * 40, 120);
    }
    burst(b.x, b.y + 10, b.col, 14, 300, 0.5, 3);
    sfx.crunch();
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
          if (hit > 60 && time - p.last > 0.12) { p.flash = 1; p.last = time; sfx.peg(p.note + (p.x / 100 | 0)); }
        }
        for (const bp of L.bumpers) {
          const hit = collideCircle(b, bp, 0.2);
          if (hit) {
            const nx = b.x - bp.x, ny = b.y - bp.y, d = Math.hypot(nx, ny) || 1;
            b.vx += nx / d * 260 * h * 20; b.vy += ny / d * 120 * h * 20;
            if (bp.flash < 0.5) { sfx.bumper(); burst(b.x, b.y, '#ffe36b', 6, 200, 0.35, 2.5); }
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
        if (b.melt > 0.8) { b.dead = true; melted++; if (melted === CELEBRATE_AT) celebrate(); }
        continue;
      }
      if (b.pop) { b.pop += dt; if (b.pop > 0.25) b.dead = true; continue; }
      if (b.sx === undefined || Math.hypot(b.x - b.sx, b.y - b.sy) > 10) { b.sx = b.x; b.sy = b.y; b.still = 0; }
      else b.still += dt;
      if (b.still > 6 || b.y > H + 60 || b.x < -60 || b.x > W + 60) {
        b.pop = 0.001; stuckPops++; if (window.__pops) window.__pops.push([b.x | 0, b.y | 0, b.r]); burst(b.x, b.y, b.col, 8, 160, 0.4, 2.5); sfx.pop();
      }
    }
    balls = balls.filter(b => !b.dead);

    for (const p of sparks) { p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    sparks = sparks.filter(p => p.life > 0);

    updateTruck(dt);
    if (banner.t > 0) banner.t -= dt;
    if (celebrating > 0) {
      celebrating -= dt;
      if (Math.random() < dt * 5) firework();
      if (celebrating <= 0 && advancing) loadLevel(levelIndex + 1);
    }
  }

  function celebrate() {
    celebrating = 4;
    advancing = true;
    banner = { text: 'Hooray! 🎉', t: 3.5 };
    sfx.yay();
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
          addBall(t.x - 30 + Math.random() * 14, 128 + Math.random() * 10, l.r, l.h, -90 - Math.random() * 120, 40);
          t.spawnT += 0.045;
        }
      }
      if (!t.load.length && t.timer > 1.6) t.state = 'lowering';
    } else if (t.state === 'lowering') {
      t.bed = Math.max(0, t.bed - dt * 1.4);
      if (t.bed === 0) t.state = 'leaving';
    } else if (t.state === 'leaving') {
      t.x += 420 * dt;
      if (t.x > 1800) { t.state = 'away'; t.timer = 0; refillTruck(); }
    } else if (t.state === 'away') {
      t.timer += dt;
      if (t.timer > 1.2) t.state = 'arriving';
    }
  }
  const truckHit = (x, y) => x > truck.x - 30 && x < truck.x + 270 && y > 40 && y < 175;
  function dumpTruck() {
    if (truck.state !== 'parked') return false;
    truck.state = 'dumping'; truck.timer = 0; truck.spawnT = 0;
    sfx.dump(); sfx.whirr();
    return true;
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
    const heat = Math.min(1, melted / CELEBRATE_AT);
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
    const full = celebrating > 0 ? 1 : Math.min(1, melted / CELEBRATE_AT);
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
    const a = Math.min(1, banner.t, (3 - banner.t) * 3 + 0.2);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, a));
    ctx.font = '700 72px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#bff3ff'; ctx.shadowColor = '#19c8ff'; ctx.shadowBlur = 30;
    ctx.fillText(banner.text, W / 2, 80);
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
    if (truckHit(x, y)) { if (!dumpTruck()) sfx.horn(); return; }
    for (const part of L.parts) if (part.tap && part.tap(x, y)) return;
    for (const g of L.gears) if (Math.hypot(x - g.x, y - g.y) < g.r + 20) {
      g.boost = 2.5; sfx.whirr(); burst(g.x, g.y, '#9ff3ff', 12, 260, 0.5, 3); return;
    }
    for (const bp of L.bumpers) if (Math.hypot(x - bp.x, y - bp.y) < bp.r + 25) {
      bp.flash = 1; sfx.bumper(); burst(bp.x, bp.y, '#ffe36b', 12, 260, 0.5, 3); return;
    }
    for (const p of L.pegs) if (Math.hypot(x - p.x, y - p.y) < 24) { p.flash = 1; sfx.peg(p.note + (p.x / 100 | 0)); return; }
    if (x < 0 || x > W || y < 0 || y > H) return;
    addBall(x, y, Math.random() < 0.55 ? BIG : SMALL, HUES[(Math.random() * HUES.length) | 0]);
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
  ['gesturestart', 'gesturechange', 'contextmenu', 'dblclick'].forEach(ev =>
    document.addEventListener(ev, e => e.preventDefault(), { passive: false }));
  document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

  const startEl = document.getElementById('start');
  function start() {
    initAudio();
    if (started) return;
    started = true;
    startEl.style.display = 'none';
    banner.t = 2.8;
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

  // level buttons
  const levelBar = document.getElementById('levels');
  const levelBtns = [];
  LEVELS.forEach((_, i) => {
    const b = document.createElement('button');
    b.textContent = String(i + 1);
    b.setAttribute('aria-label', `Factory ${i + 1}`);
    b.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); initAudio(); if (i !== levelIndex) { loadLevel(i); sfx.pop(); } });
    levelBar.appendChild(b);
    levelBtns.push(b);
  });
  function updateLevelButtons() { levelBtns.forEach((b, i) => b.classList.toggle('on', i === levelIndex)); }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (ac) ac.suspend(); }
    else { if (ac && started) ac.resume(); last = performance.now(); }
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
  let saved = 0;
  try { saved = parseInt(localStorage.getItem('bf-level') || '0', 10) || 0; } catch (e) {}
  loadLevel(saved);
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  resize();
  requestAnimationFrame(loop);

  // test hook (harmless in production)
  window.__bf = {
    get balls() { return balls; }, get melted() { return melted; }, get level() { return levelIndex; }, get stuckPops() { return stuckPops; },
    truck, dumpTruck, onTap, step, loadLevel, addBall,
  };
})();
