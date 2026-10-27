# Admin & content server

The site is still a static website, but the **brands** and **articles** pages are
data-driven and editable from a small browser admin at `/admin`. One zero-runtime
dependency Node server (`server.js`) serves the site, stores the content as JSON
and renders article pages on demand.

## Run it

```bash
cd "pure-chaos 2"
node server.js            # or: npm start
```

The server prints the site, admin and data paths. Open `/admin`, paste the admin
token, and edit. Without `ADMIN_TOKEN` the token is random on every start:

```bash
ADMIN_TOKEN="choose-a-long-random-token" PORT=3000 node server.js
```

On this Mac the server is also installed as a launchd agent
(`~/Library/LaunchAgents/com.purechaos.brands.plist`), so it starts at login and
restarts itself if it crashes. See "Managing the service" below.

## Admin layout

- Left sidebar with **Brands** and **Articles**; drag the divider to resize it,
  collapse it to an icon rail, or open it as a drawer on mobile. The width and
  collapsed state are remembered in `localStorage`.
- Each section has its own page header and list; one **save** button writes every
  dirty section.
- **reload** discards unsaved changes; **lock** clears the token from the tab.
- The token is stored in `sessionStorage` only and sent as a Bearer token for
  writes. Reading the public content does not need it.

## Brands

- Edit the page title/intro, add/remove/reorder brands, edit name, description,
  link, logo path and logo scale.
- Logos can be uploaded (SVG/PNG/JPG/WebP/GIF, max 2 MB) and are stored under
  `assets/uploads/`.

## Articles

Statuses: `draft` (admin only), `in-the-works` (shown on the listing but not
clickable) and `published` (visible and readable).

### Writing workflow (Obsidian → admin)

1. **+ add article**, then fill title, slug (auto from title, editable), status,
   date (defaults to today), summary.
2. **upload .md** — the server parses the file, strips YAML frontmatter, and
   fills title/slug/date/summary from it when they are empty. The normalised body
   is previewed in the editor.
3. **upload cover** (optional) and **upload PDF** (optional).
4. Pick the **primary format**: `markdown`, `pdf`, or a **self-contained HTML
   file**. Only the primary is rendered on the article page; the other formats
   are offered as download links.
5. **save** (whole document, optimistic `revision` check).

Supported Markdown: CommonMark/GFM via vendored `markdown-it` + footnotes + task
lists — headings, bold/italic, links, lists, tables, blockquotes, code, rules,
remote `https://` images, inline HTML, footnotes. YAML frontmatter keys read by
the importer: `title`, `slug`, `date`, `summary`/`description`, `status`,
`cover`/`image`, `primary`/`format`.

Obsidian-only syntax gets a small compatibility pass: `[[wikilink]]` becomes its
label, `![[embed]]` is removed, callouts become blockquotes, and `%%comments%%`
are stripped. Plugin-specific syntax (Dataview, Mermaid, etc.) is intentionally
out of scope and renders as plain text — a separate project will handle it.

The Markdown body is stored inside `data/articles.json`; PDFs and covers stay
as files under `assets/uploads/articles/`; self-contained HTML articles live in
`data/articles/html/`. **Uploaded files are never deleted
automatically** — deleting an article only removes its JSON entry.

### HTML articles (self-contained)

The third primary format is a **single standalone HTML file** — all CSS and JS
must live inside that file. When `primaryFormat` is `html`:

- `/articles/<slug>` serves the uploaded file as the **whole page** (the site's
  nav/footer/styles are not added; the file owns the document).
- The file is stored under `data/articles/html/` and is never exposed as a
  plain static file.
- The response is sandboxed with
  `Content-Security-Policy: sandbox allow-scripts allow-popups allow-forms allow-modals allow-downloads`.
  Its scripts run, but it cannot read cookies, `localStorage`/`sessionStorage`, or
  the admin token, and cannot call the site's API with same-origin credentials.
- In the admin, the **upload .html** button stores the file, switches the primary
  format to HTML, and shows a sandboxed preview; **preview** re-renders the saved
  file. `.html` is also downloadable at `/articles/<slug>.html`.
- Relative URLs inside the file resolve under `/articles/…`. Inline assets
  (data URIs), absolute URLs, or no external assets at all are recommended.

