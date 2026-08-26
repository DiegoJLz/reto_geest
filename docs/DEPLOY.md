# Deploy — Render + GitHub Actions

## Arquitectura

```
GitHub push to main   →  GitHub Actions CI (lint + tests + e2e)
                     →  GitHub Actions CD  →  Render API  →  PROD service
GitHub push to qa    →  GitHub Actions CI
                     →  GitHub Actions CD  →  Render API  →  QA service
```

Los deploys en Render tienen `autoDeploy: false` — el trigger real viene del
workflow `.github/workflows/deploy.yml`, que corre después del push a `main`
o `qa` **si CI pasa** (configurar branch protection para hacerlo estricto).

## Infra provisionada por `render.yaml`

| Recurso | Nombre | Plan | Notas |
|---|---|---|---|
| PostgreSQL | `geest-db` | Free | Compartida entre prod y qa (schema `public`). Ver trade-off abajo. |
| Web Service PROD | `geest-api-prod` | Starter | Rama `main`. No duerme. |
| Web Service QA | `geest-api-qa` | Free | Rama `qa`. Duerme tras 15 min → cold start 30-60s. |

**Trade-off DB compartida:** PROD y QA apuntan a la misma base de datos.
Aceptable para un reto de 7 días (evaluadores prueban solo PROD; QA es
interno). Si en el futuro se necesita aislamiento total, `render.yaml`
soporta declarar 2 databases + 2 `DATABASE_URL` distintos.

## Setup inicial (una sola vez)

### 1. Rotar la Render API Key
Como fue compartida por chat previamente, rotala en `Account Settings → API Keys`
antes de continuar. Copia el nuevo valor a portapapeles.

### 2. Agregar el secret a GitHub

**Repo Settings → Secrets and variables → Actions → Environments**

Crear dos environments:
- `qa` → agregar secret `RENDER_API_KEY` (el que rotaste)
- `production` → agregar secret `RENDER_API_KEY` (mismo valor o distinto si preferís)

Opcionalmente configurar **required reviewers** en `production` para que el
deploy a prod requiera aprobación manual.

### 3. Provisionar el Blueprint en Render

1. Ir a https://dashboard.render.com/blueprints → **New Blueprint Instance**
2. Conectar el repo `DiegoJLz/reto_geest`
3. Render lee `render.yaml` y muestra los recursos → **Apply**
4. Esperar ~3 min mientras se crea la DB y se buildea la primera imagen
5. Copiar las URLs que asigne Render (algo tipo `https://geest-api-prod.onrender.com`)

### 4. Setear `NOTIFY_URL` manualmente en cada servicio

En el dashboard de cada Web Service:
- Environment → Add Env Var → `NOTIFY_URL` = `https://webhook.site/<tu-uuid>`
  (o cualquier URL destino real de las notificaciones de archivado)

El resto de env vars vienen del `render.yaml`.

### 5. Verificar el primer deploy

```bash
curl https://geest-api-prod.onrender.com/health
# { "status":"ok", ... }

curl https://geest-api-prod.onrender.com/docs
# Swagger UI HTML
```

## CI/CD workflow

### CI (`.github/workflows/ci.yml`)
Corre en cada PR y push a `develop`/`qa`/`main`:
- `lint` — ESLint
- `unit-tests` — Jest (52 tests)
- `e2e-tests` — Jest con Postgres real (service container, 11 tests)
- `build` — nest build

### Deploy (`.github/workflows/deploy.yml`)
Corre en push a `main` o `qa` (auto), o via `workflow_dispatch` (manual):
1. Resuelve el nombre del servicio según la rama
2. Look up del service ID via Render API (`GET /v1/services?name=...`)
3. Trigger deploy (`POST /v1/services/:id/deploys`)
4. Polling del status cada 10s hasta `live` o `*_failed` (timeout 15 min)

### Deploy manual
Actions → Deploy to Render → Run workflow → elegir `prod` o `qa`.

## Rollback

```bash
# Ver deploys recientes de un servicio
curl -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services/<SVC_ID>/deploys?limit=5" | jq

# Rollback a un deploy anterior
curl -X POST -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.render.com/v1/services/<SVC_ID>/rollback" \
  -d '{"deployId":"dep_xxxxx"}'
```

## Troubleshooting

| Síntoma | Causa probable | Fix |
|---|---|---|
| CD job: `Service 'geest-api-prod' not found in Render` | Blueprint no aplicado aún | Correr paso 3 del setup |
| CD job: `RENDER_API_KEY not set` | Secret no está en el environment que usa el workflow | Agregar secret al environment correcto |
| App arranca pero falla en DB | `DB_SSL` mal seteado o `DATABASE_URL` incorrecta | Verificar env vars en Render dashboard |
| Cold start ~60s en QA | Free plan sleeps tras 15 min | Esperar, o upgrade a Starter |
| `Server does not support SSL` local | `.env` tiene `DB_SSL=true` mientras Docker Postgres no lo soporta | Confirmar `DB_SSL=false` en `.env` local |
