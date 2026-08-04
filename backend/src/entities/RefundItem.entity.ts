import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('refund_item')
export class RefundItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  refund_request_id: string;

  @Column({ type: 'uuid' })
  order_item_id: string;

  @Column({ type: 'int', default: 1 })
  quantity_refunded: number;

  @Column({ type: 'numeric', precision: 19, scale: 4 })
  amount: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
