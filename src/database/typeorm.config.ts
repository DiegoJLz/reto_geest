import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { User } from '../modules/users/entities/user.entity';
import { Task } from '../modules/tasks/entities/task.entity';
import { TaskAssignment } from '../modules/tasks/entities/task-assignment.entity';
import { InitialSchema1735260000000 } from './migrations/1735260000000-InitialSchema';

export function typeOrmConfig(): TypeOrmModuleOptions {
  const useUrl = !!process.env.DATABASE_URL;
  const isProd = process.env.NODE_ENV === 'production';
  const ssl = process.env.DB_SSL === 'true' || isProd;

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
    entities: [User, Task, TaskAssignment],
    migrations: [InitialSchema1735260000000],
    migrationsRun: isProd || process.env.AUTO_RUN_MIGRATIONS === 'true',
    synchronize: false,
    logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  };
}
