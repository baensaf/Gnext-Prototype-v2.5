import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * One build of the branch agent (protocol §9). The same program runs at every branch, so a
 * release belongs to the installation rather than to a tenant. Agents only ever see published
 * releases; the highest published version is "latest".
 */
@Entity('agent_release')
export class AgentRelease {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** `major.minor.patch`. */
  @Column({ type: 'varchar', length: 32, unique: true })
  version: string;

  /** SHA-256 of the file, lower-case hex. The agent refuses a download that does not match. */
  @Column({ type: 'varchar', length: 64 })
  sha256: string;

  @Column({ type: 'bigint' })
  size_bytes: string;

  /** Under the data directory, e.g. `agent-releases/1.0.3/gnext-agent.exe`. */
  @Column({ type: 'varchar', length: 255 })
  file_path: string;

  /** The setup wizard for new branch PCs, e.g. `agent-releases/1.0.9/gnext-agent-setup-1.0.9.exe`. Only CI supplies one. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  installer_path?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  installer_sha256?: string | null;

  @Column({ type: 'bigint', nullable: true })
  installer_size_bytes?: string | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  /** Agents older than this are closed with 4011 and must update first. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  min_agent_version?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  published_at?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  uploaded_by?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
