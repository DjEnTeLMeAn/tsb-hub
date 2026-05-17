# SELF_CHECK 0.7.1-dev

Проверено перед выдачей:

- `index.html` содержит `<link rel="manifest" href="manifest.json?v=0.7.1-dev">`.
- `manifest.json` содержит `display: standalone`, `start_url`, `scope`, `icons` 192/512.
- `service-worker.js` содержит актуальный cache name `tsb-hub-v0-7-1-dev`.
- `app.js` проходит `node --check`.
- Архив упакован с корневой папкой `TSB-Hub-v0.7.1-dev/`.

Причина патча:

В 0.7.0-dev manifest-файл физически был в проекте, но не был подключён в `index.html`, поэтому Chrome не считал сайт устанавливаемым PWA.
