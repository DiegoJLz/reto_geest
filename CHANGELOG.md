# Changelog

Todas las entregas relevantes del proyecto se documentan en este archivo.
El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y las versiones adhieren a [Semantic Versioning](https://semver.org/lang/es/).

El desarrollo se organiza en **sprints (S0–S5)**. `v1.0.0` se libera al cierre de S5.

---

## [Unreleased]

Próximo: **S2 — Assignments, Complete y archivado atómico**.

---

## [S1] — 2026-08-25

Base CRUD de `users` y `tasks` + sistema uniforme de errores + primera migración.

### Added
- **Módulo Users** (`src/modules/users/`)
  - `POST /users` — registra usuario (validación de email + campos requeridos)
  - `GET /users` — lista usuarios con `pendingTaskIds[]` (IDs de tareas open no completadas por el usuario)
  - `UsersService` con detección de email duplicado (Postgres `23505`) → `409 USER_EMAIL_ALREADY_EXISTS`
- **Módulo Tasks** (`src/modules/tasks/`)
  - `POST /tasks` — crea tarea (title requerido, description opcional, status default `open`)
  - `GET /tasks?status=open|archived` — lista con filtro opcional
  - `GET /tasks/:id` — detalle con `assignees[]` (userId, name, lastName, completed, completedAt)
- **Common layer** (`src/common/`)
  - `DomainException` base + `NotFoundException`, `ValidationException`, `ConflictException`
  - `GlobalExceptionFilter` registrado vía `APP_FILTER` → formato uniforme `{ error: { code, message, details? } }`
  - `bigintTransformer` para exponer PKs BIGSERIAL como `number` en JS
- **Persistencia** (TypeORM 0.3 + Postgres 16)
  - Entities `User`, `Task`, `TaskAssignment` (esta última lista para S2)
  - Migración `1735260000000-InitialSchema`:
    - `users` (BIGSERIAL PK, `email` UNIQUE)
    - `tasks` (BIGSERIAL PK, CHECK `status IN ('open','archived')`, índice sobre `status`)
    - `task_assignments` (PK compuesta `(task_id, user_id)`, FKs con `ON DELETE CASCADE`, partial index sobre `WHERE completed_at IS NULL`)
- **Infra**
  - `docker-compose.yml` ahora levanta `db` + `api` con healthchecks (`pg_isready` para db, HTTP `/health` para api)
  - `Dockerfile` runtime incluye `wget` para el healthcheck
  - `AUTO_RUN_MIGRATIONS=true` corre migraciones al startup del container
- **DX**
  - Swagger UI en `/docs` con decoradores `@ApiTags/@ApiOperation/@ApiProperty`
  - `GET /health` público (Kubernetes/Render style)

### Fixed
- **SSL detection en TypeORM config** — SSL ahora es opt-in vía `DB_SSL=true`, no acoplado a `NODE_ENV`. Antes, correr con `NODE_ENV=production` forzaba SSL y rompía Postgres local en Docker. (PR #2)

### Testing
- **18/18 unit tests** pasan
  - `UsersService`: create success, duplicate email, unknown error, findAll empty/populated, findByIdOrFail found/missing
  - `TasksService`: create con description nullable, findAll con/sin filtro status, findByIdWithAssignees found/missing
  - `GlobalExceptionFilter`: mapping de DomainException, HttpException, class-validator BadRequest, unknown Error
  - `HealthController`: status ok

### GitHub workflow
- **15 labels** creados: `type:{feature,bug,docs,chore,test,refactor}`, `priority:{high,medium,low}`, `sprint:s1..s5`, `reliability`
- **Milestones** S0–S5 (S0 y S1 cerrados)
- **PRs mergeados**:
  - #1 `feat(S1): Users + Tasks CRUD + global error handling`
  - #2 `fix(db): make SSL opt-in via DB_SSL flag`

### Verified end-to-end
API corriendo en Docker (`docker compose up -d`), validado con curls contra `http://localhost:3000`:
- POST /users válido → 201
- POST /users email inválido → 400 con `details[]`
- POST /users email duplicado → 409 `USER_EMAIL_ALREADY_EXISTS`
- POST /tasks → 201
- GET /tasks, GET /tasks/:id → 200
- GET /tasks/999 → 404 `TASK_NOT_FOUND`

---

## [S0] — 2026-08-25 — `v0.1.0`

Setup inicial del proyecto y flujo de git.

### Added
- **Scaffold NestJS 10 + TypeScript** (`src/main.ts`, `src/app.module.ts`)
  - `ValidationPipe` global (whitelist, forbidNonWhitelisted, transform)
  - Swagger habilitado en `/docs`
  - CORS habilitado
- **TypeORM 0.3 + Postgres 16** (`src/database/`)
  - `typeorm.config.ts` (soporta `DATABASE_URL` o vars separadas)
  - `data-source.ts` para CLI de migraciones
- **Docker Compose** para Postgres local (`postgres:16-alpine` con healthcheck)
- **Dockerfile multi-stage** (builder + runtime, `npm prune --omit=dev`)
- **Tooling**
  - ESLint 8 + Prettier 3 (config con `plugin:@typescript-eslint/recommended` + `plugin:prettier/recommended`)
  - Jest configurado en `package.json` + config e2e en `test/jest-e2e.json`
  - `.gitattributes` para normalizar line endings a LF cross-platform
  - `.dockerignore` para builds más rápidos
- **Env template** `.env.example` con vars para DB, Notifications, Idempotency
- **README skeleton** con instrucciones de setup local
- **Health controller** (`GET /health`) + primer unit test

### GitHub workflow
- **3 ramas creadas** y protegidas conceptualmente:
  - `main` → producción (Render Starter)
  - `qa` → QA (Render Free — para líderes GEEST)
  - `develop` → integración (base de features)
- **Tag `v0.1.0`** anotado y pushed
- Repositorio público: https://github.com/DiegoJLz/reto_geest

### Decisiones técnicas registradas
- **TypeORM sobre Prisma** — decisión explícita por preferencia (mala experiencia previa con Prisma).
- **BIGSERIAL para PKs** — futuro-proof; transformer aplicado para exponer como `number` en JS.
- **Docker Compose para dev local** — no exige instalar Postgres al desarrollador.
- **APP_FILTER pattern** para el global filter (mejor DI/testability que `useGlobalFilters`).

### Verified
- `npm run build` — OK
- `npm test` — 1/1 pass
- `git push` a las 3 ramas + tag v0.1.0 — OK
