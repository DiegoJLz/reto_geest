import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException } from '../../common/exceptions/not-found.exception';
import { Task } from '../tasks/entities/task.entity';
import { NotificationAttempt } from './entities/notification-attempt.entity';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let attemptsRepo: jest.Mocked<Repository<NotificationAttempt>>;
  let tasksRepo: jest.Mocked<Repository<Task>>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: getRepositoryToken(NotificationAttempt),
          useValue: { find: jest.fn() },
        },
        {
          provide: getRepositoryToken(Task),
          useValue: { exists: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(NotificationsService);
    attemptsRepo = module.get(getRepositoryToken(NotificationAttempt));
    tasksRepo = module.get(getRepositoryToken(Task));
  });

  it('throws NotFoundException when task does not exist', async () => {
    tasksRepo.exists.mockResolvedValue(false);
    await expect(service.getAttemptsForTask(999)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns attempts ordered by attempt_number and mapped to DTO', async () => {
    tasksRepo.exists.mockResolvedValue(true);
    const now = new Date('2026-08-25T20:00:00Z');
    attemptsRepo.find.mockResolvedValue([
      {
        id: 1,
        taskId: 1,
        attemptNumber: 1,
        statusCode: 500,
        errorMessage: null,
        createdAt: now,
      },
      {
        id: 2,
        taskId: 1,
        attemptNumber: 2,
        statusCode: 200,
        errorMessage: null,
        createdAt: new Date(now.getTime() + 1000),
      },
    ] as never);

    const res = await service.getAttemptsForTask(1);
    expect(res).toHaveLength(2);
    expect(res[0]).toEqual({
      attemptNumber: 1,
      statusCode: 500,
      errorMessage: null,
      timestamp: now.toISOString(),
    });
    expect(res[1].attemptNumber).toBe(2);
  });
});
