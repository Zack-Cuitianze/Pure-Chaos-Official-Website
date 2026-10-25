/* Public brands page renderer.
   Loads /api/brands when the site is served by server.js and re-renders the
   brand cards. When the page is opened from file:// (or the API is not
   available) the static markup in brands.html stays untouched. */
(() => {
  'use strict';

  if (!/^https?:$/.test(location.protocol)) return;

  const titleEl = document.getElementById('brandsTitle');
  const introEl = document.querySelector('.brands__intro');
  const listEl = document.querySelector('.brands__list');
  if (!listEl) return;

  fetch('/api/brands', { headers: { Accept: 'application/json' } })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => { if (data) render(data); })
    .catch(() => { /* keep the static fallback */ });

  function render(data) {
    const page = data.page && typeof data.page === 'object' ? data.page : {};

    if (titleEl && typeof page.title === 'string' && page.title.trim()) {
      titleEl.textContent = page.title;
    }

    if (introEl) {
      const intro = typeof page.intro === 'string' ? page.intro.trim() : '';
      introEl.textContent = intro;
      introEl.hidden = !intro;
    }

    if (!Array.isArray(data.brands)) return;
    const brands = data.brands
      .slice()
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    listEl.textContent = '';
    brands.forEach((brand) => listEl.appendChild(card(brand)));
  }

  function card(brand) {
    const node = document.createElement(brand.url ? 'a' : 'article');
    node.className = 'brand-card' + (brand.url ? ' brand-card--link' : '');
    if (brand.url) {
      node.href = brand.url;
      node.target = '_blank';
      node.rel = 'noopener';
    }

    const logoSlot = document.createElement('div');
    logoSlot.className = 'brand-card__logo';
    if (brand.logo) {
      const img = document.createElement('img');
      img.src = brand.logo;
      img.alt = (brand.name || 'Brand') + ' logo';
      img.width = 260;
      img.height = 88;
      img.loading = 'lazy';
      img.style.setProperty('--logo-scale', String(Number(brand.logoScale) || 1));
      img.addEventListener('error', () => { img.style.display = 'none'; });
      logoSlot.appendChild(img);
    }

    const body = document.createElement('div');
    body.className = 'brand-card__body';

    const name = document.createElement('h2');
    name.className = 'brand-card__name';
    name.textContent = brand.name || '';
    body.appendChild(name);

    if (brand.description) {
      const desc = document.createElement('p');
      desc.className = 'brand-card__desc';
      desc.textContent = brand.description;
      body.appendChild(desc);
    }

    if (brand.url) {
      const visit = document.createElement('span');
      visit.className = 'brand-card__visit';
      visit.textContent = 'Visit →';
      body.appendChild(visit);
    }

    node.appendChild(logoSlot);
    node.appendChild(body);
    return node;
  }
})();
