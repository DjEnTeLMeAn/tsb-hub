# SELF_CHECK 0.7.0-dev

Проверено перед выдачей:

- `index.html` содержит подключение `manifest.json?v=0.7.0-dev`.
- CSS и JS подключаются с `?v=0.7.0-dev`.
- `APP_VERSION = 0.7.0-dev`.
- Service worker больше не отключается для dev-сборки.
- Service worker использует кэш `tsb-hub-v0-7-0-dev`.
- В настройках добавлена PWA-диагностика.
- `node --check js/app.js` проходит без синтаксических ошибок.
- ZIP упакован с корневой папкой проекта внутри.
