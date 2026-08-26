import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { NotFoundException } from '../../common/exceptions/not-found.exception';
import { ValidationException } from '../../common/exceptions/validation.exception';
import { UsersService } from '../users/users.service';
import { AssignUsersResponseDto } from './dto/assign-users.dto';
import { CompleteTaskResponseDto } from './dto/complete-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { TaskResponseDto } from './dto/task-response.dto';
import { TaskAssignment } from './entities/task-assignment.entity';
import { Task, TaskStatus } from './entities/task.entity';
import {
  TASK_ARCHIVED_NOTIFIER,
  TaskArchivedNotifier,
} from './notifications/task-archived-notifier';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    @InjectRepository(TaskAssignment)
    private readonly assignments: Repository<TaskAssignment>,
    private readonly usersService: UsersService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(TASK_ARCHIVED_NOTIFIER)
    private readonly notifier: TaskArchivedNotifier,
  ) {}

  async create(dto: CreateTaskDto): Promise<TaskResponseDto> {
    const entity = this.tasks.create({
      title: dto.title,
      description: dto.description ?? null,
      status: 'open',
    });
    const saved = await this.tasks.save(entity);
    return TaskResponseDto.from(saved);
  }

  async findAll(status?: TaskStatus): Promise<TaskResponseDto[]> {
    const qb = this.tasks
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.assignments', 'a')
      .leftJoinAndSelect('a.user', 'u')
      .orderBy('t.id', 'ASC');

    if (status) qb.where('t.status = :status', { status });

    const rows = await qb.getMany();
    return rows.map((t) => TaskResponseDto.from(t));
  }

  async findByIdWithAssignees(id: number): Promise<TaskResponseDto> {
    const task = await this.tasks
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.assignments', 'a')
      .leftJoinAndSelect('a.user', 'u')
      .where('t.id = :id', { id })
      .getOne();

    if (!task) {
      throw new NotFoundException('TASK_NOT_FOUND', `Task with id ${id} not found`);
    }
    return TaskResponseDto.from(task);
  }

  async findByIdOrFail(id: number): Promise<Task> {
    const task = await this.tasks.findOne({ where: { id } });
    if (!task) {
      throw new NotFoundException('TASK_NOT_FOUND', `Task with id ${id} not found`);
    }
    return task;
  }

  /**
   * Assigns a batch of users to a task. Duplicate rows are silently skipped
   * via INSERT ... ON CONFLICT DO NOTHING, so repeated calls are idempotent.
   *
   * Rejects if:
   *   - task does not exist (404)
   *   - task is archived (400) — assigning to a closed task makes no sense
   *   - any userId does not exist (404, with list of missing ids)
   *
   * Returns the FULL current list of assigned userIds (including pre-existing)
   * so clients get authoritative state, not a copy of their input.
   */
  async assignUsers(taskId: number, userIds: number[]): Promise<AssignUsersResponseDto> {
    const uniqueIds = [...new Set(userIds)];

    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException('TASK_NOT_FOUND', `Task with id ${taskId} not found`);
    }
    if (task.status === 'archived') {
      throw new ValidationException(
        'TASK_ARCHIVED',
        `Task ${taskId} is archived; cannot assign new users`,
      );
    }

    const missing = await this.usersService.findMissingIds(uniqueIds);
    if (missing.length > 0) {
      throw new NotFoundException(
        'USER_NOT_FOUND',
        `User(s) not found: ${missing.join(', ')}`,
      );
    }

    if (uniqueIds.length > 0) {
      await this.assignments
        .createQueryBuilder()
        .insert()
        .into(TaskAssignment)
        .values(uniqueIds.map((uid) => ({ taskId, userId: uid })))
        .orIgnore()
        .execute();
    }

    // Return authoritative state: ALL assignees on the task now, not just the input.
    const current = await this.assignments.find({
      where: { taskId },
      select: ['userId'],
      order: { userId: 'ASC' },
    });

    return {
      message: 'Users assigned successfully',
      taskId,
      assignedUserIds: current.map((a) => a.userId),
    };
  }

  /**
   * Marks a user's part of a task as complete. When the last pending assignee
   * completes, the task is archived exactly once and the notifier is fired
   * exactly once — enforced via pessimistic row lock on the tasks row plus a
   * status='open' guard on the archive update (two safety nets).
   *
   * Idempotent: repeat calls (double-click, retry) after the assignment has
   * already been marked complete are a no-op that returns archived=false.
   */
  async completeByUser(taskId: number, userId: number): Promise<CompleteTaskResponseDto> {
    // Pre-flight existence checks outside tx for clean 404s on invalid input.
    await Promise.all([
      this.assertTaskExists(taskId),
      this.usersService.assertExists(userId),
    ]);

    const result = await this.dataSource.transaction(async (manager) => {
      // 1) Serialize concurrent completes on the same task via pessimistic write lock.
      const lockedTask = await manager
        .createQueryBuilder(Task, 't')
        .setLock('pessimistic_write')
        .where('t.id = :id', { id: taskId })
        .getOne();

      if (!lockedTask) {
        throw new NotFoundException('TASK_NOT_FOUND', `Task with id ${taskId} not found`);
      }

      // 2) Assignment must exist for this (task, user).
      const assignment = await manager.findOne(TaskAssignment, {
        where: { taskId, userId },
      });
      if (!assignment) {
        throw new ValidationException(
          'USER_NOT_ASSIGNED_TO_TASK',
          `User ${userId} is not assigned to task ${taskId}`,
        );
      }

      // 3) Data-integrity guard (audit M4): refuse to mutate an archived task
      // if the assignment is inconsistent (uncompleted on archived task).
      // Legitimate double-clicks after archiving hit assignment.completedAt != null
      // below and short-circuit to no-op.
      if (lockedTask.status === 'archived' && assignment.completedAt == null) {
        throw new ValidationException(
          'TASK_ARCHIVED',
          `Task ${taskId} is archived; cannot record new completions`,
        );
      }

      // 4) Mark complete (idempotent — repeated calls / double-click no-op).
      if (assignment.completedAt == null) {
        assignment.completedAt = new Date();
        await manager.save(assignment);
      }

      // 5) Count remaining pending assignees within the same locked window.
      const remaining = await manager.count(TaskAssignment, {
        where: { taskId, completedAt: IsNull() },
      });

      // 6) Archive iff still open AND no pending assignees. Guard prevents
      //    double-archive if the row was already archived (defense in depth).
      let archived = false;
      if (remaining === 0 && lockedTask.status === 'open') {
        lockedTask.status = 'archived';
        lockedTask.archivedAt = new Date();
        await manager.save(lockedTask);
        archived = true;
      }

      return { archived, task: lockedTask };
    });

    // Notification fires AFTER the DB commit, and only when THIS caller archived.
    // Guarantees exactly-once because only the winning tx sees status='open'.
    if (result.archived) {
      try {
        await this.notifier.notify({
          taskId: result.task.id,
          title: result.task.title,
          archivedAt: result.task.archivedAt!.toISOString(),
        });
      } catch (err) {
        this.logger.error(
          `Notifier failed for task ${result.task.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    return {
      message: 'User completion recorded',
      taskId,
      userId,
      archived: result.archived,
    };
  }

  private async assertTaskExists(id: number): Promise<void> {
    const exists = await this.tasks.exists({ where: { id } });
    if (!exists) {
      throw new NotFoundException('TASK_NOT_FOUND', `Task with id ${id} not found`);
    }
  }
}
