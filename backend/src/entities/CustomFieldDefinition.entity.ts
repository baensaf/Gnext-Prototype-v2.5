import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('custom_field_definition')
export class CustomFieldDefinition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 64 })
  key: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'varchar', length: 32, default: 'STRING' })
  data_type: string;

  @Column({ type: 'boolean', default: false })
  is_required: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
