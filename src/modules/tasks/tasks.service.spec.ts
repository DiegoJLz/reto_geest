import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException } from '../../common/exceptions/not-found.exception';
import { Task } from './entities/task.entity';
import { TasksService } from './tasks.service';

describe('TasksService', () => {
  let service: TasksService;
  let repo: jest.Mocked<Repository<Task>>;

  const buildTask = (over: Partial<Task> = {}): Task => ({
    id: 1,
    title: 'Preparar informe',
    description: 'Q3',
    status: 'open',
    archivedAt: null,
    createdAt: new Date('2026-08-25T20:00:00Z'),
    assignments: [],
    ...over,
  });

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        TasksService,
        {
          provide: getRepositoryToken(Task),
          useValue: {
            create: jest.fn((v) => v),
            save: jest.fn(),
            createQueryBuilder: jest.fn(),
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(TasksService);
    repo = module.get(getRepositoryToken(Task));
  });

  describe('create', () => {
    it('creates a task with status "open" by default and nullable description', async () => {
      repo.save.mockResolvedValue(buildTask({ description: null }));
      const res = await service.create({ title: 'Preparar informe' });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Preparar informe', description: null, status: 'open' }),
      );
      expect(res.status).toBe('open');
      expect(res.description).toBeNull();
      expect(res.assignees).toEqual([]);
    });
  });

  describe('findAll', () => {
    it('lists tasks and filters by status when provided', async () => {
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([buildTask({ id: 1 }), buildTask({ id: 2 })]),
      };
      repo.createQueryBuilder.mockReturnValue(
        qb as unknown as ReturnType<Repository<Task>['createQueryBuilder']>,
      );

      const res = await service.findAll('open');

      expect(qb.where).toHaveBeenCalledWith('t.status = :status', { status: 'open' });
      expect(res).toHaveLength(2);
    });

    it('does not add where clause when status is undefined', async () => {
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      repo.createQueryBuilder.mockReturnValue(
        qb as unknown as ReturnType<Repository<Task>['createQueryBuilder']>,
      );

      await service.findAll();
      expect(qb.where).not.toHaveBeenCalled();
    });
  });

  describe('findByIdWithAssignees', () => {
    it('returns task detail when found', async () => {
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(buildTask()),
      };
      repo.createQueryBuilder.mockReturnValue(
        qb as unknown as ReturnType<Repository<Task>['createQueryBuilder']>,
      );

      const res = await service.findByIdWithAssignees(1);
      expect(res.id).toBe(1);
      expect(res.assignees).toEqual([]);
    });

    it('throws NotFoundException when task missing', async () => {
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      repo.createQueryBuilder.mockReturnValue(
        qb as unknown as ReturnType<Repository<Task>['createQueryBuilder']>,
      );

      await expect(service.findByIdWithAssignees(999)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
