# Brands admin (Node.js)

The brands page is now data-driven: its content lives in `data/brands.json` and
can be edited from a small browser admin at `/admin` instead of editing
`brands.html` by hand.

The site itself is still static. When you open `brands.html` from `file://` (or
host it without Node), the fallback markup inside the file is shown; when it is
served by `server.js`, the page is rendered from `data/brands.json`.

## Run it

```bash
cd "pure-chaos 2"
node server.js            # or: npm start
```

The server prints:

```
Site:   http://127.0.0.1:3000/brands.html
Admin:  http://127.0.0.1:3000/admin
Token:  <random token>
```

Open `/admin`, paste the token, and edit. The token is generated on every start
unless you supply one:

```bash
ADMIN_TOKEN="choose-a-long-random-token" PORT=3000 node server.js
```

Only writes require the token; reading the brands page and the JSON is public.

## What you can edit

- the page title and intro line;
- add / delete / reorder brands;
- for each brand: name, description, optional link, logo path, logo scale;
- upload a logo (SVG / PNG / JPG / WebP / GIF, up to 2 MB) — it is stored under
  `assets/uploads/`.

While editing, nothing is written until you press **save**. Every save keeps a
timestamped copy of the previous document in `data/backups/` (last 20 kept).

## Data and API

`data/brands.json`:

```json
{
  "revision": 1,
  "page": { "title": "...", "intro": "..." },
  "brands": [
    {
      "id": "zack",
      "name": "Zack",
      "description": "...",
      "logo": "assets/Zack.svg",
      "logoScale": 1.05,
      "url": "",
      "order": 1
    }
  ]
}
```

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/brands` | no | read the document |
| PUT | `/api/brands` | Bearer token | replace the document (optimistic `revision` check) |
| GET | `/api/auth` | Bearer token | check a token |
| POST | `/api/upload` | Bearer token | save a logo, returns `{ path }` |

The content document is validated on the server (length limits, allowed logo
extensions under `assets/`, http(s)-only links, 40 brands max).

## Security notes

- `server.js` binds to `127.0.0.1` by default. Do not expose it directly to the
  internet — put it behind a TLS reverse proxy with its own authentication if
  this ever moves to a real host.
- Use a long random `ADMIN_TOKEN`; never commit it, never put it in a URL or in
  the git remote.
- Uploads are limited to 2 MB and raster/vector image types; filenames are
  sanitized.
- The admin page is `noindex`, but it is public HTML — only writes are protected.

## Rollback

- Previous documents: `data/backups/brands-*.json`
- Code changes: git history (this feature is committed)
