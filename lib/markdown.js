'use strict';

/*
 * Markdown pipeline for article imports.
 *
 * - standard Markdown / CommonMark via vendored markdown-it
 * - GFM tables, strikethrough, autolinks, footnotes and task lists
 * - Obsidian frontmatter is parsed into article metadata and stripped
 * - common Obsidian-only syntax is normalised so it does not leak raw
 *   brackets into the rendered page (plugin-specific syntax is out of scope)
 */

const MarkdownIt = require('../assets/vendor/markdown-it/markdown-it.umd.min.js');
const footnote = require('../assets/vendor/markdown-it/markdown-it-footnote.umd.js');
const taskLists = require('../assets/vendor/markdown-it/markdown-it-task-lists.umd.js');

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: false,
  breaks: false,
})
  .use(footnote)
  .use(taskLists);

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value === '' || value === '~' || value.toLowerCase() === 'null') return '';
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((item) => unquote(item))
      .filter((item) => item !== '');
  }
  return unquote(value);
}

/**
 * Split YAML frontmatter from the Markdown body.
 * Supports the flat `key: value` shape used by Obsidian properties.
 */
function parseFrontmatter(source) {
  const text = String(source || '').replace(/^\uFEFF/, '');
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return { data: {}, body: text, warnings: [] };

  const data = {};
  const warnings = [];
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon < 0) {
      warnings.push('frontmatter line skipped (no ":"): ' + trimmed.slice(0, 60));
      continue;
    }
    const key = line.slice(0, colon).trim().toLowerCase();
    if (!/^[a-z0-9_-]+$/.test(key)) {
      warnings.push('frontmatter key skipped: ' + key.slice(0, 40));
      continue;
    }
    data[key] = parseScalar(line.slice(colon + 1));
  }
  return { data, body: text.slice(match[0].length), warnings };
}

/**
 * Normalise Obsidian-specific syntax that is not part of standard Markdown.
 * Plugin syntax (dataview, templater, mermaid, etc.) is intentionally left
 * untouched — a separate project will handle those.
 */
function normalizeObsidian(body) {
  let out = String(body || '');

  // Obsidian comments %% ... %%
  out = out.replace(/%%[\s\S]*?%%/g, '');

  // Embeds ![[file.png]] — removed; local vault assets are not published.
  out = out.replace(/!\[\[[^\]]*\]\]/g, '');

  // Wiki links: [[Target|Alias]] -> Alias, [[Target#Heading]] -> Target
  out = out.replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?\|([^\]]+)\]\]/g, '$2');
  out = out.replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?\]\]/g, '$1');

  // Callouts: "> [!note] Title" -> "> **Title**"
  out = out.replace(
    /^(\s*>\s*)\[!([a-zA-Z-]+)\]([+-])?\s*(.*)$/gm,
    (line, prefix, type, fold, title) => {
      const label = title.trim() || type.charAt(0).toUpperCase() + type.slice(1);
      return prefix + '**' + label + '**';
    }
  );

  return out;
}

function renderMarkdown(markdown) {
  return md.render(normalizeObsidian(markdown));
}

function plainText(markdown) {
  return String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[ \t]*[#>*+-]+[ \t]*/gm, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstHeading(markdown) {
  const match = /^#{1,3}[ \t]+(.+)$/m.exec(String(markdown || ''));
  return match ? match[1].trim() : '';
}

function firstParagraph(markdown) {
  const blocks = String(markdown || '')
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  for (const block of blocks) {
    if (/^#{1,6}[ \t]/.test(block)) continue;
    if (/^```/.test(block)) continue;
    if (/^[-*+][ \t]/.test(block) || /^\d+[.)][ \t]/.test(block)) continue;
    return block;
  }
  return blocks[0] || '';
}

function summarize(markdown, max = 200) {
  const text = plainText(firstParagraph(markdown));
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

function slugify(value, fallback) {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback || 'article';
}

function normalizeDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (match) return match[1] + '-' + match[2] + '-' + match[3];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return parsed.getFullYear() + '-' + pad(parsed.getMonth() + 1) + '-' + pad(parsed.getDate());
}

function normalizeStatus(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (raw === 'published' || raw === 'publish' || raw === 'live') return 'published';
  if (raw === 'in-the-works' || raw === 'in-the-works' || raw === 'soon' || raw === 'queued' || raw === 'in progress' || raw === 'in-progress') return 'in-the-works';
  if (raw === 'draft' || raw === 'todo' || raw === 'idea') return 'draft';
  return 'draft';
}

/**
 * Parse an uploaded .md file into the shape the admin form expects.
 */
function analyzeImport(filename, source) {
  const { data, body, warnings } = parseFrontmatter(source);
  const normalized = normalizeObsidian(body).trim();
  const title = String(data.title || firstHeading(body) || '').trim();
  const summary = String(data.summary || data.description || summarize(body));
  const date = normalizeDate(data.date || data.published || '');
  const status = normalizeStatus(data.status || (data.draft === 'true' ? 'draft' : ''));
  const slug = slugify(data.slug || title, 'article');
  const cover = String(data.cover || data.image || '').trim();
  const primary = /^pdf$/i.test(String(data.primary || data.format || '')) ? 'pdf' : 'markdown';

  return {
    filename: String(filename || '').slice(0, 200),
    frontmatter: data,
    body: normalized,
    rawBody: body,
    title,
    slug,
    summary,
    date,
    status,
    cover,
    primaryFormat: primary,
    warnings,
  };
}

module.exports = {
  parseFrontmatter,
  normalizeObsidian,
  renderMarkdown,
  plainText,
  summarize,
  slugify,
  normalizeDate,
  normalizeStatus,
  analyzeImport,
  md,
};
