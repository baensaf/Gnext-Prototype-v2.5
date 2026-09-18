import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { promises as fs, createReadStream, ReadStream } from 'fs';
import * as path from 'path';
import { IsNull, Not, Repository } from 'typeorm';
import { AgentRelease } from '../../entities/AgentRelease.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { AgentCommandsService } from './agent-commands.service';
import { compareVersions } from './agent-protocol';
import { AgentSessionsService } from './agent-sessions.service';

export const AGENT_BINARY_NAME = 'gnext-agent.exe';
/** A Windows build of the agent is a few megabytes; anything near this is a mistake. */
export const MAX_RELEASE_BYTES = 64 * 1024 * 1024;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;

export interface ReleaseUpload {
  version: string;
  notes?: string;
  minAgentVersion?: string;
  file: { buffer: Buffer; size: number; originalname?: string };
}

export interface LatestRelease {
  version: string;
  url: string;
  sha256: string;
  size: number;
  released_at: string;
  min_agent_version: string | null;
}

interface CheckedBuild {
  version: string;
  min: string | null;
  file: ReleaseUpload['file'];
  sha256: string;
}

export function releaseUrl(version: string) {
  return `/api/v1/agent/releases/${version}/${AGENT_BINARY_NAME}`;
}

/**
 * The agent's own updates (protocol §9): head office uploads a build, publishes it, and every
 * agent picks it up on its hourly check, or at once when it is online.
 */
@Injectable()
export class AgentReleasesService {
  private readonly logger = new Logger('AgentReleases');

  constructor(
    @InjectRepository(AgentRelease) private readonly repo: Repository<AgentRelease>,
    private readonly sessions: AgentSessionsService,
    private readonly commands: AgentCommandsService,
    private readonly auditWriter: AuditWriter,
  ) {}

  /** Where release files live: the backend's persistent data volume. */
  static dataDir() {
    return process.env.DATA_DIR || path.join(process.cwd(), 'data');
  }

  async list() {
    const rows = await this.repo.find({ order: { created_at: 'DESC' } });
    return rows.sort((a, b) => compareVersions(b.version, a.version)).map((r) => this.view(r));
  }

  async upload(input: ReleaseUpload, actor: { tenantId: string; userId?: string }) {
    const build = this.check(input);
    if (await this.repo.findOne({ where: { version: build.version } })) {
      throw new ConflictException(`Version ${build.version} already exists.`);
    }
    const saved = await this.store(build, input.notes?.trim() || null, actor.userId ?? null);
    if (!saved) throw new ConflictException(`Version ${build.version} already exists.`);
    await this.auditWriter.write({
      tenantId: actor.tenantId,
      actorType: 'ADMIN',
      actorId: actor.userId,
      action: 'AGENT_RELEASE_UPLOADED',
      entityType: 'AgentRelease',
      entityId: saved.id,
      details: { version: saved.version, sha256: saved.sha256, size: build.file.size },
    });
    return this.view(saved);
  }

  /**
   * A build CI made from main, stored unpublished: head office still decides when it reaches
   * the branches. CI offers the build after every deploy, so a version that is already here is
   * not an error. `sha256_matches` false means the agent changed without a bump of
   * agent/VERSION, and the stored build is kept: agents running that version must not be
   * told it is something else. Releases belong to no tenant, so this logs instead of auditing.
   */
  async uploadFromCi(input: { version: string; commit?: string; file: ReleaseUpload['file'] }) {
    const build = this.check({ version: input.version, file: input.file });
    const commit = /^[0-9a-f]{7,40}$/i.test(input.commit || '') ? input.commit!.toLowerCase() : null;
    const notes = commit ? `Built by CI from commit ${commit.slice(0, 12)}.` : 'Built by CI.';
    const saved = (await this.repo.findOne({ where: { version: build.version } })) ? null : await this.store(build, notes, null);
    if (!saved) {
      const existing = await this.repo.findOneOrFail({ where: { version: build.version } });
      return { created: false, sha256_matches: existing.sha256 === build.sha256, release: this.view(existing) };
    }
    this.logger.log(`CI uploaded agent ${saved.version} (${saved.sha256})${commit ? ` from ${commit}` : ''}`);
    return { created: true, sha256_matches: true, release: this.view(saved) };
  }

