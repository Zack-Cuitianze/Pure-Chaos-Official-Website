/* Public articles listing.
   Fetches /api/articles when the site is served by server.js and renders the
   card grid. Opened from file:// (or without the API) the static fallback in
   articles.html stays untouched. */
(() => {
  'use strict';

  if (!/^https?:$/.test(location.protocol)) return;

  const grid = document.getElementById('articlesGrid');
  const kickerEl = document.querySelector('.page__kicker');
  const titleEl = document.querySelector('.page__title');
  const leadEl = document.querySelector('.page__lead');
  const noteEl = document.querySelector('.page__note');
  if (!grid) return;

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  fetch('/api/articles', { headers: { Accept: 'application/json' } })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => { if (data) render(data); })
    .catch(() => { /* keep static fallback */ });

  function formatDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return '';
    const month = MONTHS[Number(match[2]) - 1];
    return month ? Number(match[3]) + ' ' + month + ' ' + match[1] : '';
  }

  function render(data) {
    const page = data.page && typeof data.page === 'object' ? data.page : {};
    if (kickerEl && page.kicker) kickerEl.textContent = page.kicker;
    if (titleEl && page.title) titleEl.textContent = page.title;
    if (leadEl && page.lead) leadEl.textContent = page.lead;
    if (noteEl) {
      if (page.note) noteEl.textContent = page.note;
      else noteEl.hidden = true;
    }

    const articles = (Array.isArray(data.articles) ? data.articles : [])
      .slice()
      .sort((a, b) => {
        const rank = (item) => (item.status === 'in-the-works' ? 0 : 1);
        const byRank = rank(a) - rank(b);
        if (byRank !== 0) return byRank;
        if (a.status === 'in-the-works') return 0; /* keep the curated queue order */
        return String(b.date || '').localeCompare(String(a.date || '')) || String(a.title).localeCompare(String(b.title));
      });

    grid.textContent = '';
    if (!articles.length) {
      const empty = document.createElement('p');
      empty.className = 'articles-grid__empty';
      empty.textContent = 'No articles yet — the first dispatch is on its way.';
      grid.appendChild(empty);
      return;
    }
    articles.forEach((article) => grid.appendChild(card(article)));
  }

  function card(article) {
    const published = article.status === 'published';
    const node = document.createElement(published ? 'a' : 'article');
    node.className = 'article-card' + (published ? '' : ' article-card--soon');
    if (published) node.href = '/articles/' + encodeURIComponent(article.slug);

    const media = document.createElement('div');
    media.className = 'article-card__media';
    if (article.cover) {
      const img = document.createElement('img');
      img.src = '/' + String(article.cover).replace(/^\/+/, '');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', () => {
        media.textContent = '';
        media.classList.add('article-card__media--empty');
        const label = document.createElement('span');
        label.className = 'article-card__placeholder';
        label.textContent = 'Pure Chaos';
        media.appendChild(label);
      });
      media.appendChild(img);
    } else {
      media.classList.add('article-card__media--empty');
      const label = document.createElement('span');
      label.className = 'article-card__placeholder';
      label.textContent = 'Pure Chaos';
      media.appendChild(label);
    }

    const body = document.createElement('div');
    body.className = 'article-card__body';

    const meta = document.createElement('div');
    meta.className = 'article-card__meta';
    const date = document.createElement('span');
    date.textContent = formatDate(article.date) || (article.status === 'in-the-works' ? 'In the works' : 'Article');
    meta.appendChild(date);
    if (article.status === 'in-the-works') {
      const flag = document.createElement('span');
      flag.className = 'article-card__flag';
      flag.textContent = 'Soon';
      meta.appendChild(flag);
    }
    body.appendChild(meta);

    const title = document.createElement('h2');
    title.className = 'article-card__title';
    title.textContent = article.title || '';
    body.appendChild(title);

    if (article.summary) {
      const summary = document.createElement('p');
      summary.className = 'article-card__summary';
      summary.textContent = article.summary;
      body.appendChild(summary);
    }

    node.appendChild(media);
    node.appendChild(body);
    return node;
  }
})();
