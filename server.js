#!/usr/bin/env node
'use strict';

/*
 * Pure Chaos — content server
 * ---------------------------
 * Static site + a small JSON API for the admin:
 *
 *   GET/PUT  /api/brands            brands page content (write needs token)
 *   GET/PUT  /api/articles          article document (full view needs token)
 *   POST     /api/articles/import   parse an uploaded Markdown file (token)
 *   POST     /api/articles/upload   cover image / PDF upload (token)
 *   POST     /api/preview           render Markdown preview (token)
 *   GET      /api/auth              200 when the token is valid
 *   POST     /api/upload            brand logo upload (token)
 *
 * Public article routes:
 *   GET /articles/<slug>            rendered article page
 *   GET /articles/<slug>.md         Markdown download
 *   GET /articles/<slug>.pdf        PDF (HTTP Range supported)
 *
 * Zero runtime dependencies: Node built-ins plus vendored static assets.
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');

const { analyzeImport, renderMarkdown, slugify, normalizeDate, normalizeStatus } = require('./lib/markdown');
const { renderArticlePage, renderArticleNotFound } = require('./lib/article-page');

const ROOT = __dirname;
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomBytes(18).toString('hex');
const TOKEN_HASH = crypto.createHash('sha256').update(ADMIN_TOKEN, 'utf8').digest();

const DATA_DIR = path.join(ROOT, 'data');
const BRANDS_FILE = path.join(DATA_DIR, 'brands.json');
const ARTICLES_FILE = path.join(DATA_DIR, 'articles.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const UPLOAD_DIR = path.join(ROOT, 'assets', 'uploads');
const ARTICLE_UPLOAD_DIR = path.join(UPLOAD_DIR, 'articles');

const MAX_JSON = 1 * 1024 * 1024;            // brands document
const MAX_ARTICLES_JSON = 6 * 1024 * 1024;   // article document (bodies included)
const MAX_MARKDOWN = 2 * 1024 * 1024;        // uploaded .md
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_COVER_BYTES = 8 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_ARTICLE_BODY = 512 * 1024;
const ARTICLE_STATUSES = new Set(['draft', 'in-the-works', 'published']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pfb': 'application/octet-stream',
  '.bcmap': 'application/octet-stream',
  '.icc': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.ftl': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.map': 'application/json; charset=utf-8',
};

const ARTICLE_EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
};

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function authOk(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  const hash = crypto.createHash('sha256').update(match[1], 'utf8').digest();
  return hash.length === TOKEN_HASH.length && crypto.timingSafeEqual(hash, TOKEN_HASH);
}

function requireAuth(req, res) {
  if (authOk(req)) return true;
  sendJson(res, 401, { error: 'unauthorized' });
  return false;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(httpError(413, 'request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseJson(buf) {
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw httpError(400, 'invalid JSON');
  }
}

function asText(value, max) {
  return typeof value === 'string'
    ? value.replace(/\r\n?/g, '\n').trim().slice(0, max)
    : '';
}

function asSlug(value, fallback) {
  return slugify(value, fallback || 'item');
}

function uniqueSlug(base, seen) {
  let slug = base;
  let n = 2;
  while (seen.has(slug)) slug = base + '-' + n++;
  seen.add(slug);
  return slug;
}

function safeUploadPath(relPath) {
  const abs = path.resolve(ROOT, relPath);
  return abs === ROOT || abs.startsWith(ROOT + path.sep) ? abs : null;
}

/* ------------------------------------------------------------------ */
/* document validation                                                */
/* ------------------------------------------------------------------ */

function validateBrandsDoc(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw httpError(400, 'document must be an object');
  }

  const pageIn = input.page && typeof input.page === 'object' ? input.page : {};
  const page = {
    title: asText(pageIn.title, 120) || 'Meet our brands.',
    intro: asText(pageIn.intro, 500),
  };

  const list = Array.isArray(input.brands) ? input.brands : [];
  if (list.length > 40) throw httpError(400, 'too many brands (max 40)');

  const seen = new Set();
  const brands = list.map((brand, index) => {
    if (!brand || typeof brand !== 'object') throw httpError(400, 'brand must be an object');

    const name = asText(brand.name, 80);
    if (!name) throw httpError(400, 'brand name is required');

    const id = uniqueSlug(asSlug(brand.id || name, 'brand-' + (index + 1)), seen);

    const logo = asText(brand.logo, 300);
    if (logo && !/^assets\/(?!\.\.)[\w./ -]+\.(svg|png|jpe?g|webp|gif)$/i.test(logo)) {
      throw httpError(400, 'logo must be a file under assets/ (svg, png, jpg, webp or gif)');
    }

    const url = asText(brand.url, 500);
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) {
      throw httpError(400, 'brand link must start with http:// or https://');
    }

    const scale = Number(brand.logoScale);
    const order = Number(brand.order);

    return {
      id,
      name,
      description: asText(brand.description, 400),
      logo,
      logoScale: Number.isFinite(scale) ? Math.min(2, Math.max(0.4, Math.round(scale * 100) / 100)) : 1,
      url,
      order: Number.isFinite(order) ? order : index + 1,
    };
  });

  brands.sort((a, b) => a.order - b.order).forEach((brand, index) => { brand.order = index + 1; });

  return { page, brands };
}

