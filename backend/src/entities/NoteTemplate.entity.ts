import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * A phrase the till can drop into a note with one tap: "no onion", "ring on arrival",
 * "cutlery for two".
 *
 * Free-typed notes are slow at a busy register and come out of the kitchen printer in
 * whatever spelling the cashier managed, so the same instruction reads five ways and the
 * line cook stops trusting any of it. A fixed list types itself and prints the same every
 * time. The note it produces is still an ordinary `order_note` row — this table only holds
 * the phrases on offer, so editing one never rewrites what past orders were told.
 */
@Entity('note_template')
export class NoteTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  /**
   * ITEM sits on one line ("no pickles"), ORDER on the whole ticket ("ring on arrival").
   * They are offered in different places, so a phrase declares where it belongs.
   */
  @Column({ type: 'varchar', length: 20, default: 'ITEM' })
  scope: string;

  /** What the cashier taps. Also what prints. */
  @Column({ type: 'varchar', length: 200 })
  text: string;

  /**
   * Optional grouping for the picker — "Allergies", "Delivery" — so a long list stays
   * navigable. No entity behind it: a free label is enough for a handful of chips.
   */
  @Column({ type: 'varchar', length: 60, nullable: true })
  category: string | null;

  @Column({ type: 'int', default: 0 })
  sort_order: number;

  /**
   * Retired rather than deleted, so a phrase can come off the till without disturbing the
   * notes it already produced.
   */
  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @Column({ type: 'uuid', nullable: true })
  updated_by: string | null;
}
