import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';

/**
 * Integration tests for the reliability guarantees introduced in S3:
 *  - Idempotency-Key: same key + same body → same response, executed once,
 *    even under parallel POST arrival.
 *  - Notifications: recorded per attempt, queryable via GET.
 *
 * Uses a local HTTP server to simulate NOTIFY_URL — no network required.
 */

describe('Reliability — Idempotency + Notifications (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let httpServer: any;
  let notifyServer: Server;
  let notifyPort: number;
  let notifyRequestsReceived: Array<{ body: unknown; timestamp: number }> = [];
  let notifyResponseStatus = 200;
  let notifyResponseDelayMs = 0;

  beforeAll(async () => {
    // Spin up a local HTTP server that acts as NOTIFY_URL
    notifyServer = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        let body: unknown = null;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          /* ignore */
        }
        notifyRequestsReceived.push({ body, timestamp: Date.now() });
        setTimeout(() => {
          res.statusCode = notifyResponseStatus;
          res.end('ok');
        }, notifyResponseDelayMs);
      });
    });
    await new Promise<void>((resolve) => notifyServer.listen(0, '127.0.0.1', () => resolve()));
    notifyPort = (notifyServer.address() as AddressInfo).port;
    process.env.NOTIFY_URL = `http://127.0.0.1:${notifyPort}/`;
    process.env.NOTIFY_INITIAL_BACKOFF_MS = '10'; // fast for tests
    process.env.NOTIFY_MAX_ATTEMPTS = '3';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    httpServer = app.getHttpServer();
    dataSource = app.get(DataSource);
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await new Promise<void>((resolve) => notifyServer.close(() => resolve()));
  });

  beforeEach(async () => {
    notifyRequestsReceived = [];
    notifyResponseStatus = 200;
    notifyResponseDelayMs = 0;
    await dataSource.query(
      'TRUNCATE TABLE notification_attempts, idempotency_keys, task_assignments, tasks, users RESTART IDENTITY CASCADE',
    );
  });

  // ---------- Idempotency ----------
  describe('Idempotency-Key', () => {
    it('same key + same body sent in PARALLEL returns identical responses and creates ONE user', async () => {
      const key = 'test-key-parallel-1';
      const body = { name: 'Iris', lastName: 'Same', email: 'iris@geest.com' };

      const [r1, r2, r3] = await Promise.all([
        request(httpServer).post('/users').set('Idempotency-Key', key).send(body),
        request(httpServer).post('/users').set('Idempotency-Key', key).send(body),
        request(httpServer).post('/users').set('Idempotency-Key', key).send(body),
      ]);

      // All 3 must succeed and return identical body
      [r1, r2, r3].forEach((r) => expect(r.status).toBe(201));
      expect(r1.body).toEqual(r2.body);
      expect(r2.body).toEqual(r3.body);

      // Only ONE user actually exists in the DB
      const [{ count }] = (await dataSource.query(
        'SELECT COUNT(*)::int AS count FROM users WHERE email = $1',
        ['iris@geest.com'],
      )) as Array<{ count: number }>;
      expect(count).toBe(1);
    });

    it('same key + DIFFERENT body returns 400 IDEMPOTENCY_KEY_BODY_MISMATCH', async () => {
      const key = 'test-key-mismatch-1';
      const first = await request(httpServer)
        .post('/users')
        .set('Idempotency-Key', key)
        .send({ name: 'Original', lastName: 'One', email: 'orig@geest.com' });
      expect(first.status).toBe(201);

      const conflict = await request(httpServer)
        .post('/users')
        .set('Idempotency-Key', key)
        .send({ name: 'Different', lastName: 'Two', email: 'diff@geest.com' });
      expect(conflict.status).toBe(400);
      expect(conflict.body).toEqual({
        error: {
          code: 'IDEMPOTENCY_KEY_BODY_MISMATCH',
          message: expect.stringContaining('different request body'),
        },
      });
    });

    it('no Idempotency-Key means each POST creates a new resource', async () => {
      const r1 = await request(httpServer)
        .post('/users')
        .send({ name: 'NoKey1', lastName: 'X', email: 'nk1@geest.com' });
      const r2 = await request(httpServer)
        .post('/users')
        .send({ name: 'NoKey2', lastName: 'X', email: 'nk2@geest.com' });
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      expect(r1.body.id).not.toBe(r2.body.id);
    });

    it('same key works across different endpoints (composite PK)', async () => {
      const key = 'shared-key-across-endpoints';
      const u = await request(httpServer)
        .post('/users')
        .set('Idempotency-Key', key)
        .send({ name: 'A', lastName: 'B', email: 'ab@geest.com' });
      expect(u.status).toBe(201);

      // Same key on a different endpoint should succeed (composite PK on key+endpoint)
      const t = await request(httpServer)
        .post('/tasks')
        .set('Idempotency-Key', key)
        .send({ title: 'Task with same idempotency key' });
      expect(t.status).toBe(201);
    });
  });

  // ---------- Notifications ----------
  describe('Notifications with retry', () => {
    it('fires notification exactly once and records attempt when archive succeeds', async () => {
      const u = await request(httpServer)
        .post('/users')
        .send({ name: 'N', lastName: 'One', email: 'n1@geest.com' })
        .expect(201);
      const t = await request(httpServer)
        .post('/tasks')
        .send({ title: 'Solo notify test' })
        .expect(201);
      await request(httpServer)
        .post(`/tasks/${t.body.id}/assign`)
        .send({ userIds: [u.body.id] })
        .expect(200);

      const archive = await request(httpServer)
        .post(`/tasks/${t.body.id}/complete`)
        .send({ userId: u.body.id });
      expect(archive.body.archived).toBe(true);

      // Wait briefly for the async notify to complete
      await new Promise((r) => setTimeout(r, 200));

      expect(notifyRequestsReceived).toHaveLength(1);
      expect(notifyRequestsReceived[0].body).toEqual({
        taskId: t.body.id,
        title: 'Solo notify test',
        archivedAt: expect.any(String),
      });

      const attempts = await request(httpServer).get(`/tasks/${t.body.id}/notifications`);
      expect(attempts.status).toBe(200);
      expect(attempts.body).toHaveLength(1);
      expect(attempts.body[0]).toEqual({
        attemptNumber: 1,
        statusCode: 200,
        errorMessage: null,
        timestamp: expect.any(String),
      });
    });

    it('retries on 5xx up to 3 attempts, each persisted, queryable via GET', async () => {
      notifyResponseStatus = 503;

      const u = await request(httpServer)
        .post('/users')
        .send({ name: 'N', lastName: 'Two', email: 'n2@geest.com' })
        .expect(201);
      const t = await request(httpServer)
        .post('/tasks')
        .send({ title: 'Retry test' })
        .expect(201);
      await request(httpServer)
        .post(`/tasks/${t.body.id}/assign`)
        .send({ userIds: [u.body.id] })
        .expect(200);
      await request(httpServer)
        .post(`/tasks/${t.body.id}/complete`)
        .send({ userId: u.body.id });

      // Backoffs are 10ms, 20ms → total <100ms with 3 attempts
      await new Promise((r) => setTimeout(r, 300));

      expect(notifyRequestsReceived).toHaveLength(3);

      const attempts = await request(httpServer)
        .get(`/tasks/${t.body.id}/notifications`)
        .expect(200);
      expect(attempts.body).toHaveLength(3);
      expect(attempts.body.map((a: { attemptNumber: number; statusCode: number }) => a.attemptNumber)).toEqual([1, 2, 3]);
      attempts.body.forEach((a: { statusCode: number }) => expect(a.statusCode).toBe(503));
    });

    it('GET /tasks/:id/notifications returns 404 when task does not exist', async () => {
      const resp = await request(httpServer).get('/tasks/99999/notifications');
      expect(resp.status).toBe(404);
      expect(resp.body.error.code).toBe('TASK_NOT_FOUND');
    });
  });
});
