import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { TaskStatus } from '../entities/task.entity';

export class ListTasksQueryDto {
  @ApiPropertyOptional({ enum: ['open', 'archived'], example: 'open' })
  @IsOptional()
  @IsIn(['open', 'archived'], { message: 'status must be either "open" or "archived"' })
  status?: TaskStatus;
}