function validateArticleUploadPath(value, kind) {
  const pattern = kind === 'pdf'
    ? /^assets\/uploads\/articles\/[A-Za-z0-9._-]+\.pdf$/
    : /^assets\/uploads\/articles\/[A-Za-z0-9._-]+\.(png|jpe?g|webp|gif|svg)$/;
  const text = asText(value, 300);
  if (text && !pattern.test(text)) {
    throw httpError(400, kind === 'pdf' ? 'invalid PDF path' : 'invalid cover image path');
  }
  return text;
}

function validateArticlesDoc(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw httpError(400, 'document must be an object');
  }

  const pageIn = input.page && typeof input.page === 'object' ? input.page : {};
  const page = {
    kicker: asText(pageIn.kicker, 80) || 'Articles',
    title: asText(pageIn.title, 160) || 'Articles',
    lead: asText(pageIn.lead, 600),
    note: asText(pageIn.note, 300),
  };

  const list = Array.isArray(input.articles) ? input.articles : [];
  if (list.length > 200) throw httpError(400, 'too many articles (max 200)');

  const seenIds = new Set();
  const seenSlugs = new Set();
  const now = new Date().toISOString();

  const articles = list.map((article, index) => {
    if (!article || typeof article !== 'object') throw httpError(400, 'article must be an object');

    const title = asText(article.title, 160);
    if (!title) throw httpError(400, 'article title is required');

    const id = uniqueSlug(asSlug(article.id || article.slug || title, 'article-' + (index + 1)), seenIds);
    const slug = uniqueSlug(asSlug(article.slug || title, 'article-' + (index + 1)), seenSlugs);

    const status = ARTICLE_STATUSES.has(article.status) ? article.status : 'draft';
    const date = normalizeDate(article.date);
    const cover = validateArticleUploadPath(article.cover, 'cover');
    const pdf = validateArticleUploadPath(article.pdf, 'pdf');
    const body = typeof article.body === 'string'
      ? article.body.replace(/\r\n?/g, '\n').slice(0, MAX_ARTICLE_BODY).trim()
      : '';
    const summary = asText(article.summary, 500);
    const sourceName = asText(article.sourceName, 200);
    const primaryFormat = article.primaryFormat === 'pdf' && pdf ? 'pdf' : 'markdown';
    const createdAt = /^\d{4}-\d{2}-\d{2}T/.test(String(article.createdAt || '')) ? article.createdAt : now;

    return {
      id,
      slug,
      title,
      summary,
      status,
      date,
      cover,
      pdf,
      body,
      sourceName,
      primaryFormat,
      createdAt,
      updatedAt: now,
    };
  });

  return { page, articles };
}

/* ------------------------------------------------------------------ */
/* storage                                                            */
/* ------------------------------------------------------------------ */

const EMPTY_BRANDS = () => ({ revision: 0, page: { title: 'Meet our brands.', intro: '' }, brands: [] });
const EMPTY_ARTICLES = () => ({ revision: 0, page: { kicker: 'Articles', title: 'Articles', lead: '', note: '' }, articles: [] });

async function readJson(file, fallback) {
  try {
    const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : fallback();
  } catch {
    return fallback();
  }
}

const readBrands = () => readJson(BRANDS_FILE, EMPTY_BRANDS);
const readArticles = () => readJson(ARTICLES_FILE, EMPTY_ARTICLES);

async function pruneBackups(prefix) {
  try {
    const files = (await fsp.readdir(BACKUP_DIR)).filter((f) => f.startsWith(prefix + '-')).sort();
    while (files.length > 20) {
      await fsp.unlink(path.join(BACKUP_DIR, files.shift())).catch(() => {});
    }
  } catch { /* no backups yet */ }
}

