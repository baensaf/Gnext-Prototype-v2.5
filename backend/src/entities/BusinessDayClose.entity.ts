import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  VersionColumn,
  Unique,
} from 'typeorm';

/**
 * A branch's business day, closed by the system once it ended at the cutoff and every shift on
 * it was counted. Nothing reads it as a lock: dates are stamped when things happen. It keeps the
 * day's totals and what the close did with the orders left open.
 */
@Entity('business_day_close')
@Unique(['tenant_id', 'branch_id', 'business_date'])
export class BusinessDayClose {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  branch_id: string;

  @Column({ type: 'varchar', length: 10 })
  business_date: string;

  @Column({ type: 'jsonb', nullable: true })
  totals: any;

  @CreateDateColumn({ type: 'timestamptz' })
  closed_at: Date;

  @VersionColumn({ default: 1 })
  version: number;
}
