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
import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks.query.dto';
import { TaskResponseDto } from './dto/task-response.dto';
import { TasksService } from './tasks.service';

@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

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
}
