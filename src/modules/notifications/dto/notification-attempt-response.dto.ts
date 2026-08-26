import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationAttempt } from '../entities/notification-attempt.entity';

export class NotificationAttemptResponseDto {
  @ApiProperty({ example: 1 })
  attemptNumber!: number;

  @ApiPropertyOptional({
    example: 200,
    description: 'HTTP status code returned by NOTIFY_URL. Null if the request failed to send.',
  })
  statusCode!: number | null;

  @ApiPropertyOptional({
    example: 'ECONNREFUSED',
    description: 'Error message when statusCode is null (network failure, timeout, etc.)',
  })
  errorMessage!: string | null;

  @ApiProperty({ example: '2026-08-25T20:00:00.000Z' })
  timestamp!: string;

  static from(a: NotificationAttempt): NotificationAttemptResponseDto {
    return {
      attemptNumber: a.attemptNumber,
      statusCode: a.statusCode,
      errorMessage: a.errorMessage,
      timestamp: a.createdAt.toISOString(),
    };
  }
}
