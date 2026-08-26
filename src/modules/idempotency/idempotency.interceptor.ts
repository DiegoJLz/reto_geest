import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { firstValueFrom, from, Observable, of } from 'rxjs';
import { ConflictException } from '../../common/exceptions/conflict.exception';
import { ValidationException } from '../../common/exceptions/validation.exception';
import { IdempotencyService } from './idempotency.service';

const HEADER = 'idempotency-key';
const MAX_KEY_LEN = 200;

/**
 * Applies HTTP-level idempotency to POST endpoints. If the client sends an
 * `Idempotency-Key` header, this interceptor guarantees that duplicate
 * requests with the same key and body return the same response — even under
 * parallel arrival (Postgres UNIQUE constraint serializes claims).
 *
 * Contract:
 *  - Same key + same body      → identical response (cached from first execution)
 *  - Same key + different body → 400 IDEMPOTENCY_KEY_BODY_MISMATCH
 *  - Same key still in-flight  → wait up to 5s for original to complete, then
 *                                return same response; else 409 IDEMPOTENCY_KEY_IN_PROGRESS
 *  - No key                    → pass through normally (idempotency is opt-in)
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly service: IdempotencyService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    if (req.method !== 'POST') {
      return next.handle();
    }

    const rawKey = req.headers[HEADER];
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;

    if (!key) {
      return next.handle(); // Idempotency is opt-in
    }
    if (key.length > MAX_KEY_LEN) {
      throw new ValidationException(
        'IDEMPOTENCY_KEY_TOO_LONG',
        `Idempotency-Key must be ${MAX_KEY_LEN} chars or fewer`,
      );
    }

    const endpoint = this.buildEndpointKey(req);
    const bodyHash = this.service.hashBody(req.body);

    const decision = await this.service.claim({ key, endpoint, bodyHash });

    if (decision.action === 'mismatch') {
      throw new ValidationException(
        'IDEMPOTENCY_KEY_BODY_MISMATCH',
        'Idempotency-Key was reused with a different request body',
      );
    }

    if (decision.action === 'return_cached') {
      res.status(decision.statusCode);
      return of(decision.responseBody);
    }

    if (decision.action === 'wait_and_retry') {
      const cached = await this.service.waitForCompletion({ key, endpoint });
      if (cached) {
        res.status(cached.statusCode);
        return of(cached.responseBody);
      }
      throw new ConflictException(
        'IDEMPOTENCY_KEY_IN_PROGRESS',
        'A concurrent request with the same Idempotency-Key is still processing',
      );
    }

    // action === 'execute' — we won the claim, run the handler and cache the response.
    try {
      const response = await firstValueFrom(next.handle());
      const statusCode = res.statusCode || 200;
      await this.service.storeResponse({ key, endpoint, statusCode, responseBody: response });
      return of(response);
    } catch (err) {
      // Release the claim so the caller can retry with the same key.
      await this.service
        .releaseFailed({ key, endpoint })
        .catch((releaseErr) =>
          this.logger.warn(
            `Failed to release idempotency claim after handler error: ${
              releaseErr instanceof Error ? releaseErr.message : String(releaseErr)
            }`,
          ),
        );
      // Re-throw as observable so Nest's exception layer handles it (global filter).
      return from(Promise.reject(err));
    }
  }

  private buildEndpointKey(req: Request): string {
    // Use the matched route pattern when available (e.g. "POST /tasks/:id/complete")
    // so path params don't fragment the key namespace.
    const routePath =
      (req.route as { path?: string } | undefined)?.path ?? (req.originalUrl || req.url);
    return `${req.method} ${routePath}`;
  }
}
