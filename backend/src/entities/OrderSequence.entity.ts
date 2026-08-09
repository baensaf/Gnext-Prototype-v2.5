import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

@Entity('order_sequence')
@Unique(['tenant_id', 'prefix'])
export class OrderSequence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 32 })
  prefix: string;

  @Column({ type: 'integer', default: 0 })
  last_value: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
