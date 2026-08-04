import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('pin_attempt_log')
export class PinAttemptLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  action: string;

  @Column({ type: 'boolean', default: false })
  is_success: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  attempted_at: Date;
}
