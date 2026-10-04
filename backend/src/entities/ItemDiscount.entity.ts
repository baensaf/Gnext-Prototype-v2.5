import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * A dated price cut on one product (V1, 2026-10-03), as HAMI branches use them: "cheese
 * mushroom 20% off from the 1st to the 15th". It applies by itself to every POS line of the
 * product at every branch while the branch's business day is within the dates, and the one
 * order discount (manual, coupon or customer rate) then applies to what is left.
 *
 * Not campaigns: no customer targeting, no conditions, no minimum basket. Category-wide
 * discounts, fixed amounts, time-of-day and per-branch rules are later.
 */
@Entity('item_discount')
@Index(['tenant_id', 'product_id'])
export class ItemDiscount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  product_id: string;

  /** Percent off, e.g. 20.00. */
  @Column({ type: 'numeric', precision: 5, scale: 2 })
  percent: string;

  /** First business day it applies, YYYY-MM-DD. */
  @Column({ type: 'date' })
  starts_on: string;

  /** Last business day it applies (inclusive); null runs until ended. */
  @Column({ type: 'date', nullable: true })
  ends_on: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
