import { Test, TestingModule } from '@nestjs/testing';
import { MediaService } from '../src/modules/media/media.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FileAsset } from '../src/entities/FileAsset.entity';
import { BadRequestException } from '@nestjs/common';
import * as os from 'os';
import * as path from 'path';

describe('MediaService (Unit)', () => {
  let service: MediaService;
  let assetRepo: any;

  beforeAll(() => {
    process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'gnext-media-test');
  });

  beforeEach(async () => {
    assetRepo = { create: jest.fn(), save: jest.fn(), findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaService,
        { provide: getRepositoryToken(FileAsset), useValue: assetRepo },
      ],
    }).compile();

    service = module.get<MediaService>(MediaService);
  });

  it('should save uploaded valid PNG file asset and compute sha256 checksum in temp dir', async () => {
    const pngBuffer = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const mockFile: any = {
      originalname: 'logo.png',
      mimetype: 'image/png',
      size: pngBuffer.length,
      buffer: pngBuffer,
    };

    assetRepo.create.mockImplementation((dto: any) => ({ id: 'asset-1', ...dto }));
    assetRepo.save.mockImplementation((a: any) => Promise.resolve({ ...a, created_at: new Date() }));

    const result = await service.saveFile('t-1', mockFile);

    expect(result.id).toBe('asset-1');
    expect(result.mime_type).toBe('image/png');
    expect(result.checksum_sha256).toBeDefined();
    expect(result.url).toContain('/api/v1/media/uploads/');
  });

  it('should reject file with invalid magic header signature', async () => {
    const invalidBuffer = Buffer.from('1234567890abcdef', 'hex');
    const mockFile: any = {
      originalname: 'fake.png',
      mimetype: 'image/png',
      size: invalidBuffer.length,
      buffer: invalidBuffer,
    };

    await expect(service.saveFile('t-1', mockFile)).rejects.toThrow(BadRequestException);
  });

  it('should reject file exceeding 5MB limit', async () => {
    const largeBuffer = Buffer.alloc(6 * 1024 * 1024);
    largeBuffer.write('89504e47', 0, 'hex');
    const mockFile: any = {
      originalname: 'huge.png',
      mimetype: 'image/png',
      size: largeBuffer.length,
      buffer: largeBuffer,
    };

    await expect(service.saveFile('t-1', mockFile)).rejects.toThrow(BadRequestException);
  });
});
