import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, VersionColumn } from 'typeorm';

@Entity('cash_drawer_shift')
export class CashDrawerShift {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  branch_id: string;

  @Column({ type: 'uuid' })
  terminal_id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'varchar', length: 32 })
  shift_number: string;

  @CreateDateColumn({ type: 'timestamptz' })
  opened_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  closed_at: Date;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  opening_float: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  expected_cash: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, nullable: true })
  actual_cash: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, nullable: true })
  over_short_amount: string;

  @Column({ type: 'varchar', length: 20, default: 'OPEN' })
  status: string; // OPEN, CLOSED

  @Column({ type: 'text', nullable: true })
  notes: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @Column({ type: 'uuid', nullable: true })
  created_by: string;

  @Column({ type: 'uuid', nullable: true })
  updated_by: string;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date;

  @VersionColumn({ default: 1 })
  version: number;
}
