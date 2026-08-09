import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('order_link')
export class OrderLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  from_order_id: string;

  @Column({ type: 'uuid' })
  to_order_id: string;

  @Column({ type: 'varchar', length: 32 })
  link_type: 'SPLIT' | 'MERGE' | 'TRANSFER' | 'REPLACEMENT';

  @Column({ type: 'jsonb', nullable: true })
  details: any;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
