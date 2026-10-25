#!/usr/bin/env node
'use strict';

/*
 * Pure Chaos — brands content server
 * ----------------------------------
 * Serves the static site and exposes a tiny JSON API so the brands page can be
 * managed from /admin without editing HTML:
 *
 *   GET  /api/brands     -> { revision, updatedAt, page, brands }
 *   PUT  /api/brands     -> replace the document (requires admin token)
 *   GET  /api/auth       -> 200 when the token is valid
 *   POST /api/upload     -> save a brand logo under assets/uploads/ (token)
 *
 * Zero dependencies: Node's built-in http/fs only. Run `node server.js`
 * (or `npm start`) and open the printed URL. Writes are atomic and every save
 * keeps a timestamped copy under data/backups/.
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomBytes(18).toString('hex');
const TOKEN_HASH = crypto.createHash('sha256').update(ADMIN_TOKEN, 'utf8').digest();

const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'brands.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const UPLOAD_DIR = path.join(ROOT, 'assets', 'uploads');

const MAX_JSON = 1 * 1024 * 1024;   // 1 MB for the content document
const MAX_UPLOAD = 4 * 1024 * 1024; // 4 MB for a logo upload
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

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
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
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
  const slug = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || fallback;
}

/* ------------------------------------------------------------------ */
/* document validation                                                */
/* ------------------------------------------------------------------ */

function validateDoc(input) {
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

    let id = asSlug(brand.id || name, 'brand-' + (index + 1));
    let unique = id;
    let n = 2;
    while (seen.has(unique)) unique = id + '-' + n++;
    seen.add(unique);

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
      id: unique,
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

/* ------------------------------------------------------------------ */
/* storage                                                            */
/* ------------------------------------------------------------------ */

const EMPTY_DOC = () => ({
  revision: 0,
  page: { title: 'Meet our brands.', intro: '' },
  brands: [],
});

async function readData() {
  try {
    const raw = await fsp.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY_DOC();
    return parsed;
  } catch {
    return EMPTY_DOC();
  }
}

async function pruneBackups() {
  try {
    const files = (await fsp.readdir(BACKUP_DIR)).filter((f) => f.startsWith('brands-')).sort();
    while (files.length > 20) {
      await fsp.unlink(path.join(BACKUP_DIR, files.shift())).catch(() => {});
    }
  } catch { /* no backups yet */ }
}

async function writeData(next, previous) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  if (previous) {
    await fsp.mkdir(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fsp.writeFile(path.join(BACKUP_DIR, 'brands-' + stamp + '.json'), JSON.stringify(previous, null, 2) + '\n', 'utf8');
    await pruneBackups();
  }
  const tmp = DATA_FILE + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  await fsp.rename(tmp, DATA_FILE);
}

/* ------------------------------------------------------------------ */
/* static files                                                       */
/* ------------------------------------------------------------------ */

function resolveStatic(pathname) {
  let rel = pathname;
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/admin') rel = '/admin.html';
  rel = rel.replace(/^\/+/, '');

  // never expose internals, backups or logs
  if (!rel || rel.startsWith('.') || rel.startsWith('data/backups') || rel === 'logs' || rel.startsWith('logs/')) {
    return null;
  }

  const abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  return abs;
}

async function serveStatic(req, res, pathname) {
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

  const body = await fsp.readFile(abs);
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': body.length,
    'Last-Modified': stat.mtime.toUTCString(),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') res.end();
  else res.end(body);
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

    /* ---- API ---- */
    if (pathname === '/api/brands') {
      if (req.method === 'GET') {
        return sendJson(res, 200, await readData());
      }
      if (req.method === 'PUT') {
        if (!requireAuth(req, res)) return;
        const body = parseJson(await readBody(req, MAX_JSON));
        const current = await readData();
        if (body.revision != null && Number(body.revision) !== Number(current.revision)) {
          return sendJson(res, 409, { error: 'conflict', revision: current.revision });
        }
        const normalized = validateDoc(body);
        const next = {
          revision: (Number(current.revision) || 0) + 1,
          updatedAt: new Date().toISOString(),
          page: normalized.page,
          brands: normalized.brands,
        };
        await writeData(next, current);
        return sendJson(res, 200, next);
      }
      return sendJson(res, 405, { error: 'method not allowed' });
    }

    if (pathname === '/api/auth') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
      return authOk(req) ? sendJson(res, 200, { ok: true }) : sendJson(res, 401, { error: 'unauthorized' });
    }

    if (pathname === '/api/upload') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      if (!requireAuth(req, res)) return;
      const body = parseJson(await readBody(req, MAX_UPLOAD));
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
  console.log('  Pure Chaos — brands server');
  console.log('  ----------------------------------------');
  console.log('  Site:   ' + base + '/brands.html');
  console.log('  Admin:  ' + base + '/admin');
  if (process.env.ADMIN_TOKEN) {
    console.log('  Token:  (read from ADMIN_TOKEN)');
  } else {
    console.log('  Token:  ' + ADMIN_TOKEN);
    console.log('          (set ADMIN_TOKEN=... to use a fixed token)');
  }
  console.log('  Data:   data/brands.json  (backups in data/backups/)');
  console.log('');
});

server.on('error', (error) => {
  console.error('[server]', error.message);
  process.exitCode = 1;
});
