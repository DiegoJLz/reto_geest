import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

export type IdempotencyStatus = 'processing' | 'completed';

/**
 * Stores an in-flight or completed idempotency claim.
 *
 * Composite PK (key, endpoint) means the same Idempotency-Key can be reused
 * across different endpoints without collision. Body hash guards against
 * accidental reuse with different payloads.
 */
@Entity({ name: 'idempotency_keys' })
export class IdempotencyKey {
  @PrimaryColumn({ type: 'varchar', length: 200, name: 'key' })
  key!: string;

  @PrimaryColumn({ type: 'varchar', length: 100, name: 'endpoint' })
  endpoint!: string;

  @Column({ type: 'char', length: 64, name: 'request_hash' })
  requestHash!: string;

  @Column({ type: 'varchar', length: 20, name: 'status', default: 'processing' })
  status!: IdempotencyStatus;

  @Column({ type: 'int', name: 'status_code', nullable: true })
  statusCode!: number | null;

  @Column({ type: 'jsonb', name: 'response_body', nullable: true })
  responseBody!: unknown;

  @Index('ix_idempotency_keys_created_at')
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt!: Date | null;
}
