import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('printer_group_member')
export class PrinterGroupMember {
  @PrimaryColumn({ type: 'uuid' })
  group_id: string;

  @PrimaryColumn({ type: 'uuid' })
  printer_id: string;

  @Column({ type: 'int', default: 0 })
  priority: number;

  @Column({ type: 'int', default: 1 })
  copies: number;
}
