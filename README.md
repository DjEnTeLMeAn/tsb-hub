# TSB Hub v0.14.1-qwen-food-ai-20260904

Release: `0.14.1-qwen-food-ai-20260904`

Персональное оффлайн PWA-приложение для задач, питания, финансов, важных дат и отчётов для GPT. Текущий релиз и cache-buster берутся из `version.json`.

## Статус API keys

API key provider-а вводится пользователем после установки приложения и хранится только локально на телефоне. Local vault использует IndexedDB для зашифрованного значения и non-extractable Web Crypto AES-GCM device key; raw key material нельзя экспортировать, а plaintext никогда не persistent.

API key никогда не находится в repository или GitHub, build output/bundle, service-worker cache, app backup, state sync, D1 или server logs. Он не отправляется backend foundation.

Gemini и Qwen Food photo реализованы через прямой browser API после выбора пользователем provider и фото: Google `generativelanguage.googleapis.com` или Qwen `dashscope-intl.aliyuncs.com`. OpenAI и Anthropic не реализованы. Ключи локальные; фото отправляется только выбранному provider. Прямые client API несут риски CORS и billing/лимитов провайдера.
Распознанные масса, калории и БЖУ являются приблизительной оценкой: пользователь обязан проверить и при необходимости исправить их, затем подтвердить перед сохранением. Это не медицинская рекомендация.

Это не защита от активного same-origin XSS, скомпрометированного JavaScript или вредоносного устройства: приложение, работающее от имени пользователя, может вызвать decrypt. Пользователь принимает этот риск. Local vault снижает риск попадания ключа в GitHub/backup и затрудняет casual IndexedDB inspection, но не создаёт абсолютную границу секретности.

## Backend foundation: статус

В репозитории локально реализован backend foundation на Cloudflare Pages Functions, D1 и Cloudflare Access. Он ещё не создан и не развёрнут в облаке: нет созданных D1/Pages/Access ресурсов, production secrets или production deployment. Клиентское приложение пока не подключено к backend и continues to use `localStorage` для несекретных текущих данных.

Server encrypted credential vault и `AI_CREDENTIAL_KEK` удалены из целевой модели. Ни один из них не является действующим механизмом.
Backend foundation остаётся accounts/state only: local vault не deployed, client sync не connected.

Backend provider proxy отсутствует и не реализован: Gemini и Qwen Food photo работают только напрямую из браузера. Ключи, фото и ответы не попадают в backup/sync, service-worker cache или server logs.

Foundation включает same-origin server-side routes `/session`, `/auth/logout` и `/api/v1/state`; provider credential routes не являются способом хранения локального ключа. CORS deny-by-default, dynamic API/auth/session responses требуют `Cache-Control: no-store`, а cookie при возможном будущем использовании должна быть `Secure`, `HttpOnly`, `SameSite=Lax` или строже.

Синхронизация backend foundation — whole-state optimistic concurrency с canonical schema/hash и практическим пределом тела 1 MiB. Auth authority — Cloudflare Access. Server audit status: provider proxy и новая credential-интеграция не аудированы; перед таким изменением требуется отдельный adversarial/security audit.

## Backup и импорт

## PWA shell и обязательные файлы

PWA shell кэширует только статические assets. Service worker обходит будущие sensitive routes (`/api`, `/auth`, `/session`) и не кэширует их. Обычный backup приложения не включает API key и не является способом его восстановления.

## Перед развёртыванием

Создать отдельные preview/production D1 resources только для accounts/state, применить существующие state migrations `0001`, затем `0002`, настроить Access team/AUD/origin и secrets через Cloudflare, развернуть preview и провести server adversarial audit. Не добавлять credential KEK или provider migrations. Только после отдельного аудита допускаются client integration и production deployment. Реальные ID и secrets не должны появляться в репозитории.

Проверка: `npm test`, `npm run lint`, `npm run build` (или bundled Node из инструкции релиза).
