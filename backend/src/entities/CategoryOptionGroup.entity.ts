import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** An add-on group put on a category: every product in it carries the group, new ones too. */
@Entity('category_option_group')
export class CategoryOptionGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  category_id: string;

  @Column({ type: 'uuid' })
  option_group_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
