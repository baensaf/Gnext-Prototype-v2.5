import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('payment_attempt')
export class PaymentAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  payment_id: string;

  @Column({ type: 'int', default: 1 })
  attempt_number: number;

  @Column({ type: 'uuid', nullable: true })
  device_id: string;

  @Column({ type: 'numeric', precision: 19, scale: 4 })
  amount: string;

  @Column({ type: 'varchar', length: 32, default: 'SUCCESS' }) // SUCCESS, FAILED, RETRYING, CANCELLED
  status: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  error_code: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  error_message: string;

  @Column({ type: 'jsonb', nullable: true })
  raw_response: Record<string, any>;

  @CreateDateColumn({ type: 'timestamptz' })
  attempted_at: Date;
}
