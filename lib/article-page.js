'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { renderMarkdown } = require('./markdown');

const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'templates', 'article.html'), 'utf8');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return '';
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return '';
  return Number(match[3]) + ' ' + month + ' ' + match[1];
}

function fillTemplate(tokens) {
  return TEMPLATE.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : ''
  );
}

function articleUrl(article, suffix) {
  return '/articles/' + encodeURIComponent(article.slug) + (suffix || '');
}

function buildContent(article) {
  const slug = encodeURIComponent(article.slug);
  const isPdf = article.primaryFormat === 'pdf' && article.pdf;
  const parts = [];

  if (isPdf) {
    const viewer =
      '/assets/vendor/pdfjs/web/viewer.html?file=' +
      encodeURIComponent('/articles/' + slug + '.pdf');
    parts.push(
      '<div class="article__pdf">',
      '<div class="pdf-frame" data-viewer="' + escapeHtml(viewer) + '" data-pdf="' + escapeHtml(articleUrl(article, '.pdf')) + '">',
      '<button class="pdf-frame__open" type="button">Read the PDF edition</button>',
      '<p class="pdf-frame__hint">Loaded on demand in the PDF.js viewer.</p>',
      '</div>',
      '<div class="article__attachments">',
      '<a class="article__attachment" href="' + escapeHtml(articleUrl(article, '.pdf')) + '" download>Download PDF</a>',
      article.body
        ? '<a class="article__attachment" href="' +
          escapeHtml(articleUrl(article, '.md')) +
          '" download>Download Markdown</a>'
        : '',
      '</div>',
      '</div>'
    );
  } else if (article.body) {
    parts.push('<div class="article__body">', renderMarkdown(article.body), '</div>');
    if (article.pdf) {
      parts.push(
        '<div class="article__attachments">',
        '<a class="article__attachment" href="' + escapeHtml(articleUrl(article, '.pdf')) + '" download>Download PDF edition</a>',
        '</div>'
      );
    }
  } else {
    parts.push('<p class="article__empty">This article is being prepared.</p>');
  }

  return parts.join('\n');
}

function renderArticlePage(article, site) {
  const page = site && site.page ? site.page : {};
  const title = article.title + ' — Pure Chaos';
  const description = String(article.summary || page.lead || '').slice(0, 300);
  const metaParts = [];
  const date = formatDate(article.date);
  if (date) metaParts.push(date);
  metaParts.push(article.primaryFormat === 'pdf' && article.pdf ? 'PDF edition' : 'Article');

  const cover = article.cover
    ? '<figure class="article__cover"><img src="/' +
      escapeHtml(String(article.cover).replace(/^\/+/, '')) +
      '" alt="" loading="lazy" decoding="async"></figure>'
    : '';

  return fillTemplate({
    TITLE: escapeHtml(title),
    DESCRIPTION: escapeHtml(description),
    KICKER: escapeHtml(page.kicker || 'Articles'),
    ARTICLE_TITLE: escapeHtml(article.title),
    META_LINE: escapeHtml(metaParts.join(' · ')),
    COVER: cover,
    CONTENT: buildContent(article),
  });
}

function renderArticleNotFound(site) {
  const page = site && site.page ? site.page : {};
  return fillTemplate({
    TITLE: 'Article not found — Pure Chaos',
    DESCRIPTION: 'This article does not exist or is not published.',
    KICKER: escapeHtml(page.kicker || 'Articles'),
    ARTICLE_TITLE: 'Article not found',
    META_LINE: '404',
    COVER: '',
    CONTENT:
      '<p class="article__empty">This article does not exist or has not been published yet.</p>',
  });
}

module.exports = { renderArticlePage, renderArticleNotFound, formatDate, escapeHtml };
