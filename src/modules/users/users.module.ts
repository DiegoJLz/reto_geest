import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskAssignment } from '../tasks/entities/task-assignment.entity';
import { User } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, TaskAssignment])],
  controllers: [UsersController],
  providers: [UsersService],
  // Exported so TasksModule can validate user existence without owning the User repo (audit M6).
  exports: [UsersService],
})
export class UsersModule {}
