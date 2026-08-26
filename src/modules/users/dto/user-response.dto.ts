import { ApiProperty } from '@nestjs/swagger';
import { User } from '../entities/user.entity';

export class UserResponseDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'Diego' })
  name!: string;

  @ApiProperty({ example: 'Julio' })
  lastName!: string;

  @ApiProperty({ example: 'diego@geest.com' })
  email!: string;

  @ApiProperty({ example: '2026-08-25T20:00:00.000Z' })
  createdAt!: string;

  static from(user: User): UserResponseDto {
    return {
      id: user.id,
      name: user.name,
      lastName: user.lastName,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
    };
  }
}

export class UserWithPendingTasksDto extends UserResponseDto {
  @ApiProperty({
    description:
      'IDs of tasks assigned to the user with pending completion (open + not completed by user)',
    example: [1, 3, 5],
    type: [Number],
  })
  pendingTaskIds!: number[];
}
