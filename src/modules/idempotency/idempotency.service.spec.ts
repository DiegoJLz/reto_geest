import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { IdempotencyKey } from './entities/idempotency-key.entity';
import { IdempotencyService } from './idempotency.service';

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let repo: jest.Mocked<Repository<IdempotencyKey>>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        IdempotencyService,
        {
          provide: getRepositoryToken(IdempotencyKey),
          useValue: {
            insert: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(IdempotencyService);
    repo = module.get(getRepositoryToken(IdempotencyKey));
  });

  describe('hashBody', () => {
    it('produces the same hash regardless of property order', () => {
      const a = service.hashBody({ name: 'x', age: 1 });
      const b = service.hashBody({ age: 1, name: 'x' });
      expect(a).toBe(b);
    });

    it('produces different hashes for different values', () => {
      const a = service.hashBody({ name: 'x' });
      const b = service.hashBody({ name: 'y' });
      expect(a).not.toBe(b);
    });

    it('handles undefined / null / empty body', () => {
      expect(service.hashBody(undefined)).toBe(service.hashBody(undefined));
      expect(service.hashBody(null)).toBe(service.hashBody(null));
      expect(service.hashBody({})).toBe(service.hashBody({}));
    });
  });

  describe('claim', () => {
    const params = { key: 'k1', endpoint: 'POST /x', bodyHash: 'h1' };

    it('returns action=execute when insert succeeds (winner)', async () => {
      repo.insert.mockResolvedValue({} as never);
      await expect(service.claim(params)).resolves.toEqual({ action: 'execute' });
    });

    it('returns action=return_cached when existing row is completed with same hash', async () => {
      const err = new QueryFailedError('insert', [], new Error('dup'));
      (err as unknown as { driverError: { code: string } }).driverError = { code: '23505' };
      repo.insert.mockRejectedValue(err);
      repo.findOne.mockResolvedValue({
        key: 'k1',
        endpoint: 'POST /x',
        requestHash: 'h1',
        status: 'completed',
        statusCode: 201,
        responseBody: { id: 1 },
        createdAt: new Date(),
        completedAt: new Date(),
      } as never);

      await expect(service.claim(params)).resolves.toEqual({
        action: 'return_cached',
        statusCode: 201,
        responseBody: { id: 1 },
      });
    });

    it('returns action=mismatch when body hash differs', async () => {
      const err = new QueryFailedError('insert', [], new Error('dup'));
      (err as unknown as { driverError: { code: string } }).driverError = { code: '23505' };
      repo.insert.mockRejectedValue(err);
      repo.findOne.mockResolvedValue({
        key: 'k1',
        endpoint: 'POST /x',
        requestHash: 'DIFFERENT',
        status: 'completed',
        statusCode: 201,
        responseBody: null,
        createdAt: new Date(),
        completedAt: null,
      } as never);

      await expect(service.claim(params)).resolves.toEqual({ action: 'mismatch' });
    });

    it('returns action=wait_and_retry when existing row is still processing', async () => {
      const err = new QueryFailedError('insert', [], new Error('dup'));
      (err as unknown as { driverError: { code: string } }).driverError = { code: '23505' };
      repo.insert.mockRejectedValue(err);
      repo.findOne.mockResolvedValue({
        key: 'k1',
        endpoint: 'POST /x',
        requestHash: 'h1',
        status: 'processing',
        statusCode: null,
        responseBody: null,
        createdAt: new Date(),
        completedAt: null,
      } as never);

      await expect(service.claim(params)).resolves.toEqual({ action: 'wait_and_retry' });
    });

    it('re-throws unknown errors', async () => {
      repo.insert.mockRejectedValue(new Error('boom'));
      await expect(service.claim(params)).rejects.toThrow('boom');
    });
  });

  describe('storeResponse / releaseFailed', () => {
    it('storeResponse updates status to completed with body + status code', async () => {
      await service.storeResponse({
        key: 'k',
        endpoint: 'POST /x',
        statusCode: 201,
        responseBody: { id: 1 },
      });
      expect(repo.update).toHaveBeenCalledWith(
        { key: 'k', endpoint: 'POST /x' },
        expect.objectContaining({
          status: 'completed',
          statusCode: 201,
          responseBody: { id: 1 },
          completedAt: expect.any(Date),
        }),
      );
    });

    it('releaseFailed deletes the claim row', async () => {
      await service.releaseFailed({ key: 'k', endpoint: 'POST /x' });
      expect(repo.delete).toHaveBeenCalledWith({ key: 'k', endpoint: 'POST /x' });
    });
  });
});
