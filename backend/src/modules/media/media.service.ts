import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileAsset } from '../../entities/FileAsset.entity';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface UploadedFileDto {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class MediaService {
  private readonly uploadDir = path.join(process.cwd(), 'uploads');

  constructor(
    @InjectRepository(FileAsset) private readonly assetRepo: Repository<FileAsset>,
  ) {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async saveFile(tenantId: string, file: UploadedFileDto, createdBy?: string) {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file uploaded');
    }

    const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const ext = path.extname(file.originalname) || '.bin';
    const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    const filePath = path.join(this.uploadDir, filename);

    await fs.promises.writeFile(filePath, file.buffer);

    const relativeUrlPath = `/uploads/${filename}`;

    const asset = this.assetRepo.create({
      tenant_id: tenantId,
      storage_kind: 'LOCAL',
      file_path: relativeUrlPath,
      mime_type: file.mimetype,
      size_bytes: file.size,
      checksum_sha256: sha256,
      created_by: createdBy || null,
    });

    const saved = await this.assetRepo.save(asset);

    return {
      id: saved.id,
      url: relativeUrlPath,
      mime_type: saved.mime_type,
      size_bytes: Number(saved.size_bytes),
      checksum_sha256: saved.checksum_sha256,
      created_at: saved.created_at,
    };
  }

  async getFileById(tenantId: string, fileId: string) {
    const asset = await this.assetRepo.findOne({ where: { id: fileId, tenant_id: tenantId } });
    if (!asset) throw new NotFoundException('File asset not found');
    return {
      id: asset.id,
      url: asset.file_path,
      mime_type: asset.mime_type,
      size_bytes: Number(asset.size_bytes),
      checksum_sha256: asset.checksum_sha256,
      created_at: asset.created_at,
    };
  }
}
