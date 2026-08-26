import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class CompleteTaskDto {
  @ApiProperty({ example: 1, description: 'ID of the user marking their part complete' })
  @IsInt({ message: 'userId must be an integer' })
  @Min(1)
  userId!: number;
}

export class CompleteTaskResponseDto {
  @ApiProperty({ example: 'User completion recorded' })
  message!: string;

  @ApiProperty({ example: 1 })
  taskId!: number;

  @ApiProperty({ example: 1 })
  userId!: number;

  @ApiProperty({
    example: false,
    description: 'True if this completion triggered the task to be archived',
  })
  archived!: boolean;
}
