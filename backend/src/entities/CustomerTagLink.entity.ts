import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('customer_tag_link')
@Index(['tenant_id', 'customer_id', 'tag_id'], { unique: true })
export class CustomerTagLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  customer_id: string;

  @Column({ type: 'uuid' })
  tag_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
