import {
  Column,
  CreateDateColumn,
  Entity,
  Generated,
  Index,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import { bigintTransformer } from '../../../common/transformers/bigint.transformer';
import { TaskAssignment } from './task-assignment.entity';

export type TaskStatus = 'open' | 'archived';

@Entity({ name: 'tasks' })
export class Task {
  @PrimaryColumn({ type: 'bigint', name: 'id', transformer: bigintTransformer })
  @Generated('increment')
  id!: number;

  @Column({ type: 'varchar', length: 200, name: 'title' })
  title!: string;

  @Column({ type: 'text', name: 'description', nullable: true })
  description!: string | null;

  @Index('ix_tasks_status')
  @Column({ type: 'varchar', length: 16, name: 'status', default: 'open' })
  status!: TaskStatus;

  @Column({ type: 'timestamptz', name: 'archived_at', nullable: true })
  archivedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @OneToMany(() => TaskAssignment, (a) => a.task)
  assignments?: TaskAssignment[];
}
