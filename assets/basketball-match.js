/* ============================================================
   Pure Chaos — full-court 1v1 basketball engine
   ------------------------------------------------------------
   Two hoops, one court. Players sprint, dribble, fade away and
   lean in; every shot is launched into the shared physics engine
   (basketball-physics.js) so makes, rims and bank shots are real.

   No DOM. The 1v1 page renders the state, node tests simulate it.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./basketball-physics.js'));
  } else {
    root.BasketballMatch = factory(root.BasketballPhysics);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (P) {
  'use strict';

  if (!P) throw new Error('BasketballPhysics must load before BasketballMatch');

  /* ---------------- court ---------------- */
  const COURT = P.COURT;
  const W = COURT.W;
  const H = COURT.H;
  const FLOOR = COURT.FLOOR;
  const HOOPS = COURT.HOOPS;
  const PLAYER_MIN = 96;
  const PLAYER_MAX = 864;
  const HAND_Y = 100;
  const SHOT_CLOCK = 12;

  /* ---------------- movement ---------------- */
  const BASE_SPEED = 185;
  const DEF_SPEED = 200;
  const SPRINT_SPEED = 380;
  const SPRINT_DUR = 0.42;
  const SPRINT_CD = 1.0;
  const ACCEL = 1600;
  const AIR_ACCEL = 950;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rand = (rng, lo, hi) => lo + (hi - lo) * rng();
  const other = (side) => (side === 'p1' ? 'p2' : 'p1');
  const attackDir = (side) => (side === 'p1' ? 1 : -1);
  const targetHoop = (side) => (side === 'p1' ? HOOPS.right : HOOPS.left);
  const ownBaseline = (side) => (side === 'p1' ? PLAYER_MIN + 52 : PLAYER_MAX - 52);

  /* ---------------- difficulty ---------------- */
  const DIFFICULTY = {
    easy: {
      id: 'easy', label: 'EASY',
      guardGap: 58, speed: 148, jumpDelay: 0.40, stealEvery: 3.0, stealP: 0.08,
      resist: 0.20, skill: 0.42,
      blurb: 'Lets you get a step. Closes out late.',
    },
    normal: {
      id: 'normal', label: 'NORMAL',
      guardGap: 50, speed: 172, jumpDelay: 0.26, stealEvery: 2.4, stealP: 0.14,
      resist: 0.45, skill: 0.60,
      blurb: 'Stays in front. Gets a hand up.',
    },
    hard: {
      id: 'hard', label: 'HARD',
      guardGap: 43, speed: 192, jumpDelay: 0.16, stealEvery: 1.9, stealP: 0.20,
      resist: 0.68, skill: 0.76,
      blurb: 'Cuts the lane and punishes loose handles.',
    },
    allstar: {
      id: 'allstar', label: 'ALL-STAR',
      guardGap: 38, speed: 208, jumpDelay: 0.09, stealEvery: 1.5, stealP: 0.26,
      resist: 0.85, skill: 0.90,
      blurb: 'The cabinet champion. No mercy, no air.',
    },
  };
  const DIFF_ORDER = ['easy', 'normal', 'hard', 'allstar'];

  /* ---------------- dribble moves (shifts are relative to the attack) ---------------- */
  const MOVES = {
    1: { id: 'crossover', label: 'CROSSOVER', dur: 0.30, shift: 42, push: 0, stun: 0.55, stunP: 0.52, risk: 0, glyph: '1' },
    2: { id: 'behind', label: 'BEHIND THE BACK', dur: 0.28, shift: -32, push: 0, stun: 0.45, stunP: 0.40, risk: 0, glyph: '2' },
    3: { id: 'between', label: 'BETWEEN THE LEGS', dur: 0.32, shift: 16, push: 18, stun: 0.50, stunP: 0.44, risk: 0, glyph: '3' },
    4: { id: 'spin', label: 'SPIN CYCLE', dur: 0.38, shift: 72, push: 0, stun: 0.70, stunP: 0.56, risk: 0.28, glyph: '4' },
  };

  /* ---------------- players ---------------- */
  function makePlayer(side, name, num) {
    return {
      side: side,
      name: name,
      num: num,
      role: 'off',
      x: 0,
      vx: 0,
      facing: 1,
      jump: null,              // { t, dur, height, contest, shot }
      move: null,              // { id, t, dur }
      dash: null,              // { t, dur, dir }
      dashCd: 0,
      stun: 0,
      cooldown: 0,
      protect: false,
      brace: false,
      stealCd: 0,
      /* shooting / stat line */
      score: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0,
      stl: 0, blk: 0, ankle: 0, movTry: 0, movOk: 0, to: 0,
      /* cpu brain */
      ai: {
        t: 0, plan: null, planT: 0, shootAt: 0, stealT: 0,
        jumpWait: -1, targetV: 0,
      },
    };
  }

  function jumpHeight(p) {
    if (!p.jump) return 0;
    const u = clamp(p.jump.t / p.jump.dur, 0, 1);
    return Math.sin(Math.PI * u) * p.jump.height;
  }

  function startJump(p, contest, shot) {
    if (p.jump) return false;
    p.jump = {
      t: 0,
      dur: contest ? 0.70 : 0.86,
      height: contest ? 80 : 100,
      contest: !!contest,
      shot: !!shot,
    };
    p.move = null;
    p.dash = null;
    p.vx *= 0.35;
    return true;
  }

  function releaseQuality(p) {
    if (!p.jump) return 0;
    const u = clamp(p.jump.t / p.jump.dur, 0, 1);
    return clamp(1 - Math.abs(u - 0.5) * 2, 0, 1);
  }

  /* ============================================================
     MATCH
     ============================================================ */
  function createMatch(opts) {
    opts = opts || {};
    const rng = opts.rng || Math.random;
    const mode = opts.mode === '2p' ? '2p' : 'cpu';
    const diffId = DIFFICULTY[opts.difficulty] ? opts.difficulty : 'normal';
    const diff = DIFFICULTY[diffId];
    const target = Math.max(1, opts.target || 11);
    const names = {
      p1: opts.names && opts.names.p1 ? opts.names.p1 : 'PURE CHAOS',
      p2: opts.names && opts.names.p2
        ? opts.names.p2
        : (mode === 'cpu' ? 'THE CABINET' : 'PLAYER 2'),
    };

    const m = {
      W: W, H: H, FLOOR: FLOOR, COURT: COURT, HOOPS: HOOPS,
      PLAYER_MIN: PLAYER_MIN, PLAYER_MAX: PLAYER_MAX, HAND_Y: HAND_Y,
      mode: mode,
      difficulty: diffId,
      diffLabel: diff.label,
      target: target,
      names: names,
      players: {
        p1: makePlayer('p1', names.p1, 1),
        p2: makePlayer('p2', names.p2, 2),
      },
      human: mode === '2p' ? ['p1', 'p2'] : ['p1'],
      offSide: opts.firstOffense === 'p2' ? 'p2' : 'p1',
      defSide: 'p2',
      phase: 'check',
      freeze: 1.0,
      pendingSwitch: false,
      shotClock: SHOT_CLOCK,
      ball: null,
      shotInfo: null,
      effects: [],
      input: {
        p1: { left: false, right: false, down: false },
        p2: { left: false, right: false, down: false },
      },
      time: 0,
      over: null,
      rng: rng,
      diff: diff,
      log: [],
      lastNote: '',
    };
    m.defSide = other(m.offSide);
    m.players[m.offSide].role = 'off';
    m.players[m.defSide].role = 'def';
    m.ball = { mode: 'held', side: m.offSide, x: 0, y: 0, phys: null, scoredHandled: false };

    resetPossession(m, m.offSide, 'TIP OFF', true);
    m.freeze = 1.0;

    /* ---------------- possession helpers ---------------- */
    function resetPossession(mm, offSide, note, center) {
      const dir = attackDir(offSide);
      const off = mm.players[offSide];
      const def = mm.players[other(offSide)];
      off.role = 'off';
      def.role = 'def';

      [off, def].forEach((p) => {
        p.vx = 0;
        p.jump = null;
        p.move = null;
        p.dash = null;
        p.stun = 0;
        p.protect = false;
        p.brace = false;
        p.cooldown = 0;
        p.stealCd = 0;
        p.ai.plan = null;
        p.ai.planT = 0;
        p.ai.stealT = 0;
        p.ai.jumpWait = -1;
        p.ai.targetV = 0;
      });

      off.x = center ? W / 2 : ownBaseline(offSide);
      off.facing = dir;
      def.x = clamp(off.x + dir * mm.diff.guardGap, PLAYER_MIN, PLAYER_MAX);
      def.facing = -dir;
      def.ai.stealT = mm.diff.stealEvery;

      mm.shotClock = SHOT_CLOCK;
      mm.ball = {
        mode: 'held',
        side: offSide,
        x: off.x + dir * 24,
        y: FLOOR - HAND_Y,
        phys: null,
        scoredHandled: false,
      };
      mm.shotInfo = null;
      mm.lastNote = note || '';
    }
    m._resetPossession = resetPossession;

    function switchPossession(note) {
      const next = other(m.offSide);
      m.offSide = next;
      m.defSide = other(next);
      m.players[next].role = 'off';
      m.players[m.defSide].role = 'def';
      resetPossession(m, next, note, false);
      m.phase = 'check';
      m.freeze = 0.55;
    }
    m._switchPossession = switchPossession;

    function pushEffect(text, x, y, eopts) {
      const o = eopts || {};
      m.effects.push({
        text: text,
        x: x == null ? W / 2 : x,
        y: y == null ? 240 : y,
        t: 0,
        dur: o.dur || 1.15,
        big: !!o.big,
      });
      if (m.effects.length > 8) m.effects.shift();
    }
    m._pushEffect = pushEffect;

    function statLine(p) {
      return {
        name: p.name, side: p.side, score: p.score,
        fgm: p.fgm, fga: p.fga, tpm: p.tpm, tpa: p.tpa,
        stl: p.stl, blk: p.blk, ankle: p.ankle, to: p.to,
        moves: p.movOk, moveTries: p.movTry,
      };
    }
    m.statLine = statLine;

    function addScore(side, pts) {
      const p = m.players[side];
      p.score += pts;
      if (p.score >= m.target) endMatch(side);
    }

    function endMatch(winner) {
      if (m.phase === 'over') return;
      m.phase = 'over';
      m.ball = { mode: 'dead', side: winner, x: W / 2, y: 300, phys: null, scoredHandled: true };
      m.over = {
        winner: winner,
        loser: other(winner),
        reason: 'target',
        players: {
          p1: statLine(m.players.p1),
          p2: statLine(m.players.p2),
        },
      };
      m.log.push((winner === 'p1' ? m.names.p1 : m.names.p2) + ' WINS ' +
        m.players.p1.score + '-' + m.players.p2.score);
    }

    function scheduleSwitch(note) {
      if (m.phase === 'over') return;
      m.pendingSwitch = true;
      m.lastNote = note || '';
      m.phase = 'freeze';
      m.freeze = 0.8;
      m.ball = { mode: 'dead', side: m.offSide, x: W / 2, y: 300, phys: null, scoredHandled: true };
    }

    /* ---------------- shooting ---------------- */
    function shoot(p) {
      if (!p.jump || m.phase !== 'live') return false;
      if (m.ball.mode !== 'held' || m.ball.side !== p.side) return false;

      const dir = attackDir(p.side);
      const hoop = targetHoop(p.side);
      const q = releaseQuality(p);
      const held = m.input[p.side] || {};
      const heldDir = (held.right ? 1 : 0) - (held.left ? 1 : 0);
      const fade = heldDir === -dir;
      const lean = heldDir === dir;

      const releaseX = clamp(p.x + dir * 26, PLAYER_MIN, PLAYER_MAX);
      const releaseY = FLOOR - jumpHeight(p) - HAND_Y;
      const dist = Math.abs(hoop.x - releaseX);
      const isThree = dist > COURT.THREE_DIST + 2;

      const def = m.players[m.defSide];
      const dd = Math.abs(def.x - p.x);
      let contest = 0;
      if (def.jump && dd < 118) contest = 0.85;
      else if (dd < 88) contest = 0.35;
      if (fade) contest *= 0.45;
      if (lean && dist < 170) contest = Math.min(1, contest + 0.12);
      const moving = Math.abs(p.vx) > 150;

      /* blocked at the release point (rare, only smothering defence) */
      if (contest > 0.6 && dd < 62 && m.rng() < 0.12) {
        p.fga++;
        if (isThree) p.tpa++;
        def.blk++;
        pushEffect('BLOCKED!', (p.x + def.x) / 2, FLOOR - 165, { big: true });
        const swat = P.makeBall(
          p.x + dir * 22,
          FLOOR - jumpHeight(p) - HAND_Y,
          -dir * rand(m.rng, 180, 320),
          rand(m.rng, -280, -90)
        );
        m.ball = { mode: 'flight', side: p.side, x: swat.x, y: swat.y, phys: swat, scoredHandled: true };
        m.shotInfo = { side: p.side, isThree: false, blocked: true, hoop: hoop.key, fade: false, lean: false, contest: contest, quality: q, dist: dist };
        m.phase = 'flight';
        return true;
      }

      const phys = P.launchShot({
        fromX: releaseX,
        fromY: releaseY,
        hoop: hoop,
        quality: q,
        contest: contest,
        fade: fade,
        lean: lean,
        moving: moving,
        rng: m.rng,
      });

      p.fga++;
      if (isThree) p.tpa++;

      m.ball = { mode: 'flight', side: p.side, x: phys.x, y: phys.y, phys: phys, scoredHandled: false };
      m.shotInfo = {
        side: p.side, isThree: isThree, blocked: false, hoop: hoop.key,
        fade: fade, lean: lean, contest: contest, quality: q, dist: dist,
      };
      m.phase = 'flight';
      if (fade) pushEffect('FADEAWAY', p.x + dir * 20, FLOOR - jumpHeight(p) - 150);
      else if (lean) pushEffect('LEAN-IN', p.x + dir * 20, FLOOR - jumpHeight(p) - 150);
      return true;
    }
    m._shoot = shoot;

    function handleFlight(dt) {
      const phys = m.ball.phys;
      if (!phys) return;
      const info = m.shotInfo || {};
      const ev = P.step(phys, dt, { hoop: info.hoop });
      m.ball.x = phys.x;
      m.ball.y = phys.y;

      if (ev.scored && !m.ball.scoredHandled && !info.blocked) {
        m.ball.scoredHandled = true;
        const shooter = m.players[info.side];
        shooter.fgm++;
        if (info.isThree) shooter.tpm++;
        const clean = !phys.rimTouched && !phys.boardTouched;
        const bank = phys.boardTouched && !phys.rimTouched;
        const hoop = HOOPS[info.hoop];
        pushEffect(
          clean ? 'SWISH' : (bank ? 'OFF THE GLASS' : 'RATTLED IN'),
          hoop.x, hoop.y - 96, { big: true, dur: 1.25 }
        );
        addScore(info.side, info.isThree ? 3 : 2);
        if (m.phase === 'over') return;
      }

      if (ev.done) {
        if (m.phase === 'over') return;
        const scored = !!phys.scored;
        if (!scored) {
          const hoop = HOOPS[info.hoop];
          pushEffect(
            phys.rimTouched ? 'OFF THE RIM' : 'MISS',
            phys.x, hoop.y - 70
          );
        }
        m.phase = 'freeze';
        m.pendingSwitch = true;
        m.freeze = scored ? 1.0 : 0.8;
        m.lastNote = scored ? 'BUCKET' : 'MISS';
        m.ball = { mode: 'dead', side: info.side, x: phys.x, y: phys.y, phys: null, scoredHandled: true };
      }
    }

    /* ---------------- steals / turnovers ---------------- */
    function turnover(offender, defender, label) {
      offender.to++;
      if (defender) defender.stl++;
      pushEffect(label || 'STOLEN!', (offender.x + (defender ? defender.x : offender.x + 40)) / 2,
        FLOOR - 140, { big: true });
      scheduleSwitch('steal');
    }

    function trySteal(defender, offender, human) {
      if (m.phase !== 'live') return false;
      if (offender.jump) return false;
      const dist = Math.abs(defender.x - offender.x);
      if (dist > 74) return false;
      if (offender.protect) {
        defender.stun = Math.max(defender.stun, 0.3);
        pushEffect('REACH IN', offender.x, FLOOR - 130);
        return false;
      }
      let chance = human ? 0.30 : m.diff.stealP;
      chance += clamp((70 - dist) / 70, 0, 1) * 0.18;
      if (offender.move) chance += 0.10;
      chance = clamp(chance, 0.02, 0.6);
      if (m.rng() < chance) {
        turnover(offender, defender, 'STRIPPED!');
        return true;
      }
      return false;
    }
    m._trySteal = trySteal;

    /* ---------------- dribble moves ---------------- */
    function startMove(p, id) {
      const mv = MOVES[id];
      if (!mv) return false;
      if (m.phase !== 'live') return false;
      if (p.role !== 'off') return false;
      if (p.jump || p.move || p.stun > 0 || p.cooldown > 0 || p.protect) return false;
      p.move = { id: id, t: 0, dur: mv.dur };
      p.movTry++;
      p.dash = null;
      p.ai.plan = null;
      return true;
    }

    function finishMove(p) {
      const mv = MOVES[p.move.id];
      const dir = attackDir(p.side);
      p.move = null;
      p.cooldown = 0.5;
      p.x = clamp(p.x + mv.shift * dir, PLAYER_MIN, PLAYER_MAX);

      const def = m.players[m.defSide];
      if (mv.push) def.x = clamp(def.x + mv.push * dir, PLAYER_MIN, PLAYER_MAX);

      let stunChance = mv.stunP;
      if (def.brace) stunChance *= 0.5;
      if (m.human.indexOf(def.side) < 0) stunChance *= 1 - m.diff.resist * 0.5;
      const close = Math.abs(def.x - p.x) < 78;
      if (m.rng() < stunChance) {
        def.stun = Math.max(def.stun, mv.stun);
        def.dash = null;
        def.ai.plan = null;
        p.movOk++;
        if (close) {
          p.ankle++;
          pushEffect('ANKLE BREAKER', def.x, FLOOR - 180, { big: true });
        } else {
          pushEffect(mv.label, p.x, FLOOR - 170);
        }
      } else {
        if (mv.risk && m.rng() < mv.risk) {
          turnover(p, def, 'SPUN OUT');
          return;
        }
        pushEffect('TIGHT D', def.x, FLOOR - 160);
      }
    }

    /* ---------------- movement ---------------- */
    function approach(v, target, accel, dt) {
      const d = target - v;
      const step = accel * dt;
      return v + clamp(d, -step, step);
    }

    function tickTimers(p, dt) {
      if (p.stun > 0) {
        p.stun = Math.max(0, p.stun - dt);
        p.dash = null;
      }
      if (p.cooldown > 0) p.cooldown = Math.max(0, p.cooldown - dt);
      if (p.stealCd > 0) p.stealCd = Math.max(0, p.stealCd - dt);
      if (p.dashCd > 0) p.dashCd = Math.max(0, p.dashCd - dt);
      if (p.dash) {
        p.dash.t += dt;
        if (p.dash.t >= p.dash.dur) p.dash = null;
      }
      if (p.jump) {
        p.jump.t += dt;
        if (p.jump.t >= p.jump.dur) p.jump = null;
      }
      if (p.move) {
        p.move.t += dt;
        if (p.move.t >= p.move.dur) finishMove(p);
      }
    }

    function movePlayer(p, dt) {
      const held = m.input[p.side] || {};
      const heldDir = (held.right ? 1 : 0) - (held.left ? 1 : 0);
      const human = m.human.indexOf(p.side) >= 0;
      let targetV = 0;
      let dirUsed = 0;

      if (human) {
        dirUsed = heldDir;
        if (p.role === 'off') {
          p.protect = !!held.down && !p.jump && !p.move && p.stun <= 0;
          if (p.stun > 0 || p.move) targetV = 0;
          else if (p.protect) targetV = 0;
          else if (p.dash) targetV = p.dash.dir * SPRINT_SPEED;
          else targetV = heldDir * (p.jump ? BASE_SPEED * 0.62 : BASE_SPEED);
        } else {
          p.brace = !!held.down;
          if (p.stun > 0 || p.move) targetV = 0;
          else if (p.dash) targetV = p.dash.dir * SPRINT_SPEED;
          else targetV = heldDir * (p.jump ? DEF_SPEED * 0.5 : DEF_SPEED);
        }
      } else {
        if (p.stun > 0 || p.move) targetV = 0;
        else if (p.dash) targetV = p.dash.dir * SPRINT_SPEED;
        else targetV = p.ai.targetV || 0;
        dirUsed = Math.abs(targetV) > 20 ? (targetV > 0 ? 1 : -1) : 0;
      }

      if (!(human && p.role === 'off' && p.protect)) p.protect = false;
      p.vx = approach(p.vx, targetV, p.jump ? AIR_ACCEL : ACCEL, dt);
      p.x = clamp(p.x + p.vx * dt, PLAYER_MIN, PLAYER_MAX);

      if (Math.abs(p.vx) > 18) p.facing = p.vx > 0 ? 1 : -1;
      else if (dirUsed === 0) {
        p.facing = p.role === 'off' ? attackDir(p.side)
          : (m.players[m.offSide].x >= p.x ? 1 : -1);
      }
    }

    /* ---------------- human input ---------------- */
    m.setHeld = function (side, held) {
      if (!m.input[side] || !held) return;
      m.input[side].left = !!held.left;
      m.input[side].right = !!held.right;
      m.input[side].down = !!held.down;
    };

    m.command = function (side, cmd, arg) {
      const p = m.players[side];
      if (!p || m.phase === 'over') return false;
      if (m.human.indexOf(side) < 0) return false;

      if (cmd === 'release') {
        if (m.phase !== 'live') return false;
        if (p.role === 'off' && p.jump) return shoot(p);
        return false;
      }
      if (m.phase !== 'live') return false;

      if (cmd === 'up') {
        if (p.stun > 0) return false;
        if (p.role === 'off') {
          if (p.jump || p.move || p.protect) return false;
          return startJump(p, false, true);
        }
        if (p.jump) return false;
        return startJump(p, true, false);
      }

      if (cmd === 'sprint') {
        if (p.jump || p.move || p.stun > 0 || p.dash || p.dashCd > 0) return false;
        if (p.role === 'off' && p.protect) return false;
        p.dash = { t: 0, dur: SPRINT_DUR, dir: arg >= 0 ? 1 : -1 };
        p.dashCd = SPRINT_CD;
        return true;
      }

      if (cmd === 'move') {
        if (p.role !== 'off') return false;
        return startMove(p, arg);
      }

      if (cmd === 'steal') {
        if (p.role !== 'def') return false;
        if (p.stun > 0 || p.stealCd > 0 || p.jump) return false;
        p.stealCd = 0.7;
        return trySteal(p, m.players[m.offSide], true);
      }
      return false;
    };

    /* ---------------- cpu brain ---------------- */
    function cpuChooseOffPlan(off) {
      const hoop = targetHoop(off.side);
      const d = Math.abs(hoop.x - off.x);
      const def = m.players[m.defSide];
      const open = def.stun > 0.2 || Math.abs(def.x - off.x) > 100;
      const skill = m.diff.skill;
      const r = m.rng();

      if (m.shotClock < 3.5) {
        if (d < 360) return { type: 'shoot' };
        return { type: 'advance', dur: 0.7, sprint: true };
      }
      if (d > 430) {
        if (r < 0.14) return { type: 'dribble', id: 1 + Math.floor(m.rng() * 4) };
        if (r < 0.24) return { type: 'protect', dur: rand(m.rng, 0.3, 0.5) };
        return { type: 'advance', dur: rand(m.rng, 0.5, 1.0), sprint: m.rng() < 0.5 };
      }
      if (d > 340) {
        if (r < 0.26 + skill * 0.16) return { type: 'shoot' };
        if (r < 0.50) return { type: 'advance', dur: rand(m.rng, 0.25, 0.5), sprint: m.rng() < 0.35 };
        if (r < 0.72) return { type: 'dribble', id: 1 + Math.floor(m.rng() * 4) };
        if (r < 0.84) return { type: 'protect', dur: rand(m.rng, 0.3, 0.5) };
        return { type: 'stepback', dur: rand(m.rng, 0.2, 0.4) };
      }
      if (d < 125 && (open || r < 0.62)) return { type: 'shoot' };
      if (r < 0.30) return { type: 'dribble', id: 1 + Math.floor(m.rng() * 4) };
      if (r < 0.58) return { type: 'drive', dur: rand(m.rng, 0.25, 0.5) };
      if (r < 0.72) return { type: 'stepback', dur: rand(m.rng, 0.2, 0.4) };
      if (r < 0.85) return { type: 'protect', dur: rand(m.rng, 0.3, 0.5) };
      return { type: 'shoot' };
    }

    function cpuOffence(off, dt) {
      const ai = off.ai;
      const dir = attackDir(off.side);
      const hoop = targetHoop(off.side);

      if (off.stun > 0) {
        ai.plan = null;
        ai.targetV = 0;
        return;
      }

      if (!ai.plan) {
        ai.plan = cpuChooseOffPlan(off);
        ai.planT = 0;
        ai.targetV = 0;
        if (ai.plan.type === 'shoot') {
          startJump(off, false, true);
          ai.shootAt = off.jump.dur * (0.5 + (m.rng() - 0.5) * (1 - m.diff.skill) * 0.9);
        }
        if (ai.plan.type === 'advance' && ai.plan.sprint && off.dashCd <= 0) {
          off.dash = { t: 0, dur: SPRINT_DUR, dir: dir };
          off.dashCd = SPRINT_CD;
        }
      }

      const plan = ai.plan;
      ai.planT += dt;

      if (plan.type === 'shoot') {
        ai.targetV = 0;
        if (off.jump && off.jump.t >= ai.shootAt) {
          shoot(off);
          ai.plan = null;
        } else if (!off.jump) {
          ai.plan = null;
        }
        return;
      }
      if (plan.type === 'advance' || plan.type === 'drive') {
        ai.targetV = dir * BASE_SPEED * (plan.sprint ? 1.55 : 1.0);
        if (ai.planT >= plan.dur) {
          ai.plan = null;
          ai.targetV = dir * BASE_SPEED;
        }
        return;
      }
      if (plan.type === 'stepback') {
        ai.targetV = -dir * BASE_SPEED * 0.9;
        if (ai.planT >= plan.dur) ai.plan = null;
        return;
      }
      if (plan.type === 'dribble') {
        startMove(off, plan.id);
        ai.targetV = 0;
        ai.plan = null;
        return;
      }
      if (plan.type === 'protect') {
        off.protect = true;
        ai.targetV = 0;
        if (ai.planT >= plan.dur) {
          off.protect = false;
          ai.plan = null;
        }
        return;
      }
      ai.plan = null;
    }

    function cpuDefence(def, dt) {
      const off = m.players[m.offSide];
      const ai = def.ai;
      def.brace = false;
      def.protect = false;
      if (def.stun > 0) {
        ai.targetV = 0;
        return;
      }
      if (def.jump) {
        ai.targetV = 0;
        return;
      }
      const dir = attackDir(off.side);
      const want = clamp(off.x + dir * m.diff.guardGap, PLAYER_MIN, PLAYER_MAX);
      const dx = want - def.x;
      const maxV = m.diff.speed * (Math.abs(dx) > 190 ? 1.18 : 1);
      ai.targetV = clamp(dx * 7, -maxV, maxV);

      /* contest a jumper after a human-ish reaction delay */
      if (off.jump && off.jump.shot && ai.jumpWait < 0 && Math.abs(off.x - def.x) < 130) {
        ai.jumpWait = m.diff.jumpDelay;
      }
      if (ai.jumpWait >= 0) {
        ai.jumpWait -= dt;
        if (ai.jumpWait <= 0) {
          ai.jumpWait = -1;
          if (Math.abs(off.x - def.x) < 105) startJump(def, true, false);
        }
      }

      /* automated reach-ins */
      ai.stealT -= dt;
      if (ai.stealT <= 0) {
        ai.stealT = m.diff.stealEvery;
        if (!off.jump && Math.abs(off.x - def.x) < 74) trySteal(def, off, false);
      }
    }

    /* ---------------- per-frame update ---------------- */
    m.update = function (dt) {
      dt = clamp(dt, 0, 0.05);
      m.time += dt;

      for (let i = m.effects.length - 1; i >= 0; i--) {
        m.effects[i].t += dt;
        if (m.effects[i].t >= m.effects[i].dur) m.effects.splice(i, 1);
      }

      tickTimers(m.players.p1, dt);
      tickTimers(m.players.p2, dt);

      if (m.phase === 'over') return;

      if (m.phase === 'freeze' || m.phase === 'check') {
        m.freeze -= dt;
        if (m.freeze <= 0) {
          if (m.pendingSwitch) {
            m.pendingSwitch = false;
            switchPossession(m.lastNote);
          } else {
            m.phase = 'live';
          }
        }
        return;
      }

      if (m.phase === 'live') {
        if (m.human.indexOf('p1') < 0) {
          if (m.players.p1.role === 'off') cpuOffence(m.players.p1, dt);
          else cpuDefence(m.players.p1, dt);
        } else if (m.players.p1.role === 'def') {
          m.players.p1.protect = false;
        }
        if (m.human.indexOf('p2') < 0) {
          if (m.players.p2.role === 'off') cpuOffence(m.players.p2, dt);
          else cpuDefence(m.players.p2, dt);
        } else if (m.players.p2.role === 'def') {
          m.players.p2.protect = false;
        }

        movePlayer(m.players.p1, dt);
        movePlayer(m.players.p2, dt);

        m.shotClock -= dt;
        if (m.shotClock <= 0) {
          const offender = m.players[m.offSide];
          if (offender) offender.to++;      // a violation is a turnover in the stat line
          pushEffect('SHOT CLOCK', W / 2, 200, { big: true });
          scheduleSwitch('shot clock');
          m.shotClock = 0;
          return;
        }
      }

      if (m.phase === 'flight') handleFlight(dt);
    };

    m.finishGame = function (winnerSide) {
      endMatch(winnerSide || 'p1');
    };

    m.getResult = function () {
      if (!m.over) return null;
      const winSide = m.over.winner;
      return {
        winner: winSide,
        names: m.names,
        score: [m.players.p1.score, m.players.p2.score],
        stats: {
          p1: statLine(m.players.p1),
          p2: statLine(m.players.p2),
        },
        playerWin: winSide === 'p1',
      };
    };

    return m;
  }

  /* ============================================================
     SEASON — single-elimination playoff run
     ============================================================ */
  const TEAMS = {
    'PURE CHAOS': 80,
    'CABINET KINGS': 88,
    'PIXEL HEAT': 86,
    'VOID BULLS': 83,
    'GLITCH SPURS': 79,
    'STATIC LAKERS': 75,
    'BYTE CELTICS': 71,
    'CRT WARRIORS': 67,
  };

  const SEASON_ROUNDS = [
    { key: 'qf', name: 'QUARTERFINALS', difficulty: 'easy', target: 7 },
    { key: 'sf', name: 'SEMIFINALS', difficulty: 'normal', target: 11 },
    { key: 'f', name: 'THE FINALS', difficulty: 'hard', target: 15 },
  ];

  function createSeason(opts) {
    opts = opts || {};
    const rng = opts.rng || Math.random;
    const playerTeam = 'PURE CHAOS';

    const bracket = {
      qf: [
        { a: 'PURE CHAOS', b: 'CRT WARRIORS', you: true, sa: null, sb: null, winner: null },
        { a: 'GLITCH SPURS', b: 'STATIC LAKERS', you: false, sa: null, sb: null, winner: null },
        { a: 'PIXEL HEAT', b: 'BYTE CELTICS', you: false, sa: null, sb: null, winner: null },
        { a: 'CABINET KINGS', b: 'VOID BULLS', you: false, sa: null, sb: null, winner: null },
      ],
      sf: [
        { a: null, b: null, you: true, sa: null, sb: null, winner: null },
        { a: null, b: null, you: false, sa: null, sb: null, winner: null },
      ],
      f: [
        { a: null, b: null, you: true, sa: null, sb: null, winner: null },
      ],
    };

    const totals = {
      games: 0, wins: 0, losses: 0,
      ptsFor: 0, ptsAgainst: 0,
      fgm: 0, fga: 0, tpm: 0, tpa: 0,
      stl: 0, blk: 0, ankle: 0, to: 0,
      bestGame: 0, biggestWin: 0,
    };

    const history = [];
    let roundIndex = 0;
    let champion = false;
    let eliminated = false;
    let roundReached = 0;

    function power(name) { return TEAMS[name] || 75; }

    function simulateSeries(a, b, target) {
      const pa = power(a);
      const pb = power(b);
      let pA = 0.5 + (pa - pb) / 180;
      pA = clamp(pA, 0.18, 0.82);
      const aWins = rng() < pA;
      const winner = aWins ? a : b;
      const loser = aWins ? b : a;
      const loseScore = Math.max(2, Math.round(target * rand(rng, 0.36, 0.86)));
      return { winner: winner, loser: loser, sa: aWins ? target : loseScore, sb: aWins ? loseScore : target };
    }

    function simulateRoundGames() {
      const round = SEASON_ROUNDS[roundIndex];
      if (!round) return;
      bracket[round.key].forEach((game) => {
        if (game.winner || game.you) return;
        if (!game.a || !game.b) return;
        const res = simulateSeries(game.a, game.b, round.target);
        game.sa = res.sa;
        game.sb = res.sb;
        game.winner = res.winner;
      });
    }

    function fillNextRound() {
      /* QF -> SF */
      if (bracket.qf.every((g) => g.winner)) {
        for (let i = 0; i < 2; i++) {
          const g = bracket.sf[i];
          if (g.a || g.b) continue;
          const x = bracket.qf[i * 2];
          const y = bracket.qf[i * 2 + 1];
          g.a = x.winner;
          g.b = y.winner;
          g.you = g.a === playerTeam || g.b === playerTeam;
        }
      }
      /* SF -> F */
      if (bracket.sf.every((g) => g.winner)) {
        const g = bracket.f[0];
        if (!g.a && !g.b) {
          g.a = bracket.sf[0].winner;
          g.b = bracket.sf[1].winner;
          g.you = g.a === playerTeam || g.b === playerTeam;
        }
      }
    }

    function playerGame() {
      const round = SEASON_ROUNDS[roundIndex];
      if (!round || champion || eliminated) return null;
      const games = bracket[round.key];
      const game = games.find((g) => g.you && !g.winner);
      if (!game) return null;
      const opponent = game.a === playerTeam ? game.b : game.a;
      return {
        roundIndex: roundIndex,
        round: round.key,
        roundName: round.name,
        difficulty: round.difficulty,
        target: round.target,
        opponent: opponent,
        opponentPower: power(opponent),
      };
    }

    function recordPlayerResult(res) {
      /* res: { win, sa, sb, stats } — sa = PURE CHAOS score */
      const cfg = playerGame();
      if (!cfg) return { done: true };
      const round = SEASON_ROUNDS[roundIndex];
      const games = bracket[round.key];
      const game = games.find((g) => g.you && !g.winner && (g.a === playerTeam || g.b === playerTeam));
      if (!game) return { done: true };

      const playerIsA = game.a === playerTeam;
      game.sa = playerIsA ? res.sa : res.sb;
      game.sb = playerIsA ? res.sb : res.sa;
      game.winner = res.win ? playerTeam : cfg.opponent;
      game.played = true;

      const stats = res.stats || {};
      totals.games++;
      if (res.win) totals.wins++; else totals.losses++;
      totals.ptsFor += res.sa;
      totals.ptsAgainst += res.sb;
      totals.fgm += stats.fgm || 0;
      totals.fga += stats.fga || 0;
      totals.tpm += stats.tpm || 0;
      totals.tpa += stats.tpa || 0;
      totals.stl += stats.stl || 0;
      totals.blk += stats.blk || 0;
      totals.ankle += stats.ankle || 0;
      totals.to += stats.to || 0;
      totals.bestGame = Math.max(totals.bestGame, res.sa);
      const margin = res.sa - res.sb;
      if (res.win) totals.biggestWin = Math.max(totals.biggestWin, margin);

      history.push({
        round: cfg.roundName,
        opponent: cfg.opponent,
        win: !!res.win,
        sa: res.sa,
        sb: res.sb,
        stats: stats,
      });
      roundReached = roundIndex + 1;

      simulateRoundGames();
      fillNextRound();

      if (!res.win) {
        eliminated = true;
        return { over: true, eliminated: true, champion: false };
      }
      if (round.key === 'f') {
        champion = true;
        return { over: true, eliminated: false, champion: true };
      }
      roundIndex++;
      return { over: false, eliminated: false, champion: false, next: playerGame() };
    }

    function report() {
      const g = totals.games || 1;
      const fgPct = totals.fga ? Math.round((totals.fgm / totals.fga) * 100) : 0;
      const tpPct = totals.tpa ? Math.round((totals.tpm / totals.tpa) * 100) : 0;
      const ppg = totals.games ? (totals.ptsFor / totals.games) : 0;
      const oppPpg = totals.games ? (totals.ptsAgainst / totals.games) : 0;
      let grade = 'D';
      if (champion) {
        grade = (totals.wins - totals.losses) === 3 && fgPct >= 55 && totals.ankle >= 3 ? 'S+' : 'S';
      } else if (totals.wins === 2) grade = 'A';
      else if (totals.wins === 1) grade = 'B';
      else if (totals.wins === 0 && totals.games > 0) grade = 'C';
      return {
        champion: champion,
        eliminated: eliminated,
        roundReached: roundReached,
        roundName: roundReached ? SEASON_ROUNDS[roundReached - 1].name : '—',
        games: totals.games,
        wins: totals.wins,
        losses: totals.losses,
        record: totals.wins + '-' + totals.losses,
        ppg: ppg,
        oppPpg: oppPpg,
        ptsFor: totals.ptsFor,
        ptsAgainst: totals.ptsAgainst,
        fgm: totals.fgm,
        fga: totals.fga,
        fgPct: fgPct,
        tpm: totals.tpm,
        tpa: totals.tpa,
        tpPct: tpPct,
        stl: totals.stl,
        blk: totals.blk,
        ankle: totals.ankle,
        to: totals.to,
        bestGame: totals.bestGame,
        biggestWin: totals.biggestWin,
        grade: grade,
        history: history.slice(),
      };
    }

    return {
      playerTeam: playerTeam,
      rounds: SEASON_ROUNDS,
      bracket: bracket,
      get roundIndex() { return roundIndex; },
      get champion() { return champion; },
      get eliminated() { return eliminated; },
      playerGame: playerGame,
      recordPlayerResult: recordPlayerResult,
      simulateRoundGames: simulateRoundGames,
      fillNextRound: fillNextRound,
      report: report,
      power: power,
    };
  }


  return {
    W: W, H: H, FLOOR: FLOOR,
    COURT: COURT, HOOPS: HOOPS,
    PLAYER_MIN: PLAYER_MIN, PLAYER_MAX: PLAYER_MAX,
    HAND_Y: HAND_Y, SHOT_CLOCK: SHOT_CLOCK,
    BASE_SPEED: BASE_SPEED, SPRINT_SPEED: SPRINT_SPEED, SPRINT_DUR: SPRINT_DUR,
    DIFFICULTY: DIFFICULTY, DIFF_ORDER: DIFF_ORDER,
    MOVES: MOVES,
    TEAMS: TEAMS, SEASON_ROUNDS: SEASON_ROUNDS,
    attackDir: attackDir, targetHoop: targetHoop,
    createMatch: createMatch,
    createSeason: createSeason,
    clamp: clamp,
  };
});
