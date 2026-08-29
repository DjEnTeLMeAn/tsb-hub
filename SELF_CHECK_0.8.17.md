# Самопроверка TSB Hub · релиз `0.13.3-finance-transaction-control-20260808`

Файл сохранён под историческим именем `SELF_CHECK_0.8.17.md`; контрольная версия берётся из `version.json`.

- [x] Версия синхронизирована с `version.json` в HTML, manifest, service worker и cache-buster ссылок.
- [x] Основной запуск через `index.html` и offline PWA shell сохранены.
- [x] Обязательные файлы shell и иконки присутствуют.
- [x] Полный backup экспортируется как нормализованный JSON; импорт принимает JSON и повторно нормализует его.
- [x] Импорт более старого backup требует отдельного подтверждения.
- [x] `node --check js/app.js` пройден без изменений `js/app.js`.
- [x] Финансовые регрессии Finance v2/Part 3 запускаются вместе с общим набором тестов.

Команды: `npm test`, `npm run lint`, `npm run build`.
