# GEEST — Task Management API

API REST para gestión de tareas asignables a múltiples usuarios, con archivado automático y notificaciones externas. Reto técnico GEEST.

> **Estado del proyecto:** en desarrollo (`v0.1.0` — setup inicial).

## Stack

- **Runtime:** Node.js 20 + TypeScript
- **Framework:** NestJS 10
- **BD:** PostgreSQL 16
- **ORM:** TypeORM (migraciones versionadas)
- **Tests:** Jest + Supertest
- **Docs API:** Swagger (`/docs`)
- **Hosting:** Render.com (prod + qa)

## Requisitos locales

- Node.js ≥ 20
- Docker + Docker Compose (para Postgres local)

## Cómo correr localmente

```bash
# 1) Instalar dependencias
npm install

# 2) Configurar variables de entorno
cp .env.example .env

# 3) Levantar Postgres local
npm run db:up

# 4) Correr migraciones (cuando existan)
npm run migration:run

# 5) Arrancar API en modo dev
npm run start:dev

# API disponible en http://localhost:3000
# Swagger UI en http://localhost:3000/docs
# Healthcheck en http://localhost:3000/health
```

## Tests

```bash
npm test            # unit tests
npm run test:cov    # con coverage
npm run test:e2e    # end-to-end
```

## Ramas y despliegue

- `main` → Producción (Render Starter)
- `qa` → QA / Staging (Render Free — para evaluación de líderes GEEST)
- `develop` → Integración
- `feature/*` → salen de `develop`

## Documentación adicional

- [Changelog / historial de sprints](./CHANGELOG.md)
- [Manual técnico](./docs/MANUAL_TECNICO.md) *(pendiente)*
- [Manual de usuario](./docs/MANUAL_USUARIO.md) *(pendiente)*
- [UML de la BD](./docs/UML.md) *(pendiente)*

## Autor

Diego Julio — [DiegoJLz](https://github.com/DiegoJLz)
