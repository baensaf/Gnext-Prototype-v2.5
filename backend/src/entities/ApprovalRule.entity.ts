import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('approval_rule')
export class ApprovalRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 64 })
  // Drawer variance is not a rule here: SHIFT_POLICY.varianceTolerance decides it.
  action: string; // DISCOUNT, PRICE_OVERRIDE, REFUND, CANCEL, CREDIT_OVERRIDE, REOPEN_ORDER, REPRINT, PAYMENT_CORRECTION

  @Column({ type: 'varchar', length: 32, default: 'PERCENTAGE' }) // PERCENTAGE, AMOUNT
  threshold_type: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  threshold_value: string;

  @Column({ type: 'int', default: 1 })
  required_steps: number; // 1 or 2 steps

  @Column({ type: 'varchar', length: 32, default: 'SUPERVISOR' }) // SUPERVISOR, MANAGER, IT, ADMIN
  approver_role: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
