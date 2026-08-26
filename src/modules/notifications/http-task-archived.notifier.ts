import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import axios, { AxiosError, isAxiosError } from 'axios';
import { Repository } from 'typeorm';
import {
  TaskArchivedNotifier,
  TaskArchivedPayload,
} from '../tasks/notifications/task-archived-notifier';
import { NotificationAttempt } from './entities/notification-attempt.entity';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 500;
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Real notifier: POSTs to NOTIFY_URL with exponential backoff retries.
 * Spec-compliant: retries on 5xx and network failures, max 3 attempts,
 * every attempt (successful or failed) is persisted for GET /tasks/:id/notifications.
 *
 * Non-retriable: 2xx (success), 4xx (permanent client error).
 * Retriable: 5xx, timeouts, connection errors.
 */
@Injectable()
export class HttpTaskArchivedNotifier implements TaskArchivedNotifier {
  private readonly logger = new Logger(HttpTaskArchivedNotifier.name);

  constructor(
    @InjectRepository(NotificationAttempt)
    private readonly attempts: Repository<NotificationAttempt>,
    private readonly config: ConfigService,
  ) {}

  async notify(payload: TaskArchivedPayload): Promise<void> {
    const url = this.config.get<string>('NOTIFY_URL');
    if (!url) {
      this.logger.warn(
        `NOTIFY_URL not configured; skipping notification for task ${payload.taskId}`,
      );
      return;
    }

    const maxAttempts = Number(this.config.get('NOTIFY_MAX_ATTEMPTS') ?? DEFAULT_MAX_ATTEMPTS);
    const baseBackoff = Number(
      this.config.get('NOTIFY_INITIAL_BACKOFF_MS') ?? DEFAULT_BACKOFF_MS,
    );

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const outcome = await this.tryOnce(url, payload);
      await this.persistAttempt(payload.taskId, attempt, outcome.statusCode, outcome.errorMessage);

      if (outcome.terminal) {
        if (outcome.statusCode && outcome.statusCode < 300) {
          this.logger.log(
            `Notify success (attempt ${attempt}/${maxAttempts}) for task ${payload.taskId}`,
          );
        } else {
          this.logger.warn(
            `Notify permanent failure (attempt ${attempt}/${maxAttempts}) status=${outcome.statusCode} for task ${payload.taskId}`,
          );
        }
        return;
      }

      if (attempt < maxAttempts) {
        // Exponential backoff: 500ms, 1000ms, 2000ms...
        const wait = baseBackoff * 2 ** (attempt - 1);
        await this.sleep(wait);
      }
    }

    this.logger.error(
      `Notify exhausted ${maxAttempts} attempts for task ${payload.taskId}. Attempts persisted; no further retries.`,
    );
  }

  private async tryOnce(
    url: string,
    payload: TaskArchivedPayload,
  ): Promise<{ statusCode: number | null; errorMessage: string | null; terminal: boolean }> {
    try {
      const resp = await axios.post(url, payload, {
        timeout: DEFAULT_TIMEOUT_MS,
        validateStatus: () => true, // treat all statuses uniformly; classify below
      });
      const s = resp.status;
      if (s >= 200 && s < 300) {
        return { statusCode: s, errorMessage: null, terminal: true };
      }
      if (s >= 400 && s < 500) {
        // Permanent client error — do not retry.
        return { statusCode: s, errorMessage: null, terminal: true };
      }
      // 5xx — retriable.
      return { statusCode: s, errorMessage: null, terminal: false };
    } catch (err) {
      const msg = this.errorMessage(err);
      // Network/timeout — retriable.
      return { statusCode: null, errorMessage: msg, terminal: false };
    }
  }

  private errorMessage(err: unknown): string {
    if (isAxiosError(err)) {
      const ax = err as AxiosError;
      return ax.code ? `${ax.code}: ${ax.message}` : ax.message;
    }
    return err instanceof Error ? err.message : String(err);
  }

  private async persistAttempt(
    taskId: number,
    attemptNumber: number,
    statusCode: number | null,
    errorMessage: string | null,
  ): Promise<void> {
    try {
      await this.attempts.insert({ taskId, attemptNumber, statusCode, errorMessage });
    } catch (err) {
      this.logger.error(
        `Failed to persist notification_attempt (task=${taskId}, attempt=${attemptNumber})`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
