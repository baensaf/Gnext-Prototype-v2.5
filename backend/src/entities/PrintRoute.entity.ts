import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * A kitchen printer that prints a category, or one product, at one branch. A category or a
 * product can go to several printers. A product with routes of its own prints only there; any
 * other product prints where its category goes, and one with neither on the branch's default
 * kitchen printer.
 */
@Entity('print_route')
export class PrintRoute {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  branch_id: string;

  @Column({ type: 'uuid' })
  printer_id: string;

  @Column({ type: 'uuid', nullable: true })
  category_id?: string | null;

  @Column({ type: 'uuid', nullable: true })
  product_id?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