async function writeJson(file, next, previous, prefix) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  if (previous) {
    await fsp.mkdir(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fsp.writeFile(
      path.join(BACKUP_DIR, prefix + '-' + stamp + '.json'),
      JSON.stringify(previous, null, 2) + '\n',
      'utf8'
    );
    await pruneBackups(prefix);
  }
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  await fsp.rename(tmp, file);
}

function findArticleBySlug(doc, slug) {
  return (doc.articles || []).find((article) => article.slug === slug) || null;
}

function publicArticles(doc) {
  return {
    revision: doc.revision,
    updatedAt: doc.updatedAt,
    page: doc.page,
    articles: (doc.articles || [])
      .filter((article) => article.status !== 'draft')
      .map((article) => ({
        id: article.id,
        slug: article.slug,
        title: article.title,
        summary: article.summary,
        status: article.status,
        date: article.date,
        cover: article.cover,
        primaryFormat: article.primaryFormat,
        hasPdf: Boolean(article.pdf),
        updatedAt: article.updatedAt,
      })),
  };
}

/* ------------------------------------------------------------------ */
/* file serving                                                       */
/* ------------------------------------------------------------------ */

function resolveStatic(pathname) {
  let rel = pathname;
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/admin') rel = '/admin.html';
  rel = rel.replace(/^\/+/, '');

  // never expose content drafts, backups or logs
  if (
    !rel ||
    rel.startsWith('.') ||
    rel === 'data' ||
    rel.startsWith('data/') ||
    rel === 'lib' ||
    rel.startsWith('lib/') ||
    rel === 'templates' ||
    rel.startsWith('templates/') ||
    rel === 'logs' ||
    rel.startsWith('logs/')
  ) {
    return null;
  }

  const abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  return abs;
}

function cacheControl(relPath) {
  if (
    relPath.startsWith('assets/vendor/') ||
    relPath.startsWith('assets/fonts/') ||
    relPath.startsWith('assets/uploads/')
  ) {
    return 'public, max-age=3600';
  }
  return 'no-store';
}