### Public pages

| URL | Behaviour |
| --- | --- |
| `articles.html` | card grid, rendered from `/api/articles` when served by Node (static fallback for `file://`) |
| `/articles/<slug>` | server-rendered reading page (Markdown or PDF primary) |
| `/articles/<slug>.md` | Markdown download |
| `/articles/<slug>.pdf` | PDF, with HTTP Range support |

PDFs are shown with a locally vendored **PDF.js** viewer (lazy-loaded, dark
themed). If the viewer is unavailable the browser's native PDF viewer is used as
a fallback. PDF content is not rendered on the listing page — only the card.

## Data files

| File | Contents |
| --- | --- |
| `data/brands.json` | brands page content |
| `data/articles.json` | articles page content + article bodies |
| `data/backups/` | timestamped copies of the previous document on every save (last 20 per file, gitignored) |
| `assets/uploads/` | brand logos |
| `assets/uploads/articles/` | covers and PDFs |
| `data/articles/html/` | self-contained HTML article files (served through the sandboxed article route) |

Writes are atomic (`.tmp` + rename) and revision-checked; a conflicting save gets
`409 conflict`.

## API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/brands` | no | read brands document |
| PUT | `/api/brands` | token | replace brands document |
| GET | `/api/articles` | token for full view | public view excludes drafts and bodies |
| PUT | `/api/articles` | token | replace articles document |
| POST | `/api/articles/import` | token | parse uploaded Markdown (`{ filename, text }`) |
| POST | `/api/articles/upload` | token | upload cover / PDF / HTML (`{ kind, filename, data }`) |
| GET | `/api/articles/html?path=…` | token | read an uploaded HTML file for the admin preview |
| POST | `/api/preview` | token | render Markdown preview (`{ markdown }`) |
| GET | `/api/auth` | token | validate the token |
| POST | `/api/upload` | token | brand logo upload |

Limits: Markdown import 2 MB, body 512 KB, cover 8 MB, PDF 25 MB, HTML file
8 MB, 200 articles, 40 brands. Uploads are restricted to image types or `application/pdf` (PDF magic
bytes checked).

## Vendored libraries

| Library | Version | License | Location |
| --- | --- | --- | --- |
| PDF.js | 6.4.299 | Apache-2.0 | `assets/vendor/pdfjs/` |
| markdown-it | 15.0.3 | MIT | `assets/vendor/markdown-it/markdown-it.umd.min.js` |
| markdown-it-footnote | 4.0.0 | MIT | `assets/vendor/markdown-it/markdown-it-footnote.umd.js` |
| markdown-it-task-lists | 2.1.1 | ISC | `assets/vendor/markdown-it/markdown-it-task-lists.umd.js` |

License texts are kept next to the files. The PDF.js bundle adds roughly 8 MB to
the repository; it is only loaded on article pages that show a PDF.

## Managing the service (launchd)

```bash
# status / restart
launchctl print gui/$(id -u)/com.purechaos.brands | head
launchctl kickstart -k gui/$(id -u)/com.purechaos.brands

# stop until next login
launchctl bootout gui/$(id -u)/com.purechaos.brands

# start again
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.purechaos.brands.plist

# read the fixed token
plutil -extract EnvironmentVariables.ADMIN_TOKEN raw ~/Library/LaunchAgents/com.purechaos.brands.plist

# logs
tail -f ~/Library/Logs/purechaos-brands.log
```

The plist points at the nvm Node binary (`v20.20.2`); update `ProgramArguments`
if that Node version is removed.

## Security notes

- The server binds to `127.0.0.1` only. Do not expose it directly to the
  internet; use a TLS reverse proxy with authentication if ever hosted.
- Keep the token out of URLs, commits and public screenshots. `data/` and
  `data/backups/` are never served over HTTP.
- Drafts are not exposed by `/api/articles` unless the request is authenticated.
- Article HTML comes from the trusted admin, so inline HTML is allowed without a
  sanitiser; add one before allowing third-party authors. Uploaded standalone
  HTML pages are additionally sandboxed (opaque origin, no site storage/API
  access) when served.
- Uploaded PDFs and covers are validated by type/size but not virus-scanned.
