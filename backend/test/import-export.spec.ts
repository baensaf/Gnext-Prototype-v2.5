import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { ImportExportService } from '../src/modules/import-export/import-export.service';
import { ImportJob } from '../src/entities/ImportJob.entity';
import { ImportRow } from '../src/entities/ImportRow.entity';
import { Customer } from '../src/entities/Customer.entity';
import { Product } from '../src/entities/Product.entity';
import { Category } from '../src/entities/Category.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';

describe('ImportExportService (Slice 22 Unit & Logic)', () => {
  let service: ImportExportService;
  let jobRepo: any;
  let rowRepo: any;
  let customerRepo: any;
  let productRepo: any;
  let categoryRepo: any;
  let dataSource: any;
  let auditWriter: any;

  beforeEach(async () => {
    jobRepo = {
      create: jest.fn((dto) => ({ id: 'job-uuid-1', ...dto })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      findOne: jest.fn(),
    };

    rowRepo = {
      create: jest.fn((dto) => ({ id: 'row-uuid-1', ...dto })),
      save: jest.fn((entities) => Promise.resolve(entities)),
      find: jest.fn(),
      // No bad rows unless a test says so.
      count: jest.fn().mockResolvedValue(0),
    };

    customerRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    productRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    categoryRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    dataSource = {
      transaction: jest.fn((cb) => cb({ findOne: jest.fn(), create: jest.fn(), save: jest.fn(), query: jest.fn() })),
      // The chain's categories, for checking the category code of each product row.
      getRepository: jest.fn(() => ({ find: jest.fn().mockResolvedValue([{ code: 'CAT-A' }, { code: 'OLD', deleted_at: new Date() }]) })),
    };
    auditWriter = { write: jest.fn().mockResolvedValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportExportService,
        { provide: getRepositoryToken(ImportJob), useValue: jobRepo },
        { provide: getRepositoryToken(ImportRow), useValue: rowRepo },
        { provide: getRepositoryToken(Customer), useValue: customerRepo },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: getRepositoryToken(Category), useValue: categoryRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    service = module.get<ImportExportService>(ImportExportService);
  });

  describe('Spreadsheet CSV/Excel Parser', () => {
    it('should parse CSV content into headers and row objects', () => {
      const csvData = 'Customer Code,First Name,Last Name,Mobile\nCUST-001,Ali,Rezaei,09121112233\nCUST-002,Sara,Ahmadi,09129998877';
      const parsed = service.parseRawContent(csvData);

      expect(parsed.headers).toEqual(['Customer Code', 'First Name', 'Last Name', 'Mobile']);
      expect(parsed.rows).toHaveLength(2);
      expect(parsed.rows[0]['Customer Code']).toBe('CUST-001');
      expect(parsed.rows[0]['First Name']).toBe('Ali');
      expect(parsed.rows[1]['Mobile']).toBe('09129998877');
    });

    it('should parse XLSX buffer into headers and row objects', async () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Sheet1');
      sheet.addRow(['Customer Code', 'First Name', 'Last Name', 'Mobile']);
      sheet.addRow(['CUST-001', 'Ali', 'Rezaei', '09121112233']);
      sheet.addRow(['CUST-002', 'Sara', 'Ahmadi', '09129998877']);
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

      const parsed = await service.parseXlsxBuffer(buffer);
      expect(parsed.headers).toEqual(['Customer Code', 'First Name', 'Last Name', 'Mobile']);
      expect(parsed.rows).toHaveLength(2);
      expect(parsed.rows[0]['Customer Code']).toBe('CUST-001');
      expect(parsed.rows[0]['First Name']).toBe('Ali');
      expect(parsed.rows[1]['Mobile']).toBe('09129998877');
    });

    it('should parse XLSX with mixed cell types (numbers, formulas, Persian text)', async () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Products');
      sheet.addRow(['کد کالا', 'نام کالا', 'قیمت', 'Formula Total']);

      const row2 = sheet.addRow(['PROD-100', 'همبرگر مخصوص', 250000]);
      row2.getCell(4).value = { formula: 'C2*1.09', result: 272500 };

      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      const parsed = await service.parseXlsxBuffer(buffer);

      expect(parsed.headers).toEqual(['کد کالا', 'نام کالا', 'قیمت', 'Formula Total']);
      expect(parsed.rows).toHaveLength(1);
      expect(parsed.rows[0]['کد کالا']).toBe('PROD-100');
      expect(parsed.rows[0]['نام کالا']).toBe('همبرگر مخصوص');
      expect(parsed.rows[0]['قیمت']).toBe('250000');
      expect(parsed.rows[0]['Formula Total']).toBe('272500');
    });

    it('should throw BadRequestException when parsing empty XLSX buffer', async () => {
      await expect(service.parseXlsxBuffer(Buffer.from([]))).rejects.toThrow('Excel file is empty');
    });

    it('should stage an import job from XLSX buffer', async () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Products');
      sheet.addRow(['کد کالا', 'نام کالا', 'قیمت']);
      sheet.addRow(['P-X1', 'همبرگر', '250000']);
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

      const job = await service.createStagedJobFromXlsx('test-tenant', 'PRODUCTS', 'products.xlsx', buffer);

      expect(jobRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: 'test-tenant',
          entity_type: 'PRODUCTS',
          file_name: 'products.xlsx',
          status: 'STAGED',
          total_rows: 1,
        }),
      );
      expect(rowRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          row_number: 1,
          status: 'STAGED',
          raw_data: {
            'کد کالا': 'P-X1',
            'نام کالا': 'همبرگر',
            'قیمت': '250000',
          },
        }),
      );
    });
  });

  describe('Auto-Mapping Engine', () => {
    it('should auto-map English and Persian column headers with high confidence', () => {
      const headers = ['نام کالا', 'قیمت', 'کد کالا', 'English Title', 'Unknown Column'];
      const mapping = service.generateAutoMapping(headers, 'PRODUCTS');

      expect(mapping).toEqual([
        { header: 'نام کالا', mappedField: 'name_fa', confidence: 100 },
        { header: 'قیمت', mappedField: 'base_price', confidence: 100 },
        { header: 'کد کالا', mappedField: 'code', confidence: 100 },
        { header: 'English Title', mappedField: null, confidence: 0 },
        { header: 'Unknown Column', mappedField: null, confidence: 0 },
      ]);
    });

  });

  describe('Job Validation (Dry Run)', () => {
    it('should validate product rows and capture row-level errors', async () => {
      const job = { id: 'job-1', entity_type: 'PRODUCTS', status: 'STAGED' };
      jobRepo.findOne.mockResolvedValue(job);

      const rows = [
        { row_number: 1, raw_data: { Name: 'Burger', Price: '250000', Cat: 'CAT-A' } },
        { row_number: 2, raw_data: { Name: '', Price: '-5', Cat: 'CAT-A' } },
      ];
      rowRepo.find.mockResolvedValue(rows);

      const validatedJob = await service.validateJob('job-1', { Name: 'name_fa', Price: 'base_price', Cat: 'category_code' });

      expect(validatedJob.valid_rows).toBe(1);
      expect(validatedJob.error_rows).toBe(1);
      expect(validatedJob.error_summary).toHaveLength(2); // Name required & negative price
    });

    it('needs a known category code, and refuses two rows for the same product', async () => {
      jobRepo.findOne.mockResolvedValue({ id: 'job-1', entity_type: 'PRODUCTS', status: 'STAGED' });
      rowRepo.find.mockResolvedValue([
        { row_number: 1, raw_data: { Name: 'Burger', Price: '1', Cat: 'CAT-A', Code: 'B1' } },
        { row_number: 2, raw_data: { Name: 'Big Burger', Price: '1', Cat: 'CAT-A', Code: 'b1' } },
        { row_number: 3, raw_data: { Name: 'Fries', Price: '1', Cat: 'CAT-X', Code: '' } },
        { row_number: 4, raw_data: { Name: 'Tea', Price: '1', Cat: '', Code: '' } },
      ]);
      const job = await service.validateJob('job-1', { Name: 'name_fa', Price: 'base_price', Cat: 'category_code', Code: 'code' });
      expect(job.valid_rows).toBe(1);
      expect(job.error_summary.map((e: any) => e.message)).toEqual([
        'Same product as row 1',
        'No category has the code CAT-X',
        'Category Code is required',
      ]);
    });
  });

  describe('Archived categories and bad rows', () => {
    it('refuses an archived category code, on a category row and on a product row', async () => {
      jobRepo.findOne.mockResolvedValue({ id: 'job-1', entity_type: 'CATEGORIES', status: 'STAGED' });
      rowRepo.find.mockResolvedValue([{ row_number: 1, raw_data: { Code: 'old', Name: 'Old' } }]);
      const cats = await service.validateJob('job-1', { Code: 'code', Name: 'name_fa' });
      expect(cats.error_summary.map((e: any) => e.message)).toEqual(['Code OLD belongs to an archived category and is not used again']);

      jobRepo.findOne.mockResolvedValue({ id: 'job-2', entity_type: 'PRODUCTS', status: 'STAGED' });
      rowRepo.find.mockResolvedValue([{ row_number: 1, raw_data: { Name: 'Tea', Price: '1', Cat: 'OLD' } }]);
      const prods = await service.validateJob('job-2', { Name: 'name_fa', Price: 'base_price', Cat: 'category_code' });
      expect(prods.error_summary.map((e: any) => e.message)).toEqual(['Category OLD is archived']);
    });

    it('imports nothing while any row is bad', async () => {
      jobRepo.findOne.mockResolvedValue({ id: 'job-3', tenant_id: 't-1', entity_type: 'PRODUCTS' });
      rowRepo.count.mockResolvedValue(2);
      await expect(service.executeJob('job-3', 'u-1')).rejects.toThrow('2 rows are bad. Nothing was imported');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('Product import without codes', () => {
    const runRows = async (rows: any[], existing: any[]) => {
      const manager = {
        findOne: jest.fn((entity: any) => Promise.resolve(entity === Category ? { id: 'cat-default' } : null)),
        find: jest.fn().mockResolvedValue(existing),
        create: jest.fn((_e: any, dto: any) => ({ ...dto })),
        save: jest.fn((a: any, b?: any) => Promise.resolve(b ?? a)),
        getRepository: jest.fn(() => ({ maximum: jest.fn().mockResolvedValue(3) })),
      };
      dataSource.transaction.mockImplementation((cb: any) => cb(manager));
      jobRepo.findOne.mockResolvedValue({ id: 'job-p', tenant_id: 't-1', entity_type: 'PRODUCTS' });
      rowRepo.find.mockResolvedValue(rows.map((parsed_data, i) => ({ row_number: i + 1, status: 'VALID', parsed_data })));
      const result = await service.executeJob('job-p', 'u-1');
      return { result, manager };
    };

    it('passes validation with no code column', async () => {
      jobRepo.findOne.mockResolvedValue({ id: 'job-p', entity_type: 'PRODUCTS', status: 'STAGED' });
      rowRepo.find.mockResolvedValue([{ row_number: 1, raw_data: { Name: 'Latte', Price: '90000', Cat: 'CAT-A' } }]);
      const job = await service.validateJob('job-p', { Name: 'name_fa', Price: 'base_price', Cat: 'category_code' });
      expect(job.valid_rows).toBe(1);
    });

    it('updates the product of the same name instead of adding a second one', async () => {
      const latte = { id: 'p-latte', name: 'Latte', category_id: 'cat-default', base_price: '80000.0000', code: null };
      const { result, manager } = await runRows([{ name_fa: ' latte ', base_price: '90000', category_code: 'cat-a' }], [latte]);
      expect(result.importedCount).toBe(1);
      expect(manager.create).not.toHaveBeenCalledWith(Product, expect.anything());
      // Typed in Toman, kept in Rial.
      expect(latte.base_price).toBe('900000.0000');
    });

    it('creates a new product, with no code, when no name matches, at the chain default tax', async () => {
      const { manager } = await runRows([{ name_fa: 'Mocha', base_price: '95000', category_code: 'CAT-A', barcode: '626' }], []);
      expect(manager.create).toHaveBeenCalledWith(
        Product,
        expect.objectContaining({ name: 'Mocha', code: null, base_price: '950000.0000', tax_rate: '0.1000', barcode: '626' }),
      );
    });

    it('takes the tax rate from the file as a percent', async () => {
      const { manager } = await runRows([{ name_fa: 'Soda', base_price: '30000', category_code: 'CAT-A', tax_rate: '9' }], []);
      expect(manager.create).toHaveBeenCalledWith(Product, expect.objectContaining({ tax_rate: '0.0900' }));
    });

    it('refuses a row whose name is two products, rather than guessing', async () => {
      const twins = [
        { id: 'p-1', name: 'Tea', category_id: 'cat-a' },
        { id: 'p-2', name: 'Tea', category_id: 'cat-b' },
      ];
      await expect(runRows([{ name_fa: 'Tea', base_price: '40000', category_code: 'CAT-A' }], twins)).rejects.toThrow(
        'Row 1: 2 products in this category are named "Tea"; give this row a product code. Nothing from this file was imported.',
      );
    });
  });

  describe('Seed Profiles & System Reset', () => {
    it('should return available seed profiles', () => {
      const profiles = service.getSeedProfiles();
      expect(profiles).toHaveLength(3);
      expect(profiles[0].id).toBe('MINIMAL');
      expect(profiles[1].id).toBe('DEMO_RESTAURANT');
      expect(profiles[2].id).toBe('DEMO_TRADING_DAY');
    });

    it('prepares a clean demo by resetting before applying the demo seed', async () => {
      const resetSpy = jest.spyOn(service, 'systemReset').mockResolvedValue({ resetTables: ['order_header', 'delivery'] });
      const seedSpy = jest.spyOn(service, 'applySeedProfile').mockResolvedValue({ success: true, profile: 'DEMO_RESTAURANT' });

      const result = await service.resetAndSeedDemo('tenant-1', 'user-1');

      expect(resetSpy).toHaveBeenCalledWith('tenant-1', 'user-1');
      expect(seedSpy).toHaveBeenCalledWith('tenant-1', 'user-1', 'DEMO_RESTAURANT');
      expect(resetSpy.mock.invocationCallOrder[0]).toBeLessThan(seedSpy.mock.invocationCallOrder[0]);
      expect(result.baseline).toEqual({ orders: 0, deliveries: 0, activeShifts: 0 });
    });
  });
});
