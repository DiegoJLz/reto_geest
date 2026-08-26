# GEEST — Task Management API

API REST para gestión de tareas asignables a múltiples usuarios, con archivado automático exactly-once y notificaciones externas con reintentos. Reto técnico GEEST.

- **🌍 URL pública (PROD):** https://geest-api-prod.onrender.com
- **🔍 Swagger UI:** https://geest-api-prod.onrender.com/docs
- **🩺 Health:** https://geest-api-prod.onrender.com/health
- **🧪 URL QA (para pruebas):** https://geest-api-qa.onrender.com *(free tier — cold start 30–60s la primera request tras inactividad)*

## Stack

**Node 20 + TypeScript · NestJS 10 · TypeORM 0.3 · PostgreSQL 16 · Jest · Docker · Render · GitHub Actions**

## Cómo ejecutar localmente

```bash
# 1) Instalar dependencias
npm install

# 2) Configurar env
cp .env.example .env
# Si tenés Postgres nativo en :5432, editá DB_PORT=5433 (evita conflicto)

# 3) Levantar Postgres + API con Docker
docker compose up -d --build

# 4) API disponible en http://localhost:3000
curl http://localhost:3000/health
open http://localhost:3000/docs
```

Sin Docker (Postgres propio):
```bash
npm run db:up            # levanta solo el contenedor db
npm run migration:run    # corre migraciones
npm run start:dev        # API con hot reload
```

## Tests

```bash
npm test              # 52 unit tests (~4s)
npm run test:e2e      # 11 integration tests contra Postgres real (~10s, requiere docker db up)
npm run test:cov      # unit + coverage
```

## Endpoints (9)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/users` | Crea usuario (email único, validación) |
| GET | `/users` | Lista con `pendingTaskIds` |
| GET | `/users/:id/tasks` | Tareas asignadas con `completedByUser` |
| POST | `/tasks` | Crea tarea (`status='open'`) |
| GET | `/tasks?status=open\|archived` | Lista con assignees |
| GET | `/tasks/:id` | Detalle con assignees + estado |
| POST | `/tasks/:id/assign` | Body `{ userIds:[] }`, idempotente (ON CONFLICT DO NOTHING) |
| POST | `/tasks/:id/complete` | Body `{ userId }`, archiva exactly-once cuando es el último |
| GET | `/tasks/:id/notifications` | Intentos de notificación (num, statusCode, error, timestamp) |

Todos los POST aceptan `Idempotency-Key` header (opcional). Todos los errores devuelven `{ "error": { "code", "message" } }`. Ver [manual de usuario](./docs/MANUAL_USUARIO.md).

## Decisiones técnicas importantes

- **NestJS + TypeORM + PostgreSQL**: framework maduro con DI/testing nativo; TypeORM sobre Prisma por preferencia del dev; Postgres por soporte de `FOR UPDATE` + `ON CONFLICT` que resuelven la reliability sin lockservice externo.
- **Archivado exactly-once**: transacción con `SELECT ... FOR UPDATE` sobre la row de `tasks` serializa concurrent completes; guard `WHERE status='open'` en el `UPDATE` da segunda capa de defensa. Notifier fires solo si esa TX archivó.
- **Idempotency-Key global via Interceptor**: PK compuesta `(key, endpoint)` en `idempotency_keys` + `INSERT ON CONFLICT DO NOTHING`. Postgres UNIQUE serializa los claims. Body hash SHA-256 canónico (keys ordenadas) detecta reuse con body diferente → 400.
- **Notifier con retries**: Strategy Pattern con DI token. Impl HTTP con backoff exponencial (500/1000/2000ms), max 3 intentos. Retriable: 5xx + network. Non-retriable: 2xx/4xx. Cada intento persistido en `notification_attempts`.
- **Formato de error uniforme**: `GlobalExceptionFilter` (via `APP_FILTER`) transforma DomainException, HttpException y errores genéricos al `{ error: { code, message, details? } }` del spec. Códigos machine-readable (`VALIDATION_ERROR`, no "Bad Request").
- **Deploy IaC**: `render.yaml` declara todo (DB + 2 web services). CI/CD en GitHub Actions con graceful-skip pattern (permite mergear pipeline antes del provisioning inicial).

