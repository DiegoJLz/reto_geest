import { Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Body } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CreateUserDto } from './dto/create-user.dto';
import { UserResponseDto, UserWithPendingTasksDto } from './dto/user-response.dto';
import { UserTaskResponseDto } from './dto/user-tasks-response.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  async create(@Body() dto: CreateUserDto): Promise<UserResponseDto> {
    return this.usersService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all users with their pending task IDs' })
  async findAll(): Promise<UserWithPendingTasksDto[]> {
    return this.usersService.findAll();
  }

  @Get(':id/tasks')
  @ApiOperation({ summary: "List all tasks assigned to a user, with per-user completion state" })
  @ApiParam({ name: 'id', type: Number })
  async listUserTasks(@Param('id', ParseIntPipe) id: number): Promise<UserTaskResponseDto[]> {
    return this.usersService.getUserTasks(id);
  }
}
