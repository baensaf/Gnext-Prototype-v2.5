import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('session')
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'char', length: 64, unique: true })
  token_hash: string;

  @Column({ type: 'char', length: 64 })
  csrf_hash: string;

  @Column({ type: 'timestamptz' })
  expires_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  last_seen_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revoked_at: Date;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  user_agent: string;
}
