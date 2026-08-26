import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { IdempotencyKey } from '../modules/idempotency/entities/idempotency-key.entity';
import { NotificationAttempt } from '../modules/notifications/entities/notification-attempt.entity';
import { TaskAssignment } from '../modules/tasks/entities/task-assignment.entity';
import { Task } from '../modules/tasks/entities/task.entity';
import { User } from '../modules/users/entities/user.entity';
import { AddIdempotencyAndNotifications1735260060000 } from './migrations/1735260060000-AddIdempotencyAndNotifications';
import { InitialSchema1735260000000 } from './migrations/1735260000000-InitialSchema';

export function typeOrmConfig(): TypeOrmModuleOptions {
  const useUrl = !!process.env.DATABASE_URL;
  const isProd = process.env.NODE_ENV === 'production';
  // SSL is opt-in via DB_SSL=true. Managed providers (Render, Neon, Supabase) require it;
  // local Postgres in Docker does not. If DATABASE_URL is set and DB_SSL is not, default to true.
  const ssl =
    process.env.DB_SSL === 'true' || (useUrl && process.env.DB_SSL === undefined);

  return {
    type: 'postgres',
    ...(useUrl
      ? { url: process.env.DATABASE_URL }
      : {
          host: process.env.DB_HOST ?? 'localhost',
          port: Number(process.env.DB_PORT ?? 5432),
          username: process.env.DB_USER ?? 'geest',
          password: process.env.DB_PASSWORD ?? 'geest',
          database: process.env.DB_NAME ?? 'geest',
        }),
    ssl: ssl ? { rejectUnauthorized: false } : false,
    entities: [User, Task, TaskAssignment, NotificationAttempt, IdempotencyKey],
    migrations: [InitialSchema1735260000000, AddIdempotencyAndNotifications1735260060000],
    migrationsRun: isProd || process.env.AUTO_RUN_MIGRATIONS === 'true',
    synchronize: false,
    logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  };
}
