import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('customer_custom_value')
export class CustomerCustomValue {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  customer_id: string;

  @Column({ type: 'uuid' })
  field_id: string;

  @Column({ type: 'text', nullable: true })
  value: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
