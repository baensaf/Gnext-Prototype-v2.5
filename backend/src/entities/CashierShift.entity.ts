import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  VersionColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { CashMovement } from './CashMovement.entity';

export type ShiftState = 'OPEN' | 'CLOSED';

/** What a shift's report says about its orders. */
export interface ShiftOrderFigures {
  orderCount: number;
  cancelledCount: number;
  salesTotal: string;
  discountTotal: string;
  deliveryFeeTotal: string;
  unpaidTotal: string;
  byType: Array<{ type: string; count: number; total: string }>;
}

@Entity('cashier_shift')
@Index(['tenant_id', 'branch_id', 'business_date', 'state'])
export class CashierShift {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  branch_id: string;

  @Column({ type: 'uuid' })
  terminal_id: string;

  @Column({ type: 'uuid', nullable: true })
  opened_by: string;

  @Column({ type: 'uuid', nullable: true })
  closed_by: string;

  @Column({ type: 'varchar', length: 32 })
  shift_number: string;

  @Column({ type: 'varchar', length: 30, default: 'OPEN' })
  state: ShiftState;

  @Column({ type: 'varchar', length: 10 })
  business_date: string;

  @CreateDateColumn({ type: 'timestamptz' })
  opened_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  closed_at: Date;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  opening_cash: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, nullable: true })
  expected_cash: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, nullable: true })
  actual_cash: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, nullable: true })
  short_over: string;

  /** Of the count, what stays in the drawer for the next shift; the rest was handed over. */
  @Column({ type: 'numeric', precision: 19, scale: 4, nullable: true })
  left_in_drawer: string | null;

  /** The report's order figures as they stood at the close (P-29). Null on a shift closed before these were kept. */
  @Column({ type: 'jsonb', nullable: true })
  closing_orders: ShiftOrderFigures | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @VersionColumn({ default: 1 })
  version: number;

  @OneToMany(() => CashMovement, (m) => m.shift, { cascade: true })
  movements: CashMovement[];
}
