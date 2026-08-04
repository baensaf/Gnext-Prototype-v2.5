import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('inventory_transaction')
export class InventoryTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  inventory_item_id: string;

  @Column({ type: 'varchar', length: 30 })
  transaction_type: string; // PURCHASE_RECEIPT, SALE_DEDUCTION, ADJUSTMENT, WASTE, TRANSFER

  @Column({ type: 'numeric', precision: 19, scale: 4 })
  quantity_delta: string;

  @Column({ type: 'uuid', nullable: true })
  reason_code_id: string;

  @Column({ type: 'text', nullable: true })
  note: string;

  @CreateDateColumn({ type: 'timestamptz' })
  recorded_at: Date;
}
