import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { TaskAssignment } from './entities/task-assignment.entity';
import { Task } from './entities/task.entity';
import {
  LoggerTaskArchivedNotifier,
  TASK_ARCHIVED_NOTIFIER,
} from './notifications/task-archived-notifier';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [TypeOrmModule.forFeature([Task, TaskAssignment, User])],
  controllers: [TasksController],
  providers: [
    TasksService,
    { provide: TASK_ARCHIVED_NOTIFIER, useClass: LoggerTaskArchivedNotifier },
  ],
  exports: [TasksService],
})
export class TasksModule {}
