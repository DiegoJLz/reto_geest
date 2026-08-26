import {
  Column,
  CreateDateColumn,
  Entity,
  Generated,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { bigintTransformer } from '../../../common/transformers/bigint.transformer';

@Entity({ name: 'notification_attempts' })
export class NotificationAttempt {
  @PrimaryColumn({ type: 'bigint', name: 'id', transformer: bigintTransformer })
  @Generated('increment')
  id!: number;

  @Index('ix_notification_attempts_task')
  @Column({ type: 'bigint', name: 'task_id', transformer: bigintTransformer })
  taskId!: number;

  @Column({ type: 'int', name: 'attempt_number' })
  attemptNumber!: number;

  @Column({ type: 'int', name: 'status_code', nullable: true })
  statusCode!: number | null;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
