# Changelog

Todas las entregas relevantes del proyecto se documentan en este archivo.
El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y las versiones adhieren a [Semantic Versioning](https://semver.org/lang/es/).

El desarrollo se organiza en **sprints (S0–S5)**. `v1.0.0` se libera al cierre de S5.

---

## [Unreleased]

Próximo: **S5 — Extra (Swagger polish), UML, README final, release v1.0.0**.

---

## [S4] — 2026-08-25

Deploy automatizado a Render + pipeline CI/CD. No cambia código de negocio.

### Added
- **`render.yaml`** — Infrastructure-as-Code Blueprint que declara:
  - `geest-db` (PostgreSQL Free, compartida entre envs)
  - `geest-api-prod` (Web Service Starter, rama `main`, no sleep)
  - `geest-api-qa` (Web Service Free, rama `qa`, sleeps tras 15 min)
  - `autoDeploy: false` en ambos web services → deploys los dispara GitHub Actions solo cuando CI pasa
- **`.github/workflows/ci.yml`** — CI en cada PR y push a `develop`/`qa`/`main`:
  - `lint` (ESLint)
  - `unit-tests` (Jest, 52 tests)
  - `e2e-tests` (Jest + Postgres 16 service container, 11 tests)
  - `build` (nest build)
  - `concurrency` cancel-in-progress por ref
- **`.github/workflows/deploy.yml`** — CD en push a `main`/`qa` o via `workflow_dispatch`:
  - Look up del service ID via Render API (`GET /v1/services?name=...`)
  - `POST /v1/services/:id/deploys` para trigger
  - Polling del status cada 10s hasta `live` o `*_failed` (timeout 15 min)
  - **Graceful skip** si el servicio no existe todavía (antes de aplicar Blueprint) o si `RENDER_API_KEY` no está en el environment — emite warning en vez de fallar
  - `environment: production|qa` dinámico según la rama (permite scoping de secrets)
- **`docs/DEPLOY.md`** — guía end-to-end de setup inicial, workflow de deploy, rollback, troubleshooting

### Changed
- README linkea a `docs/DEPLOY.md`

### GitHub workflow
- **PRs mergeados**:
  - #8 `ci(S4): Render Blueprint + GitHub Actions CI/CD`
  - #9 `release: promote develop → qa (v0.5.0-rc)` — primera vez que qa recibe el código real
  - #10 `release: promote qa → main (v0.5.0)` — primera vez que main recibe el código real
- Labels: `type:chore, sprint:s4, priority:high`
- Milestone S4 cerrado

### Setup pendiente por parte del owner del repo (post-merge)
1. Rotar `RENDER_API_KEY` (fue compartida por chat previamente)
2. Duplicar el secret al environment `production` (ya está en `qa`)
3. Apply Blueprint en https://dashboard.render.com/blueprints
4. Setear `NOTIFY_URL` manualmente en el dashboard de cada web service
5. Verificar `curl https://geest-api-prod.onrender.com/health` → 200

### Verificado
- CI runs green en `develop`, `qa`, `main` después de los merges
- Deploy workflow ran en push a qa y main → **graceful skip con warning** (esperado, Blueprint aún no aplicado)
- YAML syntax validado con `js-yaml.load` en los 3 archivos

### Trade-offs documentados
- **DB compartida** entre prod y qa: aceptable para reto de 7 días (evaluadores prueban solo prod). Aislamiento real requeriría 2 databases o schemas separados.
- **Free plan en QA**: sleeps tras 15 min → cold start 30-60s en primera request. Aceptable porque QA es interno.

---

## [S3] — 2026-08-25

Reliability completa. Idempotency HTTP + notifier con reintentos exponenciales.
Cierra los 9 endpoints del spec y trae los fixes del code review previo.

### Added
- **`IdempotencyModule`** (`src/modules/idempotency/`)
  - Interceptor global (`APP_INTERCEPTOR`) sobre POSTs — opt-in via header `Idempotency-Key`
  - Tabla `idempotency_keys` con PK compuesta `(key, endpoint)` — mismo key puede usarse en distintos endpoints sin colisión
  - Postgres `UNIQUE` serializa concurrent claims (winner via INSERT, losers ven la row y esperan/retornan cache)
  - Contract:
    - Mismo key + mismo body → 200/201 con cached response, ejecutado 1 vez
    - Mismo key + body diferente → 400 `IDEMPOTENCY_KEY_BODY_MISMATCH`
    - Mismo key aún en vuelo → poll hasta 5s, luego cache o 409 `IDEMPOTENCY_KEY_IN_PROGRESS`
    - Sin key → passthrough normal
- **`NotificationsModule`** (`src/modules/notifications/`)
  - `HttpTaskArchivedNotifier` reemplaza el `LoggerNoop` de S2 via DI swap (Open/Closed — `TasksService` no cambió)
  - Backoff exponencial: `500ms → 1000ms → 2000ms` (configurable via `NOTIFY_INITIAL_BACKOFF_MS` + `NOTIFY_MAX_ATTEMPTS`)
  - Retriable: 5xx + errores de red. Non-retriable: 2xx, 4xx.
  - Cada intento persistido en `notification_attempts` (número, statusCode, errorMessage, timestamp)
  - `NotificationsService.getAttemptsForTask()` alimenta el nuevo endpoint
- **Nuevo endpoint `GET /tasks/:id/notifications`** — lista intentos ordenados por número

### Fixed (audit)
- **M8/M9** `GlobalExceptionFilter` — devuelve códigos machine-readable (`VALIDATION_ERROR`, `NOT_FOUND`) en vez de "Bad Request"/"Not Found". Cumple el "código uniforme" del spec.
- **M6** `TasksService` — ya no inyecta `User` repo (violación de boundary). Ahora usa `UsersService.assertExists()` y `UsersService.findMissingIds()`.
- **M2** `assignUsers` — retorna estado authoritativo (todos los assignees actuales), no el eco del input.
- **M3** `assignUsers` — rechaza asignar a task archivada → 400 `TASK_ARCHIVED`.
- **M4** `completeByUser` — detecta estado inconsistente (task archived + assignment no completado) y throws `TASK_ARCHIVED`. Double-click sobre task ya archivada con assignment ya completado sigue siendo idempotent no-op.
- **M7** Nuevo partial index `ix_task_assignments_user_pending (user_id) WHERE completed_at IS NULL` para optimizar la query de `GET /users`.
- **H3** e2e safety guard — refuse to TRUNCATE si `NODE_ENV=production`.
- **L1** `repo.exist()` → `repo.exists()` (deprecation).
- **Bonus**: `GlobalExceptionFilter` oculta `err.message` en 500s cuando `NODE_ENV=production` (no info leak).

### Changed
- `UsersModule` exporta `UsersService` (necesario para `TasksModule`).
- `TasksModule` importa `UsersModule` y `NotificationsModule`.
- `AppModule` importa `IdempotencyModule` (activa el interceptor global).
- Ya no se declara el provider `LoggerTaskArchivedNotifier` en `TasksModule` — `NotificationsModule` provee la implementación HTTP.
- `test:e2e` script ahora usa `--runInBand` (evita deadlock por TRUNCATE concurrente entre suites).

### DB schema (nueva migración `1735260060000-AddIdempotencyAndNotifications`)
```sql
CREATE TABLE notification_attempts (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  status_code INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_notification_attempts_task ON notification_attempts(task_id);

CREATE TABLE idempotency_keys (
  key VARCHAR(200) NOT NULL,
  endpoint VARCHAR(100) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed')),
  status_code INTEGER,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (key, endpoint)
);
CREATE INDEX ix_idempotency_keys_created_at ON idempotency_keys(created_at);

-- Audit M7
CREATE INDEX ix_task_assignments_user_pending
  ON task_assignments(user_id) WHERE completed_at IS NULL;
```

### Testing
- **52/52 unit tests** (+24)
  - `IdempotencyService` x9 (hash determinism, claim decisions, storeResponse, releaseFailed)
  - `HttpTaskArchivedNotifier` x5 (2xx success, 4xx non-retry, 5xx retry x3, network error, missing NOTIFY_URL)
  - `NotificationsService` x2 (task not found, returns attempts ordered)
  - `UsersService` audit x5 (assertExists, findMissingIds dedup + return correct diff)
  - `TasksService` audit x8 (M2 real state, M3 archived reject, M4 inconsistent state guard, más tests de completeByUser)
- **11/11 e2e integration tests** (+7 en `test/reliability.e2e-spec.ts`)
  - 3 parallel POST /users con mismo Idempotency-Key → 1 user creado, mismos bodies
  - Body mismatch → 400 `IDEMPOTENCY_KEY_BODY_MISMATCH`
  - Sin key → cada POST crea nuevo recurso
  - Same key en endpoints distintos → OK (composite PK)
  - Notify success end-to-end + GET /notifications
  - Notify 5xx → retry x3, attempts persistidos y queryables
  - GET /notifications para task inexistente → 404

### GitHub workflow
- **PR mergeado**: #6 `feat(S3): Idempotency-Key + HTTP notifier with retries + audit fixes`
- Labels: `type:feature, sprint:s3, priority:high, reliability`
- Milestone S3 cerrado

### Verified end-to-end (Docker)
```
POST /users [Idempotency-Key: demo-key-1] body A     → 201 { id:2, ... }
POST /users [Idempotency-Key: demo-key-1] body A     → 201 { id:2, ... }  (misma respuesta, un solo user)
POST /users [Idempotency-Key: demo-key-1] body B     → 400 IDEMPOTENCY_KEY_BODY_MISMATCH
9 endpoints del spec registrados y respondiendo
```

### Deferred (documentar en README de S5 como trade-offs)
- Pagination en GET /tasks / GET /users (H1/M5) — no requerido por spec
- Bigint precision más allá de 2^53 (H2) — teórico, no aplica a este scope
- Auth de Swagger en prod (L4) — evaluable en S4
- Health check con ping a DB (L2) — considerar en S4 con `/ready`

---

## [S2] — 2026-08-25

Assignments, completado por usuario y archivado atómico exactly-once. Establece
la base de reliability que S3 extiende con idempotencia HTTP y reintentos.

### Added
- **Endpoint `POST /tasks/:id/assign`** (`AssignUsersDto`)
  - Body `{ userIds: number[] }`, valida array no vacío + ints
  - Deduplica userIds antes de insertar
  - Verifica atómicamente que la task y TODOS los users existan → 404 con lista de missing
  - Insert vía `INSERT ... ON CONFLICT DO NOTHING` (Postgres) → idempotente
  - Retorna `{ message, taskId, assignedUserIds }`
- **Endpoint `POST /tasks/:id/complete`** (`CompleteTaskDto`)
  - Body `{ userId: number }`
  - Transacción con `SELECT ... FOR UPDATE` (pessimistic write lock) sobre la fila de `tasks`
  - Idempotente por naturaleza: assignment ya completado = no-op
  - Cuando el último assignee completa → `UPDATE tasks SET status='archived', archived_at=now()` **solo si** `status='open'` (guard de defensa contra doble archivo)
  - Retorna `{ message, taskId, userId, archived: bool }`
- **Endpoint `GET /users/:id/tasks`** (`UserTaskResponseDto`)
  - Lista tareas asignadas al user con `completedByUser` boolean y `completedAt`
- **Strategy Pattern para notificaciones** (`src/modules/tasks/notifications/task-archived-notifier.ts`)
  - `TaskArchivedNotifier` interface + `TASK_ARCHIVED_NOTIFIER` DI token
  - `LoggerTaskArchivedNotifier` impl (noop-with-log) en S2
  - S3 reemplaza el provider por HTTP+retry sin tocar `TasksService` (Open/Closed principle)
  - Se dispara AFTER commit y solo cuando la transacción archivó (exactly-once)

### Reliability guarantees probadas
Exactly-once archiving y notification bajo concurrencia real (`Promise.all`), validados con Postgres real vía integration tests. La combinación de row-lock + guard `status='open'` da dos capas de defensa contra doble archivo.

### Testing
- **28/28 unit tests** (+10 nuevos): `assignUsers` (dedup/task-missing/users-missing), `completeByUser` (task-missing/user-missing/not-assigned/partial/archives-last/no-op-if-archived/no-op-if-already-completed), `getUserTasks` (user-missing/returns-with-state)
- **4/4 e2e integration tests** en `test/task-completion.e2e-spec.ts` (comando `npm run test:e2e`, requiere docker db)
  - Archivado + notify exactly-once bajo `Promise.all` de los 2 últimos assignees
  - 5 completes en paralelo del mismo user → 1 archive, 1 notify
  - Error format correcto cuando user no está asignado
  - Assign es idempotente ante duplicados

### Fixed
- **`TasksService` ahora usa `Repository.exist()` para pre-flight checks** — más eficiente que `findOne()` cuando solo importa existencia (evita hidratar entities).

### Changed
- `.env.example`: agregada nota sobre conflicto de puerto 5432 con Postgres nativo (recomendado `DB_PORT=5433` en Windows/Mac con Postgres instalado)

### GitHub workflow
- **PR mergeado**: #4 `feat(S2): assignments + complete + atomic archiving`
- Labels: `type:feature, sprint:s2, priority:high, reliability`
- Milestone S2 cerrado

### Verified end-to-end (Docker)
```
POST /users x2 (Ana, Beto)
POST /tasks (Demo S2)
POST /tasks/1/assign { userIds:[1,2] }         → 200 { assignedUserIds:[1,2] }
POST /tasks/1/complete { userId:1 }            → 200 { archived:false }
GET  /tasks/1                                  → status:open, 2 assignees, 1 completed
GET  /users/1/tasks                            → [ { completedByUser:true } ]
POST /tasks/1/complete { userId:2 }            → 200 { archived:true }
GET  /tasks/1                                  → status:archived, archivedAt set
```

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
