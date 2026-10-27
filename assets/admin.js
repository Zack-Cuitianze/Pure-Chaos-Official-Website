/* Pure Chaos — admin controller (brands + articles) */
(() => {
  'use strict';

  const TOKEN_KEY = 'pc_admin_token';
  const WIDTH_KEY = 'pc_admin_sidebar_width';
  const COLLAPSED_KEY = 'pc_admin_sidebar_collapsed';
  const MIN_WIDTH = 180;
  const MAX_WIDTH = 420;
  const STATUS_LABELS = { draft: 'Draft', 'in-the-works': 'In the works', published: 'Published' };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const el = {
    shell: $('#shell'),
    sidebar: $('#sidebar'),
    resizer: $('#resizer'),
    toggle: $('#sidebarToggle'),
    status: $('#status'),
    reload: $('#reload'),
    save: $('#save'),
    lock: $('#lock'),
    login: $('#login'),
    loginForm: $('#loginForm'),
    loginError: $('#loginError'),
    tokenInput: $('#tokenInput'),
    editor: $('#editor'),
    viewBrands: $('#view-brands'),
    viewArticles: $('#view-articles'),
    brandsCount: $('#brandsCount'),
    articlesCount: $('#articlesCount'),
    // brands
    brandPageTitle: $('#brandPageTitle'),
    brandPageIntro: $('#brandPageIntro'),
    brandList: $('#brandList'),
    addBrand: $('#addBrand'),
    // articles page header
    articlePageKicker: $('#articlePageKicker'),
    articlePageTitle: $('#articlePageTitle'),
    articlePageLead: $('#articlePageLead'),
    articlePageNote: $('#articlePageNote'),
    // article list
    articleList: $('#articleList'),
    addArticle: $('#addArticle'),
    // article editor
    articleEditor: $('#articleEditor'),
    articleEditorTitle: $('#articleEditorTitle'),
    closeArticle: $('#closeArticle'),
    deleteArticle: $('#deleteArticle'),
    aTitle: $('#aTitle'),
    aSlug: $('#aSlug'),
    aStatus: $('#aStatus'),
    aDate: $('#aDate'),
    aSummary: $('#aSummary'),
    aCoverPath: $('#aCoverPath'),
    aCoverUpload: $('#aCoverUpload'),
    aCoverFile: $('#aCoverFile'),
    aCoverPreview: $('#aCoverPreview'),
    aPdfPath: $('#aPdfPath'),
    aPdfUpload: $('#aPdfUpload'),
    aPdfFile: $('#aPdfFile'),
    aPdfInfo: $('#aPdfInfo'),
    aMdUploadBtn: $('#aMdUploadBtn'),
    aMdFile: $('#aMdFile'),
    aMdPreviewBtn: $('#aMdPreviewBtn'),
    aMdClear: $('#aMdClear'),
    aMdInfo: $('#aMdInfo'),
    aMdWarnings: $('#aMdWarnings'),
    aPreview: $('#aPreview'),
  };

  const state = {
    token: sessionStorage.getItem(TOKEN_KEY) || '',
    section: 'brands',
    brands: null,
    articles: null,
    activeArticleId: null,
    dirty: { brands: false, articles: false },
    busy: false,
    width: clampWidth(Number(localStorage.getItem(WIDTH_KEY)) || 236),
    collapsed: localStorage.getItem(COLLAPSED_KEY) === '1',
    dragging: false,
  };

  /* ------------------------------------------------------------------ */
  /* helpers                                                            */
  /* ------------------------------------------------------------------ */

  function clampWidth(value) {
    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)));
  }

  function slugify(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'article';
  }

  function todayISO() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }

  function formatDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return '';
    const month = MONTHS[Number(match[2]) - 1];
    return month ? Number(match[3]) + ' ' + month + ' ' + match[1] : '';
  }

  function setStatus(text, kind) {
    el.status.textContent = text;
    el.status.dataset.state = kind || 'idle';
  }

  function anyDirty() {
    return state.dirty.brands || state.dirty.articles;
  }

  function refreshSave() {
    el.save.disabled = state.busy || !anyDirty();
  }

  function updateCounts() {
    if (state.brands) el.brandsCount.textContent = String(state.brands.brands.length);
    if (state.articles) el.articlesCount.textContent = String(state.articles.articles.length);
  }

  function markDirty(section) {
    if (!state.dirty[section]) {
      state.dirty[section] = true;
      refreshSave();
    }
    if (!state.busy) setStatus('unsaved changes', 'dirty');
  }

  function markClean() {
    state.dirty.brands = false;
    state.dirty.articles = false;
    refreshSave();
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error('could not read file'));
      reader.readAsDataURL(file);
    });
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error('could not read file'));
      reader.readAsText(file);
    });
  }

  async function api(path, options = {}) {
    const headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, Object.assign({}, options, { headers }));
    const raw = await res.text();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = { error: raw }; }
    if (!res.ok) {
      const error = new Error(body && body.error ? body.error : 'HTTP ' + res.status);
      error.status = res.status;
      throw error;
    }
    return body;
  }

  /* ------------------------------------------------------------------ */
  /* normalisation                                                      */
  /* ------------------------------------------------------------------ */

  function normalizeBrands(doc) {
    const page = (doc && doc.page) || {};
    const brands = Array.isArray(doc && doc.brands) ? doc.brands : [];
    return {
      revision: Number(doc && doc.revision) || 0,
      page: {
        title: typeof page.title === 'string' ? page.title : '',
        intro: typeof page.intro === 'string' ? page.intro : '',
      },
      brands: brands.map((brand, index) => ({
        id: brand.id || '',
        name: brand.name || '',
        description: brand.description || '',
        logo: brand.logo || '',
        logoScale: Number.isFinite(Number(brand.logoScale)) ? Number(brand.logoScale) : 1,
        url: brand.url || '',
        order: Number.isFinite(Number(brand.order)) ? Number(brand.order) : index + 1,
      })),
    };
  }

  function normalizeArticles(doc) {
    const page = (doc && doc.page) || {};
    const articles = Array.isArray(doc && doc.articles) ? doc.articles : [];
    return {
      revision: Number(doc && doc.revision) || 0,
      page: {
        kicker: typeof page.kicker === 'string' ? page.kicker : 'Articles',
        title: typeof page.title === 'string' ? page.title : '',
        lead: typeof page.lead === 'string' ? page.lead : '',
        note: typeof page.note === 'string' ? page.note : '',
      },
      articles: articles.map((article, index) => {
        const item = {
          id: article.id || 'article-' + (index + 1),
          slug: article.slug || '',
          title: article.title || '',
          summary: article.summary || '',
          status: STATUS_LABELS[article.status] ? article.status : 'draft',
          date: article.date || '',
          cover: article.cover || '',
          pdf: article.pdf || '',
          body: typeof article.body === 'string' ? article.body : '',
          sourceName: article.sourceName || '',
          primaryFormat: article.primaryFormat === 'pdf' ? 'pdf' : 'markdown',
          createdAt: article.createdAt || new Date().toISOString(),
          updatedAt: article.updatedAt || new Date().toISOString(),
        };
        Object.defineProperty(item, '_autoSlug', { value: false, writable: true, enumerable: false });
        return item;
      }),
    };
  }

  function findArticle(id) {
    return state.articles ? state.articles.articles.find((article) => article.id === id) || null : null;
  }

  /* ------------------------------------------------------------------ */
  /* sidebar                                                            */
  /* ------------------------------------------------------------------ */

  function applySidebar() {
    document.documentElement.style.setProperty('--sidebar-width', state.width + 'px');
    el.shell.classList.toggle('is-collapsed', state.collapsed);
  }

  function showSection(name) {
    if (name !== 'brands' && name !== 'articles') return;
    state.section = name;
    $$('.side-item').forEach((item) => item.classList.toggle('is-active', item.dataset.section === name));
    el.viewBrands.hidden = name !== 'brands';
    el.viewArticles.hidden = name !== 'articles';
    if (name === 'brands') renderBrands();
    else renderArticles();
    if (window.matchMedia('(max-width: 900px)').matches) el.shell.classList.remove('is-open');
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  function initSidebar() {
    applySidebar();
    $$('.side-item').forEach((item) => item.addEventListener('click', () => showSection(item.dataset.section)));

    el.toggle.addEventListener('click', () => {
      if (window.matchMedia('(max-width: 900px)').matches) {
        el.shell.classList.toggle('is-open');
        return;
      }
      state.collapsed = !state.collapsed;
      localStorage.setItem(COLLAPSED_KEY, state.collapsed ? '1' : '0');
      applySidebar();
    });

    el.resizer.addEventListener('pointerdown', (event) => {
      if (window.matchMedia('(max-width: 900px)').matches) return;
      event.preventDefault();
      state.dragging = true;
      el.resizer.classList.add('is-dragging');
      el.resizer.setPointerCapture(event.pointerId);
    });

    window.addEventListener('pointermove', (event) => {
      if (!state.dragging) return;
      const left = el.shell.getBoundingClientRect().left;
      state.width = clampWidth(event.clientX - left);
      applySidebar();
    });

    window.addEventListener('pointerup', () => {
      if (!state.dragging) return;
      state.dragging = false;
      el.resizer.classList.remove('is-dragging');
      localStorage.setItem(WIDTH_KEY, String(state.width));
    });
  }

  /* ------------------------------------------------------------------ */
  /* brands                                                             */
  /* ------------------------------------------------------------------ */

  function renderBrands() {
    if (!state.brands) return;
    el.brandPageTitle.value = state.brands.page.title;
    el.brandPageIntro.value = state.brands.page.intro;
    el.brandsCount.textContent = String(state.brands.brands.length);
    el.brandList.textContent = '';
    state.brands.brands.forEach((brand, index) => el.brandList.appendChild(brandEditor(brand, index)));
  }

  function refreshBrandPreview(preview, brand) {
    if (brand.logo) {
      preview.hidden = false;
      preview.src = '/' + String(brand.logo).replace(/^\/+/, '');
    } else {
      preview.hidden = true;
      preview.removeAttribute('src');
    }
  }

  function brandEditor(brand, index) {
    const node = $('#brandTpl').content.firstElementChild.cloneNode(true);
    const preview = $('.brand__preview', node);
    const file = $('.brand__file', node);
    const upload = $('.brand__upload', node);
    const name = $('.brand__name', node);
    const desc = $('.brand__desc', node);
    const logoPath = $('.brand__logoPath', node);
    const scale = $('.brand__scale', node);
    const url = $('.brand__url', node);

    name.value = brand.name;
    desc.value = brand.description;
    logoPath.value = brand.logo;
    scale.value = String(brand.logoScale);
    url.value = brand.url;
    refreshBrandPreview(preview, brand);
    preview.addEventListener('error', () => { preview.hidden = true; });

    name.addEventListener('input', () => { brand.name = name.value; markDirty('brands'); });
    desc.addEventListener('input', () => { brand.description = desc.value; markDirty('brands'); });
    logoPath.addEventListener('input', () => {
      brand.logo = logoPath.value.trim();
      refreshBrandPreview(preview, brand);
      markDirty('brands');
    });
    scale.addEventListener('input', () => { brand.logoScale = Number(scale.value); markDirty('brands'); });
    url.addEventListener('input', () => { brand.url = url.value.trim(); markDirty('brands'); });

    upload.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const picked = file.files && file.files[0];
      file.value = '';
      if (!picked) return;
      if (picked.size > 2 * 1024 * 1024) {
        setStatus('logo too large (max 2 MB)', 'error');
        return;
      }
      setStatus('uploading logo…', 'busy');
      try {
        const dataUrl = await readFileAsDataUrl(picked);
        const uploaded = await api('/api/upload', {
          method: 'POST',
          body: JSON.stringify({ filename: picked.name, data: dataUrl }),
        });
        brand.logo = uploaded.path;
        logoPath.value = uploaded.path;
        refreshBrandPreview(preview, brand);
        markDirty('brands');
        setStatus('logo uploaded', 'ok');
      } catch (error) {
        setStatus('upload failed: ' + error.message, 'error');
      }
    });

    $('.brand__up', node).addEventListener('click', () => {
      if (index === 0) return;
      const list = state.brands.brands;
      [list[index - 1], list[index]] = [list[index], list[index - 1]];
      renderBrands();
      markDirty('brands');
    });
    $('.brand__down', node).addEventListener('click', () => {
      const list = state.brands.brands;
      if (index >= list.length - 1) return;
      [list[index + 1], list[index]] = [list[index], list[index + 1]];
      renderBrands();
      markDirty('brands');
    });
    $('.brand__delete', node).addEventListener('click', () => {
      const label = brand.name || 'this brand';
      if (!confirm('Delete "' + label + '"?')) return;
      state.brands.brands.splice(index, 1);
      renderBrands();
      markDirty('brands');
    });

    return node;
  }

  function bindBrandPageInputs() {
    el.brandPageTitle.addEventListener('input', () => {
      state.brands.page.title = el.brandPageTitle.value;
      markDirty('brands');
    });
    el.brandPageIntro.addEventListener('input', () => {
      state.brands.page.intro = el.brandPageIntro.value;
      markDirty('brands');
    });
    el.addBrand.addEventListener('click', () => {
      state.brands.brands.push({
        id: '',
        name: 'New brand',
        description: '',
        logo: '',
        logoScale: 1,
        url: '',
        order: state.brands.brands.length + 1,
      });
      renderBrands();
      markDirty('brands');
    });
  }

  /* ------------------------------------------------------------------ */
  /* articles                                                           */
  /* ------------------------------------------------------------------ */

  function renderArticles() {
    if (!state.articles) return;
    el.articlePageKicker.value = state.articles.page.kicker;
    el.articlePageTitle.value = state.articles.page.title;
    el.articlePageLead.value = state.articles.page.lead;
    el.articlePageNote.value = state.articles.page.note;
    el.articlesCount.textContent = String(state.articles.articles.length);
    renderArticleList();
    if (state.activeArticleId && findArticle(state.activeArticleId)) {
      fillArticleEditor(findArticle(state.activeArticleId));
    } else {
      state.activeArticleId = null;
      el.articleEditor.hidden = true;
    }
  }

  function renderArticleList() {
    if (!state.articles) return;
    el.articleList.textContent = '';
    if (!state.articles.articles.length) {
      const empty = document.createElement('p');
      empty.className = 'article-list__empty';
      empty.textContent = 'No articles yet — add the first one.';
      el.articleList.appendChild(empty);
      return;
    }
    state.articles.articles.forEach((article) => {
      const node = $('#articleRowTpl').content.firstElementChild.cloneNode(true);
      const pill = $('.article-row__pill', node);
      pill.classList.add('pill--' + article.status);
      pill.textContent = STATUS_LABELS[article.status] || 'Draft';
      $('.article-row__title', node).textContent = article.title || 'Untitled article';
      const meta = [];
      if (article.date) meta.push(formatDate(article.date));
      else if (article.status === 'in-the-works') meta.push('In the works');
      meta.push(article.primaryFormat === 'pdf' ? 'PDF' : 'Markdown');
      $('.article-row__meta', node).textContent = meta.join(' · ');
      node.classList.toggle('is-active', article.id === state.activeArticleId);
      node.addEventListener('click', () => openArticle(article.id));
      el.articleList.appendChild(node);
    });
  }

  function fillArticleEditor(article) {
    el.articleEditor.hidden = false;
    el.articleEditorTitle.textContent = article.title || 'Untitled article';
    el.aTitle.value = article.title;
    el.aSlug.value = article.slug;
    el.aStatus.value = article.status;
    el.aDate.value = article.date;
    el.aSummary.value = article.summary;
    $$('input[name="aPrimary"]').forEach((radio) => { radio.checked = radio.value === article.primaryFormat; });
    el.aCoverPath.value = article.cover;
    refreshCoverPreview(article);
    refreshPdfInfo(article);
    refreshMarkdownInfo(article);
    el.aMdWarnings.hidden = true;
    el.aMdWarnings.textContent = '';
    el.aPreview.hidden = true;
    el.aPreview.textContent = '';
  }

  function refreshCoverPreview(article) {
    if (article.cover) {
      el.aCoverPreview.hidden = false;
      el.aCoverPreview.src = '/' + String(article.cover).replace(/^\/+/, '');
    } else {
      el.aCoverPreview.hidden = true;
      el.aCoverPreview.removeAttribute('src');
    }
  }

  function refreshPdfInfo(article) {
    el.aPdfInfo.textContent = '';
    if (!article.pdf) {
      el.aPdfInfo.textContent = 'No PDF uploaded.';
      return;
    }
    const link = document.createElement('a');
    link.className = 'link';
    link.target = '_blank';
    link.rel = 'noopener';
    link.href =
      '/assets/vendor/pdfjs/web/viewer.html?file=' + encodeURIComponent('/' + article.pdf);
    link.textContent = 'open PDF in viewer ↗';
    el.aPdfInfo.appendChild(link);
    el.aPdfInfo.appendChild(document.createTextNode(' · ' + article.pdf.split('/').pop()));
  }

  function refreshMarkdownInfo(article) {
    if (!article.body) {
      el.aMdInfo.textContent = 'No Markdown body yet.';
      return;
    }
    const chars = article.body.length.toLocaleString();
    el.aMdInfo.textContent =
      chars + ' characters' + (article.sourceName ? ' · ' + article.sourceName : '');
  }

  function openArticle(id) {
    const article = findArticle(id);
    if (!article) return;
    state.activeArticleId = article.id;
    fillArticleEditor(article);
    renderArticleList();
    el.articleEditor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeArticleEditor() {
    state.activeArticleId = null;
    el.articleEditor.hidden = true;
    renderArticleList();
  }

  function updateActiveEditorTitle() {
    const article = findArticle(state.activeArticleId);
    if (article) el.articleEditorTitle.textContent = article.title || 'Untitled article';
  }

  async function runPreview() {
    const article = findArticle(state.activeArticleId);
    if (!article || !article.body) {
      el.aPreview.hidden = true;
      el.aPreview.textContent = '';
      return;
    }
    setStatus('rendering preview…', 'busy');
    try {
      const result = await api('/api/preview', {
        method: 'POST',
        body: JSON.stringify({ markdown: article.body }),
      });
      el.aPreview.innerHTML = result.html;
      el.aPreview.hidden = false;
      setStatus('preview ready', 'ok');
    } catch (error) {
      setStatus('preview failed: ' + error.message, 'error');
    }
  }

  function applyImportedMarkdown(article, result) {
    article.body = typeof result.body === 'string' ? result.body : article.body;
    article.sourceName = result.filename || article.sourceName;

    const isPlaceholderTitle = !article.title.trim() || article.title === 'Untitled article';
    if (isPlaceholderTitle && result.title) article.title = result.title;
    if (!article.slug.trim() && result.slug) article.slug = result.slug;
    if (!article.date && result.date) article.date = result.date;
    if (!article.summary && result.summary) article.summary = result.summary;

    el.aTitle.value = article.title;
    el.aSlug.value = article.slug;
    el.aDate.value = article.date;
    el.aSummary.value = article.summary;
    updateActiveEditorTitle();
    refreshMarkdownInfo(article);
    renderArticleList();
    markDirty('articles');

    const notes = [];
    if (result.warnings && result.warnings.length) notes.push.apply(notes, result.warnings);
    if (result.frontmatter && Object.keys(result.frontmatter).length) {
      notes.push('frontmatter: ' + Object.keys(result.frontmatter).join(', '));
    }
    if (notes.length) {
      el.aMdWarnings.hidden = false;
      el.aMdWarnings.textContent = notes.join(' · ');
    } else {
      el.aMdWarnings.hidden = true;
      el.aMdWarnings.textContent = '';
    }
    runPreview();
  }

  function bindArticleInputs() {
    el.articlePageKicker.addEventListener('input', () => {
      state.articles.page.kicker = el.articlePageKicker.value;
      markDirty('articles');
    });
    el.articlePageTitle.addEventListener('input', () => {
      state.articles.page.title = el.articlePageTitle.value;
      markDirty('articles');
    });
    el.articlePageLead.addEventListener('input', () => {
      state.articles.page.lead = el.articlePageLead.value;
      markDirty('articles');
    });
    el.articlePageNote.addEventListener('input', () => {
      state.articles.page.note = el.articlePageNote.value;
      markDirty('articles');
    });

    el.addArticle.addEventListener('click', () => {
      const article = {
        id: 'article-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
        slug: '',
        title: '',
        summary: '',
        status: 'draft',
        date: todayISO(),
        cover: '',
        pdf: '',
        body: '',
        sourceName: '',
        primaryFormat: 'markdown',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      Object.defineProperty(article, '_autoSlug', { value: true, writable: true, enumerable: false });
      state.articles.articles.push(article);
      renderArticleList();
      markDirty('articles');
      openArticle(article.id);
      el.aTitle.focus();
    });

    el.aTitle.addEventListener('input', () => {
      const article = findArticle(state.activeArticleId);
      if (!article) return;
      article.title = el.aTitle.value;
      if (article._autoSlug || !article.slug.trim()) {
        article.slug = el.aTitle.value ? slugify(el.aTitle.value) : '';
        el.aSlug.value = article.slug;
      }
      updateActiveEditorTitle();
      markDirty('articles');
      renderArticleList();
    });

    el.aSlug.addEventListener('input', () => {
      const article = findArticle(state.activeArticleId);
      if (!article) return;
      article.slug = el.aSlug.value;
      article._autoSlug = false;
      markDirty('articles');
    });

    el.aStatus.addEventListener('change', () => {
      const article = findArticle(state.activeArticleId);
      if (!article) return;
      article.status = el.aStatus.value;
      renderArticleList();
      markDirty('articles');
    });

    el.aDate.addEventListener('change', () => {
      const article = findArticle(state.activeArticleId);
      if (!article) return;
      article.date = el.aDate.value;
      renderArticleList();
      markDirty('articles');
    });

    el.aSummary.addEventListener('input', () => {
      const article = findArticle(state.activeArticleId);
      if (!article) return;
      article.summary = el.aSummary.value;
      markDirty('articles');
    });

    $$('input[name="aPrimary"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        const article = findArticle(state.activeArticleId);
        if (!article || !radio.checked) return;
        article.primaryFormat = radio.value;
        markDirty('articles');
      });
    });

    el.aCoverPath.addEventListener('input', () => {
      const article = findArticle(state.activeArticleId);
      if (!article) return;
      article.cover = el.aCoverPath.value.trim();
      refreshCoverPreview(article);
      markDirty('articles');
    });
    el.aCoverPreview.addEventListener('error', () => { el.aCoverPreview.hidden = true; });

    el.aCoverUpload.addEventListener('click', () => el.aCoverFile.click());
    el.aCoverFile.addEventListener('change', async () => {
      const picked = el.aCoverFile.files && el.aCoverFile.files[0];
      el.aCoverFile.value = '';
      if (!picked) return;
      setStatus('uploading cover…', 'busy');
      try {
        const dataUrl = await readFileAsDataUrl(picked);
        const uploaded = await api('/api/articles/upload', {
          method: 'POST',
          body: JSON.stringify({ kind: 'cover', filename: picked.name, data: dataUrl }),
        });
        const article = findArticle(state.activeArticleId);
        if (!article) return;
        article.cover = uploaded.path;
        el.aCoverPath.value = uploaded.path;
        refreshCoverPreview(article);
        markDirty('articles');
        setStatus('cover uploaded', 'ok');
      } catch (error) {
        setStatus('cover upload failed: ' + error.message, 'error');
      }
    });

    el.aPdfPath.addEventListener('input', () => {
      const article = findArticle(state.activeArticleId);
      if (!article) return;
      article.pdf = el.aPdfPath.value.trim();
      refreshPdfInfo(article);
      markDirty('articles');
    });

    el.aPdfUpload.addEventListener('click', () => el.aPdfFile.click());
    el.aPdfFile.addEventListener('change', async () => {
      const picked = el.aPdfFile.files && el.aPdfFile.files[0];
      el.aPdfFile.value = '';
      if (!picked) return;
      if (picked.size > 25 * 1024 * 1024) {
        setStatus('PDF too large (max 25 MB)', 'error');
        return;
      }
      setStatus('uploading PDF…', 'busy');
      try {
        const dataUrl = await readFileAsDataUrl(picked);
        const uploaded = await api('/api/articles/upload', {
          method: 'POST',
          body: JSON.stringify({ kind: 'pdf', filename: picked.name, data: dataUrl }),
        });
        const article = findArticle(state.activeArticleId);
        if (!article) return;
        article.pdf = uploaded.path;
        el.aPdfPath.value = uploaded.path;
        refreshPdfInfo(article);
        markDirty('articles');
        setStatus('PDF uploaded', 'ok');
      } catch (error) {
        setStatus('PDF upload failed: ' + error.message, 'error');
      }
    });

    el.aMdUploadBtn.addEventListener('click', () => el.aMdFile.click());
    el.aMdFile.addEventListener('change', async () => {
      const picked = el.aMdFile.files && el.aMdFile.files[0];
      el.aMdFile.value = '';
      if (!picked) return;
      if (picked.size > 2 * 1024 * 1024) {
        setStatus('Markdown file too large (max 2 MB)', 'error');
        return;
      }
      setStatus('importing Markdown…', 'busy');
      try {
        const text = await readFileAsText(picked);
        const result = await api('/api/articles/import', {
          method: 'POST',
          body: JSON.stringify({ filename: picked.name, text }),
        });
        const article = findArticle(state.activeArticleId);
        if (!article) return;
        applyImportedMarkdown(article, result);
        setStatus('Markdown imported', 'ok');
      } catch (error) {
        setStatus('import failed: ' + error.message, 'error');
      }
    });

    el.aMdPreviewBtn.addEventListener('click', runPreview);

    el.aMdClear.addEventListener('click', () => {
      const article = findArticle(state.activeArticleId);
      if (!article) return;
      if (article.body && !confirm('Clear the Markdown body for this article?')) return;
      article.body = '';
      article.sourceName = '';
      refreshMarkdownInfo(article);
      el.aPreview.hidden = true;
      el.aPreview.textContent = '';
      el.aMdWarnings.hidden = true;
      markDirty('articles');
    });

    el.closeArticle.addEventListener('click', closeArticleEditor);

    el.deleteArticle.addEventListener('click', () => {
      const article = findArticle(state.activeArticleId);
      if (!article) return;
      if (!confirm('Delete "' + (article.title || 'this article') + '"? Uploaded files are kept.')) return;
      state.articles.articles = state.articles.articles.filter((item) => item.id !== article.id);
      closeArticleEditor();
      renderArticleList();
      markDirty('articles');
    });
  }

  /* ------------------------------------------------------------------ */
  /* save / load / auth                                                 */
  /* ------------------------------------------------------------------ */

  function brandsPayload() {
    return {
      revision: state.brands.revision,
      page: {
        title: state.brands.page.title,
        intro: state.brands.page.intro,
      },
      brands: state.brands.brands.map((brand, index) => ({
        id: brand.id,
        name: brand.name,
        description: brand.description,
        logo: brand.logo,
        logoScale: brand.logoScale,
        url: brand.url,
        order: index + 1,
      })),
    };
  }

  function articlesPayload() {
    return {
      revision: state.articles.revision,
      page: {
        kicker: state.articles.page.kicker,
        title: state.articles.page.title,
        lead: state.articles.page.lead,
        note: state.articles.page.note,
      },
      articles: state.articles.articles.map((article) => ({
        id: article.id,
        slug: article.slug,
        title: article.title,
        summary: article.summary,
        status: article.status,
        date: article.date,
        cover: article.cover,
        pdf: article.pdf,
        body: article.body,
        sourceName: article.sourceName,
        primaryFormat: article.primaryFormat,
        createdAt: article.createdAt,
      })),
    };
  }

  async function saveAll() {
    if (state.busy || !anyDirty()) return;
    state.busy = true;
    refreshSave();
    setStatus('saving…', 'busy');
    const activeIndex = state.articles
      ? state.articles.articles.findIndex((article) => article.id === state.activeArticleId)
      : -1;
    try {
      if (state.dirty.brands) {
        const saved = await api('/api/brands', { method: 'PUT', body: JSON.stringify(brandsPayload()) });
        state.brands = normalizeBrands(saved);
        state.dirty.brands = false;
      }
      if (state.dirty.articles) {
        const saved = await api('/api/articles', { method: 'PUT', body: JSON.stringify(articlesPayload()) });
        state.articles = normalizeArticles(saved);
        state.dirty.articles = false;
        state.activeArticleId = activeIndex >= 0 && state.articles.articles[activeIndex]
          ? state.articles.articles[activeIndex].id
          : null;
      }
      state.busy = false;
      renderBrands();
      renderArticles();
      updateCounts();
      setStatus('saved', 'ok');
    } catch (error) {
      state.busy = false;
      if (error.status === 409) setStatus('conflict — reload and try again', 'error');
      else setStatus('save failed: ' + error.message, 'error');
    } finally {
      refreshSave();
    }
  }

  async function loadAll() {
    setStatus('loading…', 'busy');
    const [brands, articles] = await Promise.all([api('/api/brands'), api('/api/articles')]);
    state.brands = normalizeBrands(brands);
    state.articles = normalizeArticles(articles);
    state.dirty.brands = false;
    state.dirty.articles = false;
    state.activeArticleId = null;
    refreshSave();
    updateCounts();
    showSection(state.section);
    setStatus('saved', 'ok');
  }

  async function unlock(candidate) {
    state.token = candidate;
    try {
      await api('/api/auth');
    } catch (error) {
      state.token = '';
      sessionStorage.removeItem(TOKEN_KEY);
      throw error;
    }
    sessionStorage.setItem(TOKEN_KEY, state.token);
    el.login.hidden = true;
    el.loginError.hidden = true;
    el.editor.hidden = false;
    el.reload.disabled = false;
    el.lock.disabled = false;
    await loadAll();
  }

  /* ------------------------------------------------------------------ */
  /* global events                                                      */
  /* ------------------------------------------------------------------ */

  el.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = el.tokenInput.value.trim();
    if (!value) return;
    try {
      await unlock(value);
      el.tokenInput.value = '';
    } catch {
      el.loginError.hidden = false;
    }
  });

  el.save.addEventListener('click', saveAll);

  el.reload.addEventListener('click', async () => {
    if (anyDirty() && !confirm('Discard unsaved changes?')) return;
    try {
      await loadAll();
    } catch (error) {
      setStatus('reload failed: ' + error.message, 'error');
    }
  });

  el.lock.addEventListener('click', () => {
    if (anyDirty() && !confirm('Discard unsaved changes and lock?')) return;
    sessionStorage.removeItem(TOKEN_KEY);
    location.reload();
  });

  window.addEventListener('beforeunload', (event) => {
    if (!anyDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  /* ------------------------------------------------------------------ */
  /* boot                                                               */
  /* ------------------------------------------------------------------ */

  initSidebar();
  bindBrandPageInputs();
  bindArticleInputs();

  if (state.token) {
    unlock(state.token).catch(() => {
      el.login.hidden = false;
      el.editor.hidden = true;
      setStatus('locked', 'idle');
    });
  }
})();
