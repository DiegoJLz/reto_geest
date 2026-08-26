import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { QueryFailedError, Repository } from 'typeorm';
import { IdempotencyKey } from './entities/idempotency-key.entity';

export type ClaimDecision =
  | { action: 'execute' }
  | { action: 'return_cached'; statusCode: number; responseBody: unknown }
  | { action: 'wait_and_retry' }
  | { action: 'mismatch' };

export interface CachedResponse {
  statusCode: number;
  responseBody: unknown;
}

/**
 * Data-plane for HTTP idempotency. Uses Postgres UNIQUE constraint on
 * (key, endpoint) to serialize concurrent requests atomically — the first
 * INSERT wins and executes; losers see the row and either return cached
 * response, wait for the in-flight winner, or reject on body mismatch.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private static readonly WAIT_MAX_MS = 5000;
  private static readonly WAIT_POLL_MS = 100;

  constructor(
    @InjectRepository(IdempotencyKey)
    private readonly repo: Repository<IdempotencyKey>,
  ) {}

  hashBody(body: unknown): string {
    // Deterministic hash: sort object keys so property order does not change the hash.
    const canonical = this.canonicalStringify(body);
    return createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Attempts to claim ownership of the (key, endpoint) request. The first
   * caller wins via INSERT; subsequent callers see the existing row and
   * decide what to do based on body hash + status.
   */
  async claim(params: {
    key: string;
    endpoint: string;
    bodyHash: string;
  }): Promise<ClaimDecision> {
    const { key, endpoint, bodyHash } = params;

    try {
      await this.repo.insert({
        key,
        endpoint,
        requestHash: bodyHash,
        status: 'processing',
      });
      return { action: 'execute' };
    } catch (err) {
      if (!this.isUniqueViolation(err)) throw err;

      // Row already exists — inspect it.
      const existing = await this.repo.findOne({ where: { key, endpoint } });
      if (!existing) {
        // Extremely unlikely: someone deleted the row after the unique violation.
        // Treat as "start over" — recurse once by re-throwing? Simplest: mismatch.
        this.logger.warn(`Idempotency row vanished after conflict for key=${key}`);
        return { action: 'mismatch' };
      }
      if (existing.requestHash !== bodyHash) {
        return { action: 'mismatch' };
      }
      if (existing.status === 'completed') {
        return {
          action: 'return_cached',
          statusCode: existing.statusCode ?? 200,
          responseBody: existing.responseBody,
        };
      }
      // status === 'processing' — wait
      return { action: 'wait_and_retry' };
    }
  }

  async storeResponse(params: {
    key: string;
    endpoint: string;
    statusCode: number;
    responseBody: unknown;
  }): Promise<void> {
    await this.repo.update(
      { key: params.key, endpoint: params.endpoint },
      {
        status: 'completed',
        statusCode: params.statusCode,
        responseBody: params.responseBody as never,
        completedAt: new Date(),
      },
    );
  }

  /**
   * Called when the executing request fails: remove the claim so the client
   * can safely retry with the same Idempotency-Key.
   */
  async releaseFailed(params: { key: string; endpoint: string }): Promise<void> {
    await this.repo.delete({ key: params.key, endpoint: params.endpoint });
  }

  /**
   * Polls for the in-flight winning request to complete. Bounded wait to avoid
   * indefinite blocking of loser requests.
   */
  async waitForCompletion(params: {
    key: string;
    endpoint: string;
  }): Promise<CachedResponse | null> {
    const start = Date.now();
    while (Date.now() - start < IdempotencyService.WAIT_MAX_MS) {
      const existing = await this.repo.findOne({
        where: { key: params.key, endpoint: params.endpoint },
      });
      if (!existing) return null; // winner failed and released
      if (existing.status === 'completed') {
        return {
          statusCode: existing.statusCode ?? 200,
          responseBody: existing.responseBody,
        };
      }
      await this.sleep(IdempotencyService.WAIT_POLL_MS);
    }
    return null;
  }

  private canonicalStringify(value: unknown): string {
    // Stable JSON stringify with sorted keys — handles nested objects.
    // Coerce undefined to null so hashing a missing body still yields a hash.
    const normalized = value === undefined ? null : value;
    return (
      JSON.stringify(normalized, (_, v) => {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          return Object.keys(v)
            .sort()
            .reduce<Record<string, unknown>>((acc, k) => {
              acc[k] = (v as Record<string, unknown>)[k];
              return acc;
            }, {});
        }
        return v;
      }) ?? 'null'
    );
  }

  private isUniqueViolation(err: unknown): boolean {
    if (!(err instanceof QueryFailedError)) return false;
    const driverErr = err.driverError as { code?: string } | undefined;
    return driverErr?.code === '23505';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
