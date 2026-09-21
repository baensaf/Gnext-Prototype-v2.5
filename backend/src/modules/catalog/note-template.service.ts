import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NoteTemplate } from '../../entities/NoteTemplate.entity';
import { AuditWriter } from '../audit/audit-writer.service';

export const NOTE_TEMPLATE_SCOPES = ['ITEM', 'ORDER'] as const;
export type NoteTemplateScope = (typeof NOTE_TEMPLATE_SCOPES)[number];

export interface NoteTemplateInput {
  scope?: string;
  text?: string;
  category?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

@Injectable()
export class NoteTemplateService {
  constructor(
    @InjectRepository(NoteTemplate) private readonly repo: Repository<NoteTemplate>,
    private readonly auditWriter: AuditWriter,
  ) {}

  /**
   * The till asks for one scope and wants only what it may offer; the settings screen asks
   * for everything, retired phrases included, because that is where they come back.
   */
  async list(tenantId: string, opts: { scope?: string; includeInactive?: boolean } = {}) {
    const qb = this.repo
      .createQueryBuilder('n')
      .where('n.tenant_id = :tenantId', { tenantId })
      .orderBy('n.sort_order', 'ASC')
      .addOrderBy('n.text', 'ASC');

    if (opts.scope) {
      qb.andWhere('n.scope = :scope', { scope: this.normalizeScope(opts.scope) });
    }
    if (!opts.includeInactive) {
      qb.andWhere('n.is_active = true');
    }
    return qb.getMany();
  }

  async create(tenantId: string, input: NoteTemplateInput, actorId?: string, correlationId?: string) {
    const text = (input.text || '').trim();
    if (!text) throw new BadRequestException('Note template text is required');

    const scope = this.normalizeScope(input.scope);
    const duplicate = await this.repo.findOne({ where: { tenant_id: tenantId, scope, text } });
    if (duplicate) throw new ConflictException(`A ${scope.toLowerCase()} note with this text already exists`);

    const saved = await this.repo.save(
      this.repo.create({
        tenant_id: tenantId,
        scope,
        text,
        category: this.normalizeCategory(input.category),
        sort_order: Number.isInteger(input.sort_order) ? input.sort_order : 0,
        is_active: input.is_active !== false,
        created_by: actorId || null,
        updated_by: actorId || null,
      }),
    );

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId,
      action: 'NOTE_TEMPLATE_CREATED',
      entityType: 'NoteTemplate',
      entityId: saved.id,
      correlationId,
      afterData: saved,
    });

    return saved;
  }

  async update(tenantId: string, id: string, input: NoteTemplateInput, actorId?: string, correlationId?: string) {
    const template = await this.repo.findOne({ where: { id, tenant_id: tenantId } });
    if (!template) throw new NotFoundException('Note template not found');
    const before = { ...template };

    if (input.text !== undefined) {
      const text = input.text.trim();
      if (!text) throw new BadRequestException('Note template text is required');
      template.text = text;
    }
    if (input.scope !== undefined) template.scope = this.normalizeScope(input.scope);
    if (input.category !== undefined) template.category = this.normalizeCategory(input.category);
    if (input.sort_order !== undefined) template.sort_order = Number(input.sort_order) || 0;
    if (input.is_active !== undefined) template.is_active = Boolean(input.is_active);
    template.updated_by = actorId || null;

    // The unique index would catch this, but as a 500 rather than a sentence the operator
    // can act on.
    const clash = await this.repo
      .createQueryBuilder('n')
      .where('n.tenant_id = :tenantId AND n.scope = :scope AND n.text = :text AND n.id <> :id', {
        tenantId,
        scope: template.scope,
        text: template.text,
        id,
      })
      .getOne();
    if (clash) throw new ConflictException(`A ${template.scope.toLowerCase()} note with this text already exists`);

    const saved = await this.repo.save(template);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId,
      action: 'NOTE_TEMPLATE_UPDATED',
      entityType: 'NoteTemplate',
      entityId: saved.id,
      correlationId,
      beforeData: before,
      afterData: saved,
    });

    return saved;
  }

  /**
   * Retire, never delete. The phrase has been printed on real tickets; taking the row away
   * would be rewriting what those tickets said.
   */
  async archive(tenantId: string, id: string, actorId?: string, correlationId?: string) {
    const template = await this.repo.findOne({ where: { id, tenant_id: tenantId } });
    if (!template) throw new NotFoundException('Note template not found');
    const before = { ...template };

    template.is_active = false;
    template.updated_by = actorId || null;
    const saved = await this.repo.save(template);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId,
      action: 'NOTE_TEMPLATE_ARCHIVED',
      entityType: 'NoteTemplate',
      entityId: saved.id,
      correlationId,
      beforeData: before,
      afterData: saved,
    });

    return saved;
  }

  private normalizeScope(scope?: string): NoteTemplateScope {
    const value = (scope || 'ITEM').toUpperCase();
    if (!NOTE_TEMPLATE_SCOPES.includes(value as NoteTemplateScope)) {
      throw new BadRequestException(`Note template scope must be one of ${NOTE_TEMPLATE_SCOPES.join(', ')}`);
    }
    return value as NoteTemplateScope;
  }

  private normalizeCategory(category?: string | null): string | null {
    if (category === undefined || category === null) return null;
    const trimmed = category.trim();
    return trimmed ? trimmed : null;
  }
}
