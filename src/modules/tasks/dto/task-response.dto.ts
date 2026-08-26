import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Task, TaskStatus } from '../entities/task.entity';

export class TaskAssigneeDto {
  @ApiProperty({ example: 1 }) userId!: number;
  @ApiProperty({ example: 'Diego' }) name!: string;
  @ApiProperty({ example: 'Julio' }) lastName!: string;
  @ApiProperty({ example: true }) completed!: boolean;
  @ApiPropertyOptional({ example: '2026-08-25T20:00:00.000Z' }) completedAt?: string | null;
}

export class TaskResponseDto {
  @ApiProperty({ example: 1 }) id!: number;
  @ApiProperty({ example: 'Preparar informe Q3' }) title!: string;
  @ApiPropertyOptional({ example: 'Incluir métricas de churn' }) description!: string | null;
  @ApiProperty({ enum: ['open', 'archived'], example: 'open' }) status!: TaskStatus;
  @ApiPropertyOptional({ example: null }) archivedAt!: string | null;
  @ApiProperty({ example: '2026-08-25T19:00:00.000Z' }) createdAt!: string;
  @ApiProperty({ type: [TaskAssigneeDto] }) assignees!: TaskAssigneeDto[];

  static from(task: Task): TaskResponseDto {
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      archivedAt: task.archivedAt ? task.archivedAt.toISOString() : null,
      createdAt: task.createdAt.toISOString(),
      assignees: (task.assignments ?? []).map((a) => ({
        userId: a.userId,
        name: a.user?.name ?? '',
        lastName: a.user?.lastName ?? '',
        completed: a.completedAt != null,
        completedAt: a.completedAt ? a.completedAt.toISOString() : null,
      })),
    };
  }
}
