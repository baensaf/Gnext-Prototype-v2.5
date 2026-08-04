import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('cash_drawer_transaction')
export class CashDrawerTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  shift_id: string;

  @Column({ type: 'varchar', length: 30 })
  transaction_type: string; // PAY_IN, PAY_OUT, SAFE_DROP, FLOAT_ADJUSTMENT

  @Column({ type: 'numeric', precision: 19, scale: 4 })
  amount: string;

  @Column({ type: 'uuid', nullable: true })
  reason_code_id: string;

  @Column({ type: 'text', nullable: true })
  note: string;

  @CreateDateColumn({ type: 'timestamptz' })
  recorded_at: Date;
}
