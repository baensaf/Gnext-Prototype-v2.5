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

export type ShiftState = 'OPEN' | 'CLOSING_REVIEW' | 'CLOSED';

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
  user_id: string; // legacy alias

  @Column({ type: 'uuid', nullable: true })
  opened_by: string;

  @Column({ type: 'uuid', nullable: true })
  closed_by: string;

  @Column({ type: 'varchar', length: 32 })
  shift_number: string;

  @Column({ type: 'varchar', length: 30, default: 'OPEN' })
  state: ShiftState;

  @Column({ type: 'varchar', length: 30, default: 'OPEN' })
  status: string; // legacy alias

  @Column({ type: 'varchar', length: 3, default: 'IRR' })
  currency_code: string;

  @Column({ type: 'varchar', length: 10 })
  business_date: string;

  @CreateDateColumn({ type: 'timestamptz' })
  opened_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  closed_at: Date;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  opening_cash: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  opening_float: string; // legacy alias

  @Column({ type: 'numeric', precision: 19, scale: 4, nullable: true })
  expected_cash: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, nullable: true })
  actual_cash: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, nullable: true })
  short_over: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, nullable: true })
  over_short_amount: string; // legacy alias

  @Column({ type: 'text', nullable: true })
  closing_note: string;

  @Column({ type: 'text', nullable: true })
  notes: string; // legacy alias

  @Column({ type: 'uuid', nullable: true })
  approval_request_id: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  preview_version: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @VersionColumn({ default: 1 })
  version: number;

  @OneToMany(() => CashMovement, (m) => m.shift, { cascade: true })
  movements: CashMovement[];
}
