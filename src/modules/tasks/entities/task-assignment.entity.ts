import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { bigintTransformer } from '../../../common/transformers/bigint.transformer';
import { User } from '../../users/entities/user.entity';
import { Task } from './task.entity';

@Entity({ name: 'task_assignments' })
export class TaskAssignment {
  @PrimaryColumn({ type: 'bigint', name: 'task_id', transformer: bigintTransformer })
  taskId!: number;

  @PrimaryColumn({ type: 'bigint', name: 'user_id', transformer: bigintTransformer })
  userId!: number;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @ManyToOne(() => Task, (t) => t.assignments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task?: Task;

  @ManyToOne(() => User, (u) => u.assignments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;
}
