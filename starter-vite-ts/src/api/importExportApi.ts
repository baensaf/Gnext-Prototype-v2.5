import { httpClient } from './httpClient';

export interface ImportJobDto {
  id: string;
  tenant_id: string;
  entity_type: 'CUSTOMERS' | 'PRODUCTS' | 'CATEGORIES';
  file_name: string;
  status: 'STAGED' | 'VALIDATED' | 'COMPLETED' | 'FAILED';
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  column_mapping: Record<string, string>;
  value_mapping: Record<string, Record<string, string>>;
  error_summary?: Array<{ row: number; column: string; message: string }>;
}

export interface ImportRowDto {
  id: string;
  job_id: string;
  row_number: number;
  status: 'STAGED' | 'VALID' | 'INVALID' | 'IMPORTED';
  raw_data: Record<string, any>;
  parsed_data?: Record<string, any>;
  errors?: string[];
}

export const importExportApi = {
  uploadFile: async (entityType: string, fileContent: string, fileName: string = 'import.csv') => {
    const res = await httpClient.post<{ success: boolean; data: ImportJobDto }>('/api/v1/import/upload', {
      entityType,
      fileContent,
      fileName,
    });
    return res.data.data;
  },

  uploadFileAsFormData: async (entityType: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('entityType', entityType);
    const res = await httpClient.post<{ success: boolean; data: ImportJobDto }>('/api/v1/import/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return res.data.data;
  },

  getJobDetail: async (jobId: string) => {
    const res = await httpClient.get<{ success: boolean; data: { job: ImportJobDto; rows: ImportRowDto[] } }>(`/api/v1/import/job/${jobId}`);
    return res.data.data;
  },

  autoMap: async (headers: string[], entityType: string) => {
    const res = await httpClient.post<{ success: boolean; data: Array<{ header: string; mappedField: string | null; confidence: number }> }>('/api/v1/import/auto-map', {
      headers,
      entityType,
    });
    return res.data.data;
  },

  getDistinctValues: async (jobId: string, columnMapping: Record<string, string>) => {
    const res = await httpClient.post<{ success: boolean; data: Record<string, string[]> }>('/api/v1/import/distinct-values', {
      jobId,
      columnMapping,
    });
    return res.data.data;
  },

  validateJob: async (jobId: string, columnMapping: Record<string, string>, valueMapping: Record<string, Record<string, string>> = {}) => {
    const res = await httpClient.post<{ success: boolean; data: ImportJobDto }>('/api/v1/import/validate', {
      jobId,
      columnMapping,
      valueMapping,
    });
    return res.data.data;
  },

  executeJob: async (jobId: string) => {
    const res = await httpClient.post<{ success: boolean; data: { importedCount: number; failedCount: number } }>('/api/v1/import/execute', {
      jobId,
    });
    return res.data.data;
  },

  systemReset: async (pin: string) => {
    const res = await httpClient.post<{ success: boolean; data: { resetTables: string[] } }>('/api/v1/system/reset', {
      pin,
    });
    return res.data.data;
  },

  getSeedProfiles: async () => {
    const res = await httpClient.get<{ success: boolean; data: Array<{ id: string; name: string; description: string }> }>('/api/v1/system/seed-profiles');
    return res.data.data;
  },

  applySeedProfile: async (pin: string, profileId: string) => {
    const res = await httpClient.post<{ success: boolean; data: { success: boolean; profile: string } }>('/api/v1/system/apply-seed', {
      pin,
      profileId,
    });
    return res.data.data;
  },
};
