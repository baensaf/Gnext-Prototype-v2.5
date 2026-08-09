import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn } from 'typeorm';

@Entity('print_route')
export class PrintRoute {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  branch_id: string;

  @Column({ type: 'varchar', length: 64 }) // CUSTOMER_RECEIPT, KITCHEN_TICKET, COURIER_SLIP, GUEST_BILL
  document_type: string;

  @Column({ type: 'uuid', nullable: true })
  product_id?: string;

  @Column({ type: 'uuid', nullable: true })
  category_id?: string;

  @Column({ type: 'uuid', nullable: true })
  station_id?: string;

  @Column({ type: 'uuid' })
  printer_group_id: string;

  @Column({ type: 'int', default: 0 })
  priority: number;

  @Column({ type: 'int', default: 1 })
  copies: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at?: Date;
}
