import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('price_group_branch')
@Index(['tenant_id', 'branch_id'], { unique: true })
export class PriceGroupBranch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  price_group_id: string;

  @Column({ type: 'uuid' })
  branch_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