  private check(input: { version: string; minAgentVersion?: string; file: ReleaseUpload['file'] }): CheckedBuild {
    const version = String(input.version || '').trim();
    if (!VERSION.test(version)) throw new BadRequestException('Version must look like 1.0.3.');
    const min = input.minAgentVersion?.trim() || null;
    if (min && !VERSION.test(min)) throw new BadRequestException('Minimum agent version must look like 1.0.0.');
    if (min && compareVersions(min, version) > 0) throw new BadRequestException('The minimum agent version cannot be newer than the release.');
    const file = input.file;
    if (!file?.buffer?.length) throw new BadRequestException('Attach the agent .exe.');
    if (file.size > MAX_RELEASE_BYTES) throw new BadRequestException('The file is too large for an agent build.');
    // Every Windows executable starts with "MZ".
    if (file.buffer[0] !== 0x4d || file.buffer[1] !== 0x5a) throw new BadRequestException('That is not a Windows executable.');
    return { version, min, file, sha256: createHash('sha256').update(file.buffer).digest('hex') };
  }

  /**
   * Saves the row, then moves the file into place. When another upload of the same version
   * got there first, the unique version refuses the row, this returns null, and the file
   * behind the release that won is left alone.
   */
  private async store(build: CheckedBuild, notes: string | null, uploadedBy: string | null): Promise<AgentRelease | null> {
    const relative = path.posix.join('agent-releases', build.version, AGENT_BINARY_NAME);
    const absolute = path.join(AgentReleasesService.dataDir(), relative);
    const pending = `${absolute}.${randomUUID()}.part`;
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(pending, build.file.buffer);
    try {
      const saved = await this.repo.save(
        this.repo.create({
          version: build.version,
          sha256: build.sha256,
          size_bytes: String(build.file.size),
          file_path: relative,
          notes,
          min_agent_version: build.min,
          uploaded_by: uploadedBy,
        }),
      );
      await fs.rename(pending, absolute);
      return saved;
    } catch (err: any) {
      await fs.rm(pending, { force: true });
      if (err?.code === '23505') return null;
      throw err;
    }
  }

  /** Makes a release available, and tells every agent online to look now (§7.8). */
  async publish(id: string, actor: { tenantId: string; userId?: string }) {
    const release = await this.find(id);
    release.published_at = release.published_at ?? new Date();
    const saved = await this.repo.save(release);
    await this.auditWriter.write({
      tenantId: actor.tenantId,
      actorType: 'ADMIN',
      actorId: actor.userId,
      action: 'AGENT_RELEASE_PUBLISHED',
      entityType: 'AgentRelease',
      entityId: saved.id,
      details: { version: saved.version },
    });
    for (const handle of this.sessions.all()) {
      if (handle.agentVersion && compareVersions(handle.agentVersion, saved.version) >= 0) continue;
      await this.commands
        .enqueue(handle.tenantId, handle.branchId, 'agent.check_update', {}, { replacePending: true })
        .catch((err) => this.logger.warn(`could not nudge agent ${handle.agentId}: ${err?.message || err}`));
    }
    return this.view(saved);
  }

  async unpublish(id: string, actor: { tenantId: string; userId?: string }) {
    const release = await this.find(id);
    release.published_at = null;
    const saved = await this.repo.save(release);
    await this.auditWriter.write({
      tenantId: actor.tenantId,
      actorType: 'ADMIN',
      actorId: actor.userId,
      action: 'AGENT_RELEASE_UNPUBLISHED',
      entityType: 'AgentRelease',
      entityId: saved.id,
      details: { version: saved.version },
    });
    return this.view(saved);
  }

  /** The highest published version, or null. */
  async latest(): Promise<LatestRelease | null> {
    const published = await this.repo.find({ where: { published_at: Not(IsNull()) } });
    if (!published.length) return null;
    const top = published.sort((a, b) => compareVersions(b.version, a.version))[0];
    return {
      version: top.version,
      url: releaseUrl(top.version),
      sha256: top.sha256,
      size: Number(top.size_bytes),
      released_at: new Date(top.published_at!).toISOString(),
      min_agent_version: top.min_agent_version ?? null,
    };
  }

  /** The file of a published release, for download. */
  async openPublished(version: string): Promise<{ stream: ReadStream; size: number; sha256: string }> {
    const release = VERSION.test(version) ? await this.repo.findOne({ where: { version, published_at: Not(IsNull()) } }) : null;
    if (!release) throw new NotFoundException({ code: 'NOT_FOUND', title: 'Not Found', detail: `No published release ${version}.` });
    const absolute = path.join(AgentReleasesService.dataDir(), release.file_path);
    try {
      await fs.access(absolute);
    } catch {
      this.logger.error(`release ${version} is published but its file is missing: ${absolute}`);
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Not Found', detail: `The file for ${version} is missing.` });
    }
    return { stream: createReadStream(absolute), size: Number(release.size_bytes), sha256: release.sha256 };
  }

  private async find(id: string) {
    const release = await this.repo.findOne({ where: { id } });
    if (!release) throw new NotFoundException('Release not found');
    return release;
  }

  private view(r: AgentRelease) {
    const { file_path, ...rest } = r;
    return { ...rest, size_bytes: Number(r.size_bytes), url: releaseUrl(r.version), published: !!r.published_at };
  }
}
