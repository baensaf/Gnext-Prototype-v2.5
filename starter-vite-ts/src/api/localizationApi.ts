import { httpClient } from './httpClient';

export interface LocalizedStringDto {
  id?: string;
  entity_type: string;
  entity_id: string;
  field_name: string;
  locale: string;
  text_value: string;
}

export const localizationApi = {
  getStrings: async (entityType: string, entityId: string): Promise<LocalizedStringDto[]> => {
    const res = await httpClient.get('/api/v1/localization/strings', {
      params: { entityType, entityId },
    });
    return res.data;
  },
  getBilingualMap: async (entityType: string, entityId: string): Promise<Record<string, Record<string, string>>> => {
    const res = await httpClient.get('/api/v1/localization/bilingual-map', {
      params: { entityType, entityId },
    });
    return res.data;
  },
  upsertStrings: async (strings: LocalizedStringDto[]): Promise<LocalizedStringDto[]> => {
    const res = await httpClient.put('/api/v1/localization/strings', { strings });
    return res.data;
  },
};
