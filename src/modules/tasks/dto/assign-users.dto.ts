import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, ArrayNotEmpty, IsArray, IsInt, Min } from 'class-validator';

export class AssignUsersDto {
  @ApiProperty({
    description: 'IDs of users to assign to the task (duplicates within array are ignored)',
    example: [1, 2, 3],
    type: [Number],
    minItems: 1,
  })
  @IsArray({ message: 'userIds must be an array' })
  @ArrayNotEmpty({ message: 'userIds must not be empty' })
  @ArrayMinSize(1)
  @IsInt({ each: true, message: 'each userIds element must be an integer' })
  @Min(1, { each: true })
  userIds!: number[];
}

export class AssignUsersResponseDto {
  @ApiProperty({ example: 'Users assigned successfully' })
  message!: string;

  @ApiProperty({ example: 1 })
  taskId!: number;

  @ApiProperty({
    description: 'Complete list of userIds assigned to the task after this operation',
    example: [1, 2, 3],
    type: [Number],
  })
  assignedUserIds!: number[];
}
