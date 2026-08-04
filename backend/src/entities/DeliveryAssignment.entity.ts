import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('delivery_assignment')
export class DeliveryAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  order_id: string;

  @Column({ type: 'uuid' })
  courier_id: string;

  @Column({ type: 'varchar', length: 32, default: 'ASSIGNED' }) // ASSIGNED, PICKED_UP, OUT_FOR_DELIVERY, DELIVERED, FAILED, RETURNED
  status: string;

  @Column({ type: 'timestamptz' })
  assigned_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  picked_up_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  delivered_at: Date;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: '0.00' })
  delivery_fee: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: '0.00' })
  tip_amount: string;

  @Column({ type: 'text', nullable: true })
  failure_reason: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
