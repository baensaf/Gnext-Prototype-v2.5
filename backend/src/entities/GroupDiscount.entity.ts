import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * A percent off for the customers in the groups it picks, filled in on the till. Optional
 * monthly limits (an extra beyond Toast, Square and Lightspeed, for Iran Burger's staff
 * scheme): how much of their orders it covers in a calendar month, how many orders, and how
 * much of one order; the rest of a bigger order is full price.
 */
@Entity('group_discount')
@Index(['tenant_id', 'is_active'])
export class GroupDiscount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'numeric', precision: 5, scale: 2 })
  percent: string;

  @Column({ type: 'uuid', array: true, default: () => "'{}'" })
  group_ids: string[];

  /** Only at the branch the person belongs to in the group. */
  @Column({ type: 'boolean', default: false })
  own_branch_only: boolean;

  @Column({ type: 'numeric', precision: 19, scale: 4, nullable: true })
  monthly_cap: string | null;

  @Column({ type: 'int', nullable: true })
  uses_per_month: number | null;

  @Column({ type: 'numeric', precision: 19, scale: 4, nullable: true })
  per_visit_cap: string | null;

  @Column({ type: 'int', default: 0 })
  sort_order: number;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
