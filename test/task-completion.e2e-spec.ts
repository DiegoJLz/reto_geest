import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  TASK_ARCHIVED_NOTIFIER,
  TaskArchivedNotifier,
  TaskArchivedPayload,
} from '../src/modules/tasks/notifications/task-archived-notifier';

/**
 * Integration tests hitting a real Postgres to prove the reliability guarantees
 * of the challenge spec: archiving happens exactly once, notification fires
 * exactly once, even under concurrent completes.
 *
 * Prerequisite: Postgres running (docker compose up -d db).
 * Env: use the same .env as dev (host port 5433).
 */

class SpyNotifier implements TaskArchivedNotifier {
  public calls: TaskArchivedPayload[] = [];
  async notify(payload: TaskArchivedPayload): Promise<void> {
    this.calls.push(payload);
  }
}

describe('Task completion — concurrency (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let spyNotifier: SpyNotifier;
  // Nest returns http.Server here; supertest accepts it as a callable listener.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let httpServer: any;

  beforeAll(async () => {
    spyNotifier = new SpyNotifier();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TASK_ARCHIVED_NOTIFIER)
      .useValue(spyNotifier)
      .compile();

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
  });

  beforeEach(async () => {
    spyNotifier.calls = [];
    // Reset all tables to a known state per test.
    await dataSource.query(
      'TRUNCATE TABLE task_assignments, tasks, users RESTART IDENTITY CASCADE',
    );
  });

  it('archives a task exactly once and notifies exactly once when the last two assignees complete in parallel', async () => {
    // Arrange: 2 users, 1 task, both assigned.
    const userA = await request(httpServer)
      .post('/users')
      .send({ name: 'Alice', lastName: 'Zero', email: 'alice@geest.com' })
      .expect(201);
    const userB = await request(httpServer)
      .post('/users')
      .send({ name: 'Bob', lastName: 'One', email: 'bob@geest.com' })
      .expect(201);
    const task = await request(httpServer)
      .post('/tasks')
      .send({ title: 'Race condition test', description: 'boom' })
      .expect(201);
    await request(httpServer)
      .post(`/tasks/${task.body.id}/assign`)
      .send({ userIds: [userA.body.id, userB.body.id] })
      .expect(200);

    // Act: both users complete in parallel.
    const [respA, respB] = await Promise.all([
      request(httpServer)
        .post(`/tasks/${task.body.id}/complete`)
        .send({ userId: userA.body.id }),
      request(httpServer)
        .post(`/tasks/${task.body.id}/complete`)
        .send({ userId: userB.body.id }),
    ]);

    // Assert: both requests succeeded (200), exactly one reports archived=true.
    expect(respA.status).toBe(200);
    expect(respB.status).toBe(200);
    const archivedFlags = [respA.body.archived, respB.body.archived];
    expect(archivedFlags.filter(Boolean)).toHaveLength(1);

    // Assert: task in DB is archived, archived_at is set once.
    const [dbTask] = (await dataSource.query('SELECT status, archived_at FROM tasks')) as Array<{
      status: string;
      archived_at: Date;
    }>;
    expect(dbTask.status).toBe('archived');
    expect(dbTask.archived_at).toBeInstanceOf(Date);

    // Assert: notifier fired exactly once.
    expect(spyNotifier.calls).toHaveLength(1);
    expect(spyNotifier.calls[0]).toEqual({
      taskId: task.body.id,
      title: 'Race condition test',
      archivedAt: expect.any(String),
    });
  });

  it('is a no-op on repeated completes by the same user (double-click safe)', async () => {
    const user = await request(httpServer)
      .post('/users')
      .send({ name: 'Carol', lastName: 'Two', email: 'carol@geest.com' });
    const task = await request(httpServer)
      .post('/tasks')
      .send({ title: 'Solo task' });
    await request(httpServer)
      .post(`/tasks/${task.body.id}/assign`)
      .send({ userIds: [user.body.id] });

    // 5 parallel completes by same user
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(httpServer)
          .post(`/tasks/${task.body.id}/complete`)
          .send({ userId: user.body.id }),
      ),
    );

    responses.forEach((r) => expect(r.status).toBe(200));
    // Exactly one call archived (the one that first completed the last assignment)
    expect(responses.filter((r) => r.body.archived === true)).toHaveLength(1);
    // Notifier fires exactly once
    expect(spyNotifier.calls).toHaveLength(1);
  });

  it('returns 400/404 error format when user is not assigned to task', async () => {
    const user = await request(httpServer)
      .post('/users')
      .send({ name: 'Dan', lastName: 'Three', email: 'dan@geest.com' });
    const task = await request(httpServer).post('/tasks').send({ title: 'Not assigned test' });

    const resp = await request(httpServer)
      .post(`/tasks/${task.body.id}/complete`)
      .send({ userId: user.body.id })
      .expect(400);

    expect(resp.body).toEqual({
      error: {
        code: 'USER_NOT_ASSIGNED_TO_TASK',
        message: expect.stringContaining('not assigned'),
      },
    });
  });

  it('assign is idempotent: duplicate assign calls do not create duplicate rows', async () => {
    const user = await request(httpServer)
      .post('/users')
      .send({ name: 'Eve', lastName: 'Four', email: 'eve@geest.com' });
    const task = await request(httpServer).post('/tasks').send({ title: 'Dup test' });

    await request(httpServer)
      .post(`/tasks/${task.body.id}/assign`)
      .send({ userIds: [user.body.id, user.body.id, user.body.id] })
      .expect(200);
    await request(httpServer)
      .post(`/tasks/${task.body.id}/assign`)
      .send({ userIds: [user.body.id] })
      .expect(200);

    const [row] = (await dataSource.query(
      'SELECT COUNT(*)::int AS n FROM task_assignments WHERE task_id = $1',
      [task.body.id],
    )) as Array<{ n: number }>;
    expect(row.n).toBe(1);
  });
});
