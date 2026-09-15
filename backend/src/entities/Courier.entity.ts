import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn } from 'typeorm';

@Entity('courier')
export class Courier {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid', nullable: true })
  branch_id: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone: string;

  @Column({ type: 'varchar', length: 32, default: 'MOTORCYCLE' }) // MOTORCYCLE, BICYCLE, CAR, ON_FOOT
  vehicle_type: string;

  @Column({ type: 'varchar', length: 32, default: 'AVAILABLE' }) // AVAILABLE, ON_DELIVERY, INACTIVE
  status: string;

  /** FLAT, DELIVERY_FEE or ZONE_RATE — see `courier-pay.ts`. */
  @Column({ type: 'varchar', length: 20, default: 'FLAT' })
  pay_mode: string;

  /** The fixed amount per delivery under FLAT, and the fallback for a zone with no courier rate. */
  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  compensation_per_delivery: string;

  @Column({ type: 'varchar', length: 3, default: 'IRR' })
  currency_code: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date;
}
