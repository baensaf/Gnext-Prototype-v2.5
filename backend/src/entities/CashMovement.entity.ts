import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { CashierShift } from './CashierShift.entity';

export type CashMovementType =
  | 'OPENING_FLOAT'
  | 'CASH_PAYMENT'
  | 'CASH_REFUND'
  | 'PAID_IN'
  | 'PAID_OUT'
  | 'CLOSE_ADJUSTMENT';

@Entity('cash_movement')
@Index(['shift_id'])
export class CashMovement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  shift_id: string;

  @Column({ type: 'varchar', length: 30 })
  type: CashMovementType;

  @Column({ type: 'numeric', precision: 19, scale: 4 })
  amount: string; // signed: positive for opening/payment/paid-in, negative for refund/paid-out

  @Column({ type: 'varchar', length: 3, default: 'IRR' })
  currency_code: string;

  @Column({ type: 'uuid', nullable: true })
  payment_id: string;

  @Column({ type: 'uuid', nullable: true })
  refund_id: string;

  @Column({ type: 'uuid', nullable: true })
  reason_code_id: string;

  @Column({ type: 'text', nullable: true })
  reason_text: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  reference: string;

  @CreateDateColumn({ type: 'timestamptz' })
  posted_at: Date;

  @Column({ type: 'uuid', nullable: true })
  posted_by: string;

  @ManyToOne(() => CashierShift, (shift) => shift.movements, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shift_id' })
  shift: CashierShift;
}
