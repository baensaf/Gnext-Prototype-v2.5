import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * A weekly window in which an item is on sale: breakfast 07:00–11:00 every day, or a
 * Friday-only dish. It names a product or a whole category, for every branch or one.
 *
 * An item with no window is on sale whenever the shop is open. An item with windows is on
 * sale only inside one of them, read on the branch's own clock. A window whose end is not
 * after its start runs past midnight (22:00–02:00); equal times mean the whole day.
 */
@Entity('availability_schedule')
@Index(['tenant_id', 'product_id'])
@Index(['tenant_id', 'category_id'])
export class AvailabilitySchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid', nullable: true })
  product_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  category_id: string | null;

  /** Empty means every branch. */
  @Column({ type: 'uuid', nullable: true })
  branch_id: string | null;

  /** Days the window opens on, 0 = Sunday … 6 = Saturday, comma separated. */
  @Column({ type: 'varchar', length: 20 })
  days_of_week: string;

  /** HH:MM on the branch's clock. */
  @Column({ type: 'varchar', length: 5 })
  start_time: string;

  @Column({ type: 'varchar', length: 5 })
  end_time: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  label: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
