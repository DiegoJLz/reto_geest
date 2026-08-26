import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { ConflictException } from '../../common/exceptions/conflict.exception';
import { NotFoundException } from '../../common/exceptions/not-found.exception';
import { TaskAssignment } from '../tasks/entities/task-assignment.entity';
import { Task } from '../tasks/entities/task.entity';
import { UserTaskResponseDto } from './dto/user-tasks-response.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UserResponseDto, UserWithPendingTasksDto } from './dto/user-response.dto';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(TaskAssignment)
    private readonly assignments: Repository<TaskAssignment>,
  ) {}

  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    const entity = this.users.create(dto);
    try {
      const saved = await this.users.save(entity);
      return UserResponseDto.from(saved);
    } catch (err) {
      if (err instanceof QueryFailedError && this.isUniqueViolation(err)) {
        throw new ConflictException(
          'USER_EMAIL_ALREADY_EXISTS',
          `A user with email "${dto.email}" already exists`,
        );
      }
      throw err;
    }
  }

  async findAll(): Promise<UserWithPendingTasksDto[]> {
    const users = await this.users.find({ order: { id: 'ASC' } });
    if (users.length === 0) return [];

    const userIds = users.map((u) => u.id);
    const pending = await this.assignments
      .createQueryBuilder('a')
      .innerJoin(Task, 't', 't.id = a.task_id')
      .select(['a.user_id AS "userId"', 'a.task_id AS "taskId"'])
      .where('a.user_id IN (:...ids)', { ids: userIds })
      .andWhere('a.completed_at IS NULL')
      .andWhere("t.status = 'open'")
      .getRawMany<{ userId: string; taskId: string }>();

    const pendingByUser = new Map<number, number[]>();
    for (const row of pending) {
      const uid = Number(row.userId);
      const tid = Number(row.taskId);
      const list = pendingByUser.get(uid) ?? [];
      list.push(tid);
      pendingByUser.set(uid, list);
    }

    return users.map((u) => ({
      ...UserResponseDto.from(u),
      pendingTaskIds: pendingByUser.get(u.id) ?? [],
    }));
  }

  async findByIdOrFail(id: number): Promise<User> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('USER_NOT_FOUND', `User with id ${id} not found`);
    }
    return user;
  }

  /**
   * Returns all tasks the user is assigned to, indicating whether
   * this specific user has completed their part or not.
   */
  async getUserTasks(userId: number): Promise<UserTaskResponseDto[]> {
    await this.findByIdOrFail(userId);

    const rows = await this.assignments
      .createQueryBuilder('a')
      .innerJoin(Task, 't', 't.id = a.task_id')
      .select([
        't.id AS "taskId"',
        't.title AS "title"',
        't.status AS "status"',
        'a.completed_at AS "completedAt"',
      ])
      .where('a.user_id = :userId', { userId })
      .orderBy('t.id', 'ASC')
      .getRawMany<{ taskId: string; title: string; status: string; completedAt: Date | null }>();

    return rows.map((r) => ({
      taskId: Number(r.taskId),
      title: r.title,
      status: r.status as UserTaskResponseDto['status'],
      completedByUser: r.completedAt != null,
      completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : null,
    }));
  }

  private isUniqueViolation(err: QueryFailedError): boolean {
    const driverError = err.driverError as { code?: string } | undefined;
    return driverError?.code === '23505';
  }
}
