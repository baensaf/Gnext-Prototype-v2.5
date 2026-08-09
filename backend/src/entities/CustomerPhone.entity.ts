import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('customer_phone')
@Index(['tenant_id', 'normalized_phone'])
export class CustomerPhone {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  customer_id: string;

  @Column({ type: 'varchar', length: 32 })
  phone_number: string;

  @Column({ type: 'varchar', length: 32 })
  normalized_phone: string;

  @Column({ type: 'varchar', length: 32, default: 'MOBILE' })
  label: string;

  @Column({ type: 'boolean', default: false })
  is_primary: boolean;

  @Column({ type: 'boolean', default: false })
  is_verified: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
