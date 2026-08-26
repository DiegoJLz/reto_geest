import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { DomainException } from '../exceptions/domain.exception';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, body } = this.toErrorResponse(exception);

    if (status >= 500) {
      this.logger.error(
        `[${request.method} ${request.url}] ${body.error.code}: ${body.error.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(
        `[${request.method} ${request.url}] ${status} ${body.error.code}: ${body.error.message}`,
      );
    }

    response.status(status).json(body);
  }

  private toErrorResponse(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof DomainException) {
      return {
        status: exception.status,
        body: { error: { code: exception.code, message: exception.message } },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const resp = exception.getResponse();

      if (typeof resp === 'string') {
        return {
          status,
          body: { error: { code: this.codeFromStatus(status), message: resp } },
        };
      }

      const respObj = resp as Record<string, unknown>;
      const message = Array.isArray(respObj.message)
        ? (respObj.message as string[]).join('; ')
        : ((respObj.message as string) ?? exception.message);

      // Always prefer machine-readable code from the HTTP status over the
      // human-readable `error` field ("Bad Request", "Not Found") that Nest
      // populates by default. This keeps the API contract uniform:
      // { error: { code: "VALIDATION_ERROR", ... } } instead of code: "Bad Request".
      const code = this.codeFromStatus(status);

      return {
        status,
        body: {
          error: {
            code,
            message,
            ...(Array.isArray(respObj.message) ? { details: respObj.message } : {}),
          },
        },
      };
    }

    const err = exception as Error;
    const isProd = process.env.NODE_ENV === 'production';
    return {
      status: 500,
      body: {
        error: {
          code: 'INTERNAL_ERROR',
          // Never leak raw error messages (SQL fragments, stack info) to clients in prod.
          message: isProd ? 'Internal server error' : (err?.message ?? 'Unexpected error'),
        },
      },
    };
  }

  private codeFromStatus(status: number): string {
    const map: Record<number, string> = {
      400: 'VALIDATION_ERROR',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      500: 'INTERNAL_ERROR',
    };
    return map[status] ?? 'ERROR';
  }
}
