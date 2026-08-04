import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('kitchen_ticket_item')
export class KitchenTicketItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  ticket_id: string;

  @Column({ type: 'uuid', nullable: true })
  order_item_id: string;

  @Column({ type: 'varchar', length: 160 })
  product_name: string;

  @Column({ type: 'numeric', precision: 10, scale: 4, default: '1.0000' })
  quantity: string;

  @Column({ type: 'varchar', length: 32, default: 'PENDING' }) // PENDING, COOKING, DONE
  status: string;

  @Column({ type: 'text', nullable: true })
  special_instructions: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  options_summary: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
