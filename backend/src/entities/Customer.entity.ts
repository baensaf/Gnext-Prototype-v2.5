import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, VersionColumn } from 'typeorm';

@Entity('customer')
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 80 })
  first_name: string;

  @Column({ type: 'varchar', length: 80 })
  last_name: string;

  @Column({ type: 'varchar', length: 32 })
  mobile: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  email: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  national_id: string;

  /**
   * Date of birth. Stored as a plain date, with no time and no zone: a birthday belongs to
   * the calendar, not to an instant, and shifting it into the tenant's zone would move it
   * by a day for anyone born near midnight.
   */
  @Column({ type: 'date', nullable: true })
  birth_date: string | null;

  /**
   * A customer the chain refuses to serve — repeated false addresses, abuse of a courier.
   * Distinct from `is_active`, which retires a record, and from a blocked credit account,
   * which only stops credit: a blocked customer cannot be put on a new order at all, by
   * any channel or payment method.
   */
  @Column({ type: 'boolean', default: false })
  is_blocked: boolean;

  @Column({ type: 'text', nullable: true })
  blocked_reason: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  blocked_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  blocked_by: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'uuid', nullable: true })
  created_by: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @Column({ type: 'uuid', nullable: true })
  updated_by: string;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date;

  @VersionColumn({ default: 1 })
  version: number;
}
