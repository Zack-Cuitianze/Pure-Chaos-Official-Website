/* Article reading page: lazy-load the PDF.js viewer, fall back to the
   browser's native PDF viewer if the vendored viewer is unavailable. */
(() => {
  'use strict';

  const frame = document.querySelector('.pdf-frame');
  if (!frame) return;

  const button = frame.querySelector('.pdf-frame__open');
  const hint = frame.querySelector('.pdf-frame__hint');
  const viewerSrc = frame.getAttribute('data-viewer');
  const pdfSrc = frame.getAttribute('data-pdf');
  if (!button || !viewerSrc || !pdfSrc) return;

  let loading = false;

  async function loadViewer() {
    if (loading) return;
    loading = true;
    frame.classList.add('pdf-frame--loading');
    button.disabled = true;
    button.textContent = 'Loading PDF…';
    if (hint) hint.textContent = 'Preparing the PDF.js viewer.';

    let src = viewerSrc;
    try {
      const probe = await fetch(viewerSrc.split('?')[0], { method: 'HEAD', cache: 'no-store' });
      if (!probe.ok) throw new Error('viewer unavailable');
    } catch {
      src = pdfSrc;
    }

    const iframe = document.createElement('iframe');
    iframe.title = 'PDF edition';
    iframe.loading = 'eager';
    iframe.src = src;
    frame.textContent = '';
    frame.appendChild(iframe);
  }

  button.addEventListener('click', loadViewer);
})();
