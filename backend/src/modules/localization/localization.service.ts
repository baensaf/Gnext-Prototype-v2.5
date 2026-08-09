import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LocalizedString } from '../../entities/LocalizedString.entity';

@Injectable()
export class LocalizationService {
  constructor(
    @InjectRepository(LocalizedString) private readonly stringRepo: Repository<LocalizedString>,
  ) {}

  async getStringsForEntity(tenantId: string, entityType: string, entityId: string) {
    return await this.stringRepo.find({
      where: { tenant_id: tenantId, entity_type: entityType, entity_id: entityId },
    });
  }

  async resolveText(
    tenantId: string,
    entityType: string,
    entityId: string,
    fieldName: string,
    requestedLocale: string,
    defaultText: string = '',
  ): Promise<string> {
    const primary = await this.stringRepo.findOne({
      where: {
        tenant_id: tenantId,
        entity_type: entityType,
        entity_id: entityId,
        field_name: fieldName,
        locale: requestedLocale,
      },
    });
    if (primary && primary.text_value) return primary.text_value;

    if (requestedLocale === 'fa') {
      const fallbackEn = await this.stringRepo.findOne({
        where: {
          tenant_id: tenantId,
          entity_type: entityType,
          entity_id: entityId,
          field_name: fieldName,
          locale: 'en',
        },
      });
      if (fallbackEn && fallbackEn.text_value) return fallbackEn.text_value;
    }

    return defaultText;
  }

  async upsertStrings(
    tenantId: string,
    strings: Array<{ entity_type: string; entity_id: string; field_name: string; locale: string; text_value: string }>,
  ) {
    const results = [];
    for (const item of strings) {
      let row = await this.stringRepo.findOne({
        where: {
          tenant_id: tenantId,
          entity_type: item.entity_type,
          entity_id: item.entity_id,
          field_name: item.field_name,
          locale: item.locale,
        },
      });

      if (!row) {
        row = this.stringRepo.create({
          tenant_id: tenantId,
          entity_type: item.entity_type,
          entity_id: item.entity_id,
          field_name: item.field_name,
          locale: item.locale,
          text_value: item.text_value,
        });
      } else {
        row.text_value = item.text_value;
      }

      results.push(await this.stringRepo.save(row));
    }
    return results;
  }

  async getBilingualMap(tenantId: string, entityType: string, entityId: string) {
    const list = await this.getStringsForEntity(tenantId, entityType, entityId);
    const map: Record<string, Record<string, string>> = {};
    for (const s of list) {
      if (!map[s.field_name]) map[s.field_name] = {};
      map[s.field_name][s.locale] = s.text_value;
    }
    return map;
  }

  async exportCsv(tenantId: string): Promise<string> {
    const all = await this.stringRepo.find({
      where: { tenant_id: tenantId },
      order: { entity_type: 'ASC', entity_id: 'ASC', field_name: 'ASC', locale: 'ASC' },
    });

    const lines: string[] = ['entity_type,entity_id,field_name,locale,text_value'];
    for (const row of all) {
      const escapedText = `"${row.text_value.replace(/"/g, '""')}"`;
      lines.push(`${row.entity_type},${row.entity_id},${row.field_name},${row.locale},${escapedText}`);
    }
    return lines.join('\n');
  }

  async importCsv(tenantId: string, csvContent: string): Promise<{ imported: number }> {
    if (!csvContent) return { imported: 0 };
    const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length <= 1) return { imported: 0 };

    const itemsToUpsert = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
      if (parts.length < 5) continue;

      const entity_type = parts[0].trim();
      const entity_id = parts[1].trim();
      const field_name = parts[2].trim();
      const locale = parts[3].trim();
      let text_value = parts[4].trim();

      if (text_value.startsWith('"') && text_value.endsWith('"')) {
        text_value = text_value.substring(1, text_value.length - 1).replace(/""/g, '"');
      }

      if (entity_type && entity_id && field_name && locale) {
        itemsToUpsert.push({ entity_type, entity_id, field_name, locale, text_value });
      }
    }

    const saved = await this.upsertStrings(tenantId, itemsToUpsert);
    return { imported: saved.length };
  }
}
