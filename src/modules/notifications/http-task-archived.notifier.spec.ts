import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import axios from 'axios';
import { Repository } from 'typeorm';
import { NotificationAttempt } from './entities/notification-attempt.entity';
import { HttpTaskArchivedNotifier } from './http-task-archived.notifier';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('HttpTaskArchivedNotifier', () => {
  let notifier: HttpTaskArchivedNotifier;
  let attemptsRepo: jest.Mocked<Repository<NotificationAttempt>>;

  const payload = {
    taskId: 1,
    title: 'Test task',
    archivedAt: '2026-08-25T20:00:00.000Z',
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        HttpTaskArchivedNotifier,
        {
          provide: getRepositoryToken(NotificationAttempt),
          useValue: { insert: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((k: string) => {
              const env: Record<string, string> = {
                NOTIFY_URL: 'https://example.com/notify',
                NOTIFY_MAX_ATTEMPTS: '3',
                // Fast backoff for tests
                NOTIFY_INITIAL_BACKOFF_MS: '1',
              };
              return env[k];
            }),
          },
        },
      ],
    }).compile();

    notifier = module.get(HttpTaskArchivedNotifier);
    attemptsRepo = module.get(getRepositoryToken(NotificationAttempt));
    jest.clearAllMocks();
  });

  it('sends once and persists one attempt on 2xx', async () => {
    mockedAxios.post.mockResolvedValue({ status: 200, data: 'ok' } as never);

    await notifier.notify(payload);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(attemptsRepo.insert).toHaveBeenCalledTimes(1);
    expect(attemptsRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 1, attemptNumber: 1, statusCode: 200, errorMessage: null }),
    );
  });

  it('does NOT retry on 4xx and persists one attempt', async () => {
    mockedAxios.post.mockResolvedValue({ status: 400, data: 'bad' } as never);

    await notifier.notify(payload);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(attemptsRepo.insert).toHaveBeenCalledTimes(1);
    expect(attemptsRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ attemptNumber: 1, statusCode: 400 }),
    );
  });

  it('retries on 5xx up to max attempts and persists each one', async () => {
    mockedAxios.post.mockResolvedValue({ status: 503, data: '' } as never);

    await notifier.notify(payload);

    expect(mockedAxios.post).toHaveBeenCalledTimes(3);
    expect(attemptsRepo.insert).toHaveBeenCalledTimes(3);
    const calls = attemptsRepo.insert.mock.calls.map((c) => c[0]);
    expect(calls).toEqual([
      expect.objectContaining({ attemptNumber: 1, statusCode: 503, errorMessage: null }),
      expect.objectContaining({ attemptNumber: 2, statusCode: 503, errorMessage: null }),
      expect.objectContaining({ attemptNumber: 3, statusCode: 503, errorMessage: null }),
    ]);
  });

  it('retries on network error and records errorMessage with null statusCode', async () => {
    mockedAxios.post
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ status: 200, data: 'ok' } as never);

    await notifier.notify(payload);

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(attemptsRepo.insert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ attemptNumber: 1, statusCode: null, errorMessage: 'ECONNREFUSED' }),
    );
    expect(attemptsRepo.insert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ attemptNumber: 2, statusCode: 200 }),
    );
  });

  it('does nothing when NOTIFY_URL is not configured', async () => {
    const module = await Test.createTestingModule({
      providers: [
        HttpTaskArchivedNotifier,
        { provide: getRepositoryToken(NotificationAttempt), useValue: { insert: jest.fn() } },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => undefined) },
        },
      ],
    }).compile();
    const noUrlNotifier = module.get(HttpTaskArchivedNotifier);
    const noUrlRepo = module.get(getRepositoryToken(NotificationAttempt)) as jest.Mocked<
      Repository<NotificationAttempt>
    >;

    await noUrlNotifier.notify(payload);
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(noUrlRepo.insert).not.toHaveBeenCalled();
  });
});
