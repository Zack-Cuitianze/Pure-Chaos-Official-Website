/* ============================================================
   Pure Chaos — basketball shot physics
   ------------------------------------------------------------
   A tiny but honest projectile engine for the cabinet:

     * the ball is a circle with gravity, velocity and spin ignored
     * both rims are two collision circles, the backboard is a
       plane, the floor and the side walls bounce the ball
     * a make is not a dice roll: the ball has to fall through the
       rim opening, so rattles, bank shots and roll-outs happen
       on their own

   No DOM. Shared by the match engine and the node tests.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BasketballPhysics = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------- the court ---------------- */
  const COURT = {
    W: 960,
    H: 520,
    FLOOR: 430,
    BALL_R: 8,
    G: 1450,
    WALL_L: 12,
    WALL_R: 948,
    HOOPS: {
      left: {
        key: 'left',
        x: 72,
        y: 205,
        half: 28,
        boardX: 34,
        boardTop: 118,
        boardBottom: 246,
        boardSide: -1,          // backboard sits to the left of the rim
        poleX: 30,
      },
      right: {
        key: 'right',
        x: 888,
        y: 205,
        half: 28,
        boardX: 926,
        boardTop: 118,
        boardBottom: 246,
        boardSide: 1,           // backboard sits to the right of the rim
        poleX: 930,
      },
    },
    THREE_DIST: 306,            // distance from the rim centre for a three
  };
  const RIM_POST_R = 5;
  const RIM_RESTITUTION = 0.85;
  const RIM_FRICTION = 0.92;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function normal(rng) {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function makeBall(x, y, vx, vy) {
    return {
      x: x, y: y, prevX: x, prevY: y,
      vx: vx, vy: vy, r: COURT.BALL_R,
      t: 0,
      scored: false,
      rimTouched: false,
      boardTouched: false,
      bounces: 0,
      done: false,
      doneReason: '',
      trail: [],
    };
  }

  /* ---------------- launching a shot ----------------
     Aim the projectile at the rim, then let heave error, contest
     pressure, fade/lean and movement distort the release angle.
     Everything after the release is pure physics.               */
  function launchShot(opts) {
    const rng = opts.rng || Math.random;
    const fromX = opts.fromX;
    const fromY = opts.fromY;
    const hoop = opts.hoop;
    const quality = clamp(opts.quality == null ? 1 : opts.quality, 0, 1);
    const contest = clamp(opts.contest == null ? 0 : opts.contest, 0, 1);
    const fade = !!opts.fade;
    const lean = !!opts.lean;
    const moving = !!opts.moving;
    const errorScale = opts.errorScale == null ? 1 : opts.errorScale;

    const dir = hoop.x > fromX ? 1 : -1;
    const dist = Math.abs(hoop.x - fromX);

    /* flight time chooses the arc: deeper shots arc a little flatter */
    let T = 0.62 + dist / 1050;
    T = clamp(T, 0.68, 1.08);
    if (fade) T += 0.08;
    if (lean) T -= 0.05;

    /* aim error: the shooter aims at a point beside / above or below
       the rim and the arc is solved to pass through that point. This
       keeps the miss distance honest at every distance (rotating a
       very steep deep heave barely moves its landing spot).          */
    let sigma = 4 + dist * 0.022 + dist * dist * 0.00016 + dist * dist * dist * 0.0000002;
    sigma *= 1 + 3.2 * Math.pow(1 - quality, 1.5);
    sigma *= 1 + 1.0 * contest;
    if (fade) sigma *= 1.10;
    if (lean) sigma *= dist < 150 ? 0.90 : 1.12;
    if (moving) sigma *= 1.14;
    sigma *= errorScale;

    /* long / short error is a miss in the vertical aim point */
    let sigmaY = sigma * 0.62;
    if (fade) sigmaY *= 1.15;
    if (lean) sigmaY *= 0.95;

    const dx = normal(rng) * sigma;
    const dy = normal(rng) * sigmaY;
    const aimX = hoop.x + dx;
    const aimY = hoop.y - 5 + dy;

    let vx = (aimX - fromX) / T;
    let vy = (aimY - fromY - 0.5 * COURT.G * T * T) / T;
    const speedScale = 1 + normal(rng) * 0.006;
    vx *= speedScale;
    vy *= speedScale;

    const ball = makeBall(fromX + dir * 10, fromY, vx, vy);
    ball.shot = {
      dist: dist,
      isThree: dist > COURT.THREE_DIST,
      quality: quality,
      contest: contest,
      fade: fade,
      lean: lean,
      flight: T,
      dir: dir,
      hoop: hoop.key,
    };
    return ball;
  }

  /* ---------------- one physics tick ---------------- */
  function step(ball, dt, world) {
    const events = {
      scored: false,
      rimHit: false,
      boardHit: false,
      floorHit: false,
      done: false,
      reason: '',
    };
    if (!ball || ball.done) return events;

    const hoops = COURT.HOOPS;
    const targetHoop = world && world.hoop ? hoops[world.hoop] : hoops.right;
    const dtMax = 1 / 240;
    const steps = Math.min(24, Math.max(1, Math.ceil(dt / dtMax)));
    const h = dt / steps;

    for (let n = 0; n < steps; n++) {
      if (ball.done) break;
      ball.prevX = ball.x;
      ball.prevY = ball.y;
      ball.vy += COURT.G * h;
      ball.x += ball.vx * h;
      ball.y += ball.vy * h;
      ball.t += h;

      /* --- side walls --- */
      if (ball.x - ball.r < COURT.WALL_L) {
        ball.x = COURT.WALL_L + ball.r;
        ball.vx = Math.abs(ball.vx) * 0.45;
      } else if (ball.x + ball.r > COURT.WALL_R) {
        ball.x = COURT.WALL_R - ball.r;
        ball.vx = -Math.abs(ball.vx) * 0.45;
      }

      /* --- backboards --- */
      for (const key of ['left', 'right']) {
        const hp = hoops[key];
        const front = hp.boardX - hp.boardSide * 0; // plane at the board x
        const hitting = hp.boardSide > 0
          ? (ball.vx > 0 && ball.x + ball.r > front && ball.prevX + ball.r <= front + 4 &&
            ball.y > hp.boardTop && ball.y < hp.boardBottom)
          : (ball.vx < 0 && ball.x - ball.r < front && ball.prevX - ball.r >= front - 4 &&
            ball.y > hp.boardTop && ball.y < hp.boardBottom);
        if (hitting) {
          ball.x = hp.boardSide > 0 ? front - ball.r : front + ball.r;
          ball.vx = -ball.vx * 0.46;
          ball.vy *= 0.94;
          ball.boardTouched = true;
          events.boardHit = true;
        }
      }

      /* --- rim posts (two circles per hoop) --- */
      for (const key of ['left', 'right']) {
        const hp = hoops[key];
        for (const dir of [-1, 1]) {
          const px = hp.x + dir * hp.half;
          const py = hp.y;
          let dx = ball.x - px;
          let dy = ball.y - py;
          const min = ball.r + RIM_POST_R;
          let d = Math.hypot(dx, dy);
          if (d < min && d > 0.0001) {
            const nx = dx / d;
            const ny = dy / d;
            ball.x = px + nx * min;
            ball.y = py + ny * min;
            const vn = ball.vx * nx + ball.vy * ny;
            if (vn < 0) {
              ball.vx -= (1 + RIM_RESTITUTION) * vn * nx;
              ball.vy -= (1 + RIM_RESTITUTION) * vn * ny;
              ball.vx *= RIM_FRICTION;
              ball.vy *= RIM_FRICTION;
            }
            ball.rimTouched = true;
            events.rimHit = true;
          }
        }
      }

      /* --- score: centre of the ball falls through the rim plane --- */
      if (!ball.scored && targetHoop) {
        const inside = Math.abs(ball.x - targetHoop.x) < targetHoop.half - 3;
        const crossed = ball.prevY < targetHoop.y && ball.y >= targetHoop.y;
        if (inside && crossed && ball.vy > 0) {
          ball.scored = true;
          events.scored = true;
        }
      }

      /* --- floor --- */
      if (ball.y + ball.r > COURT.FLOOR) {
        ball.y = COURT.FLOOR - ball.r;
        if (Math.abs(ball.vy) > 55) {
          ball.vy = -Math.abs(ball.vy) * 0.55;
          ball.vx *= 0.82;
          ball.bounces++;
        } else {
          ball.vy = 0;
          ball.vx *= 0.9;
          if (ball.vx !== 0 && Math.abs(ball.vx) < 8) ball.vx = 0;
          ball.bounces++;
        }
        if (!events.floorHit && ball.bounces === 1) events.floorHit = true;
      }

      /* --- resolved? --- */
      if (ball.scored && ball.y > targetHoop.y + 62) {
        ball.done = true;
        ball.doneReason = 'score';
      } else if (!ball.scored && ball.bounces >= 1) {
        ball.done = true;
        ball.doneReason = 'rebound';
      } else if (ball.t > 4.5) {
        ball.done = true;
        ball.doneReason = 'timeout';
      } else if (ball.x < -60 || ball.x > COURT.W + 60 || ball.y > COURT.H + 80) {
        ball.done = true;
        ball.doneReason = 'out';
      }
    }

    /* keep a short dotted trail for the renderer */
    ball.trail.push({ x: ball.x, y: ball.y });
    if (ball.trail.length > 14) ball.trail.shift();

    events.done = ball.done;
    events.reason = ball.doneReason;
    return events;
  }

  return {
    COURT: COURT,
    RIM_POST_R: RIM_POST_R,
    clamp: clamp,
    normal: normal,
    makeBall: makeBall,
    launchShot: launchShot,
    step: step,
  };
});
