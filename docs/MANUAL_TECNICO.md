# Manual técnico — GEEST Task Management API

## 1. Arquitectura

Monolito modular en NestJS. Cuatro módulos de dominio + un módulo transversal:

```
src/
├── app.module.ts                         Composición raíz + APP_FILTER global
├── main.ts                               Bootstrap (ValidationPipe, Swagger, CORS)
├── health.controller.ts                  GET /health
├── common/
│   ├── exceptions/                       DomainException + Not/Val/Conflict
│   ├── filters/global-exception.filter   Formato uniforme { error: { code, message } }
│   └── transformers/bigint.transformer   BIGSERIAL → number en JS
├── database/
│   ├── typeorm.config.ts                 Config única (dev/docker/render)
│   ├── data-source.ts                    Para la CLI de TypeORM
│   └── migrations/                       Esquema versionado
└── modules/
    ├── users/                            POST /users, GET /users, GET /users/:id/tasks
    ├── tasks/                            POST /tasks, GET /tasks[?status], GET /tasks/:id,
    │                                     POST /tasks/:id/assign, POST /tasks/:id/complete,
    │                                     GET /tasks/:id/notifications
    ├── notifications/                    HttpTaskArchivedNotifier + NotificationsService
    └── idempotency/                      Interceptor global + IdempotencyService
```

Cada módulo de dominio sigue **Controller → Service → Repository (TypeORM)** con **DTOs** en el borde para validación (class-validator).

## 2. Design patterns aplicados

| Patrón | Dónde | Por qué |
|---|---|---|
| **Dependency Injection** | Nativo NestJS | Testeabilidad, swappable providers |
| **Repository Pattern** | Todos los services | Aisla ORM del dominio (mockeable) |
| **Strategy Pattern** | `TaskArchivedNotifier` interface + `LoggerTaskArchivedNotifier` (S2) / `HttpTaskArchivedNotifier` (S3) | Swap del notifier via DI token sin tocar `TasksService` (Open/Closed) |
| **Interceptor Pattern** | `IdempotencyInterceptor` global | Transversal, no requiere anotar cada endpoint |
| **Transaction Script** | `TasksService.completeByUser` | Lógica atómica con pessimistic lock + count + guard |
| **Exception Filter** | `GlobalExceptionFilter` (`APP_FILTER`) | Formato de error uniforme sin repetir en cada controller |
| **DTO Pattern** | `class-validator` en el borde | Whitelist + forbidNonWhitelisted → superficie de ataque mínima |

## 3. Cumplimiento SOLID

- **S** (Single Responsibility): cada service tiene un dominio; el notifier no sabe nada de tasks internamente
- **O** (Open/Closed): agregar un `SlackTaskArchivedNotifier` requiere solo un nuevo provider en `NotificationsModule`, ningún cambio en TasksService
- **L** (Liskov): implementaciones de `TaskArchivedNotifier` son intercambiables por contrato
- **I** (Interface Segregation): interfaces chicas y enfocadas (`TaskArchivedNotifier` tiene un solo método)
- **D** (Dependency Inversion): `TasksService` depende de la interfaz `TaskArchivedNotifier` via token, no de `HttpTaskArchivedNotifier` concreto

## 4. Reliability — cómo se garantiza exactly-once

### Archivado atómico (S2)
```sql
BEGIN;
  SELECT * FROM tasks WHERE id = $1 FOR UPDATE;           -- Pessimistic write lock
  UPDATE task_assignments SET completed_at = now()
    WHERE task_id = $1 AND user_id = $2 AND completed_at IS NULL;
  SELECT COUNT(*) FROM task_assignments
    WHERE task_id = $1 AND completed_at IS NULL;           -- remaining
  -- if remaining = 0 AND task.status = 'open':
  UPDATE tasks SET status = 'archived', archived_at = now() WHERE id = $1;
COMMIT;
-- Notifier fires ONLY if this TX updated the tasks row → exactly-once
```

Dos safety nets: el row lock serializa los completes, el guard `status='open'` previene doble archivo si el lock se libera post-archive.

