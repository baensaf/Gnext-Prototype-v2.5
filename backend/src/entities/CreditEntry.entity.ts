import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { CustomerCreditAccount } from './CustomerCreditAccount.entity';

export type CreditEntryType =
  | 'PURCHASE'
  | 'REPAYMENT'
  | 'ADJUSTMENT'
  | 'REFUND'
  | 'REVERSAL'
  | 'LOYALTY_CASHBACK'
  | 'LOYALTY_CASHBACK_REVERSAL';

@Entity('credit_entry')
@Index(['account_id', 'posted_at'])
export class CreditEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  account_id: string;

  @Column({ type: 'varchar', length: 30 })
  entry_type: CreditEntryType;

  @Column({ type: 'numeric', precision: 19, scale: 4 })
  amount: string; // signed: negative for PURCHASE, positive for REPAYMENT/REFUND/ADJUSTMENT

  @Column({ type: 'varchar', length: 3, default: 'IRR' })
  currency_code: string;

  @Column({ type: 'uuid', nullable: true })
  order_id: string;

  @Column({ type: 'uuid', nullable: true })
  payment_id: string;

  @Column({ type: 'uuid', nullable: true })
  related_entry_id: string;

  @Column({ type: 'uuid', nullable: true })
  reason_code_id: string;

  @Column({ type: 'text', nullable: true })
  reason_text: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  reference: string;

  @Column({ type: 'varchar', length: 10 })
  business_date: string;

  @CreateDateColumn({ type: 'timestamptz' })
  posted_at: Date;

  @Column({ type: 'uuid', nullable: true })
  posted_by: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  balance_after: string;

  @ManyToOne(() => CustomerCreditAccount, (acc) => acc.entries, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: CustomerCreditAccount;
}
