import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CustomFieldDefinition } from '../../entities/CustomFieldDefinition.entity';
import { CustomerCustomValue } from '../../entities/CustomerCustomValue.entity';
import { AuditWriter } from '../audit/audit-writer.service';

export const CUSTOM_FIELD_TYPES = ['TEXT', 'NUMBER', 'DATE', 'CHOICE'] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export type CustomFieldInput = {
  name?: string;
  data_type?: string;
  options?: string[];
  is_required?: boolean;
};

/** A customer's answers, by field id. An empty answer clears the field. */
export type CustomValues = Record<string, string | null>;

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The questions head office adds to the customer record — gender, a wedding date, a favourite
 * branch — so a restaurant collects what it needs without a feature built for each. The answers
 * are typed with the customer at the register and kept one row per customer and field.
 */
@Injectable()
export class CustomFieldsService {
  constructor(
    @InjectRepository(CustomFieldDefinition) private readonly fieldRepo: Repository<CustomFieldDefinition>,
    @InjectRepository(CustomerCustomValue) private readonly valueRepo: Repository<CustomerCustomValue>,
    private readonly auditWriter: AuditWriter,
  ) {}

  /** The chain's fields in their order; archived ones only when asked for. */
  async list(tenantId: string, includeArchived = false): Promise<CustomFieldDefinition[]> {
    return this.fieldRepo.find({
      where: { tenant_id: tenantId, ...(includeArchived ? {} : { is_active: true }) },
      order: { sort_order: 'ASC', created_at: 'ASC' },
    });
  }

  async create(tenantId: string, input: CustomFieldInput, actorId?: string): Promise<CustomFieldDefinition> {
    const shape = this.shape(input, undefined);
    const existing = await this.fieldRepo.find({ where: { tenant_id: tenantId } });
    if (existing.some((f) => f.is_active && f.name.trim().toLowerCase() === shape.name.toLowerCase())) {
      throw new BadRequestException({ code: 'FIELD_EXISTS', message: `A field called "${shape.name}" already exists` });
    }
    const saved = await this.fieldRepo.save(
      this.fieldRepo.create({
        tenant_id: tenantId,
        key: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        ...shape,
        sort_order: existing.length,
        is_active: true,
      }),
    );
    await this.audit(tenantId, 'CUSTOM_FIELD_CREATED', saved, actorId);
    return saved;
  }

  async update(tenantId: string, id: string, input: CustomFieldInput, actorId?: string): Promise<CustomFieldDefinition> {
    const field = await this.find(tenantId, id);
    // The type is fixed once answers exist: a date stored as text would not read back.
    if (input.data_type && input.data_type !== field.data_type) {
      const answered = await this.valueRepo.count({ where: { tenant_id: tenantId, field_id: id } });
      if (answered) throw new BadRequestException({ code: 'FIELD_TYPE_LOCKED', message: 'Customers have answered this field; its type cannot change' });
    }
    Object.assign(field, this.shape({ ...field, ...input, options: input.options ?? field.options }, field));
    const saved = await this.fieldRepo.save(field);
    await this.audit(tenantId, 'CUSTOM_FIELD_UPDATED', saved, actorId);
    return saved;
  }

  /** Archived, not deleted: the answers customers gave stay on their records. */
  async archive(tenantId: string, id: string, actorId?: string): Promise<{ success: true }> {
    const field = await this.find(tenantId, id);
    field.is_active = false;
    await this.fieldRepo.save(field);
    await this.audit(tenantId, 'CUSTOM_FIELD_ARCHIVED', field, actorId);
    return { success: true };
  }

  /** A customer's answers, by field id. */
  async valuesFor(tenantId: string, customerId: string): Promise<CustomValues> {
    const rows = await this.valueRepo.find({ where: { tenant_id: tenantId, customer_id: customerId } });
    return Object.fromEntries(rows.map((r) => [r.field_id, r.value]));
  }

