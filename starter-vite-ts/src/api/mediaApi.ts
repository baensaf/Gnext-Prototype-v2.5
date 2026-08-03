import { httpClient } from './httpClient';

export interface FileAssetDto {
  id: string;
  url: string;
  mime_type: string;
  size_bytes: number;
  checksum_sha256?: string;
  created_at: string;
}

export const mediaApi = {
  uploadFile: async (file: File): Promise<FileAssetDto> => {
    const formData = new FormData();
    formData.append('file', file);

    const res = await httpClient.post('/api/v1/media/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    return res.data;
  },
  getFile: async (id: string): Promise<FileAssetDto> => {
    const res = await httpClient.get(`/api/v1/media/files/${id}`);
    return res.data;
  },
};
