import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** A question head office adds to every customer record, such as gender or a wedding date. */
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

  /** TEXT, NUMBER, DATE (YYYY-MM-DD) or CHOICE. */
  @Column({ type: 'varchar', length: 32, default: 'TEXT' })
  data_type: string;

  /** The answers a CHOICE field offers, in order. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  options: string[];

  @Column({ type: 'boolean', default: false })
  is_required: boolean;

  @Column({ type: 'int', default: 0 })
  sort_order: number;

  /** An archived field is no longer asked; the answers already given stay. */
  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
