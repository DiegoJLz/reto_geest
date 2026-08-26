import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { ConflictException } from '../../common/exceptions/conflict.exception';
import { NotFoundException } from '../../common/exceptions/not-found.exception';
import { TaskAssignment } from '../tasks/entities/task-assignment.entity';
import { Task } from '../tasks/entities/task.entity';
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

  private isUniqueViolation(err: QueryFailedError): boolean {
    const driverError = err.driverError as { code?: string } | undefined;
    return driverError?.code === '23505';
  }
}
