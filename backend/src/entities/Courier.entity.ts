import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn } from 'typeorm';

@Entity('courier')
export class Courier {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid', nullable: true })
  branch_id: string;

  /** The courier's account (role COURIER), which the tracking app will sign in with. */
  @Column({ type: 'uuid', nullable: true })
  user_id: string | null;

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