  /**
   * Checks answers against their fields before anything is saved. A new customer must answer
   * every required field; an edit only what it sends.
   */
  async validate(tenantId: string, raw: unknown, forNewCustomer: boolean): Promise<CustomValues> {
    const values: CustomValues = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as CustomValues) } : {};
    const fields = await this.list(tenantId);
    const byId = new Map(fields.map((f) => [f.id, f]));

    for (const [fieldId, value] of Object.entries(values)) {
      const field = byId.get(fieldId);
      if (!field) throw new BadRequestException({ code: 'UNKNOWN_FIELD', message: `Unknown customer field ${fieldId}` });
      const text = value === null || value === undefined ? '' : String(value).trim();
      values[fieldId] = text || null;
      if (!text) {
        if (field.is_required) throw new BadRequestException({ code: 'FIELD_REQUIRED', message: `${field.name} is required` });
        continue;
      }
      if (field.data_type === 'NUMBER' && !Number.isFinite(Number(text))) {
        throw new BadRequestException({ code: 'FIELD_INVALID', message: `${field.name} must be a number` });
      }
      if (field.data_type === 'DATE' && (!isoDate.test(text) || Number.isNaN(Date.parse(text)))) {
        throw new BadRequestException({ code: 'FIELD_INVALID', message: `${field.name} must be a date (YYYY-MM-DD)` });
      }
      if (field.data_type === 'CHOICE' && !(field.options || []).includes(text)) {
        throw new BadRequestException({ code: 'FIELD_INVALID', message: `${field.name} must be one of ${(field.options || []).join(', ')}` });
      }
    }

    if (forNewCustomer) {
      const missing = fields.filter((f) => f.is_required && !values[f.id]);
      if (missing.length) {
        throw new BadRequestException({ code: 'FIELD_REQUIRED', message: `${missing.map((f) => f.name).join(', ')} required` });
      }
    }
    return values;
  }

  /** Saves checked answers; an empty one removes the stored answer. */
  async save(tenantId: string, customerId: string, values: CustomValues): Promise<CustomValues> {
    const ids = Object.keys(values);
    if (ids.length) {
      const stored = await this.valueRepo.find({ where: { tenant_id: tenantId, customer_id: customerId, field_id: In(ids) } });
      for (const fieldId of ids) {
        const row = stored.find((r) => r.field_id === fieldId);
        const value = values[fieldId];
        if (!value) {
          if (row) await this.valueRepo.delete({ id: row.id });
        } else if (row) {
          row.value = value;
          await this.valueRepo.save(row);
        } else {
          await this.valueRepo.save(this.valueRepo.create({ tenant_id: tenantId, customer_id: customerId, field_id: fieldId, value }));
        }
      }
    }
    return this.valuesFor(tenantId, customerId);
  }

  private async find(tenantId: string, id: string) {
    const field = await this.fieldRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!field) throw new NotFoundException('Customer field not found');
    return field;
  }

  private shape(input: CustomFieldInput, current: CustomFieldDefinition | undefined) {
    const name = String(input.name ?? current?.name ?? '').trim();
    if (!name) throw new BadRequestException({ code: 'NAME_REQUIRED', message: 'A field needs a name' });
    const type = String(input.data_type ?? current?.data_type ?? 'TEXT').toUpperCase();
    if (!(CUSTOM_FIELD_TYPES as readonly string[]).includes(type)) {
      throw new BadRequestException(`data_type must be one of ${CUSTOM_FIELD_TYPES.join(', ')}`);
    }
    const options = type === 'CHOICE' ? [...new Set((input.options || []).map((o) => String(o).trim()).filter(Boolean))] : [];
    if (type === 'CHOICE' && options.length < 2) {
      throw new BadRequestException({ code: 'CHOICES_REQUIRED', message: 'A choice field needs at least two choices' });
    }
    return { name: name.slice(0, 160), data_type: type, options, is_required: Boolean(input.is_required ?? current?.is_required) };
  }

  private async audit(tenantId: string, action: string, field: CustomFieldDefinition, actorId?: string) {
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId,
      action,
      entityType: 'CustomFieldDefinition',
      entityId: field.id,
      correlationId: 'corr-custom-field',
      afterData: field,
    });
  }
}
