import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * A dated price cut on one product (V1, 2026-10-03), as HAMI branches use them: "cheese
 * mushroom 20% off from the 1st to the 15th". It applies by itself to every POS line of the
 * product at every branch while the branch's business day is within the dates, and the one
 * order discount (manual or customer rate) then applies to what is left.
 *
 * Not campaigns: no customer targeting, no conditions, no minimum basket. Category-wide
 * discounts, fixed amounts and time-of-day rules are later.
 *
 * Scope (2026-10-12): all price groups, or a chosen list of them (`price_group_ids`); a branch
 * with no group is covered only by "all groups". And a channel: in store (the till and the
 * kiosk), Snappfood (a real price cut on the Snappfood menu), or both.
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

  /** Every price group, branches with no group included. When false, only `price_group_ids`. */
  @Column({ type: 'boolean', default: true })
  all_groups: boolean;

  @Column({ type: 'uuid', array: true, default: () => "'{}'" })
  price_group_ids: string[];

  /** IN_STORE (till and kiosk), SNAPPFOOD, or BOTH. */
  @Column({ type: 'varchar', length: 12, default: 'IN_STORE' })
  applies_to: 'IN_STORE' | 'SNAPPFOOD' | 'BOTH';

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
