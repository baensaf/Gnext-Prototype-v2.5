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
}
