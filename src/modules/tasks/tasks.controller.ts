import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { NotificationAttemptResponseDto } from '../notifications/dto/notification-attempt-response.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { AssignUsersDto, AssignUsersResponseDto } from './dto/assign-users.dto';
import { CompleteTaskDto, CompleteTaskResponseDto } from './dto/complete-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks.query.dto';
import { TaskResponseDto } from './dto/task-response.dto';
import { TasksService } from './tasks.service';

@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new task (status defaults to "open")' })
  async create(@Body() dto: CreateTaskDto): Promise<TaskResponseDto> {
    return this.tasksService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List tasks (optionally filtered by status)' })
  async findAll(@Query() q: ListTasksQueryDto): Promise<TaskResponseDto[]> {
    return this.tasksService.findAll(q.status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get task detail with assignees and completion state' })
  @ApiParam({ name: 'id', type: Number })
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<TaskResponseDto> {
    return this.tasksService.findByIdWithAssignees(id);
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign a batch of users to the task (duplicates ignored)' })
  @ApiParam({ name: 'id', type: Number })
  async assign(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignUsersDto,
  ): Promise<AssignUsersResponseDto> {
    return this.tasksService.assignUsers(id, dto.userIds);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Mark this user's part of the task as complete. When last pending assignee completes, task auto-archives (exactly once).",
  })
  @ApiParam({ name: 'id', type: Number })
  async complete(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CompleteTaskDto,
  ): Promise<CompleteTaskResponseDto> {
    return this.tasksService.completeByUser(id, dto.userId);
  }

  @Get(':id/notifications')
  @ApiOperation({
    summary: 'List all delivery attempts for the archive notification of this task',
  })
  @ApiParam({ name: 'id', type: Number })
  async notifications(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<NotificationAttemptResponseDto[]> {
    return this.notificationsService.getAttemptsForTask(id);
  }
}
