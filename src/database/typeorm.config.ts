import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export function typeOrmConfig(): TypeOrmModuleOptions {
  const useUrl = !!process.env.DATABASE_URL;
  const ssl = process.env.DB_SSL === 'true' || process.env.NODE_ENV === 'production';

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
    entities: [__dirname + '/../**/*.entity.{ts,js}'],
    migrations: [__dirname + '/migrations/*.{ts,js}'],
    migrationsRun: false,
    synchronize: false,
    logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  };
}
