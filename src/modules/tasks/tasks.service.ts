import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException } from '../../common/exceptions/not-found.exception';
import { CreateTaskDto } from './dto/create-task.dto';
import { TaskResponseDto } from './dto/task-response.dto';
import { Task, TaskStatus } from './entities/task.entity';

@Injectable()
export class TasksService {
  constructor(@InjectRepository(Task) private readonly tasks: Repository<Task>) {}

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
}
