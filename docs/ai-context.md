# Контекст SmartupCMS для AI-ассистентов

**Актуализировано:** 2026-09-10

**Назначение:** краткий воспроизводимый handoff для следующей AI-сессии

**Статус:** справочный контекст, не нормативный источник требований

Этот файл помогает быстро восстановить контекст проекта. Он не заменяет
[каноническое ТЗ](technical-specification.md), действующие
[ADR](README.md#authority-tier-2--current-decisions), код, конфигурацию или
результаты проверок. При конфликте AI обязан зафиксировать расхождение и
проверить первичный артефакт, а не дополнять пробел догадкой.

## 1. Продукт и стратегия

SmartupCMS — открытая self-hosted платформа контента и операционной работы для
одной организации и многих пользователей. Одна установка обслуживает одну
организацию и использует отдельный экземпляр PostgreSQL и отдельное объектное
хранилище. Продукт
объединяет пользователей и RBAC, задачи и комментарии, заметки (`ms/note`),
реестр модулей и навигацию (`md/navigation`), файлы, поиск,
уведомления, объявления, аудит и системное администрирование.

Проект развивается по принципу «углублять качество, не расширять scope».
Control Plane, fleet orchestration, runtime licensing, remote enrollment,
обязательная телеметрия и phone-home не входят в продукт. Горизонт подготовки
запуска — четыре месяца от утверждённой базовой точки; точная дата не
утверждена.

Плановые входные данные управляемого контура являются суммарными, а не
per-installation: примерно 100 установок, 500 зарегистрированных пользователей,
100 одновременно активных пользователей и 50 ГБ загрузок в месяц. Целевой
показатель доступности (SLO) утверждён на уровне 99.9% доступности сервиса.
В релизный скоуп v1.0.0 включены модули `ms/note`, реестр модулей,
настраиваемая навигация и Flyway-миграции `V028`–`V032`. В качестве целевого
объектного хранилища поддерживаются MinIO (S3-совместимое) или локальный диск
(`local_disk`); канал SMTP настраивается независимо per-deployment.

## 2. Нормативные источники

Использовать следующий порядок приоритета:

1. прямое текущее указание пользователя;
2. [техническое задание](technical-specification.md) с идентификаторами
   `FR-*`, `NFR-*`, `AC-*`;
3. [ADR-0014](adr/ADR-0014-unified-open-source-runtime.md) и другие действующие
   ADR согласно [индексу документации](README.md);
4. код, миграции, Compose и автоматические проверки;
5. активные engineering/operations/security документы;
6. `audit/` и `docs/superpowers/` только как датированная история и evidence.

Неподтверждённые локальные audit-черновики не являются требованиями и не должны
попадать в committed-документацию или Graphify до отдельной сверки.

## 3. Карта системы

| Область | Текущая реализация |
|---|---|
| Web | Angular 22 SPA в `apps/web`; production image обслуживается NGINX |
| Backend | Java 25, Spring Boot 4.1, модульный монолит в `apps/server` |
| Shared kernel | `libs/core-types`, `libs/platform-common`, `libs/provider-spi` |
| Транзакционные данные | PostgreSQL 18 и неизменяемые Flyway migrations |
| Поиск | Typesense 27.1 как производный индекс, не источник авторизации |
| Файлы | `local_disk` или S3-compatible provider (включая MinIO) через SPI |
| Поставка | Docker Compose; отдельный one-shot `migrate`; production backup и ClamAV |
| Проверки | Maven, Angular/Vitest, Playwright, PowerShell architecture/docs/release gates |
| Модули расширения | Заметки (`ms/note`), реестр модулей (`md_module_registry`), навигация (`md_navigation_items`) |
| Локализация | Центральный PostgreSQL registry/overrides, восемь packaged-языков, русский per-key fallback |

Browser обращается только к server API. Авторизация всегда выполняется на
сервере; Typesense не принимает решений о доступе. Контроллеры валидируют и
авторизуют запрос, application services владеют use case и транзакцией, а
repositories/adapters — I/O. Детали приведены в
[карте монорепозитория](architecture/monorepo-structure.md).

## 4. Deployment и provider policy

- Smartup-managed инфраструктура использует Cloudflare как внешний
  DNS/TLS/security edge и Cloudflare R2 как целевое объектное хранилище.
- На инфраструктуре клиента оператор может выбрать собственный edge,
  `local_disk` или любой проверенный S3-compatible provider (включая MinIO); канал
  уведомлений SMTP настраивается независимо per-deployment.
- Локальная/development топология может работать без ClamAV и планового backup.
  Поддерживаемая production-поставка требует fail-closed ClamAV и
  зашифрованный backup.
- Production публикует только web origin; PostgreSQL, Typesense и management
  endpoints не должны быть доступны извне.
- Внешние providers и webhooks включаются оператором; default runtime не должен
  требовать исходящего соединения.

## 5. Инварианты безопасности и данных

- Не хранить в Git `.env`, secret-файлы, customer data, дампы БД и
  расшифрованные backups.
- Проверки RBAC/ownership/data scope выполняются на сервере; UI не является
  security boundary.
- Upload проходит quarantine, проверку размера/MIME/magic bytes и malware scan
  до публикации объекта; production scanner работает fail-closed.
- Flyway migrations неизменяемы после публикации. Для upgrades применяются
  expand/contract, pre-migration encrypted backup и forward fix либо
  restore предыдущей проверенной версии.
- Release images принимаются только по immutable digest с checksums, SBOM,
  provenance и Cosign verification.

См. [threat model](security/threat-model.md),
[migration guidance](guidelines/database-migrations.md) и
[production launch checklist](ops/production-launch-checklist.md).

## 6. Последняя подтверждённая проверка

### Точка продолжения — 2026-09-10 (HEAD synchronized with origin/main)

2026-09-10 зафиксирован и запушен коммит `8a5a4315716e2b2aedd1b8ca889685b99e658d30`
(`feat(navigation): add category rail with flyout popover and modular system enhancements`).
Ветка `main` полностью синхронизирована с `origin/main` (`ahead 0, behind 0`).
Локальные черновики `audit/` сохранены в untracked-состоянии согласно `AGENTS.md`.

Ключевые подтверждённые факты и выполненные решения:
1. **Целевой SLO:** утверждён на уровне 99.9% доступности сервиса.
2. **Объектное хранилище и каналы:** поддерживаются MinIO (S3-совместимое) и `local_disk`; канал SMTP настраивается независимо per-deployment.
3. **Модульность ядра и БД:** в скоуп включены модуль `ms/note`, реестр модулей (`md_module_registry`), настраиваемая навигация (`md_navigation_items`) и миграции Flyway `V028`..`V032`.
4. **Навигация и UI:**
   - Левый рейл (60px) отображает категории/разделы (`space_dashboard`, `manage_accounts`, `tune`).
   - Автоматическое расширение меню по ширине на ховере полностью отключено («меню не раскрывается»).
   - Наведение или клик на категорию открывает компактную всплывающую карточку (`.rail-flyout-popover`) с заголовком раздела в uppercase, списком пунктов и активной синей плашкой `#0284c7`, точно по дизайну пользователя (`media_1788983193674.png`).
   - Закрытие карточки реализовано по Escape и клику вне области. В подвале рейла профиль пользователя также открывает flyout-карточку.
5. **Тестирование и верификация:**
   - TypeScript: 0 ошибок (`npm run typecheck`).
   - Frontend Vitest: 61 тестовый файл, 598 тестов пройдено из 598 (100% pass).
   - Все 7 верификационных контрактов репозитория подтверждены (`test-public-docs.ps1`, `test-repository-hygiene.ps1`, `test-unified-boundaries.ps1`, `verify-release.ps1`, `test-release-config.ps1`, `test-backup-status.ps1`, `test-deploy-fail-closed.sh`).
   - Граф знаний Graphify синхронизирован (`graphify update .`).
   - Docker-контейнер `smartupcms-web-1` пересобран и активен на `http://localhost:4200`.

### Текущая локальная работа — оргструктура и data scope, 2026-09-08

Локальный пакет оргструктуры реализован в последовательности `8e43e19`,
`f45f4ba`, `4dc7273`, `ae220f9`, `bcd4bd2`, `3338f07`, `0cc4a53` и
`eefd8ae`. Финальный backend gate на неизменённом backend прошёл 750/750;
перед ним один полный запуск получил один JDBC `BindException` в test fixture,
после чего неизменённые focused 6/6 и полный 750/750 прошли. Причина занятого
адреса на уровне ОС не доказана, исправление кода или сети не заявляется.

Чистый архив source commit
`eefd8aebbf35864df5bae90a8803aebb2e759357` прошёл Angular 54 файла / 492
теста, typecheck, localization audit 1064/1299 и production build 495.70 kB /
131.98 kB без budget warning. Новый изолированный Playwright-сценарий с
синтетическими пользователями и задачами подтвердил UI назначений, effective
scope и реальные task list/detail правила UNITS/SUBTREE/SELF, прямой 403 к
оргструктуре, занятое удаление 409, keyboard/discard, pending real write и
контролируемый 503/retry. Первоначальные функциональные пять сценариев прошли,
но шестой выявил у общего primary button clean source недостаточный dark
contrast: 13px/500 white `rgb(255,255,255)` на cyan `rgb(56,189,248)` —
2.1423:1 при требовании 4.5:1 на обоих viewport. Light — 5.9336:1. Этот
исторический результат остаётся 5/6; первоначальная версия вызывала финальную
browser-health проверку после ожидаемо падающей contrast-проверки, поэтому тот
запуск сам по себе не доказывал отсутствие console/pageerror.

Fix round 1 заменил постоянный порт теста на явно заданный проверяемый bare
loopback origin с отдельным портом, запрещает missing/mismatch/remote/4200 до
навигации и использует один origin для CSRF и дочерних browser contexts. Он
также проверяет browser health до contrast-агрегации и перед итоговым response
ledger явно ожидает успешные `GET 200` для `/custom-fields` и
`/tasks/projects`. Первый свежий clean-запуск прошёл origin guard, затем worker
завершился с Windows-кодом `3221226505` во время seed; неизменённый повтор прошёл
6/7 за 18.9 s, с единственным ожидаемым contrast fail и подтверждённо чистыми
console/pageerror. Причина worker exit не доказана, исправление продукта или ОС
не заявляется.

Отдельный candidate из того же `eefd8ae` плюс семь точных, отдельно
hash-манифестированных ранее существовавших dirty UI-файлов прошёл
первоначальный browser suite 6/6 и свежий fix-round suite 7/7 за 21.2 s, а
также Angular 54 файла / 501 тест, typecheck и localization. Его dark primary
contrast — 9.0701:1; production build вышел с кодом 0, но 501.30 kB превысили
budget 500 kB на 1.30 kB. Это evidence текущего preserved-workspace UI, а не
clean feature HEAD; dirty UI-файлы не входят в пакет оргструктуры. Clean
dark-contrast blocker сохраняется до публикации shared UI изменений.
Task-view-only роль также воспроизводит два фоновых 403 toast из unconditional
`/custom-fields` и `/tasks/projects`; scope actor использует ровно три read
permission, не получает organization/IAM assign, а fresh suite теперь
утверждает оба auxiliary `GET 200` до проверки полного page-response ledger.

### Публикация накопленных изменений — 2026-09-08

Пользователь разрешил сохранить и отправить все оставшиеся локальные изменения
в `main`. Ниже сохранены датированные результаты прежних проходов; их формулировки
«незакоммичено» и «push не выполнялся» описывают тот момент, а не текущий Git status.
Публикация не означает завершённую приёмку Search, production readiness или deploy.
Результат синхронизации и CI проверять отдельно по текущим Git SHA и run status.
Десять ранее локальных audit-черновиков сохраняются только как явно непроверенная
история по прямому запросу пользователя, не как требования или release evidence.

### Текущая локальная работа — CMS mechanics, 2026-09-07

По запросу проверить механику CMS исправлены подтверждённые сценарные ошибки
в общей панели, поиске, уведомлениях, аналитике, файлах и матрице ролей.
Изменения этого прохода остаются незакоммиченными; Java/SQL и серверные
бизнес-правила не менялись. Несвязанные ignore-файлы и audit-черновики сохранены.

- Поиск немедленно очищает устаревшую выдачу и отменяет прежний запрос,
  корректно закрывается/открывается, поддерживает физический Ctrl/Meta+K,
  keyboard focus и одну inline-ошибку без дублирующего toast.
- Выход блокирует повторную отправку, сохраняет UI при ошибке сервера,
  после успеха отбрасывает поздние `/auth/me` и очищает прежние уведомления.
  Смена языка защищена от повторов, ошибки и завершения пользовательского shell.
- Объявления используют реальный локализованный DTO `title/body` и язык API;
  закрытие одного сообщения открывает следующее непрочитанное. Header GET/SSE
  привязаны к правам и жизненному циклу shell. Старые HTTP/SSE callbacks не
  переносят данные между пользователями. Новое SSE-событие отменяет устаревший
  запрос счётчика и инициирует актуальный read; pending/read retry проверены.
- Аналитика отменяет старые периоды, сохраняет последний полный UI snapshot
  при ошибке обновления и подписывает график фактически загруженным периодом.
  Страница помещается в узкий viewport; график и таблица имеют именованную
  локальную прокрутку с клавиатуры. Это не общий транзакционный snapshot БД.
- Файлы отменяют старые list/stats GET, сбрасывают страницу поиска, удерживают
  одну цель удаления во время запроса и показывают одну ошибку с retry.
  Условия удаления в UI соответствуют серверу: `delete && (owner || manage_quotas)`.
- Матрица ролей допускает изменение/PUT только после загрузки прав выбранной
  роли; старый ответ другой роли не может подменить сохраняемые права.
  Pending PUT блокирует повторы и переключение; `update` не заменяет `grant`.

Финальная проверка: Angular 292/292; Maven verify 437/437 до последующих
frontend-only правок; app/E2E typecheck, i18n audit (1038 references / 1075 RU
keys), production build, E2E config 3/3, artifact-security, docs/hygiene и
architecture gates — PASS. Независимое scoped review завершено без оставшихся
Important. Полный instance suite прошёл 40/40 на web v2 и повторно 40/40 на v3;
прежний mobile overflow `/analytics` исправлен, task-create прошёл оба раза.

Изолированный стенд `http://127.0.0.1:14206`, schema 025: server image
`smartupcms/server:cms-mechanics-20260907-v1`, web
`smartupcms/web:cms-mechanics-20260907-v3`. Chromium: header/search и Analytics
проверены при 1366×900, 390×844 и 320×844 в двух темах; axe header/search — без
нарушений. Контролируемые HTTP-ошибки проверены отдельно от реальной записи
данных в E2E. Evidence и временные browser scripts находятся вне Git:
`C:/Temp/smartupcms-cms-mechanics-qa-20260907/`. Browser plugin отсутствовал,
использован Playwright. Другие браузеры, внешние доставки, production ClamAV/R2
и нагрузочные сценарии в этом проходе не проверялись. `localhost:4200`, push
и production/deploy не изменялись; Graphify обновлён локально и не staged.

**Открытые ограничения, не считать исправленными:**

- H01: `/auth/password-reset/request` создаёт код, но не отправляет инструкцию,
  хотя UI сообщает об отправке. Legacy confirm не использует протокол версии
  доступа и атомарного single-use. Требуется отдельное согласование полного
  восстановления, включая канал доставки; пользовательский выбор ещё не получен.
- `security.min_password_length`, `security.session_lifetime_hours` и
  `security.require_2fa` сохраняются настройками, но не применяются enforcement-кодом.
  Нельзя считать эти UI-поля действующей политикой авторизации. Правила обязательной
  2FA и перехода существующих пользователей не выбирались автоматически.
- Лимиты текущих UI-списков файлов (100) и уведомлений (50), переход из глобального
  поиска к списку вместо конкретной записи и остальные не покрытые сценарии не
  расширялись. Проверка прохода не означает полной production readiness CMS.
- Один ранний localization cleanup получил CSRF 403; причина не установлена.
  Добавлена диагностика без значений токенов. Focused повтор 10/10 и оба последних
  полных прогона прошли; это не доказательство отдельного исправления CSRF.

### Текущая локальная работа — Login UX, 2026-09-06

В согласованном первом UI/UX-пакете улучшены три шага `/login`: credentials,
OTP и обязательная смена пароля. Добавлены независимый показ паролей,
подсказка Caps Lock без смещения кнопок, явный keyboard focus и inline-ошибки
без дублирующих error-toasts. Повторная отправка и переход назад блокируются
на время запроса; возврат очищает секретные поля. Сохранённая тема применяется
до открытия app shell; контраст primary-кнопок исправлен локально для login.
Меню, поиск, серверная авторизация и reset H01 в этот пакет не входят.

TDD и браузерные регрессии подтвердили обработку ошибок, восстановление focus,
стабильность pointer targets при Caps Lock, сохранённую тёмную тему и очистку
auth state после завершившейся смены пароля даже при уничтожении компонента.
Angular — 219/219; focused auth/password-change E2E — 10/10; app/E2E typecheck,
i18n audit (1037 referenced / 1073 RU keys), production build, E2E config и
artifact-security — PASS. Независимое scoped code review завершено без
оставшихся замечаний. Это проверка пакета, не полный release acceptance.

Изолированный loopback-only candidate — `http://127.0.0.1:14205`, schema 025;
артефакты — вне Git в `C:/Temp/smartupcms-login-ux-qa-20260906/`.
Три шага проверены в Chromium при 1366×900, 390×844 и 320×740, в обеих темах:
нет горизонтального overflow; финальные accessibility-проверки не выявили
serious/critical нарушений. Реальная смена пароля и явный повторный вход
покрыты E2E; OTP/pending UI дополнительно проверены на синтетических ответах,
без отправки сообщений. Другие браузеры и полный instance suite не запускались
повторно; прежние несвязанные ограничения полного прогона остаются ниже.
`localhost:4200`, production, push и deploy не изменялись.

### Текущая локальная работа — Authentication generation, 2026-09-06

Реализован согласованный механизм монотонной версии доступа из
[дизайна authentication generation](superpowers/specs/2026-09-06-authentication-generation-design.md):
смена пароля, блокировка и анонимизация увеличивают версию; разблокировка
версию не меняет. Cookie-сессии, API-токены и login/channel OTP принимаются
только при совпадении сохранённой версии с активным пользователем. Публичные
password DTO и JSON-проекции внутреннюю версию не раскрывают. Миграция
`V025__authentication_generation.sql` проверена на upgrade/repeat/readiness.

UI после успешной обязательной или профильной смены очищает локального
пользователя, permissions и секретные поля, отбрасывает запоздалые `/auth/me`,
показывает одно сообщение на глобальном toast-host и возвращает на `/login` с
обязательным явным повторным вводом credentials. Ошибка сохраняет форму для
исправления. Постоянный Playwright regression проверяет два старых session
cookie, два API-токена, другого пользователя, негативные 401/422 и повторный
вход на реальном server/PostgreSQL.

Backend-пакет `0be3963..f57eb6c` и независимый Maven verify дали 437/437.
Финальный frontend: Angular 196/196, app/E2E typecheck, i18n audit
1031 referenced / 1067 RU keys, production build, E2E config 3/3 и
artifact-security — PASS. На свежем изолированном candidate с PostgreSQL 18,
явной миграцией до 025 и loopback-only web `127.0.0.1:14204` оба auth browser
case прошли 2/2; desktop 1366×900 и mobile 390×844 визуально проверены без
старых error-toasts, runtime overlay или page overflow на auth surface.

Последний полный instance run завершился 37/39: оба authentication case
прошли, но остались несвязанные mobile overflow `/analytics` и timeout старого
task-create browser case; отдельный повтор прежнего task-flow прошёл 1/1.
Артефакты находятся вне Git в
`C:/Temp/smartupcms-auth-generation-qa-20260906/`. Candidate сохранён для
review; `localhost:4200`, production, push и deploy не изменялись. Rollout
требует drain старых writers; после продвижения версий app-only rollback на
старый writer не валидирован. Reset H01 и оставшийся OTP scope не закрыты.

### Текущая локальная работа — Projects interaction и E2E, 2026-09-06

По подтверждённому пользователем [плану трёх follow-up задач](superpowers/plans/2026-09-06-projects-interaction-e2e-quality.md)
реализованы правдивые подписи закрытых задач, native form/keyboard interaction
и постоянные браузерные регрессии Projects. Source commits: `96ac5d5`,
`adcb531`, `e3e0627`; E2E commits — `b958a58`, `4a5f764`.

`doneTasks` по-прежнему считает конечные статусы, включая отмену. UI теперь
пишет «закрыто», объясняет состав показателя и использует соответствующие
accessible names в списке и карточках. Расчёты, DTO, права и data scope не
изменены. Шесть новых семантических RU-ключей синхронизированы с packaged
fallback, без старых completed-only переводов.

Создание и редактирование используют настоящие формы и внешние native submit
кнопки: Enter в имени отправляет один запрос, Enter в textarea остаётся
переносом строки. Локальные edit targets увеличены до 28×28 px; видимые A/P
убраны, значения состояния сохранены. `UiModal` потребляет обработанный
Escape до синхронного close callback: causal unit RED подтвердил защиту от
закрытия нового или второго stacked dialog тем же событием.

Постоянный `e2e/tests/browser/instance/projects-quality.spec.ts` покрывает
реальное создание/изменение, sparse PATCH, сохранение/очистку описания,
dirty Cancel/Escape, Tab/focus, контролируемые 503 и реальный retry. Отдельный
read-only HTTP fixture проверяет фильтры, pagination/search reset, неизвестную
статистику, list/cards, hitboxes и mobile 390×844; это не DB/load acceptance.
Два первоначальных browser failures оказались гонками теста: требовалось
дождаться скрытия первого confirmation и начального захвата фокуса новым
диалогом перед следующим Escape/Tab. Ожидания явных UI-состояний устранили
гонки без задержек, force-click или дополнительных изменений приложения.

Подтверждено на чистом application archive `e3e0627`: Angular 189/189,
Maven 364/364 (server359 + libraries5), app/E2E typecheck, i18n audit
1034 referenced / 1065 RU keys, E2E config3/3 и artifact-security gate.
Первый browser run с E2E commit `b958a58` прошёл 37/37 за 2,5 минуты
на изолированном `localhost:14200`, но это не финальная приёмка:
последний run с `4a5f764` завершился 36/37 за 2,7 минуты — существующая
проверка mobile overflow упала на `/analytics`. Все шесть Projects cases прошли.
Desktop1366×900/mobile390×844 Projects screenshots
проверены: содержимое, подписи, фильтр, 28px actions, отсутствие page overflow
и browser console/page errors. Артефакты вне Git:
`C:/Temp/smartupcms-projects-interaction-qa-20260906/`.

Task review потребовал сузить console allow-list ожидаемого 503; `4a5f764`
использует точное сообщение Chromium и проверяет полный набор 503 responses
по method/path. Scoped review принят, affected cases2/2 и gates прошли.
Финальный whole-change review не нашёл дефектов реализации, но оставил
приёмку незавершённой из-за последнего 36/37 результата.

Read-only сравнение двух web images на одинаковых изолированных backend/data
воспроизвело один и тот же дефект Analytics: старый `54b6159` на временном
14202 и новый `e3e0627` на14200 после загрузки всех четырёх Analytics GET
имеют `.page-content` clientWidth390/scrollWidth499 и grid366/487.
Source Analytics/styles/layout не менялся в этом пакете. Probe2/2 подтвердил
существующее переполнение, а не исправление; ранний зелёный smoke не является
доказательством корректности полностью загруженного экрана. Evidence —
`analytics-baseline-results` и `accepted-final-browser-results` во внешней
QA-папке. Временный сравнительный web container14202 удалён после проверки;
images и изолированные data volumes сохранены.

Нужно отдельное решение пользователя о расширении scope на мобильную
«Аналитику». До него `4200` остаётся на `54b6159`; promotion и новая read-only
entry проверка не выполнены. Precheck: 48 environment keys совпадают,
PostgreSQL/Typesense и mounts неизменны, migration read24/024/0 failures;
rollback `local-54b6159` images сохранены. Изменения остаются локально в main,
push не выполнялся. Прежние Maven/JNA и Graphify version/label warnings не
выдаются за исправленные дефекты. Не отмечать весь пакет принятой поставкой.

### Предыдущий локальный пакет — Projects editor, 2026-09-06

По запросу пользователя локальная установка `http://localhost:4200` обновлена
из чистого `git archive 41ec91d`: matching server/web images, 24 проверенные
миграции, schema 024 без новых миграций, оба сервиса healthy и `/healthz` 200.
PostgreSQL и Typesense не пересоздавались; именованные data volumes сохранены.
Предыдущие server/web images сохранены локальными тегами `before-41ec91d`.
Это обновление локальной dev-установки, не production deploy или release gate.

Затем по [плану Projects editor](superpowers/plans/2026-09-06-projects-editor-quality.md)
реализованы `b321599` и `8912e00`: защита create/edit-черновиков подтверждением,
fresh GET перед редактированием с retry, блокировка полей и закрытия во время
сохранения, защита повторной отправки и устаревших callbacks. PATCH содержит
только изменённые поля, пустое описание передаётся как `''`, сохранение без
изменений не делает запрос. Ошибка сохраняет черновик и доступна inline;
владельцем общего toast остаётся ApiService. Это не optimistic locking.

Frontend принят независимым task review без замечаний: Projects 21/21,
полный Angular 32 файла / 179 тестов, typecheck/build и i18n audit 1036/1059.
Поведенческий RED дополнительно воспроизведён на чистом `41ec91d`: три
скомпилированных DOM-теста завершились assertion failures, без test errors.
На отдельном Docker candidate `smartupcms-projectsq-20260906` (`14200`) с
синтетическими данными и чистыми image inputs `b321599` прошли Playwright
31/31, config 3/3, E2E typecheck и artifact-secret gate. Новый candidate
первоначально получил все 24 миграции на пустой БД.

Отдельный frontend fixture `14201`, без upstream или credentials, проверен
в light/dark на 1280×720 и 390×844: dirty Cancel/Escape, сохранение черновика,
pending create/edit, recoverable detail/save errors, retry, sparse PATCH и
очистка описания. Mobile document 390/390, console после финального reload
без warnings/errors. Это не проверка реальных серверных ролей или
аутентифицированной страницы Projects на `4200`. Артефакты вне Git:
`C:/Temp/smartupcms-projects-editor-qa-20260906/`.

Серверный пакет `0e5803f`, `9aa23e1`, `54b6159` добавляет проверку имени после
нормализации и статуса A/P до записи, индексирования и аудита. Контракт ошибок
сохранён: HTTP 422 / `validation_failed`. PATCH без attributes больше не
вызывает PostgreSQL 500: SQL использует typed JSONB coalesce и сохраняет
текущее значение строки атомарно, не service snapshot. Это не optimistic
locking и не защита от двух одновременных изменений одного поля.

На реальном PostgreSQL: initial RED 17 тестов / 15 ожидаемых failures;
дополнительный overlap RED — 1 ожидаемый failure; normalized-name RED —
4 случая / 1 failure для `\b`. Итоговый focused GREEN 19/19; полный Maven
reactor 364/364 (server 359, libraries 5), без failures/errors/skips.
Независимый task review, whole-change review и scoped re-review единственной
финальной fix wave закрыты без открытых Critical/Important. Прежний шум
Java/JNA/Testcontainers остаётся non-blocking minor, upgrade не выполнялся.

Дополнительный внешний Playwright-сценарий на Docker `b321599` воспроизвёл
реальный сбой: name-only PATCH возвращал 500 вместо 204. На `9aa23e1` тот же
тест прошёл: create → fresh edit → dirty Cancel с сохранением черновика →
sparse PATCH → повторное открытие → очистка описания → подтверждение из GET.
Full E2E `9aa23e1` также прошёл 31/31. Сценарий пока хранится только во
внешней QA-папке; в постоянную CI suite он не добавлен.

Финальная combined acceptance чистого `54b6159` завершена: 31/31 E2E за
2,3 минуты и внешний editor-сценарий 1/1. Первый запуск внешнего сценария
остановился на ошибке Playwright/CDP при чтении тела успешного POST201;
созданная строка была видна. Тест теперь берёт ID из URL наблюдаемого fresh
GET, сохраняя проверки статусов, payload и round-trip; повторный запуск
успешен. Этот сбой тестового транспорта не скрыт и не выдан за дефект UI.

`4200` затем обновлён теми же протестированными images `54b6159` без rebuild
из dirty checkout. Server/web и data services healthy, `/healthz`200;
публичные новые ru-ключи совпадают с source. Проверены неизменность environment,
mounts и времени старта PostgreSQL/Typesense; их контейнеры не пересоздавались.
24 миграции проверены, schema024, новых миграций не требуется. Rollback images
сохранены как `smartupcms/server:local-41ec91d` и `smartupcms/web:local-41ec91d`.
IAB после reload4200 показывает рабочий login без console warnings/errors;
пользовательский Chrome и данные установки не использовались для мутационных
тестов. Внешний candidate14200 и fixture14201 оставлены для продолжения QA.
Graphify обновлён AST-only, generated outputs не опубликованы. Docs105/19,
repository-hygiene, architecture-boundary и whitespace gates проходят.

Предложенные после этого пакета подписи закрытых задач, размеры/доступность
действий и постоянные браузерные регрессии описаны в текущем разделе выше.
Push не выполнялся.

### Предыдущий локальный пакет — Projects list, 2026-09-06

По подтверждённому пользователем [первому пакету Projects](superpowers/plans/2026-09-06-projects-list-quality.md)
реализован локальный commit `9ad7997`: фильтры сбрасывают страницу, reload
ограничивает её доступным диапазоном и сохраняет фокус на созданном проекте.
Список и статистика имеют независимые loading/error/retry-состояния и отмену
заменённых/уничтоженных GET-подписок. Недоступная/неполученная статистика не
выдаётся за ноль; настоящий ноль из успешного ответа сохраняется. Create/update
проверяют права проектов, а статистика и переходы к задачам — право просмотра
задач. Контроллеры, backend action permissions и task row scope не изменялись.

TDD: Projects RED — 7 ожидаемых failures / 4 passes; GREEN — 11/11. Полный
Angular suite повторно проверен на коде commit: 32 файла / 169 тестов, 0 failures;
app typecheck, production build и i18n audit (1 027 ссылок / 1 048 русских ключей)
прошли. Независимые task и whole-change review завершились без
Critical/Important/Minor замечаний. Первый пакет локально принят; это не
закрытие остальных находок Projects или production release gate.

Браузерная проверка использовала отдельный dev frontend `localhost:14201` и
read-only proxy к прежней синтетической установке `14200`, без изменения
`4200`, образов или данных. Для новых подписей proxy отдавал текущий source
`ru.json`, а не старый каталог из неизменённого server image. HTTP-фикстуры
подтвердили 21 проект / page-2 search / Archive, ошибки и retry списка/статистики,
pending/missing versus zero, а также UI с правом только просмотра проектов.
Это не проверка реального изменения серверных ролей. На pass-through данных
проверены семь проектов и keyboard-переход проекта 2 к его задаче #3.
Desktop 1280×720 и mobile 390×844, light/dark проверены; mobile document
390/390 без внешнего overflow, финальный warning/error log пуст.

Артефакты находятся вне Git:
`C:/Temp/smartupcms-projects-fix-qa-5fa11abfcf9b4d8b9d09a9d08da37fd2/`.
Graphify обновлён AST-only, generated output остаётся dirty/неопубликованным;
его version/community-label предупреждения не устранялись upgrade или LLM.
Это локальная проверка первого пакета, не deploy/production readiness.
Полные backend и Playwright E2E suites для этого пакета не запускались.
Следом остаются защита черновиков, pending/fresh edit, серверная валидация
сохранения, подписи/размеры действий и расширенные E2E. Push/deploy не выполнены.
На завершающей read-only проверке временные `14201/14202` уже не слушали порты,
IAB-вкладки отсутствовали; viewport override сброшен. Прежний candidate
`14200/healthz` также отклонял соединение, его running-контейнеров не найдено.
Причина не подтверждена; повторный подъём/удаление контейнеров не выполнялись.
Ранее записанные проверки относятся к моменту их выполнения, а не к текущей
доступности preview.

### Текущая локальная работа — 2026-09-05

Локально реализованы четырнадцать принятых исправлений качества Tasks по
[плану Tasks Quality](superpowers/plans/2026-09-05-tasks-quality.md): PATCH
различает отсутствие и явный `null`, изменения задачи и участников атомарны,
комментарии содержат отображаемого автора, а UI защищает fresh edit/detail,
точность времени, pending-формы и dirty-dismissal. Список задач и селекторы
используют независимую bounded cursor-pagination; Active/All/status доступны в
таблице и kanban. Поиск владеет debounce/cancellation, вложенные действия
клавиатуры не открывают detail, а статусный native select использует
семантический цвет текста в обеих темах. Права и server row scope не расширены.

Финальное дерево приложения `fb59a2c` проверено: Angular 32 файла / 161 тест,
app typecheck и production build прошли, i18n audit — 1 018 ссылок / 1 039
ключей; Maven reactor — server 340/340 и библиотеки 5/5. Browser E2E собран из
чистого `git archive fb59a2c` в отдельном Compose-проекте
`smartupcms-tasksq-ecb2e05e`, доступном только через loopback origin
`http://localhost:14200`; persistent `localhost:4200` не затрагивался. Пустая
candidate DB первоначально получила все 24 миграции; финальная пересборка
сохранила её синтетические данные и не потребовала новых миграций.
Повторно прошли 31/31 Playwright-сценариев за 2,1 минуты: прежние 24 и семь
новых Tasks regressions для
date/observer/comment/keyboard/dirty-cancel, 125 cursor rows, error/retry,
stale search, first-empty create, kanban/mobile и literal light/dark
status-select colors. Сценарии 125 строк, ошибок и гонок используют
контролируемые HTTP-ответы, а не нагрузку на БД. E2E
config 3/3, typecheck и artifact-secret gate также прошли; после suite все
четыре candidate-сервиса healthy и `/healthz` возвращает 200.

Артефакты isolated runtime и Playwright находятся вне репозитория в
`C:/Temp/smartupcms-tasks-quality-ecb2e05e0db34d62acd838c8702b5cc6`.
Это локальная acceptance-проверка, не deploy, нагрузочный тест или
доказательство production readiness. Live IAB на candidate подтвердил
desktop 1280×720 и mobile 390×844 без горизонтального overflow, видимые
Active/All/status в kanban, полную export-scope/filter подсказку и
native status-select в light/dark с RGB `15 23 42` / `255 255 255` и
`241 245 249` / `19 27 46`. Финальная console не содержала warnings/errors;
пользовательский Chrome и установка `localhost:4200` не затрагивались.
Скриншоты хранятся только во внешней папке `screenshots`.

Финальное whole-change review завершено. Единственный финальный fix batch
`fb59a2c` исправил совместимость общего компонента пагинации: только Tasks
передаёт `cursorItemsArePageLength=true`, Audit/Security Events сохраняют
известный total и ограниченные размером страницы диапазоны. Одновременно
унифицирована подпись пустых dynamic fields и убрано ложное empty-состояние
remote selectors во время загрузки/ошибки. Scoped re-review подтвердило все
три исправления без новых Critical/Important или отложенных замечаний.
После reload финальной сборки IAB подтвердил подпись «Динамические поля»,
keyboard edit, сохранённого наблюдателя и очищенный срок, а также диапазоны
Audit `1–20 → 21–40 → 41–60` из 116, Security Events `1–20 → 21–40` из 153
(только синтетические candidate totals); console чистая. Все пять задач плана
завершены, candidate оставлен запущенным. Изменения сохранены локальными
коммитами в `main`; push, внешняя CI и deploy этого пакета не выполнялись.
Graphify повторно обновлён AST-only, но generated output остаётся dirty и не
предназначен для task commit. Обновление завершено с предупреждением о
версиях Graphify skill/package 0.9.13/0.9.51, без upgrade.

### Ранее выполненный пакет I-01

Начата последовательная реализация [release-hardening плана](superpowers/plans/2026-09-05-release-hardening.md).
Разработка I-01 начиналась в `codex/release-hardening` от
`710efeb55c03c2d444cfc8fd22dcefa01635e99c`. По прямому указанию пользователя
работа перенесена в `main`; дальнейшую подготовку релиза вести в основной
ветке. Перед публикацией remote был проверен: новых upstream-коммитов нет,
из удалённых веток существует только `main`.

Первый пакет I-01 реализован локально: `ReportController` передаёт actor в оба
формата; `ReportService` требует actor до вывода байтов и использует один SQL
query с `MdScopeService.filterForTasks`. CSV нейтрализует опасные начальные
символы во всех четырёх редактируемых колонках; XML сохраняет типизированные
строки. UI-контракт, область ALL, пустая выгрузка и права не изменены.

Проверка TDD на реальном PostgreSQL: до исправления — 26 scope/null-actor
assertion failures; отдельный CSV red — 22 failures; после исправления — 69
новых export cases проходят. Полный нативный Maven `verify` (Java 25.0.2,
Maven 3.9.16, Testcontainers с Docker Desktop) завершился успешно: сервер
334 tests, 0 failures/errors/skipped. Public-docs, unified-boundary, hygiene
и whitespace gates зелёные; независимый read-only security review не нашёл
конкретных обходов или регрессий. Graphify обновлён AST-only; его dirty outputs
не готовы для публикации из этой рабочей копии.

Команды, ограничения и локальные log paths — в
[плане I-01](superpowers/plans/2026-09-05-task-export-security.md).
Перед публикацией на `main` повторно прошли: backend 334/334, frontend 107/107,
typecheck/build, i18n audit 1009/1022, все семь configuration/docs gates,
fail-closed deploy test, E2E config/typecheck/artifact-security и Chromium
24/24 на отдельном чистом Compose-стеке. Тестовые volumes удалены; рабочая
локальная установка этими тестами не затрагивалась.

Два препятствия release gate устранены минимально: `.gitleaksignore` теперь
содержит точный исторический путь одного Testcontainers fixture (207 commits,
0 findings); E2E локализации ожидает успешный PATCH языка до навигации и
завершения cleanup, чтобы не оставлять немецкий язык следующим сценариям.
Код пользовательской локализации и таймауты не изменены. Кэшированный web
image пересобран без кэша для обновления curl/libcurl до `8.22.0-r0`; candidate
server/web images прошли Trivy HIGH/CRITICAL gate с `--ignore-unfixed`.

Подтверждённый remote baseline до этой публикации — `710efeb`, CI
[33919965919](https://github.com/qahhor/dwh/actions/runs/33919965919) — success.
Результат push/CI/deploy текущего коммита проверять отдельно по Git и runtime,
не выводить его из pre-publication evidence. Цель прежнего deploy-запроса —
существующая локальная установка `http://localhost:4200`; production-конфигурация
`.env.production` отсутствует. Spreadsheet applications не запускались;
полная релизная готовность не заявлена. Следующий пакет — I-04: перепроверить границу
идемпотентности, составить детальный план, затем исключить кэширование секретов
и проверить допустимые повторы/восстановление. Остальные пакеты не реализованы.

### Историческое опубликованное evidence

По сохранённому handoff полностью зелёный опубликованный code-bearing baseline — immutable
commit `bd99b4f5f1a59532c7b8d5f320c3d214fd09e003`. Remote CI
[run `33919377814`](https://github.com/qahhor/dwh/actions/runs/33919377814)
завершён `success`: backend, frontend, release-config, security и clean-deploy
browser E2E jobs зелёные.

Исторический docs-only commit
`03956fd3e42a76297e029c139981c4de2c0425b5` имел remote CI
[run `33916140833`](https://github.com/qahhor/dwh/actions/runs/33916140833)
не является зелёным: backend, frontend, release-config и security прошли, но
E2E завершился 23/24 из-за воспроизведённого `429` на audit-странице. Причина —
три независимых read endpoint (`stats`, `logs`, `security-events`) делили один
expensive bucket `/api/v1/audit/**`; предыдущие audit/light-theme запросы
исчерпывали его перед dark-theme сценарием.

`57efcd77` закрывает локальную реализацию `P0-14`:

- ADR-0013 фиксирует единый контракт `ALL/SUBTREE/UNITS/SELF` для задач,
  комментариев и файлов; недоступный прямой идентификатор возвращает `404`;
- task/file repositories применяют row-scope в SQL до пагинации и подсчётов,
  HTTP controllers всегда передают идентификатор аутентифицированного
  пользователя;
- назначения участников проверяются по actor scope, а замена роли
  пересчитывает permissions и effective data scope в одной транзакции;
- Flyway `V024` добавляет обратный индекс вложений комментариев;
- Maven: 262 теста, 0 failures/errors/skipped; Angular: 31 test files / 107
  tests, typecheck, localization audit `1009/1022` и production build; E2E
  config/typecheck/artifact-security и семь architecture/docs/release/
  production gates зелёные.

Первый E2E-дефект (общий expensive bucket для `/api/v1/audit/**` и
`/api/v1/search/**`) исправлен в `5eba93f`; локально Maven и browser E2E 24/24
были зелёными. Артефакт run `33909868657` выявил второй дефект: все
неаутентифицированные запросы делили строгий IP bucket, поэтому параллельные
browser contexts за одним CI/corporate NAT получали `429` при загрузке публичных
i18n-словарей и показывали raw translation keys на форме входа. Commit `6606a7a`
выделяет `GET /api/v1/i18n/languages` и locale dictionaries в независимый
настраиваемый `public-read` bucket; новый regression test сначала красный
(`404` ожидался, получен `429`), после исправления зелёный 5/5. Полный Maven
suite с PostgreSQL/MinIO Testcontainers: 264 теста, 0 failures/errors/skipped;
Angular: 31 файлов / 107 тестов, typecheck/build/i18n audit green; пересобранный
Docker runtime: Playwright 24/24 green.

Commit `6606a7a` также реализует локально проверяемую часть `P0-15`: fail-closed managed
preflight/host contracts, digest-only deployment evidence, 100-user/20-upload/
4h k6 profiles, runtime storage/scanner latency metrics, failure drills,
encrypted object backup, combined isolated restore и published-release
verification. Это код и процедура, не доказательство реального окружения.

Commit `7df3d64` разделяет expensive buckets для трёх audit endpoint и
добавляет regression test независимости лимитов. TDD evidence: до исправления
test ожидал `404` для `/audit/stats`, но получал `429`; после исправления
`RateLimitFilterTest` — 6/6. Полный Maven `verify` с PostgreSQL/MinIO
Testcontainers — 265 тестов, 0 failures/errors/skipped. Пересобранный Docker
runtime на чистых изолированных volumes прошёл Playwright 24/24; основной
локальный runtime после проверки восстановлен и healthy. Remote CI подтвердил
исправление на том же SHA и вернул release gate в `Verified`.

Commit `bd99b4f` также заменяет deprecated Node 20 pins во всех GitHub
workflows на официальные Node 24 releases: checkout v6.1.0, setup-node v6.5.0,
setup-java v5.6.0, upload-artifact v6.0.0 и download-artifact v7.0.0. Все
actions по-прежнему зафиксированы immutable SHA; `verify-release.ps1` теперь
запрещает возврат этих пяти action families на неутверждённый pin. Локальные
`actionlint` и supply-chain contract зелёные; remote CI `33919377814` подтвердил
все пять jobs без прежних Node 20 annotations.

## 7. Открытые release gates

Production readiness остаётся условной, пока не закрыты:

- утверждённые p95/p99/error/saturation thresholds и распределение нагрузки по
  установкам;
- privacy/retention/legal owners и процессы delete/export/hold;
- external metrics/log collection, alert delivery и named on-call;
- изолированный DB-plus-objects restore drill с проверкой checksums и RPO/RTO;
- installation-specific domain, Cloudflare/origin policy либо альтернативный
  self-hosted edge, provider region и rollback/go-no-go owner;
- опубликованный stable release со связанными SBOM/provenance/signatures и
  пятью image digests.

Для выполнения target-only managed gate отсутствуют: Hetzner staging host,
production/staging hostname, Cloudflare zone/token, отдельные application и
recovery R2 buckets/credentials, alert receiver и named on-call, утверждённые
SLO/RPO/RTO thresholds, 100 staging load-user tokens и опубликованный release
tag с пятью digest-addressed images. Эти пункты остаются `UNVERIFIED` и блокируют
GO; локальная эмуляция не может изменить их статус.

Текущий список и доказательства находятся в
`audit/health-check-2026-09-04.md` и
[production launch checklist](ops/production-launch-checklist.md).

## 8. Рабочий протокол для AI

1. Сначала прочитать этот файл, ТЗ, индекс документации и применимые ADR.
2. Выполнить `git status --short --branch`; любые существующие изменения считать
   пользовательскими, пока не доказано обратное.
3. Для codebase-вопроса сначала использовать `graphify query`, затем проверять
   вывод по исходным файлам.
4. Не выдумывать отсутствующие SLO, даты, provider settings, владельцев или
   результаты тестов.
5. Не расширять продукт без нового решения; предпочитать минимальный
   исправляющий шаг и измеримый критерий проверки.
6. После изменений запускать наиболее узкие релевантные проверки, затем полный
   обязательный gate перед release-утверждением.
7. Если dirty worktree содержит неопубликованные файлы, Graphify для коммита
   генерировать из clean checkout целевого commit, чтобы граф был
   воспроизводимым.
8. Не выполнять push, deploy, удаление данных или изменение внешней
   инфраструктуры без явного разрешения пользователя.

Базовые команды проверки перечислены в
[testing strategy](guidelines/testing-strategy.md) и корневом
[README](../README.md#development).
