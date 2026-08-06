(function(){
  'use strict';

  const CURRENT_RELEASE = window.TSB_RELEASE || '0.10.1-full-refresh-20260807-0032';
  const VERSION_URL = './version.json';
  const UPDATE_INTERVAL_MS = 60 * 1000;
  const RELOAD_KEY = 'tsb_hub_sw_reloaded_release';
  let latestRelease = CURRENT_RELEASE;
  let registration = null;
  let checking = false;

  const hasServiceWorker = 'serviceWorker' in navigator;
  const nativeRegister = hasServiceWorker ? navigator.serviceWorker.register.bind(navigator.serviceWorker) : null;

  function serviceWorkerUrl(release = latestRelease) {
    return `./service-worker.js?v=${encodeURIComponent(release)}`;
  }

  function setStatus(text, tone = '') {
    document.querySelectorAll('[data-tsb-update-status]').forEach(node => {
      node.textContent = text;
      node.dataset.tone = tone;
    });
  }

  function showToastSafe(text) {
    if (typeof window.showToast === 'function') window.showToast(text);
  }

  async function fetchLatestRelease() {
    const response = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!response.ok) throw new Error(`version.json: ${response.status}`);
    const data = await response.json();
    return String(data.release || CURRENT_RELEASE);
  }

  async function activateWaitingWorker(reg) {
    if (!reg?.waiting) return false;
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    return true;
  }

  async function registerRelease(release, manual = false) {
    if (!hasServiceWorker) {
      setStatus('Service worker не поддерживается', 'bad');
      return null;
    }

    latestRelease = release || CURRENT_RELEASE;
    registration = await nativeRegister(serviceWorkerUrl(latestRelease), {
      scope: './',
      updateViaCache: 'none'
    });

    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      setStatus('Загружается новая версия…', 'progress');
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed') {
          if (navigator.serviceWorker.controller) {
            setStatus('Новая версия готова. Перезапуск…', 'ready');
            activateWaitingWorker(registration);
          } else {
            setStatus(`Версия ${latestRelease} установлена`, 'ready');
          }
        }
      });
    });

    await registration.update().catch(() => null);
    await activateWaitingWorker(registration);

    if (manual) {
      setStatus('Проверка завершена', 'ready');
      showToastSafe('Проверка обновлений завершена');
    }
    return registration;
  }

  async function checkForUpdates({ manual = false, forceReload = false } = {}) {
    if (checking) return;
    checking = true;
    if (manual) setStatus('Проверяю обновление…', 'progress');

    try {
      const remoteRelease = await fetchLatestRelease();
      const changed = remoteRelease !== CURRENT_RELEASE;
      await registerRelease(remoteRelease, manual);

      if (changed) {
        setStatus(`Доступна версия ${remoteRelease}`, 'ready');
        if (registration?.waiting) await activateWaitingWorker(registration);
        if (forceReload) {
          const url = new URL('./index.html', window.location.href);
          url.searchParams.set('v', remoteRelease);
          url.searchParams.set('refresh', String(Date.now()));
          window.location.replace(url.href);
        }
      } else if (manual) {
        setStatus(`Установлена актуальная версия ${CURRENT_RELEASE}`, 'ready');
      }
    } catch (error) {
      console.warn('Не удалось проверить обновление TSB Hub:', error);
      if (manual) {
        setStatus('Не удалось проверить обновление', 'bad');
        showToastSafe('Не удалось проверить обновление');
      }
    } finally {
      checking = false;
    }
  }

  function installRegistrationRedirect() {
    if (!hasServiceWorker || !nativeRegister) return;
    try {
      navigator.serviceWorker.register = function(scriptURL, options = {}) {
        if (String(scriptURL || '').includes('service-worker.js')) {
          return nativeRegister(serviceWorkerUrl(latestRelease), {
            ...options,
            scope: options.scope || './',
            updateViaCache: 'none'
          });
        }
        return nativeRegister(scriptURL, options);
      };
    } catch (error) {
      console.warn('Не удалось перенаправить регистрацию service worker:', error);
    }
  }

  function updateCardHTML() {
    return `
      <div class="card-title-row"><h2>Версия приложения</h2></div>
      <p class="muted">Текущий релиз: <strong>${CURRENT_RELEASE}</strong></p>
      <p class="muted" data-tsb-update-status>Проверка обновлений выполняется автоматически.</p>
      <button class="ghost-button" type="button" data-tsb-force-update>Проверить и обновить</button>
    `;
  }

  function patchSettingsCard() {
    const root = document.querySelector('#tab-settings');
    if (!root) return;
    let card = root.querySelector('[data-tsb-update-card]');
    if (!card) {
      card = document.createElement('section');
      card.className = 'card settings-update-card';
      card.dataset.tsbUpdateCard = 'true';
      root.appendChild(card);
    }
    if (!card.dataset.rendered) {
      card.innerHTML = updateCardHTML();
      card.dataset.rendered = 'true';
      card.querySelector('[data-tsb-force-update]').onclick = () => checkForUpdates({ manual: true, forceReload: true });
    }
  }

  function watchSettings() {
    patchSettingsCard();
    const observer = new MutationObserver(() => patchSettingsCard());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (hasServiceWorker) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      const previous = sessionStorage.getItem(RELOAD_KEY);
      if (previous === latestRelease) return;
      sessionStorage.setItem(RELOAD_KEY, latestRelease);
      const url = new URL(window.location.href);
      url.searchParams.set('v', latestRelease);
      url.searchParams.set('sw', String(Date.now()));
      window.location.replace(url.href);
    });

    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'TSB_SW_ACTIVATED') {
        setStatus(`Активна версия ${event.data.release || latestRelease}`, 'ready');
      }
    });
  }

  installRegistrationRedirect();

  document.addEventListener('DOMContentLoaded', () => {
    watchSettings();
    registerRelease(CURRENT_RELEASE).catch(error => console.warn('Ошибка регистрации PWA:', error));
  });

  window.addEventListener('pageshow', () => checkForUpdates());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkForUpdates();
  });
  window.setInterval(() => checkForUpdates(), UPDATE_INTERVAL_MS);

  window.TSBUpdateManager = {
    release: CURRENT_RELEASE,
    check: options => checkForUpdates({ manual: true, ...(options || {}) })
  };
})();