async function serveStatic(req, res, pathname) {
  const rel = pathname.replace(/^\/+/, '');
  let abs = resolveStatic(pathname);
  if (!abs) return sendJson(res, 404, { error: 'not found' });

  let stat;
  try {
    stat = await fsp.stat(abs);
  } catch {
    return sendJson(res, 404, { error: 'not found' });
  }

  if (stat.isDirectory()) {
    abs = path.join(abs, 'index.html');
    try {
      stat = await fsp.stat(abs);
    } catch {
      return sendJson(res, 404, { error: 'not found' });
    }
  }

  const type = MIME[path.extname(abs).toLowerCase()];
  if (!type) return sendJson(res, 404, { error: 'not found' });

  if (req.method === 'HEAD') {
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Last-Modified': stat.mtime.toUTCString(),
      'Cache-Control': cacheControl(rel),
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end();
  }

  const body = await fsp.readFile(abs);
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': body.length,
    'Last-Modified': stat.mtime.toUTCString(),
    'Cache-Control': cacheControl(rel),
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

async function serveFileRange(req, res, abs, type, extraHeaders) {
  let stat;
  try {
    stat = await fsp.stat(abs);
  } catch {
    return sendJson(res, 404, { error: 'not found' });
  }
  if (!stat.isFile()) return sendJson(res, 404, { error: 'not found' });

  const size = stat.size;
  const range = req.headers.range;
  const baseHeaders = Object.assign(
    {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
    extraHeaders || {}
  );

  if (!range) {
    res.writeHead(200, Object.assign({ 'Content-Length': size }, baseHeaders));
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(abs).pipe(res);
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
  if (!match || (match[1] === '' && match[2] === '')) {
    res.writeHead(416, { 'Content-Range': 'bytes */' + size });
    return res.end();
  }

  let start = match[1] === '' ? null : Number(match[1]);
  let end = match[2] === '' ? null : Number(match[2]);
  if (start === null) {
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (end === null || end >= size) {
    end = size - 1;
  }
  if (start > end || start >= size) {
    res.writeHead(416, { 'Content-Range': 'bytes */' + size });
    return res.end();
  }

  res.writeHead(206, Object.assign({
    'Content-Length': end - start + 1,
    'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
  }, baseHeaders));
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(abs, { start, end }).pipe(res);
}

/* ------------------------------------------------------------------ */
/* article routes                                                     */
/* ------------------------------------------------------------------ */

async function handleArticlePage(res, slug) {
  const doc = await readArticles();
  const article = findArticleBySlug(doc, slug);
  if (!article || article.status !== 'published') {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(renderArticleNotFound(doc));
  }
  const html = renderArticlePage(article, doc);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

async function handleArticleDownload(res, slug, suffix) {
  const doc = await readArticles();
  const article = findArticleBySlug(doc, slug);
  if (!article || article.status !== 'published') return sendJson(res, 404, { error: 'not found' });

  if (suffix === '.md') {
    if (!article.body) return sendJson(res, 404, { error: 'not found' });
    const payload = Buffer.from(article.body + '\n', 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Length': payload.length,
      'Content-Disposition': 'attachment; filename="' + article.slug + '.md"',
      'Cache-Control': 'no-store',
    });
    return res.end(payload);
  }

  if (!article.pdf) return sendJson(res, 404, { error: 'not found' });
  const abs = safeUploadPath(article.pdf);
  if (!abs) return sendJson(res, 404, { error: 'not found' });
  return serveFileRange(res.req, res, abs, 'application/pdf');
}

/* ------------------------------------------------------------------ */
/* server                                                             */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return sendJson(res, 400, { error: 'bad path' });
    }

    /* ---- brands API ---- */
    if (pathname === '/api/brands') {
      if (req.method === 'GET') return sendJson(res, 200, await readBrands());
      if (req.method === 'PUT') {
        if (!requireAuth(req, res)) return;
        const body = parseJson(await readBody(req, MAX_JSON));
        const current = await readBrands();
        if (body.revision != null && Number(body.revision) !== Number(current.revision)) {
          return sendJson(res, 409, { error: 'conflict', revision: current.revision });
        }
        const normalized = validateBrandsDoc(body);
        const next = {
          revision: (Number(current.revision) || 0) + 1,
          updatedAt: new Date().toISOString(),
          page: normalized.page,
          brands: normalized.brands,
        };
        await writeJson(BRANDS_FILE, next, current, 'brands');
        return sendJson(res, 200, next);
      }
      return sendJson(res, 405, { error: 'method not allowed' });
    }

    /* ---- articles API ---- */
    if (pathname === '/api/articles') {
      if (req.method === 'GET') {
        const doc = await readArticles();
        return sendJson(res, 200, authOk(req) ? doc : publicArticles(doc));
      }
      if (req.method === 'PUT') {
        if (!requireAuth(req, res)) return;
        const body = parseJson(await readBody(req, MAX_ARTICLES_JSON));
        const current = await readArticles();
        if (body.revision != null && Number(body.revision) !== Number(current.revision)) {
          return sendJson(res, 409, { error: 'conflict', revision: current.revision });
        }
        const normalized = validateArticlesDoc(body);
        const next = {
          revision: (Number(current.revision) || 0) + 1,
          updatedAt: new Date().toISOString(),
          page: normalized.page,
          articles: normalized.articles,
        };
        await writeJson(ARTICLES_FILE, next, current, 'articles');
        return sendJson(res, 200, next);
      }
      return sendJson(res, 405, { error: 'method not allowed' });
    }

    if (pathname === '/api/articles/import') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      if (!requireAuth(req, res)) return;
      const body = parseJson(await readBody(req, MAX_MARKDOWN + 64 * 1024));
      if (typeof body.text !== 'string') return sendJson(res, 400, { error: 'missing Markdown text' });
      if (Buffer.byteLength(body.text, 'utf8') > MAX_MARKDOWN) {
        return sendJson(res, 413, { error: 'Markdown too large (max 2 MB)' });
      }
      return sendJson(res, 200, analyzeImport(body.filename, body.text));
    }

    if (pathname === '/api/articles/upload') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      if (!requireAuth(req, res)) return;
      const body = parseJson(await readBody(req, MAX_PDF_BYTES * 1.4 + 1024 * 1024));
      const kind = body.kind === 'pdf' ? 'pdf' : 'cover';
      const match = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(String(body.data || ''));
      if (!match) return sendJson(res, 400, { error: 'invalid upload data' });

      const mime = match[1].toLowerCase();
      const ext = ARTICLE_EXTENSIONS[mime];
      if (!ext) return sendJson(res, 400, { error: 'unsupported file type' });
      if (kind === 'pdf' && ext !== 'pdf') return sendJson(res, 400, { error: 'expected a PDF' });
      if (kind === 'cover' && ext === 'pdf') return sendJson(res, 400, { error: 'expected an image' });

      const bytes = Buffer.from(match[2], 'base64');
      const limit = kind === 'pdf' ? MAX_PDF_BYTES : MAX_COVER_BYTES;
      if (bytes.length === 0) return sendJson(res, 400, { error: 'empty file' });
      if (bytes.length > limit) {
        return sendJson(res, 413, { error: 'file too large (max ' + Math.round(limit / 1024 / 1024) + ' MB)' });
      }
      if (kind === 'pdf' && bytes.slice(0, 5).toString('latin1') !== '%PDF-') {
        return sendJson(res, 400, { error: 'file is not a valid PDF' });
      }

      await fsp.mkdir(ARTICLE_UPLOAD_DIR, { recursive: true });
      const base = asSlug(body.filename ? path.parse(String(body.filename)).name : kind, kind);
      const name = base + '-' + crypto.randomBytes(4).toString('hex') + '.' + ext;
      await fsp.writeFile(path.join(ARTICLE_UPLOAD_DIR, name), bytes);
      return sendJson(res, 201, {
        path: 'assets/uploads/articles/' + name,
        size: bytes.length,
        kind,
      });
    }

    if (pathname === '/api/preview') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      if (!requireAuth(req, res)) return;
      const body = parseJson(await readBody(req, MAX_MARKDOWN + 64 * 1024));
      if (typeof body.markdown !== 'string') return sendJson(res, 400, { error: 'missing markdown' });
      if (Buffer.byteLength(body.markdown, 'utf8') > MAX_MARKDOWN) {
        return sendJson(res, 413, { error: 'Markdown too large (max 2 MB)' });
      }
      return sendJson(res, 200, { html: renderMarkdown(body.markdown) });
    }

    if (pathname === '/api/auth') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
      return authOk(req) ? sendJson(res, 200, { ok: true }) : sendJson(res, 401, { error: 'unauthorized' });
    }

    if (pathname === '/api/upload') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      if (!requireAuth(req, res)) return;
      const body = parseJson(await readBody(req, MAX_LOGO_BYTES * 1.5 + 1024 * 1024));
      const match = /^data:(image\/(?:svg\+xml|png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=]+)$/i.exec(String(body.data || ''));
      if (!match) return sendJson(res, 400, { error: 'invalid image data' });

      const extMap = { 'image/svg+xml': 'svg', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
      const ext = extMap[match[1].toLowerCase()] || 'png';
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.length === 0) return sendJson(res, 400, { error: 'empty image' });
      if (bytes.length > MAX_LOGO_BYTES) return sendJson(res, 413, { error: 'image too large (max 2 MB)' });

      await fsp.mkdir(UPLOAD_DIR, { recursive: true });
      const base = asSlug(body.filename ? path.parse(String(body.filename)).name : 'brand-logo', 'brand-logo');
      const name = base + '-' + crypto.randomBytes(4).toString('hex') + '.' + ext;
      await fsp.writeFile(path.join(UPLOAD_DIR, name), bytes);
      return sendJson(res, 201, { path: 'assets/uploads/' + name });
    }

    /* ---- public article routes ---- */
    if (pathname === '/articles') {
      res.writeHead(302, { Location: '/articles.html' });
      return res.end();
    }

    const articleMatch = /^\/articles\/([A-Za-z0-9-]+)(\.md|\.pdf)?$/.exec(pathname);
    if (articleMatch) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { error: 'method not allowed' });
      }
      const slug = articleMatch[1];
      const suffix = articleMatch[2] || '';
      if (!suffix) return handleArticlePage(res, slug);
      return handleArticleDownload(res, slug, suffix);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'method not allowed' });
    }

    return serveStatic(req, res, pathname);
  } catch (error) {
    const status = Number(error.status) || 500;
    if (status >= 500) console.error('[server]', error);
    if (!res.headersSent) sendJson(res, status, { error: status >= 500 ? 'server error' : error.message });
  }
});

server.listen(PORT, HOST, () => {
  const base = 'http://' + HOST + ':' + PORT;
  console.log('');
  console.log('  Pure Chaos — content server');
  console.log('  ----------------------------------------');
  console.log('  Site:     ' + base + '/index.html');
  console.log('  Brands:   ' + base + '/brands.html');
  console.log('  Articles: ' + base + '/articles.html');
  console.log('  Admin:    ' + base + '/admin');
  if (process.env.ADMIN_TOKEN) {
    console.log('  Token:    (read from ADMIN_TOKEN)');
  } else {
    console.log('  Token:    ' + ADMIN_TOKEN);
    console.log('            (set ADMIN_TOKEN=... to use a fixed token)');
  }
  console.log('  Data:     data/brands.json, data/articles.json');
  console.log('  Backups:  data/backups/');
  console.log('');
});

server.on('error', (error) => {
  console.error('[server]', error.message);
  process.exitCode = 1;
});
