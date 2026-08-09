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
  private get uploadDir(): string {
    const dir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  constructor(
    @InjectRepository(FileAsset) private readonly assetRepo: Repository<FileAsset>,
  ) {}

  validateMagicHeader(buffer: Buffer, mimeType: string) {
    if (!buffer || buffer.length < 4) {
      throw new BadRequestException('Invalid or empty file buffer');
    }

    const hex = buffer.toString('hex', 0, 8).toLowerCase();
    let isValid = false;

    if (mimeType === 'image/png' && hex.startsWith('89504e47')) {
      isValid = true;
    } else if ((mimeType === 'image/jpeg' || mimeType === 'image/jpg') && hex.startsWith('ffd8ff')) {
      isValid = true;
    } else if (mimeType === 'application/pdf' && hex.startsWith('25504446')) {
      isValid = true;
    } else if (mimeType === 'image/webp' && hex.startsWith('52494646')) { // RIFF
      isValid = true;
    }

    if (!isValid) {
      throw new BadRequestException(`File magic number signature does not match declared MIME type: ${mimeType}`);
    }
  }

  async saveFile(tenantId: string, file: UploadedFileDto, createdBy?: string) {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file uploaded');
    }

    const maxSizeBytes = 5 * 1024 * 1024; // 5MB limit per specification
    if (file.size > maxSizeBytes || file.buffer.length > maxSizeBytes) {
      throw new BadRequestException(`File size exceeds 5MB limit. Received ${file.size} bytes.`);
    }

    const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf'];
    if (!allowedMimeTypes.includes(file.mimetype.toLowerCase())) {
      throw new BadRequestException(`MIME type ${file.mimetype} is not allowed. Allowed types: ${allowedMimeTypes.join(', ')}`);
    }

    this.validateMagicHeader(file.buffer, file.mimetype.toLowerCase());

    const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const ext = path.extname(file.originalname) || '.bin';
    const opaqueFilename = `${sha256.substring(0, 16)}-${Date.now()}${ext}`;
    const filePath = path.join(this.uploadDir, opaqueFilename);

    await fs.promises.writeFile(filePath, file.buffer);

    const relativeUrlPath = `/uploads/${opaqueFilename}`;

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
    if (!asset) throw new NotFoundException('File asset not found or unauthorized cross-tenant access');
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
