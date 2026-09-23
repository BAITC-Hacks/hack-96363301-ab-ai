# Заметки по стеку и грабли

Проверено 22.09.2026 на этой машине. Файл локальный, в `.claude/` — исключён из индекса.

## Локальные файлы подготовки

| Файл | Зачем |
|---|---|
| **[`runbook.md`](runbook.md)** | **Порядок действий 23 сентября: какие команды и когда.** Открыть первым делом утром |
| [`verify-roles.md`](verify-roles.md) | Проверка, что агенты загрузились из актуальных файлов (после перезапуска) |
| `stack-notes.md` | Этот файл: стек, скелеты, грабли окружения |

Все три скрыты от git через `.git/info/exclude` и в репозиторий не уходят.

## Готовые скелеты — `C:\Users\huawei\scaffolds`

Четыре проекта с уже установленными зависимостями. Копировать папку быстрее, чем ставить с нуля, и не зависит от скорости сети на площадке:

| Папка | Что внутри |
|---|---|
| `nest-api` | NestJS + TypeORM + pg + JWT + Swagger + socket.io + openai, Prisma 5.22 |
| `vite-react-ts` | React + Vite + TypeScript + Tailwind |
| `flutter-app` | Flutter, 103 пакета, цели web и android |
| `express-api` | минимальный Express + zod + SDK, если Nest избыточен |

Использование: `cp -r C:\Users\huawei\scaffolds\<папка> <место>`, затем переименовать проект в `package.json` / `pubspec.yaml`.

Для Flutter после копирования **обязательно** `flutter pub get` — в `.dart_tool/package_config.json` лежат абсолютные пути, после переноса они неверные.

**Это шаблон — его надо раскрыть в README**, как требует регламент («свои шаблоны раскрыть»). Реализации кейса в скелетах нет, только boilerplate генераторов.

## Node / NestJS

`nest` 12.0.3 установлен глобально, резолвится из чистого PATH. Node 22.23.1, npm 10.9.8.

**Грабля: `npm install` внутри Nest-проекта падает** с `Cannot read properties of null (reading 'edgesOut')`. npm при этом здоров — в чистой папке всё ставится. Лечится флагом:

```bash
nest new <имя> --skip-git --skip-install --package-manager npm
cd <имя>
npm install --legacy-peer-deps
npm install --legacy-peer-deps <остальные пакеты>
```

Создавать проект сразу с `--skip-install` и ставить руками — иначе `nest new` упадёт на своём внутреннем `npm install`.

**Прогрето в кеш и проверено сборкой + запуском** (приложение стартует, отдаёт HTTP 200):
`@nestjs/typeorm typeorm pg` · `@nestjs/config class-validator class-transformer` · `@nestjs/jwt @nestjs/passport passport passport-jwt bcrypt` · `@nestjs/swagger` · `@nestjs/websockets @nestjs/platform-socket.io socket.io` · `openai multer` · типы `@types/passport-jwt @types/bcrypt @types/multer`.

## Prisma — обязательно пинить версию

**Грабля: на npm тег `latest` у Prisma указывает на релиз-кандидат `8.0.0-rc.15`.** У него переписан CLI, команды `generate` просто нет. Голый `npm i prisma` даёт нерабочий инструмент.

Ещё: в Prisma 7 из схемы убрали `datasource.url` — теперь нужен `prisma.config.ts` и адаптер в конструкторе `PrismaClient`. Привычный формат из 5.x не заводится.

Поэтому ставить только с явной версией:

```bash
npm install --legacy-peer-deps prisma@5.22.0 @prisma/client@5.22.0
```

Это та же версия, что в `D:\dev\window\backend`. Движки (`query_engine-windows.dll.node`) уже скачаны и лежат в кеше. Последний стабильный в 7-й ветке — `7.10.0` (тег `prev`), тоже прогрет, но формат схемы там другой.

## Flutter

Flutter 3.41.6 stable, Dart 3.11.4, SDK в `C:\Users\huawei\flutter\flutter`, в PATH. `flutter doctor`: Android SDK 37.0.0 — ОК, Chrome — ОК, Windows-desktop — **сломан** (в Visual Studio нет workload «Desktop development with C++»). Чинить не нужно: для хакатона цель — web, десктоп не понадобится.

Прогрето и проверено: `precache` для web и android, проект на `--platforms=web,android`, 103 зависимости, `flutter analyze` без замечаний, **собраны обе цели** — `build/web` (`main.dart.js` 1,8 МБ) и `app-debug.apk`.

Пакеты в кеше (отобраны по тому, что реально используется в `D:\dev`):
`http` · `flutter_riverpod` · `go_router` · `shared_preferences` · `file_picker` · `image_picker` · `path_provider` · `url_launcher` · `share_plus` · `pdf` · `printing` · `intl` · `uuid` · `collection` · `shimmer` · `fl_chart` · `flutter_map` · `latlong2`.

`pdf` + `printing` пригодятся, если кейс просит выгрузку отчёта; `fl_chart` — для дашборда; `flutter_map` + `latlong2` — если попадётся логистика.

**Отдавать жюри лучше web-сборку**, а не APK: открывается по ссылке, ничего не надо устанавливать. Готовую `build/web` можно поднять локально (`python -m http.server` в этой папке) и при необходимости выдать наружу через `cloudflared` — это закроет пункт 11 README про развёрнутую версию.

Если Flutter всё же берём — помни, что жюри должно суметь повторить запуск по README: для web нужен только `flutter build web` и любой статический сервер.

## Что выбирать под кейс

- **ORM:** TypeORM — он в `window/backend-nest` и `SkillSwap_35/backend`, то есть привычнее в связке с Nest. Prisma — только если кейс проще ложится на неё.
- **Бэкенд:** Node/TS, не Python. Python-проектов в `D:\dev` нет ни одного, FastAPI прогрет на всякий случай, но скорость у тебя в Nest/Express.
- **Фронт:** React + Vite + TS + Tailwind — прогрето, совпадает со `SkillSwap_35/frontend`. Быстрее всего для веб-демо.
- **Flutter** — если кейс мобильный по сути или если UI на нём соберётся быстрее. Собирать в web, не в APK.
- **БД:** локальный PostgreSQL 17 или образ `postgres:16-alpine` в Docker — оба готовы.

## Выбор кейса — времени на раздумья не будет

Задание публикуется **в момент старта**, заранее его не увидеть. Значит первые 10–15 минут уходят на выбор, и решать надо по заготовленному правилу, а не с нуля:

1. Отбросить кейсы, требующие данных или доступов, которых на руках нет.
2. Искать форму «грязный вход → структурированный разбор → проверяемое действие».
3. Считать обязательные требования: 3–5 проверяемых — берём, десять размытых — мимо.
4. Проверить, что демо показывается за 2 минуты без долгой подготовки.

Трек выбран заранее — менять его в последний момент дороже, чем взять в нём наименее рискованный кейс.