## Supuestos ante ambigüedades del spec

- **`Idempotency-Key` es opcional**: si no viene, el POST se ejecuta normal. Interpreté "deben aceptar" como "soportar", no "requerir".
- **Complete sobre task ya archivada**: idempotente no-op si el user ya está completado (double-click safe); error `TASK_ARCHIVED` si el estado es inconsistente (assignment uncompleted en task archivada — solo alcanzable via manipulación directa de DB).
- **Assign a task archivada**: rechazo con `TASK_ARCHIVED` (asignar a algo cerrado no tiene sentido de negocio).
- **`assignedUserIds` en response de `/assign`**: devuelvo el estado authoritativo actual (todos los assignees post-operación), no el eco del input.
- **Notifier failure**: si los 3 intentos fallan, la tarea queda archivada igual (spec no dice unroll). Los intentos quedan queryables en `/notifications` para debugging.
- **Idempotency in-flight**: si un request con la misma key aún procesa, se polea hasta 5s; si no completa, 409 `IDEMPOTENCY_KEY_IN_PROGRESS`.

## Funcionalidades recortadas por tiempo

Priorizados los "3 niveles sólidos > 4 a medias" del spec. Recortes documentados:

- **Pagination en `GET /tasks` / `GET /users`** — fuera del spec; para prod real, agregar `limit/offset`
- **Health check con ping a DB** — `/health` retorna liveness básico; `/ready` con DB check quedó como TODO
- **Swagger auth en prod** — `/docs` público (trade-off: visibilidad al evaluador > seguridad para un reto)
- **PROD y QA comparten Postgres** — aceptable para reto de 7 días; aislamiento real requeriría 2 databases separadas
- **Cleanup job para `idempotency_keys`** — hay índice sobre `created_at` y variable `IDEMPOTENCY_TTL_SECONDS`, pero el TTL no está automatizado

## Extra funcionando: Swagger UI en `/docs`

- **Qué problema resuelve:** el evaluador puede probar la API en vivo sin instalar Postman ni escribir curls — abrir `/docs` y "Try it out" en cada endpoint.
- **Por qué necesaria:** el spec dice que la evaluación es contra la URL pública. UX del evaluador cuenta para la nota.
- **Por qué sobre otras alternativas:**
  - vs **Rate limiting / auth**: sobre-ingeniería para un reto público con endpoints demostrativos
  - vs **Structured logging + observability**: valor invisible al evaluador
  - vs **Health `/ready` con DB**: útil pero cosmético
  - Swagger con `@nestjs/swagger` requiere solo decoradores en DTOs y controllers (ya usados para validación) → mucho valor visible por poco código

## Despliegue

Ver [`docs/DEPLOY.md`](./docs/DEPLOY.md). Resumen:

- **Render.com** con Blueprint (`render.yaml`) — 1 Postgres + 2 Web Services (prod Starter, qa Free)
- **GitHub Actions** — CI (lint + unit + e2e + build) en cada PR; CD (deploy vía Render API) en push a `main`/`qa`
- **Ramas:** `main` → prod, `qa` → qa, `develop` → integración, `feature/*` → salen de develop
- **Tags:** `v0.1.0` (S0) → `v0.5.0` (S4), `v1.0.0` (final)

## Documentación

- 📘 [Manual técnico](./docs/MANUAL_TECNICO.md) — arquitectura, patterns, SOLID, reliability, trade-offs
- 📗 [Manual de usuario](./docs/MANUAL_USUARIO.md) — endpoint reference con curls
- 🗄️ [UML de la base de datos](./docs/UML.md) — ERD Mermaid + índices + constraints
- 🚀 [Guía de deploy](./docs/DEPLOY.md) — Render setup, workflows, rollback
- 📜 [Changelog](./CHANGELOG.md) — historial detallado por sprint (S0–S5)

## Autor

Diego de Jesús López Rodríguez — [@DiegoJLz](https://github.com/DiegoJLz) · diego5julio2001@gmail.com
