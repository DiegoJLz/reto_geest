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
import { TaskAssignment } from '../../tasks/entities/task-assignment.entity';

@Entity({ name: 'users' })
export class User {
  @PrimaryColumn({ type: 'bigint', name: 'id', transformer: bigintTransformer })
  @Generated('increment')
  id!: number;

  @Column({ type: 'varchar', length: 120, name: 'name' })
  name!: string;

  @Column({ type: 'varchar', length: 120, name: 'last_name' })
  lastName!: string;

  @Index('ux_users_email', { unique: true })
  @Column({ type: 'varchar', length: 255, name: 'email' })
  email!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @OneToMany(() => TaskAssignment, (a) => a.user)
  assignments?: TaskAssignment[];
}
