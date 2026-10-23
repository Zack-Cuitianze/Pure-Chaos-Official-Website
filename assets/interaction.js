/* ============================================================
   Pure Chaos — title interaction runtime
   ------------------------------------------------------------
   Character-level pointer proximity + whole-title 3D tilt.
   Opt in from any page:

     <h1 data-tilt-title>…</h1>       title to split
     <main data-tilt-zone>…</main>    pointer tracking zone

   Falls back to the title's parent when no zone is declared.
   ============================================================ */
(() => {
  'use strict';

  const title = document.querySelector('[data-tilt-title]');
  const zone = document.querySelector('[data-tilt-zone]') || (title && title.parentElement);
  if (!title || !zone) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  /* ---- split text into character spans ----
     Characters are grouped into word containers: the per-character spans
     still drive the proximity lift, but lines may only break between words.
     Without that a narrow screen can break mid-word and leave a lone
     trailing "." on its own line. */
  const chars = [];
  const frag = document.createDocumentFragment();
  for (const word of title.textContent.split(/(\s+)/)) {
    if (!word) continue;
    if (/^\s+$/.test(word)) {
      frag.appendChild(document.createTextNode(' '));
      continue;
    }
    const wordEl = document.createElement('span');
    wordEl.className = 'ch-word';
    for (const ch of word) {
      const s = document.createElement('span');
      s.className = 'ch';
      s.textContent = ch;
      wordEl.appendChild(s);
      chars.push({ el: s, k: 0 });
    }
    frag.appendChild(wordEl);
  }
  title.textContent = '';
  title.appendChild(frag);

  /* ---- tuning ---- */
  const TILT = 3;       // max whole-title tilt, degrees
  const RADIUS = 160;   // pointer proximity radius, px
  const SMOOTH = 100;   // spring time-constant, ms

  /* ---- state ---- */
  let px = NaN, py = NaN;
  let tx = 0, ty = 0;
  let cx = 0, cy = 0;
  let active = false;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const smoothstep = (v) => v * v * (3 - 2 * v);

  function track(e) {
    const r = title.getBoundingClientRect();
    const nx = (e.clientX - (r.left + r.width / 2)) / ((r.width / 2) || 1);
    const ny = (e.clientY - (r.top + r.height / 2)) / ((r.height / 2) || 1);
    tx = clamp(nx, -1, 1);
    ty = clamp(ny, -1, 1);
    px = e.clientX;
    py = e.clientY;
    active = true;
  }
  function release() {
    tx = 0; ty = 0; active = false;
    px = NaN; py = NaN;
  }

  zone.addEventListener('mousemove', track, { passive: true });
  zone.addEventListener('mouseleave', release);
  zone.addEventListener('touchstart', (e) => e.touches[0] && track(e.touches[0]), { passive: true });
  zone.addEventListener('touchmove', (e) => e.touches[0] && track(e.touches[0]), { passive: true });
  zone.addEventListener('touchend', release, { passive: true });
  zone.addEventListener('touchcancel', release, { passive: true });

  /* ---- render loop ---- */
  let raf = 0;
  let last = 0;

  function tick(now) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(64, now - last || 16.7);
    last = now;
    const f = 1 - Math.exp(-dt / SMOOTH);

    cx += (tx - cx) * f;
    cy += (ty - cy) * f;

    const idleY = Math.sin(now * 0.0006) * 1.8 * (active ? 0.25 : 1);

    title.style.setProperty('--rot-x', (cy * TILT).toFixed(3) + 'deg');
    title.style.setProperty('--rot-y', (cx * TILT).toFixed(3) + 'deg');
    title.style.setProperty('--idle-y', idleY.toFixed(2) + 'px');

    for (const c of chars) {
      let target = 0;
      if (!Number.isNaN(px)) {
        const r = c.el.getBoundingClientRect();
        const d = Math.hypot(px - (r.left + r.width / 2), py - (r.top + r.height / 2));
        const prox = 1 - d / RADIUS;
        if (prox > 0) target = smoothstep(prox);
      }
      c.k += (target - c.k) * f;
      c.el.style.setProperty('--k', c.k.toFixed(3));
    }
  }

  raf = requestAnimationFrame(tick);
  window.addEventListener('pagehide', () => cancelAnimationFrame(raf), { once: true });
})();
