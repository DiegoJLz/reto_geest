import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { NotFoundException } from '../../common/exceptions/not-found.exception';
import { ValidationException } from '../../common/exceptions/validation.exception';
import { UsersService } from '../users/users.service';
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
  let usersService: jest.Mocked<UsersService>;
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
            exists: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(TaskAssignment),
          useValue: { createQueryBuilder: jest.fn(), find: jest.fn() },
        },
        {
          provide: UsersService,
          useValue: {
            findMissingIds: jest.fn(),
            assertExists: jest.fn(),
          },
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
    usersService = module.get(UsersService);
    dataSource = module.get(getDataSourceToken());
    notifier = module.get(TASK_ARCHIVED_NOTIFIER);
  });

  // ---------- create / list / detail ----------
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

  // ---------- assignUsers (S2 + audit fixes M2/M3) ----------
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
      usersService.findMissingIds.mockResolvedValue([]);
      const insertQB = buildInsertQB();
      assignmentsRepo.createQueryBuilder.mockReturnValue(insertQB as never);
      assignmentsRepo.find.mockResolvedValue([
        { userId: 1 } as TaskAssignment,
        { userId: 2 } as TaskAssignment,
      ]);

      const res = await service.assignUsers(1, [1, 2, 2, 1]);

      expect(usersService.findMissingIds).toHaveBeenCalledWith([1, 2]);
      expect(insertQB.values).toHaveBeenCalledWith([
        { taskId: 1, userId: 1 },
        { taskId: 1, userId: 2 },
      ]);
      // Audit M2: returns AUTHORITATIVE current state, not just input
      expect(res.assignedUserIds).toEqual([1, 2]);
    });

    it('audit M2: returns full current assignees including pre-existing users', async () => {
      tasksRepo.findOne.mockResolvedValue(buildTask());
      usersService.findMissingIds.mockResolvedValue([]);
      const insertQB = buildInsertQB();
      assignmentsRepo.createQueryBuilder.mockReturnValue(insertQB as never);
      // Simulate that user 99 was assigned before, and now we assign 1 & 2.
      assignmentsRepo.find.mockResolvedValue([
        { userId: 1 } as TaskAssignment,
        { userId: 2 } as TaskAssignment,
        { userId: 99 } as TaskAssignment,
      ]);

      const res = await service.assignUsers(1, [1, 2]);
      expect(res.assignedUserIds).toEqual([1, 2, 99]);
    });

    it('throws NotFoundException when task does not exist', async () => {
      tasksRepo.findOne.mockResolvedValue(null);
      await expect(service.assignUsers(999, [1])).rejects.toBeInstanceOf(NotFoundException);
    });

    it('audit M3: throws ValidationException when task is archived', async () => {
      tasksRepo.findOne.mockResolvedValue(buildTask({ status: 'archived' }));
      await expect(service.assignUsers(1, [1])).rejects.toMatchObject({
        code: 'TASK_ARCHIVED',
      });
    });

    it('throws NotFoundException listing missing user ids', async () => {
      tasksRepo.findOne.mockResolvedValue(buildTask());
      usersService.findMissingIds.mockResolvedValue([42, 99]);

      await expect(service.assignUsers(1, [1, 42, 99])).rejects.toMatchObject({
        code: 'USER_NOT_FOUND',
        message: expect.stringContaining('42, 99'),
      });
    });
  });

  // ---------- completeByUser (S2 + audit fix M4) ----------
  describe('completeByUser', () => {
    const buildTxManager = () => {
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
        } as unknown as EntityManager,
      };
    };

    it('throws NotFoundException when task does not exist (pre-flight)', async () => {
      tasksRepo.exists.mockResolvedValue(false);
      usersService.assertExists.mockResolvedValue(undefined);
      await expect(service.completeByUser(999, 1)).rejects.toMatchObject({
        code: 'TASK_NOT_FOUND',
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when user does not exist (pre-flight)', async () => {
      tasksRepo.exists.mockResolvedValue(true);
      usersService.assertExists.mockRejectedValue(
        new NotFoundException('USER_NOT_FOUND', 'User with id 999 not found'),
      );
      await expect(service.completeByUser(1, 999)).rejects.toMatchObject({
        code: 'USER_NOT_FOUND',
      });
    });

    it('throws ValidationException when user is not assigned to the task', async () => {
      tasksRepo.exists.mockResolvedValue(true);
      usersService.assertExists.mockResolvedValue(undefined);
      const { qb, manager } = buildTxManager();
      qb.getOne.mockResolvedValue(buildTask());
      (manager.findOne as jest.Mock).mockResolvedValue(null);
      dataSource.transaction.mockImplementation((fn: unknown) =>
        (fn as (m: EntityManager) => Promise<unknown>)(manager),
      );

      await expect(service.completeByUser(1, 5)).rejects.toBeInstanceOf(ValidationException);
    });

    it('audit M4: throws when task is archived AND assignment uncompleted (data integrity)', async () => {
      tasksRepo.exists.mockResolvedValue(true);
      usersService.assertExists.mockResolvedValue(undefined);
      const { qb, manager } = buildTxManager();
      qb.getOne.mockResolvedValue(buildTask({ status: 'archived' }));
      (manager.findOne as jest.Mock).mockResolvedValue({
        taskId: 1,
        userId: 1,
        completedAt: null, // inconsistent state
      });
      dataSource.transaction.mockImplementation((fn: unknown) =>
        (fn as (m: EntityManager) => Promise<unknown>)(manager),
      );

      await expect(service.completeByUser(1, 1)).rejects.toMatchObject({
        code: 'TASK_ARCHIVED',
      });
    });

    it('idempotent no-op when task archived AND assignment already completed', async () => {
      tasksRepo.exists.mockResolvedValue(true);
      usersService.assertExists.mockResolvedValue(undefined);
      const { qb, manager } = buildTxManager();
      qb.getOne.mockResolvedValue(
        buildTask({ status: 'archived', archivedAt: new Date('2026-08-25T21:00:00Z') }),
      );
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

    it('marks assignment complete without archiving when others still pending', async () => {
      tasksRepo.exists.mockResolvedValue(true);
      usersService.assertExists.mockResolvedValue(undefined);
      const { qb, manager } = buildTxManager();
      qb.getOne.mockResolvedValue(buildTask());
      (manager.findOne as jest.Mock).mockResolvedValue({
        taskId: 1,
        userId: 1,
        completedAt: null,
      });
      (manager.count as jest.Mock).mockResolvedValue(2);
      dataSource.transaction.mockImplementation((fn: unknown) =>
        (fn as (m: EntityManager) => Promise<unknown>)(manager),
      );

      const res = await service.completeByUser(1, 1);
      expect(res.archived).toBe(false);
      expect(notifier.notify).not.toHaveBeenCalled();
    });

    it('archives task and fires notifier exactly once when last assignee completes', async () => {
      tasksRepo.exists.mockResolvedValue(true);
      usersService.assertExists.mockResolvedValue(undefined);
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
      expect(notifier.notify).toHaveBeenCalledTimes(1);
    });
  });
});
