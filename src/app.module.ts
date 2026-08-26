import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { typeOrmConfig } from './database/typeorm.config';
import { HealthController } from './health.controller';
import { IdempotencyModule } from './modules/idempotency/idempotency.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    TypeOrmModule.forRoot(typeOrmConfig()),
    IdempotencyModule, // Global interceptor: opt-in via Idempotency-Key header
    UsersModule,
    NotificationsModule,
    TasksModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
export class AppModule {}
