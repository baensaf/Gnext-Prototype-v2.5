import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type AttendanceStatus = 'CHECKED_IN' | 'CHECKED_OUT' | 'PAUSED';
export type CourierAvailability = 'AVAILABLE' | 'BUSY' | 'OFF_LINE';

@Entity('courier_attendance')
export class CourierAttendance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  courier_id: string;

  @Column({ type: 'uuid' })
  branch_id: string;

  @Column({ type: 'varchar', length: 10 }) // YYYY-MM-DD
  date: string;

  @Column({ type: 'varchar', length: 30, default: 'CHECKED_IN' })
  status: AttendanceStatus;

  @Column({ type: 'varchar', length: 30, default: 'AVAILABLE' })
  availability_status: CourierAvailability;

  @Column({ type: 'timestamptz' })
  checked_in_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  checked_out_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
