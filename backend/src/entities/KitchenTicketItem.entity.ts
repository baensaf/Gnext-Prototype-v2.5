import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('kitchen_ticket_item')
@Index(['tenant_id', 'ticket_id', 'order_item_id'], { unique: true })
export class KitchenTicketItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  ticket_id: string;

  @Column({ type: 'uuid' })
  order_item_id: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  product_name: string;

  @Column({ type: 'numeric', precision: 15, scale: 4 })
  quantity: string;

  @Column({ type: 'varchar', length: 32, default: 'NEW' }) // NEW, IN_PROGRESS, READY, CANCELLED
  state: string;

  @Column({ type: 'varchar', length: 32, default: 'NEW' }) // Backwards-compatible status alias
  status: string;

  @Column({ type: 'text', nullable: true })
  special_instructions: string;

  @Column({ type: 'text', nullable: true })
  options_summary: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
