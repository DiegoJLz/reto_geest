import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { TaskAssignment } from './entities/task-assignment.entity';
import { Task } from './entities/task.entity';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Task, TaskAssignment]),
    UsersModule, // UsersService for existence validations (audit M6)
    NotificationsModule, // provides TASK_ARCHIVED_NOTIFIER (HTTP+retry) + NotificationsService
  ],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
