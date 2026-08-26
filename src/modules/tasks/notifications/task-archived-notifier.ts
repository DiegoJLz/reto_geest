import { Injectable, Logger } from '@nestjs/common';

/**
 * Payload emitted when a task transitions to "archived" (all assignees completed).
 * Shape matches the external NOTIFY_URL contract in the challenge spec.
 */
export interface TaskArchivedPayload {
  taskId: number;
  title: string;
  archivedAt: string;
}

/**
 * Strategy port for post-archive notifications. S2 ships a Logger-only
 * implementation; S3 replaces it with an HTTP client with retries + persistence
 * of attempts, without touching TasksService.
 */
export interface TaskArchivedNotifier {
  notify(payload: TaskArchivedPayload): Promise<void>;
}

export const TASK_ARCHIVED_NOTIFIER = Symbol('TASK_ARCHIVED_NOTIFIER');

@Injectable()
export class LoggerTaskArchivedNotifier implements TaskArchivedNotifier {
  private readonly logger = new Logger(LoggerTaskArchivedNotifier.name);

  async notify(payload: TaskArchivedPayload): Promise<void> {
    this.logger.log(
      `[S2 noop] Task ${payload.taskId} "${payload.title}" archived at ${payload.archivedAt}. HTTP notify wired in S3.`,
    );
  }
}
