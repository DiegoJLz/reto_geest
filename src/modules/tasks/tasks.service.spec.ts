import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { NotFoundException } from '../../common/exceptions/not-found.exception';
import { ValidationException } from '../../common/exceptions/validation.exception';
import { User } from '../users/entities/user.entity';
import { TaskAssignment } from './entities/task-assignment.entity';
import { Task } from './entities/task.entity';
import {
  TASK_ARCHIVED_NOTIFIER,
  TaskArchivedNotifier,
} from './notifications/task-archived-notifier';
import { TasksService } from './tasks.service';

describe('TasksService', () => {
  let service: TasksService;
  let tasksRepo: jest.Mocked<Repository<Task>>;
  let assignmentsRepo: jest.Mocked<Repository<TaskAssignment>>;
  let usersRepo: jest.Mocked<Repository<User>>;
  let dataSource: jest.Mocked<DataSource>;
  let notifier: jest.Mocked<TaskArchivedNotifier>;

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
            exist: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(TaskAssignment),
          useValue: { createQueryBuilder: jest.fn() },
        },
        {
          provide: getRepositoryToken(User),
          useValue: { find: jest.fn(), exist: jest.fn() },
        },
        {
          provide: getDataSourceToken(),
          useValue: { transaction: jest.fn() },
        },
        {
          provide: TASK_ARCHIVED_NOTIFIER,
          useValue: { notify: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get(TasksService);
    tasksRepo = module.get(getRepositoryToken(Task));
    assignmentsRepo = module.get(getRepositoryToken(TaskAssignment));
    usersRepo = module.get(getRepositoryToken(User));
    dataSource = module.get(getDataSourceToken());
    notifier = module.get(TASK_ARCHIVED_NOTIFIER);
  });

  // ---------- create / list / detail (already covered in S1) ----------
  describe('create', () => {
    it('creates a task with status "open" by default and nullable description', async () => {
      tasksRepo.save.mockResolvedValue(buildTask({ description: null }));
      const res = await service.create({ title: 'Preparar informe' });

      expect(tasksRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Preparar informe', description: null, status: 'open' }),
      );
      expect(res.status).toBe('open');
      expect(res.description).toBeNull();
    });
  });

  describe('findAll', () => {
    it('filters by status when provided', async () => {
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      tasksRepo.createQueryBuilder.mockReturnValue(qb as never);
      await service.findAll('archived');
      expect(qb.where).toHaveBeenCalledWith('t.status = :status', { status: 'archived' });
    });
  });

  describe('findByIdWithAssignees', () => {
    it('throws NotFoundException when missing', async () => {
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      tasksRepo.createQueryBuilder.mockReturnValue(qb as never);
      await expect(service.findByIdWithAssignees(999)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ---------- assignUsers (S2) ----------
  describe('assignUsers', () => {
    const buildInsertQB = () => ({
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ raw: [], identifiers: [] }),
    });

    it('deduplicates userIds before verifying and inserting', async () => {
      tasksRepo.findOne.mockResolvedValue(buildTask());
      usersRepo.find.mockResolvedValue([{ id: 1 } as User, { id: 2 } as User]);
      const insertQB = buildInsertQB();
      assignmentsRepo.createQueryBuilder.mockReturnValue(insertQB as never);

      const res = await service.assignUsers(1, [1, 2, 2, 1]);

      expect(res.assignedUserIds).toEqual([1, 2]);
      expect(insertQB.values).toHaveBeenCalledWith([
        { taskId: 1, userId: 1 },
        { taskId: 1, userId: 2 },
      ]);
      expect(insertQB.orIgnore).toHaveBeenCalled();
    });

    it('throws NotFoundException when task does not exist', async () => {
      tasksRepo.findOne.mockResolvedValue(null);
      await expect(service.assignUsers(999, [1])).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException listing missing user ids', async () => {
      tasksRepo.findOne.mockResolvedValue(buildTask());
      usersRepo.find.mockResolvedValue([{ id: 1 } as User]);

      await expect(service.assignUsers(1, [1, 42, 99])).rejects.toMatchObject({
        code: 'USER_NOT_FOUND',
        message: expect.stringContaining('42, 99'),
      });
    });
  });

  // ---------- completeByUser (S2) ----------
  describe('completeByUser', () => {
    const buildTxManager = (over: Partial<Record<string, jest.Mock>> = {}) => {
      const qb = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn(),
      };
      return {
        qb,
        manager: {
          createQueryBuilder: jest.fn().mockReturnValue(qb),
          findOne: jest.fn(),
          save: jest.fn().mockImplementation(async (e) => e),
          count: jest.fn(),
          ...over,
        } as unknown as EntityManager,
      };
    };

    const runTx = (implementation: (manager: EntityManager) => Promise<unknown>) => {
      dataSource.transaction.mockImplementation((fn: unknown) =>
        (fn as (m: EntityManager) => Promise<unknown>)(implementation as never),
      );
    };

    it('throws NotFoundException when task does not exist (pre-flight)', async () => {
      tasksRepo.exist.mockResolvedValue(false);
      usersRepo.exist.mockResolvedValue(true);
      await expect(service.completeByUser(999, 1)).rejects.toMatchObject({
        code: 'TASK_NOT_FOUND',
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when user does not exist (pre-flight)', async () => {
      tasksRepo.exist.mockResolvedValue(true);
      usersRepo.exist.mockResolvedValue(false);
      await expect(service.completeByUser(1, 999)).rejects.toMatchObject({
        code: 'USER_NOT_FOUND',
      });
    });

    it('throws ValidationException when user is not assigned to the task', async () => {
      tasksRepo.exist.mockResolvedValue(true);
      usersRepo.exist.mockResolvedValue(true);
      const { qb, manager } = buildTxManager();
      qb.getOne.mockResolvedValue(buildTask());
      (manager.findOne as jest.Mock).mockResolvedValue(null);
      dataSource.transaction.mockImplementation((fn: unknown) =>
        (fn as (m: EntityManager) => Promise<unknown>)(manager),
      );

      await expect(service.completeByUser(1, 5)).rejects.toBeInstanceOf(ValidationException);
    });

    it('marks the assignment complete when not the last one — no archive, no notify', async () => {
      tasksRepo.exist.mockResolvedValue(true);
      usersRepo.exist.mockResolvedValue(true);
      const { qb, manager } = buildTxManager();
      qb.getOne.mockResolvedValue(buildTask());
      (manager.findOne as jest.Mock).mockResolvedValue({
        taskId: 1,
        userId: 1,
        completedAt: null,
      });
      (manager.count as jest.Mock).mockResolvedValue(2); // still pending assignees
      dataSource.transaction.mockImplementation((fn: unknown) =>
        (fn as (m: EntityManager) => Promise<unknown>)(manager),
      );

      const res = await service.completeByUser(1, 1);

      expect(res.archived).toBe(false);
      expect(notifier.notify).not.toHaveBeenCalled();
    });

    it('archives task and fires notifier exactly once when last assignee completes', async () => {
      tasksRepo.exist.mockResolvedValue(true);
      usersRepo.exist.mockResolvedValue(true);
      const task = buildTask({ status: 'open' });
      const { qb, manager } = buildTxManager();
      qb.getOne.mockResolvedValue(task);
      (manager.findOne as jest.Mock).mockResolvedValue({
        taskId: 1,
        userId: 1,
        completedAt: null,
      });
      (manager.count as jest.Mock).mockResolvedValue(0);
      dataSource.transaction.mockImplementation((fn: unknown) =>
        (fn as (m: EntityManager) => Promise<unknown>)(manager),
      );

      const res = await service.completeByUser(1, 1);

      expect(res.archived).toBe(true);
      expect(task.status).toBe('archived');
      expect(task.archivedAt).toBeInstanceOf(Date);
      expect(notifier.notify).toHaveBeenCalledTimes(1);
      expect(notifier.notify).toHaveBeenCalledWith({
        taskId: 1,
        title: 'Preparar informe',
        archivedAt: expect.any(String),
      });
    });

    it('does NOT re-archive nor re-notify when task is already archived (idempotent)', async () => {
      tasksRepo.exist.mockResolvedValue(true);
      usersRepo.exist.mockResolvedValue(true);
      const task = buildTask({
        status: 'archived',
        archivedAt: new Date('2026-08-25T21:00:00Z'),
      });
      const { qb, manager } = buildTxManager();
      qb.getOne.mockResolvedValue(task);
      (manager.findOne as jest.Mock).mockResolvedValue({
        taskId: 1,
        userId: 1,
        completedAt: new Date('2026-08-25T20:59:00Z'),
      });
      (manager.count as jest.Mock).mockResolvedValue(0);
      dataSource.transaction.mockImplementation((fn: unknown) =>
        (fn as (m: EntityManager) => Promise<unknown>)(manager),
      );

      const res = await service.completeByUser(1, 1);

      expect(res.archived).toBe(false);
      expect(notifier.notify).not.toHaveBeenCalled();
    });

    it('is a no-op on assignment when already completed (double-click safe)', async () => {
      tasksRepo.exist.mockResolvedValue(true);
      usersRepo.exist.mockResolvedValue(true);
      const { qb, manager } = buildTxManager();
      qb.getOne.mockResolvedValue(buildTask());
      const alreadyCompleted = {
        taskId: 1,
        userId: 1,
        completedAt: new Date('2026-08-25T20:00:00Z'),
      };
      (manager.findOne as jest.Mock).mockResolvedValue(alreadyCompleted);
      (manager.count as jest.Mock).mockResolvedValue(1); // one other pending
      dataSource.transaction.mockImplementation((fn: unknown) =>
        (fn as (m: EntityManager) => Promise<unknown>)(manager),
      );

      const res = await service.completeByUser(1, 1);

      // Save on assignment should not be called because already completed
      const savedTypes = (manager.save as jest.Mock).mock.calls.map((c) => c[0]);
      expect(savedTypes).not.toContain(alreadyCompleted);
      expect(res.archived).toBe(false);
    });
  });
});
