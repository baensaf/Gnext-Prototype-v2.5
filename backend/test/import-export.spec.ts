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
    };

    customerRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    productRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    categoryRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    dataSource = { transaction: jest.fn((cb) => cb({ findOne: jest.fn(), create: jest.fn(), save: jest.fn(), query: jest.fn() })) };
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
      const sheet = workbook.addWorksheet('Customers');
      sheet.addRow(['کد مشتری', 'نام', 'نام خانوادگی', 'شماره تماس']);
      sheet.addRow(['CUST-X1', 'امیر', 'کاظمی', '09123334455']);
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

      const job = await service.createStagedJobFromXlsx('test-tenant', 'CUSTOMERS', 'customers.xlsx', buffer);

      expect(jobRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: 'test-tenant',
          entity_type: 'CUSTOMERS',
          file_name: 'customers.xlsx',
          status: 'STAGED',
          total_rows: 1,
        }),
      );
      expect(rowRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          row_number: 1,
          status: 'STAGED',
          raw_data: {
            'کد مشتری': 'CUST-X1',
            'نام': 'امیر',
            'نام خانوادگی': 'کاظمی',
            'شماره تماس': '09123334455',
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
        { header: 'English Title', mappedField: 'name_en', confidence: 100 },
        { header: 'Unknown Column', mappedField: null, confidence: 0 },
      ]);
    });

    it('should auto-map Customer headers accurately', () => {
      const headers = ['Customer Code', 'First Name', 'Surname', 'شماره تماس', 'Email'];
      const mapping = service.generateAutoMapping(headers, 'CUSTOMERS');

      const mappedFields = mapping.map((m) => m.mappedField);
      expect(mappedFields).toContain('code');
      expect(mappedFields).toContain('first_name');
      expect(mappedFields).toContain('last_name');
      expect(mappedFields).toContain('mobile');
      expect(mappedFields).toContain('email');
    });
  });

  describe('Job Validation (Dry Run)', () => {
    it('should validate customer rows and capture row-level errors', async () => {
      const job = { id: 'job-1', entity_type: 'CUSTOMERS', status: 'STAGED' };
      jobRepo.findOne.mockResolvedValue(job);

      const rows = [
        { row_number: 1, raw_data: { 'First Name': 'Ali', 'Last Name': 'Rezaei', Mobile: '09121112233' } },
        { row_number: 2, raw_data: { 'First Name': 'Invalid', 'Last Name': '', Mobile: 'invalid-phone' } },
      ];
      rowRepo.find.mockResolvedValue(rows);

      const columnMapping = {
        'First Name': 'first_name',
        'Last Name': 'last_name',
        Mobile: 'mobile',
      };

      const validatedJob = await service.validateJob('job-1', columnMapping);

      expect(validatedJob.valid_rows).toBe(1);
      expect(validatedJob.error_rows).toBe(1);
      expect(validatedJob.error_summary).toHaveLength(2); // Last Name required & Invalid phone
    });
  });

  describe('Seed Profiles & System Reset', () => {
    it('should return available seed profiles', () => {
      const profiles = service.getSeedProfiles();
      expect(profiles).toHaveLength(2);
      expect(profiles[0].id).toBe('MINIMAL');
      expect(profiles[1].id).toBe('DEMO_RESTAURANT');
    });
  });
});
