/* ============================================================
   Pure Chaos — chess engine
   ------------------------------------------------------------
   Rules + search, no DOM. Shared by game-chess.html (play) and
   game-chess-lesson.html (tutorial diagrams), and testable in node.

   Board model
     board: Array(64) of null | { t: 'p'|'n'|'b'|'r'|'q'|'k', c: 'w'|'b' }
     index: rank * 8 + file, index 0 = a8, index 63 = h1
     state: { turn, wk, wq, bk, bq, ep, half, full }
     move:  { from, to, piece, promo?, dbl?, ep?, castle? }

   Everything is immutable: applyMove() never mutates its inputs, so a
   plain board.slice() is enough (piece objects are shared, never written).
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChessEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------- geometry helpers ---------------- */
  const R = (i) => i >> 3;
  const C = (i) => i & 7;
  const IDX = (r, c) => (r << 3) | c;
  const inside = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const opp = (c) => (c === 'w' ? 'b' : 'w');
  const FILE = 'abcdefgh';
  const sqName = (i) => FILE[C(i)] + (8 - R(i));

  const KNIGHT_DELTAS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const ALL8 = DIAG.concat(ORTHO);

  /* ---------------- positions ---------------- */
  function emptyBoard() {
    return new Array(64).fill(null);
  }

  function put(board, i, t, c) {
    board[i] = { t: t, c: c };
    return board;
  }

  function startPos() {
    const b = emptyBoard();
    const back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
    for (let c = 0; c < 8; c++) {
      b[c] = { t: back[c], c: 'b' };
      b[8 + c] = { t: 'p', c: 'b' };
      b[48 + c] = { t: 'p', c: 'w' };
      b[56 + c] = { t: back[c], c: 'w' };
    }
    return {
      board: b,
      state: { turn: 'w', wk: true, wq: true, bk: true, bq: true, ep: -1, half: 0, full: 1 },
    };
  }

  /* ---------------- rules ---------------- */
  function kingSquare(board, color) {
    for (let i = 0; i < 64; i++) {
      const p = board[i];
      if (p && p.t === 'k' && p.c === color) return i;
    }
    return -1;
  }

  function attacked(board, sq, by) {
    const r = R(sq);
    const c = C(sq);

    // pawns: a white pawn attacking `sq` stands one rank below it
    const dir = by === 'w' ? 1 : -1;
    for (let dc = -1; dc <= 1; dc += 2) {
      if (inside(r + dir, c + dc)) {
        const p = board[IDX(r + dir, c + dc)];
        if (p && p.c === by && p.t === 'p') return true;
      }
    }
    // knights
    for (let k = 0; k < 8; k++) {
      const nr = r + KNIGHT_DELTAS[k][0];
      const nc = c + KNIGHT_DELTAS[k][1];
      if (!inside(nr, nc)) continue;
      const p = board[IDX(nr, nc)];
      if (p && p.c === by && p.t === 'n') return true;
    }
    // sliders: diagonals (bishop/queen), orthogonals (rook/queen)
    for (let d = 0; d < 8; d++) {
      const isDiag = d < 4;
      const dirs = isDiag ? DIAG : ORTHO;
      const types = isDiag ? 'bq' : 'rq';
      const dr = dirs[d % 4][0];
      const dc = dirs[d % 4][1];
      for (let k = 1; k < 8; k++) {
        const nr = r + dr * k;
        const nc = c + dc * k;
        if (!inside(nr, nc)) break;
        const p = board[IDX(nr, nc)];
        if (!p) continue;
        if (p.c === by && types.indexOf(p.t) >= 0) return true;
        break;
      }
    }
    // king
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        if (!inside(r + dr, c + dc)) continue;
        const p = board[IDX(r + dr, c + dc)];
        if (p && p.c === by && p.t === 'k') return true;
      }
    }
    return false;
  }

  function inCheck(board, state, color) {
    const k = kingSquare(board, color);
    return k >= 0 && attacked(board, k, opp(color));
  }

  /* pseudo-legal moves for the piece on `i` (self-check is not considered) */
  function pseudoMoves(board, state, i) {
    const pc = board[i];
    if (!pc) return [];
    const out = [];
    const r = R(i);
    const c = C(i);
    const add = (to, flags) => out.push(Object.assign({ from: i, to: to, piece: pc.t }, flags || {}));

    if (pc.t === 'p') {
      const dir = pc.c === 'w' ? -1 : 1;
      const home = pc.c === 'w' ? 6 : 1;
      const last = pc.c === 'w' ? 0 : 7;
      if (inside(r + dir, c) && !board[IDX(r + dir, c)]) {
        add(IDX(r + dir, c), r + dir === last ? { promo: true } : null);
        if (r === home && !board[IDX(r + 2 * dir, c)]) add(IDX(r + 2 * dir, c), { dbl: true });
      }
      for (let dc = -1; dc <= 1; dc += 2) {
        if (!inside(r + dir, c + dc)) continue;
        const to = IDX(r + dir, c + dc);
        if (board[to] && board[to].c !== pc.c) add(to, r + dir === last ? { promo: true } : null);
        else if (to === state.ep) add(to, { ep: true });
      }
    } else if (pc.t === 'n') {
      for (let k = 0; k < 8; k++) {
        const nr = r + KNIGHT_DELTAS[k][0];
        const nc = c + KNIGHT_DELTAS[k][1];
        if (!inside(nr, nc)) continue;
        const to = IDX(nr, nc);
        if (!board[to] || board[to].c !== pc.c) add(to);
      }
    } else {
      const dirs = pc.t === 'b' ? DIAG : pc.t === 'r' ? ORTHO : ALL8;
      const range = pc.t === 'k' ? 1 : 7;
      for (let d = 0; d < dirs.length; d++) {
        for (let k = 1; k <= range; k++) {
          const nr = r + dirs[d][0] * k;
          const nc = c + dirs[d][1] * k;
          if (!inside(nr, nc)) break;
          const to = IDX(nr, nc);
          if (!board[to]) add(to);
          else {
            if (board[to].c !== pc.c) add(to);
            break;
          }
        }
      }
      if (pc.t === 'k') {
        const home = pc.c === 'w' ? 7 : 0;
        const rights = pc.c === 'w' ? [state.wk, state.wq] : [state.bk, state.bq];
        const enemy = opp(pc.c);
        if (r === home && c === 4) {
          if (rights[0] && !board[IDX(home, 5)] && !board[IDX(home, 6)] &&
              !attacked(board, IDX(home, 4), enemy) &&
              !attacked(board, IDX(home, 5), enemy) &&
              !attacked(board, IDX(home, 6), enemy)) {
            add(IDX(home, 6), { castle: 'K' });
          }
          if (rights[1] && !board[IDX(home, 3)] && !board[IDX(home, 2)] && !board[IDX(home, 1)] &&
              !attacked(board, IDX(home, 4), enemy) &&
              !attacked(board, IDX(home, 3), enemy) &&
              !attacked(board, IDX(home, 2), enemy)) {
            add(IDX(home, 2), { castle: 'Q' });
          }
        }
      }
    }
    return out;
  }

  function applyMove(board, state, m, promoPiece) {
    const nb = board.slice();
    const pc = nb[m.from];
    const ns = {
      turn: opp(state.turn), wk: state.wk, wq: state.wq, bk: state.bk, bq: state.bq,
      ep: -1, half: state.half + 1, full: state.full + (state.turn === 'b' ? 1 : 0),
    };
    let captured = null;
    if (m.ep) {
      const cap = m.to + (pc.c === 'w' ? 8 : -8);
      captured = nb[cap];
      nb[cap] = null;
    } else if (nb[m.to]) {
      captured = nb[m.to];
    }
    nb[m.to] = nb[m.from];
    nb[m.from] = null;
    if (m.promo) nb[m.to] = { t: promoPiece || 'q', c: pc.c };
    if (m.castle) {
      const home = pc.c === 'w' ? 7 : 0;
      if (m.castle === 'K') {
        nb[IDX(home, 5)] = nb[IDX(home, 7)];
        nb[IDX(home, 7)] = null;
      } else {
        nb[IDX(home, 3)] = nb[IDX(home, 0)];
        nb[IDX(home, 0)] = null;
      }
    }
    if (m.dbl) ns.ep = (m.from + m.to) / 2;
    if (pc.t === 'k') {
      if (pc.c === 'w') { ns.wk = ns.wq = false; } else { ns.bk = ns.bq = false; }
    }
    // moving to or from a corner rook square kills that castling right
    if (m.from === 63 || m.to === 63) ns.wk = false;
    if (m.from === 56 || m.to === 56) ns.wq = false;
    if (m.from === 7 || m.to === 7) ns.bk = false;
    if (m.from === 0 || m.to === 0) ns.bq = false;
    if (pc.t === 'p' || captured) ns.half = 0;
    return { board: nb, state: ns, captured: captured };
  }

  /* legal moves for the piece on `i` */
  function legalMoves(board, state, i) {
    return filterLegal(board, state, pseudoMoves(board, state, i), state.turn);
  }

  function filterLegal(board, state, moves, color) {
    const out = [];
    const kFrom = kingSquare(board, color);
    const enemy = opp(color);
    for (let n = 0; n < moves.length; n++) {
      const m = moves[n];
      const res = applyMove(board, state, m, 'q');
      const kTo = m.from === kFrom ? m.to : (m.castle ? IDX(color === 'w' ? 7 : 0, m.castle === 'K' ? 6 : 2) : kFrom);
      if (!attacked(res.board, kTo, enemy)) out.push(m);
    }
    return out;
  }

  /* all legal moves for `color` (defaults to the side to move) */
  function allLegal(board, state, color) {
    const side = color || state.turn;
    const out = [];
    const kFrom = kingSquare(board, side);
    const enemy = opp(side);
    for (let i = 0; i < 64; i++) {
      const p = board[i];
      if (!p || p.c !== side) continue;
      const raw = pseudoMoves(board, state, i);
      for (let n = 0; n < raw.length; n++) {
        const m = raw[n];
        const res = applyMove(board, state, m, 'q');
        const kTo = m.from === kFrom ? m.to : (m.castle ? IDX(side === 'w' ? 7 : 0, m.castle === 'K' ? 6 : 2) : kFrom);
        if (!attacked(res.board, kTo, enemy)) out.push(m);
      }
    }
    return out;
  }

  function insufficientMaterial(board) {
    const rest = [];
    for (let i = 0; i < 64; i++) {
      const p = board[i];
      if (p && p.t !== 'k') rest.push({ p: p, i: i });
    }
    if (!rest.length) return true;                                   // K vs K
    if (rest.length === 1 && (rest[0].p.t === 'b' || rest[0].p.t === 'n')) return true;  // K+minor vs K
    // K+B vs K+B with both bishops on the same coloured squares cannot mate:
    // one bishop per side and equal square parity is a dead position.
    if (rest.length === 2 && rest[0].p.t === 'b' && rest[1].p.t === 'b' &&
        rest[0].p.c !== rest[1].p.c &&
        ((R(rest[0].i) + C(rest[0].i)) % 2) === ((R(rest[1].i) + C(rest[1].i)) % 2)) {
      return true;
    }
    return false;
  }

  /* ---------------- notation ---------------- */
  function san(board, state, m, promoPiece) {
    let base;
    if (m.castle) {
      base = m.castle === 'K' ? 'O-O' : 'O-O-O';
    } else {
      const pc = board[m.from];
      const dest = sqName(m.to);
      const captured = m.ep ? !!board[m.to + (pc.c === 'w' ? 8 : -8)] : !!board[m.to];
      if (pc.t === 'p') {
        base = (captured ? FILE[C(m.from)] + 'x' : '') + dest + (m.promo ? '=' + (promoPiece || 'q').toUpperCase() : '');
      } else {
        // disambiguate against other identical pieces that can reach `dest`
        const rivals = [];
        const others = allLegal(board, state, pc.c);
        for (let i = 0; i < others.length; i++) {
          const o = others[i];
          if (o.to !== m.to || o.from === m.from) continue;
          const op = board[o.from];
          if (!op || op.t !== pc.t) continue;
          if (rivals.indexOf(o.from) < 0) rivals.push(o.from);
        }
        let dis = '';
        if (rivals.length) {
          const sameFile = rivals.some((r) => C(r) === C(m.from));
          const sameRank = rivals.some((r) => R(r) === R(m.from));
          dis = !sameFile ? FILE[C(m.from)] : (!sameRank ? String(8 - R(m.from)) : sqName(m.from));
        }
        base = pc.t.toUpperCase() + dis + (captured ? 'x' : '') + dest;
      }
    }
    const res = applyMove(board, state, m, promoPiece);
    const enemy = res.state.turn;
    const chk = inCheck(res.board, res.state, enemy);
    const replies = chk ? allLegal(res.board, res.state, enemy) : null;
    return base + (chk ? (replies.length ? '+' : '#') : '');
  }

  /* an en-passant square only matters for repetition if it can actually be taken */
  function epCaptureAvailable(board, state) {
    if (state.ep < 0) return false;
    const epR = R(state.ep), epC = C(state.ep);
    const dr = state.turn === 'w' ? 1 : -1;   // the capturing pawn sits behind the target
    for (const df of [-1, 1]) {
      const r = epR + dr, c = epC + df;
      if (!inside(r, c)) continue;
      const p = board[IDX(r, c)];
      if (p && p.t === 'p' && p.c === state.turn) return true;
    }
    return false;
  }

  /* repetition key (board + side + rights + usable ep) */
  function positionKey(board, state) {
    let s = '';
    for (let i = 0; i < 64; i++) {
      const p = board[i];
      s += p ? (p.c === 'w' ? p.t.toUpperCase() : p.t) : '.';
    }
    const ep = epCaptureAvailable(board, state) ? state.ep : -1;
    return s + state.turn + (state.wk ? 'K' : '') + (state.wq ? 'Q' : '') +
      (state.bk ? 'k' : '') + (state.bq ? 'q' : '') + ep;
  }

  /* ---------------- evaluation ---------------- */
  const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  const PST = {
    p: [
      0, 0, 0, 0, 0, 0, 0, 0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
      5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0,
      5, -5, -10, 0, 0, -10, -5, 5,
      5, 10, 10, -20, -20, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0,
    ],
    n: [
      -50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20, 0, 0, 0, 0, -20, -40,
      -30, 0, 10, 15, 15, 10, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30,
      -30, 5, 10, 15, 15, 10, 5, -30,
      -40, -20, 0, 5, 5, 0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50,
    ],
    b: [
      -20, -10, -10, -10, -10, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10,
      -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 5, 0, 0, 0, 0, 5, -10,
      -20, -10, -10, -10, -10, -10, -10, -20,
    ],
    r: [
      0, 0, 0, 5, 5, 0, 0, 0,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      5, 10, 10, 10, 10, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0,
    ],
    q: [
      -20, -10, -10, -5, -5, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 5, 5, 5, 0, -10,
      -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5,
      -10, 5, 5, 5, 5, 5, 0, -10,
      -10, 0, 5, 0, 0, 0, 0, -10,
      -20, -10, -10, -5, -5, -10, -10, -20,
    ],
    k: [
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -10, -20, -20, -20, -20, -20, -20, -10,
      20, 20, 0, 0, 0, 0, 20, 20,
      20, 30, 10, 0, 0, 10, 30, 20,
    ],
  };

  function evaluate(board) {
    let score = 0;
    for (let i = 0; i < 64; i++) {
      const p = board[i];
      if (!p) continue;
      const v = VALUE[p.t] + PST[p.t][p.c === 'w' ? i : (i ^ 56)];
      score += p.c === 'w' ? v : -v;
    }
    return score;
  }

  /* ---------------- search ---------------- */
  const MATE = 100000;
  const INF = 1000000;
  const ABORT = { abort: true };
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function moveScore(board, m) {
    const victim = board[m.to];
    let s = 0;
    if (victim) s = VALUE[victim.t] * 10 - VALUE[m.piece];
    if (m.promo) s += 800;
    if (m.castle) s += 60;
    return s;
  }

  function sortMoves(board, moves) {
    const scored = moves.map((m) => ({ m: m, s: moveScore(board, m) }));
    scored.sort((a, b) => b.s - a.s);
    return scored.map((x) => x.m);
  }

  function quiesce(board, state, alpha, beta, ctx, ply, qdepth) {
    if ((ctx.nodes++ & 1023) === 0 && now() > ctx.deadline) throw ABORT;
    const sideInCheck = inCheck(board, state, state.turn);
    const stand = state.turn === 'w' ? evaluate(board) : -evaluate(board);
    if (!sideInCheck) {
      if (qdepth <= 0) return stand;
      if (stand >= beta) return beta;
      if (stand > alpha) alpha = stand;
    } else if (qdepth <= -2) {
      return stand;             // hard cap: a check is never extended forever
    }

    let moves = sortMoves(board, allLegal(board, state, state.turn));
    if (!sideInCheck) moves = moves.filter((m) => board[m.to] || m.promo || m.ep);
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const res = applyMove(board, state, m, 'q');
      const score = -quiesce(res.board, res.state, -beta, -alpha, ctx, ply + 1, qdepth - 1);
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  function negamax(board, state, depth, alpha, beta, ctx, ply) {
    ctx.nodes++;
    if ((ctx.nodes & 511) === 0 && now() > ctx.deadline) throw ABORT;

    if (state.half >= 100 || insufficientMaterial(board)) return 0;

    if (depth <= 0) {
      if (ctx.quiesce && ctx.qdepth) return quiesce(board, state, alpha, beta, ctx, ply, ctx.qdepth);
      return state.turn === 'w' ? evaluate(board) : -evaluate(board);
    }

    const moves = allLegal(board, state, state.turn);
    if (!moves.length) {
      if (inCheck(board, state, state.turn)) return -(MATE - ply - 1);
      return 0;
    }
    sortMovesInPlace(board, moves);
    let best = -INF;
    for (let i = 0; i < moves.length; i++) {
      const res = applyMove(board, state, moves[i], 'q');
      const score = -negamax(res.board, res.state, depth - 1, -beta, -alpha, ctx, ply + 1);
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    return best;
  }

  function sortMovesInPlace(board, moves) {
    for (let i = 1; i < moves.length; i++) {
      const m = moves[i];
      const s = moveScore(board, m);
      let j = i - 1;
      while (j >= 0 && moveScore(board, moves[j]) < s) {
        moves[j + 1] = moves[j];
        j--;
      }
      moves[j + 1] = m;
    }
  }

  /* exact score of one root move at a shallow depth (used by the weak levels) */
  function scoreRootMove(board, state, m, depth, ctx) {
    const res = applyMove(board, state, m, 'q');
    const enemy = res.state.turn;
    const replies = allLegal(res.board, res.state, enemy);
    if (!replies.length) {
      return inCheck(res.board, res.state, enemy) ? (MATE - 10) : 0;
    }
    return -negamax(res.board, res.state, depth - 1, -INF, INF, ctx, 1);
  }

  /* ---------------- difficulty levels ---------------- */
  const LEVELS = {
    beginner: {
      id: 'beginner', label: 'BEGINNER', depth: 1, noise: 260, blunder: 0.35,
      budget: 120, quiesce: false, qdepth: 0,
      blurb: 'Learns the ropes. Misses things. Very beatable.',
    },
    intermediate: {
      id: 'intermediate', label: 'INTERMEDIATE', depth: 2, noise: 70, blunder: 0.12,
      budget: 320, quiesce: false, qdepth: 0,
      blurb: 'Takes what is offered and defends the obvious.',
    },
    master: {
      id: 'master', label: 'MASTER', depth: 3, noise: 12, blunder: 0.02,
      budget: 700, quiesce: true, qdepth: 3,
      blurb: 'Looks three moves ahead and punishes loose pieces.',
    },
    pioneer: {
      id: 'pioneer', label: 'PIONEER', depth: 4, noise: 0, blunder: 0,
      budget: 1100, quiesce: true, qdepth: 4,
      blurb: 'The cabinet champion. Deep search, no mercy.',
    },
  };
  const LEVEL_ORDER = ['beginner', 'intermediate', 'master', 'pioneer'];

  function chooseMove(board, state, levelId, opts) {
    const cfg = LEVELS[levelId] || LEVELS.intermediate;
    const options = opts || {};
    const rng = options.rng || Math.random;
    const legal = allLegal(board, state, state.turn);
    if (!legal.length) return null;
    if (legal.length === 1) return legal[0];

    const ctx = {
      nodes: 0,
      deadline: now() + (options.budgetMs || cfg.budget),
      quiesce: cfg.quiesce,
      qdepth: cfg.qdepth,
    };

    // weak tiers: score every root move, then choose with deliberate noise
    if (cfg.depth <= 2) {
      let best = null;
      let bestScore = -INF;
      const scored = [];
      for (let i = 0; i < legal.length; i++) {
        let s;
        try {
          s = scoreRootMove(board, state, legal[i], cfg.depth, ctx);
        } catch (e) {
          if (e !== ABORT) throw e;
          break;
        }
        scored.push({ m: legal[i], s: s });
        if (s > bestScore) { bestScore = s; best = legal[i]; }
      }
      if (options.onStats) options.onStats({ depth: cfg.depth, nodes: ctx.nodes, ms: 0 });
      if (bestScore >= MATE - 1000) return best;
      if (rng() < cfg.blunder) return legal[Math.floor(rng() * legal.length)];
      const pool = scored.filter((x) => x.s >= bestScore - cfg.noise);
      return pool.length ? pool[Math.floor(rng() * pool.length)].m : best;
    }

    // strong tiers: iterative deepening with alpha-beta
    let best = legal[0];
    let bestScore = -INF;
    const rootMoves = sortMoves(board, legal);
    for (let depth = 1; depth <= cfg.depth; depth++) {
      let alpha = -INF;
      let localBest = null;
      let localScore = -INF;
      let completed = true;
      try {
        for (let i = 0; i < rootMoves.length; i++) {
          const res = applyMove(board, state, rootMoves[i], 'q');
          const score = -negamax(res.board, res.state, depth - 1, -INF, -alpha, ctx, 1);
          if (score > localScore) { localScore = score; localBest = rootMoves[i]; }
          if (score > alpha) alpha = score;
        }
      } catch (e) {
        if (e !== ABORT) throw e;
        completed = false;                  // out of time: keep the last completed depth
      }
      if (localBest) best = localBest;
      if (completed && localScore > bestScore) bestScore = localScore;
      if (options.onStats) options.onStats({ depth: depth, nodes: ctx.nodes, ms: Math.round(now() - (ctx.deadline - (options.budgetMs || cfg.budget))) });
      if (localScore >= MATE - 1000) break;
      if (!completed) break;
    }
    // never "blunder" away a forced mate the search has already found
    if (cfg.blunder && bestScore < MATE - 1000 && rng() < cfg.blunder) {
      return legal[Math.floor(rng() * legal.length)];
    }
    return best;
  }

  /* perft: node count for move-generation validation */
  function perft(board, state, depth) {
    if (depth === 0) return 1;
    const moves = allLegal(board, state, state.turn);
    if (depth === 1) return moves.length;
    let n = 0;
    for (let i = 0; i < moves.length; i++) {
      const res = applyMove(board, state, moves[i], 'q');
      n += perft(res.board, res.state, depth - 1);
    }
    return n;
  }

  return {
    R: R, C: C, IDX: IDX, inside: inside, opp: opp, sqName: sqName, FILE: FILE,
    emptyBoard: emptyBoard, put: put, startPos: startPos,
    kingSquare: kingSquare, attacked: attacked, inCheck: inCheck,
    pseudoMoves: pseudoMoves, legalMoves: legalMoves, allLegal: allLegal,
    applyMove: applyMove, insufficientMaterial: insufficientMaterial,
    san: san, positionKey: positionKey,
    evaluate: evaluate, VALUE: VALUE,
    LEVELS: LEVELS, LEVEL_ORDER: LEVEL_ORDER, chooseMove: chooseMove,
    perft: perft, MATE: MATE,
  };
});
