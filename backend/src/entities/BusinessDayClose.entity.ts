import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  VersionColumn,
  Unique,
} from 'typeorm';

export type BusinessDayStatus = 'CLOSED' | 'REOPENED';

@Entity('business_day_close')
@Unique(['tenant_id', 'branch_id', 'business_date', 'currency_code'])
export class BusinessDayClose {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  branch_id: string;

  @Column({ type: 'varchar', length: 10 })
  business_date: string;

  @Column({ type: 'varchar', length: 3, default: 'IRR' })
  currency_code: string;

  @Column({ type: 'varchar', length: 30, default: 'CLOSED' })
  status: BusinessDayStatus;

  @Column({ type: 'jsonb', nullable: true })
  totals: any;

  @CreateDateColumn({ type: 'timestamptz' })
  closed_at: Date;

  @Column({ type: 'uuid', nullable: true })
  closed_by: string;

  @Column({ type: 'timestamptz', nullable: true })
  reopened_at: Date;

  @Column({ type: 'uuid', nullable: true })
  reopened_by: string;

  @Column({ type: 'uuid', nullable: true })
  approval_request_id: string;

  @VersionColumn({ default: 1 })
  version: number;
}
