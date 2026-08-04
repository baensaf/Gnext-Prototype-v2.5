import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('approval_decision')
export class ApprovalDecision {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  request_id: string;

  @Column({ type: 'int', default: 1 })
  step_number: number;

  @Column({ type: 'uuid' })
  approver_user_id: string;

  @Column({ type: 'varchar', length: 32 }) // APPROVED, REJECTED
  decision: string;

  @Column({ type: 'int', default: 1 })
  pin_attempt_count: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
