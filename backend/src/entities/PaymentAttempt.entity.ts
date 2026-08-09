import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Payment } from './Payment.entity';

@Entity('payment_attempt')
@Unique(['payment_id', 'attempt_no'])
export class PaymentAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  payment_id: string;

  @Column({ type: 'integer', default: 1 })
  attempt_no: number;

  @Column({ type: 'varchar', length: 40, default: 'SYNCHRONOUS' })
  adapter: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  scenario_id: string;

  @Column({ type: 'varchar', length: 30, default: 'PENDING' })
  status: string;

  @Column({ type: 'jsonb', nullable: true })
  request_snapshot: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  response_snapshot: Record<string, any>;

  @Column({ type: 'varchar', length: 160, nullable: true })
  external_reference: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  error_code: string;

  @CreateDateColumn({ type: 'timestamptz' })
  started_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finished_at: Date;

  @ManyToOne(() => Payment, (p) => p.attempts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'payment_id' })
  payment: Payment;
}