### Idempotencia HTTP (S3)
- `INSERT INTO idempotency_keys ON CONFLICT DO NOTHING` — el winner obtiene ownership atómico
- Losers en paralelo ven el UNIQUE violation, hacen SELECT → si `status='completed'` retornan cached, si `processing` polean cada 100ms hasta 5s
- Body hash SHA-256 canónico (keys ordenadas) para detectar mismatch

### Notificaciones con retries (S3)
- Backoff exponencial: `500ms → 1000ms → 2000ms` (configurable)
- Retriable: 5xx + errores de red. Non-retriable: 2xx (success), 4xx (permanent)
- Cada intento se persiste en `notification_attempts` (successful o failed)
- Se dispara solo si `TasksService.completeByUser` reporta `archived=true`

## 5. Stack técnico

| Capa | Elección | Alternativas descartadas |
|---|---|---|
| Runtime | Node 20 + TypeScript | — |
| Framework | NestJS 10 | Express puro (más boilerplate para DI/testing) |
| ORM | TypeORM 0.3 | Prisma (mala experiencia previa del dev) |
| BD | PostgreSQL 16 | SQLite (single-writer, no soporta pessimistic lock igual), MySQL (menos features avanzadas) |
| Tests | Jest + Supertest | — |
| Docs API | @nestjs/swagger | Redoc (más overhead), sin docs (invisible al evaluador) |
| Hosting | Render.com | Fly.io (más setup), Heroku (paid), Railway (menos maduro) |
| CI/CD | GitHub Actions | CircleCI/Travis (extra provider), auto-deploy Render (menos control) |

## 6. Configuración

Variables de entorno (ver `.env.example`):

| Variable | Uso | Default |
|---|---|---|
| `NODE_ENV` | `development` / `production` / `test` | development |
| `PORT` | HTTP listen | 3000 |
| `DATABASE_URL` | Postgres URL completa (prod, Render) | — |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | Vars separadas (dev local) | localhost/5432/geest/geest/geest |
| `DB_SSL` | `true` para providers managed | false |
| `AUTO_RUN_MIGRATIONS` | Correr migraciones al startup | false (true en prod) |
| `NOTIFY_URL` | Destino de notificaciones | — |
| `NOTIFY_MAX_ATTEMPTS` | Máximo de reintentos | 3 |
| `NOTIFY_INITIAL_BACKOFF_MS` | Backoff base | 500 |
| `IDEMPOTENCY_TTL_SECONDS` | TTL reservado para cleanup futuro | 86400 |

## 7. Testing

- **Unit tests** (`src/**/*.spec.ts`, 52 tests): mocks de repos/services, ~4s
- **E2E integration** (`test/*.e2e-spec.ts`, 11 tests): Postgres real, verifica atomicity + idempotency bajo Promise.all, ~10s

Comandos:
```bash
npm test              # unit
npm run test:cov      # unit + coverage
npm run test:e2e      # requiere docker db up. Usa --runInBand para evitar deadlocks
```

## 8. Deploy y CI/CD

Ver [DEPLOY.md](./DEPLOY.md) para el flujo completo.

- CI: `.github/workflows/ci.yml` — lint + unit + e2e + build en cada PR/push
- CD: `.github/workflows/deploy.yml` — deploy a Render via API en push a `main`/`qa`
- IaC: `render.yaml` — 1 postgres + 2 web services

## 9. Trade-offs y limitaciones conocidas

| Ítem | Decisión | Justificación |
|---|---|---|
| Pagination en `GET /tasks` / `GET /users` | No implementado | Fuera del spec; agregar si escala pasa 10k rows |
| BIGINT PKs sin validación de rango > 2^53 | Aceptado | Teórico; no aplica a este scope |
| Swagger UI sin auth en prod | Aceptado | Trade-off por visibilidad al evaluador (`/docs` público) |
| `/health` no chequea DB | Aceptado | Simple readiness; escalable a `/ready` si se necesita |
| PROD y QA comparten Postgres | Aceptado | Reto de 7 días, evaluador prueba prod; aislamiento real requeriría 2 DBs |
| Idempotency polling en vez de LISTEN/NOTIFY | Aceptado | Polling con backoff acotado (100ms/5s) suficiente para HTTP scale bajo |
| Notificación sync durante el request | Aceptado | Backoff acotado (max ~3.5s total). Outbox real sería over-engineering para el spec |
