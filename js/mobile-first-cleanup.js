// TSB Hub 0.8.22 — small mobile-first UX layer.
// No storage keys, finance calculations or existing render functions are changed here.
(function () {
  const PRIMARY_TABS = new Set(['today', 'plans', 'finance']);
  const TAB_LABELS = {
    today: 'Сегодня',
    plans: 'Планы',
    finance: 'Финансы',
    food: 'Питание',
    important: 'Важное',
    sync: 'Синхронизация',
    settings: 'Настройки'
  };

  function qs(selector, root = document) {
    return root.querySelector(selector);
  }

  function qsa(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function updateMoreState() {
    const activeTab = document.body.dataset.activeTab || 'today';
    const fab = qs('#mobileTabFab');
    const toggle = qs('#mobileTabToggle');
    if (!fab || !toggle) return;

    const secondaryActive = !PRIMARY_TABS.has(activeTab);
    fab.classList.toggle('secondary-active', secondaryActive);
    if (secondaryActive) toggle.setAttribute('aria-current', 'page');
    else toggle.removeAttribute('aria-current');
  }

  function setupMobileFirstCleanup() {
    qsa('.tabs .tab-button').forEach(button => {
      const tab = button.dataset.tab;
      if (TAB_LABELS[tab]) button.textContent = TAB_LABELS[tab];
    });

    const toggle = qs('#mobileTabToggle');
    if (toggle) {
      toggle.textContent = 'Ещё';
      toggle.title = 'Ещё разделы';
      toggle.setAttribute('aria-label', 'Ещё разделы приложения');
    }

    const menu = qs('#mobileTabMenu');
    if (menu) {
      qsa('[data-tab-target]', menu).forEach(button => {
        const tab = button.dataset.tabTarget;
        if (TAB_LABELS[tab]) button.textContent = TAB_LABELS[tab];
        button.hidden = PRIMARY_TABS.has(tab);
      });
    }

    updateMoreState();
  }

  document.addEventListener('DOMContentLoaded', setupMobileFirstCleanup);
  window.addEventListener('load', setupMobileFirstCleanup);

  const observer = new MutationObserver(updateMoreState);
  if (document.body) {
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-active-tab'] });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { attributes: true, attributeFilter: ['data-active-tab'] });
    });
  }
})();
