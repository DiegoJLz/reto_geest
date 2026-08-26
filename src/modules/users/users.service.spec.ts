import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { ConflictException } from '../../common/exceptions/conflict.exception';
import { NotFoundException } from '../../common/exceptions/not-found.exception';
import { TaskAssignment } from '../tasks/entities/task-assignment.entity';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let usersRepo: jest.Mocked<Repository<User>>;
  let assignmentsRepo: jest.Mocked<Repository<TaskAssignment>>;

  const buildUser = (over: Partial<User> = {}): User => ({
    id: 1,
    name: 'Diego',
    lastName: 'Julio',
    email: 'diego@geest.com',
    createdAt: new Date('2026-08-25T20:00:00Z'),
    ...over,
  });

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: {
            create: jest.fn((v) => v),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(TaskAssignment),
          useValue: { createQueryBuilder: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(UsersService);
    usersRepo = module.get(getRepositoryToken(User));
    assignmentsRepo = module.get(getRepositoryToken(TaskAssignment));
  });

  describe('create', () => {
    it('saves and returns a UserResponseDto', async () => {
      const saved = buildUser();
      usersRepo.save.mockResolvedValue(saved);

      const result = await service.create({
        name: 'Diego',
        lastName: 'Julio',
        email: 'diego@geest.com',
      });

      expect(usersRepo.save).toHaveBeenCalled();
      expect(result).toEqual({
        id: 1,
        name: 'Diego',
        lastName: 'Julio',
        email: 'diego@geest.com',
        createdAt: '2026-08-25T20:00:00.000Z',
      });
    });

    it('throws ConflictException on duplicate email (Postgres 23505)', async () => {
      const err = new QueryFailedError('insert', [], new Error('dup'));
      (err as unknown as { driverError: { code: string } }).driverError = { code: '23505' };
      usersRepo.save.mockRejectedValue(err);

      await expect(
        service.create({ name: 'A', lastName: 'B', email: 'x@y.z' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('re-throws unknown errors', async () => {
      usersRepo.save.mockRejectedValue(new Error('boom'));
      await expect(service.create({ name: 'A', lastName: 'B', email: 'x@y.z' })).rejects.toThrow(
        'boom',
      );
    });
  });

  describe('findAll', () => {
    it('returns [] when no users exist', async () => {
      usersRepo.find.mockResolvedValue([]);
      expect(await service.findAll()).toEqual([]);
    });

    it('returns users with their pending task ids', async () => {
      usersRepo.find.mockResolvedValue([buildUser({ id: 1 }), buildUser({ id: 2 })]);

      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { userId: '1', taskId: '10' },
          { userId: '1', taskId: '11' },
          { userId: '2', taskId: '20' },
        ]),
      };
      assignmentsRepo.createQueryBuilder.mockReturnValue(
        qb as unknown as ReturnType<Repository<TaskAssignment>['createQueryBuilder']>,
      );

      const result = await service.findAll();

      expect(result[0].pendingTaskIds).toEqual([10, 11]);
      expect(result[1].pendingTaskIds).toEqual([20]);
    });
  });

  describe('findByIdOrFail', () => {
    it('returns the user when found', async () => {
      usersRepo.findOne.mockResolvedValue(buildUser());
      const user = await service.findByIdOrFail(1);
      expect(user.id).toBe(1);
    });

    it('throws NotFoundException when missing', async () => {
      usersRepo.findOne.mockResolvedValue(null);
      await expect(service.findByIdOrFail(999)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
