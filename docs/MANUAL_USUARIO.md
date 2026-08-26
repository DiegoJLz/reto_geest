# Manual de usuario — GEEST Task Management API

Guía práctica para consumir la API. Todos los endpoints están también documentados en Swagger UI: **[/docs](https://geest-api-prod.onrender.com/docs)**.

## URL base

- **Producción:** https://geest-api-prod.onrender.com
- **QA:** https://geest-api-qa.onrender.com *(free tier — puede tardar 30-60s la primera request tras inactividad)*
- **Local:** http://localhost:3000

## Convenciones

- Todos los cuerpos son **JSON** (`Content-Type: application/json`)
- Todos los errores tienen la forma:
  ```json
  { "error": { "code": "MACHINE_READABLE_CODE", "message": "Human readable" } }
  ```
- Los timestamps son ISO-8601 UTC (`2026-08-25T20:00:00.000Z`)
- IDs son enteros positivos

## Headers opcionales

### `Idempotency-Key`
En cualquier POST. Reintentos con la misma key + mismo body devuelven la misma respuesta sin re-ejecutar. Requests concurrentes con la misma key también deduplican.

```bash
curl -X POST /users \
  -H "Idempotency-Key: my-unique-key-123" \
  -H "Content-Type: application/json" \
  -d '{"name":"Ana","lastName":"P","email":"ana@geest.com"}'
```

Si reusás la key con **body diferente**, la API responde `400 IDEMPOTENCY_KEY_BODY_MISMATCH`.

## Endpoints

### Users

#### `POST /users`
Registra un usuario.
```bash
curl -X POST $API/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Ana","lastName":"Perez","email":"ana@geest.com"}'
```
```json
201 { "id":1, "name":"Ana", "lastName":"Perez", "email":"ana@geest.com", "createdAt":"2026-08-25T20:00:00.000Z" }
400 { "error": { "code":"VALIDATION_ERROR", "message":"email must be a valid email address", "details":[...] } }
409 { "error": { "code":"USER_EMAIL_ALREADY_EXISTS", "message":"A user with email \"ana@geest.com\" already exists" } }
```

#### `GET /users`
Lista usuarios con sus IDs de tareas pendientes (tareas open no completadas por el usuario).
```bash
curl $API/users
```
```json
200 [
  { "id":1, "name":"Ana", "lastName":"Perez", "email":"ana@geest.com",
    "createdAt":"...", "pendingTaskIds":[3, 7] }
]
```

#### `GET /users/:id/tasks`
Lista tareas del usuario con indicador de completitud personal.
```bash
curl $API/users/1/tasks
```
```json
200 [ { "taskId":3, "title":"...", "status":"open", "completedByUser":false, "completedAt":null } ]
404 { "error": { "code":"USER_NOT_FOUND", "message":"User with id 1 not found" } }
```

### Tasks

#### `POST /tasks`
Crea tarea (status inicial: `open`, description opcional).
```bash
curl -X POST $API/tasks -H "Content-Type: application/json" \
  -d '{"title":"Preparar informe","description":"Q3"}'
```
```json
201 { "id":1, "title":"Preparar informe", "description":"Q3", "status":"open",
      "archivedAt":null, "createdAt":"...", "assignees":[] }
400 { "error": { "code":"VALIDATION_ERROR", "message":"title is required", ... } }
```

#### `GET /tasks[?status=open|archived]`
Lista tareas (con filtro opcional). Incluye assignees con estado de completitud por usuario.
```bash
curl "$API/tasks?status=archived"
```

#### `GET /tasks/:id`
Detalle de una tarea con todos los assignees.
```bash
curl $API/tasks/1
```
```json
200 { "id":1, "title":"...", "status":"open", "archivedAt":null,
      "assignees":[{"userId":1,"name":"Ana","lastName":"Perez","completed":false,"completedAt":null}] }
404 { "error": { "code":"TASK_NOT_FOUND", "message":"..." } }
```

#### `POST /tasks/:id/assign`
Asigna un batch de usuarios a la tarea. Duplicados (dentro del array o vs asignaciones existentes) son ignorados silenciosamente.
```bash
curl -X POST $API/tasks/1/assign -H "Content-Type: application/json" \
  -d '{"userIds":[1,2,3]}'
```
```json
200 { "message":"Users assigned successfully", "taskId":1, "assignedUserIds":[1,2,3] }
404 { "error": { "code":"TASK_NOT_FOUND", ... } }
404 { "error": { "code":"USER_NOT_FOUND", "message":"User(s) not found: 42, 99" } }
400 { "error": { "code":"TASK_ARCHIVED", "message":"Task 1 is archived; cannot assign new users" } }
```

#### `POST /tasks/:id/complete`
Marca la parte del usuario como completada. Si es el último pendiente, **archiva la tarea automáticamente y dispara la notificación externa** (exactly-once).
```bash
curl -X POST $API/tasks/1/complete -H "Content-Type: application/json" \
  -d '{"userId":1}'
```
```json
200 { "message":"User completion recorded", "taskId":1, "userId":1, "archived":false }
200 { "message":"User completion recorded", "taskId":1, "userId":2, "archived":true }
400 { "error": { "code":"USER_NOT_ASSIGNED_TO_TASK", "message":"User 5 is not assigned to task 1" } }
404 { "error": { "code":"TASK_NOT_FOUND", ... } }
```

Idempotente: llamar dos veces con el mismo `userId` sobre una tarea ya archivada por ese usuario responde `archived: false` sin efectos secundarios.

#### `GET /tasks/:id/notifications`
Lista los intentos de notificación externa disparados cuando la tarea se archivó.
```bash
curl $API/tasks/1/notifications
```
```json
200 [
  { "attemptNumber":1, "statusCode":503, "errorMessage":null, "timestamp":"..." },
  { "attemptNumber":2, "statusCode":200, "errorMessage":null, "timestamp":"..." }
]
```
- `statusCode=null` + `errorMessage="ECONNREFUSED"` → error de red
- Máximo 3 intentos. No se reintenta si vino 2xx o 4xx.

### Salud

#### `GET /health`
```bash
curl $API/health
```
```json
200 { "status":"ok", "uptime":123.45, "timestamp":"..." }
```

## Flujo completo (ejemplo)

```bash
API="https://geest-api-prod.onrender.com"

# 1. Crear 2 users
U1=$(curl -s -X POST $API/users -H "Content-Type: application/json" \
  -d '{"name":"Ana","lastName":"P","email":"ana@geest.com"}' | jq -r '.id')
U2=$(curl -s -X POST $API/users -H "Content-Type: application/json" \
  -d '{"name":"Bob","lastName":"Q","email":"bob@geest.com"}' | jq -r '.id')

# 2. Crear tarea
T=$(curl -s -X POST $API/tasks -H "Content-Type: application/json" \
  -d '{"title":"Demo","description":"..."}' | jq -r '.id')

# 3. Asignar
curl -X POST $API/tasks/$T/assign -H "Content-Type: application/json" \
  -d "{\"userIds\":[$U1,$U2]}"

# 4. Completar user 1 (parcial)
curl -X POST $API/tasks/$T/complete -H "Content-Type: application/json" \
  -d "{\"userId\":$U1}"

# 5. Completar user 2 (archiva + notifica exactly-once)
curl -X POST $API/tasks/$T/complete -H "Content-Type: application/json" \
  -d "{\"userId\":$U2}"
# → { ..., "archived": true }

# 6. Ver intentos de notificación
curl $API/tasks/$T/notifications
```

## Códigos de error

| Código | HTTP | Cuándo |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Body inválido, campos faltantes, email mal formado |
| `USER_NOT_ASSIGNED_TO_TASK` | 400 | Complete sobre user no asignado |
| `TASK_ARCHIVED` | 400 | Assign o complete sobre task ya archivada |
| `IDEMPOTENCY_KEY_BODY_MISMATCH` | 400 | Misma Idempotency-Key con body diferente |
| `IDEMPOTENCY_KEY_TOO_LONG` | 400 | Header Idempotency-Key > 200 chars |
| `USER_NOT_FOUND` | 404 | ID de usuario inexistente |
| `TASK_NOT_FOUND` | 404 | ID de tarea inexistente |
| `USER_EMAIL_ALREADY_EXISTS` | 409 | Email duplicado en `POST /users` |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Request concurrente con misma key aún procesando (timeout tras 5s) |
| `INTERNAL_ERROR` | 500 | Error inesperado (message oculto en prod) |
