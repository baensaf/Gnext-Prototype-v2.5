import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('customer_merge')
export class CustomerMerge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  target_customer_id: string;

  @Column({ type: 'uuid' })
  source_customer_id: string;

  @Column({ type: 'jsonb', nullable: true })
  field_resolutions_json: Record<string, any>;

  @Column({ type: 'uuid', nullable: true })
  merged_by: string;

  @CreateDateColumn({ type: 'timestamptz' })
  merged_at: Date;
}
