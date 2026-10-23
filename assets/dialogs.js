/* ============================================================
   Pure Chaos — dialog focus management
   ------------------------------------------------------------
   The game pages toggle their overlays with the `hidden` property
   from inline code. This file watches those toggles and makes the
   dialogs behave like real dialogs:

     * focus moves into an overlay when it opens,
     * Tab / Shift+Tab stay inside it while it is open,
     * focus returns to the trigger when it closes.

   It is intentionally page-agnostic: no page code was changed for it.
   Only elements with role="dialog" are managed.
   ============================================================ */
(() => {
  'use strict';

  const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  let openDialog = null;
  let returnFocus = null;

  function visible(el) {
    return !!(el && el.isConnected && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  function focusables(root) {
    return Array.prototype.slice.call(root.querySelectorAll(FOCUSABLE)).filter(visible);
  }

  function open(el) {
    if (openDialog === el) return;
    if (!returnFocus) returnFocus = document.activeElement;
    openDialog = el;
    const target = focusables(el)[0] || el;
    if (target === el && !el.hasAttribute('tabindex')) el.tabIndex = -1;
    requestAnimationFrame(() => {
      if (openDialog === el && target.focus) target.focus({ preventScroll: true });
    });
  }

  function close(el) {
    if (openDialog !== el) return;
    openDialog = null;
    if (returnFocus && document.contains(returnFocus) && typeof returnFocus.focus === 'function') {
      returnFocus.focus({ preventScroll: true });
    }
    returnFocus = null;
  }

  document.addEventListener('keydown', (event) => {
    if (!openDialog || event.key !== 'Tab') return;
    const items = focusables(openDialog);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const inside = openDialog.contains(active);
    if (event.shiftKey) {
      if (!inside || active === first) {
        event.preventDefault();
        last.focus();
      }
    } else if (!inside || active === last) {
      event.preventDefault();
      first.focus();
    }
  }, true);

  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const el = mutation.target;
      if (mutation.attributeName !== 'hidden') continue;
      if (!(el instanceof Element) || !el.matches('[role="dialog"]')) continue;
      if (el.hidden) close(el);
      else open(el);
    }
  }).observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden']
  });
})();
