import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException } from '../../common/exceptions/not-found.exception';
import { Task } from '../tasks/entities/task.entity';
import { NotificationAttemptResponseDto } from './dto/notification-attempt-response.dto';
import { NotificationAttempt } from './entities/notification-attempt.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(NotificationAttempt)
    private readonly attempts: Repository<NotificationAttempt>,
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
  ) {}

  async getAttemptsForTask(taskId: number): Promise<NotificationAttemptResponseDto[]> {
    const taskExists = await this.tasks.exists({ where: { id: taskId } });
    if (!taskExists) {
      throw new NotFoundException('TASK_NOT_FOUND', `Task with id ${taskId} not found`);
    }

    const rows = await this.attempts.find({
      where: { taskId },
      order: { attemptNumber: 'ASC', createdAt: 'ASC' },
    });
    return rows.map((r) => NotificationAttemptResponseDto.from(r));
  }
}
