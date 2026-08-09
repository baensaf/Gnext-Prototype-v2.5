import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('courier_terminal_assignment')
export class CourierTerminalAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  courier_id: string;

  @Column({ type: 'uuid' })
  terminal_id: string;

  @Column({ type: 'timestamptz' })
  assigned_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  unassigned_at: Date;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
