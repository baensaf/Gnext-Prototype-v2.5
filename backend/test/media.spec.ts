import { Test, TestingModule } from '@nestjs/testing';
import { MediaService } from '../src/modules/media/media.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FileAsset } from '../src/entities/FileAsset.entity';

describe('MediaService (Unit)', () => {
  let service: MediaService;
  let assetRepo: any;

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

  it('should save uploaded file asset and compute sha256 checksum', async () => {
    const mockFile: any = {
      originalname: 'logo.png',
      mimetype: 'image/png',
      size: 1024,
      buffer: Buffer.from('test-image-content'),
    };

    assetRepo.create.mockImplementation((dto: any) => ({ id: 'asset-1', ...dto }));
    assetRepo.save.mockImplementation((a: any) => Promise.resolve({ ...a, created_at: new Date() }));

    const result = await service.saveFile('t-1', mockFile);

    expect(result.id).toBe('asset-1');
    expect(result.mime_type).toBe('image/png');
    expect(result.checksum_sha256).toBeDefined();
    expect(result.url).toContain('/uploads/');
  });
});
