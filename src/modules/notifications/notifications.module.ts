import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from '../tasks/entities/task.entity';
import { TASK_ARCHIVED_NOTIFIER } from '../tasks/notifications/task-archived-notifier';
import { NotificationAttempt } from './entities/notification-attempt.entity';
import { HttpTaskArchivedNotifier } from './http-task-archived.notifier';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    ConfigModule,
    // Task entity is a READ-only dep here (existence checks); we don't own it,
    // just query it. Owning tasks stays in TasksModule.
    TypeOrmModule.forFeature([NotificationAttempt, Task]),
  ],
  providers: [
    HttpTaskArchivedNotifier,
    NotificationsService,
    // Provide the port (interface) with the HTTP implementation. TasksService
    // injects it via the TASK_ARCHIVED_NOTIFIER token and knows nothing about
    // HTTP — Open/Closed principle in action.
    { provide: TASK_ARCHIVED_NOTIFIER, useClass: HttpTaskArchivedNotifier },
  ],
  exports: [TASK_ARCHIVED_NOTIFIER, NotificationsService],
})
export class NotificationsModule {}
