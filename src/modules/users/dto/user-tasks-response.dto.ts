import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaskStatus } from '../../tasks/entities/task.entity';

export class UserTaskResponseDto {
  @ApiProperty({ example: 1 })
  taskId!: number;

  @ApiProperty({ example: 'Preparar informe Q3' })
  title!: string;

  @ApiProperty({ enum: ['open', 'archived'], example: 'open' })
  status!: TaskStatus;

  @ApiProperty({ example: false, description: 'True if this user has completed their part' })
  completedByUser!: boolean;

  @ApiPropertyOptional({ example: '2026-08-25T20:00:00.000Z' })
  completedAt!: string | null;
}
