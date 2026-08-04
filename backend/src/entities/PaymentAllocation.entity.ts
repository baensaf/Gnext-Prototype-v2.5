import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('payment_allocation')
export class PaymentAllocation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  payment_id: string;

  @Column({ type: 'uuid' })
  order_id: string;

  @Column({ type: 'numeric', precision: 19, scale: 4 })
  amount_allocated: string;

  @Column({ type: 'varchar', length: 32, default: 'ALLOCATED' }) // ALLOCATED, REVERSED
  status: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
