import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ImportJob, ImportEntityType } from '../../entities/ImportJob.entity';
import { ImportRow } from '../../entities/ImportRow.entity';
import { Customer } from '../../entities/Customer.entity';
import { Product } from '../../entities/Product.entity';
import { Category } from '../../entities/Category.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { MoneyUtil } from '../../common/utils/money.util';

export interface AutoMapResult {
  header: string;
  mappedField: string | null;
  confidence: number;
}

const FIELD_DICTIONARIES: Record<ImportEntityType, Record<string, string[]>> = {
  CUSTOMERS: {
    code: ['code', 'customer code', 'id', 'کد مشتری', 'شناسه', 'کد'],
    first_name: ['first_name', 'first name', 'given name', 'نام', 'نام کوچک'],
    last_name: ['last_name', 'last name', 'surname', 'نام خانوادگی', 'فامیلی'],
    mobile: ['mobile', 'phone', 'cell', 'telephone', 'mobile_number', 'موبایل', 'شماره تماس', 'تلفن'],
    email: ['email', 'e-mail', 'ایمیل', 'پست الکترونیک'],
    national_id: ['national_id', 'national code', 'national id', 'ssn', 'کد ملی', 'شناسه ملی'],
    is_active: ['is_active', 'status', 'active', 'وضعیت', 'فعال'],
  },
  PRODUCTS: {
    code: ['code', 'product code', 'sku', 'کد کالا', 'شناسه محصول', 'کد'],
    name_fa: ['name_fa', 'name (fa)', 'persian name', 'title', 'name', 'نام فارسی', 'نام کالا', 'عنوان'],
    name_en: ['name_en', 'name (en)', 'english name', 'english title', 'title en', 'نام انگلیسی'],
    category_code: ['category_code', 'category', 'group', 'category code', 'کد دسته بندی', 'دسته بندی'],
    base_price: ['base_price', 'price', 'cost', 'base price', 'قیمت پایه', 'قیمت'],
    is_active: ['is_active', 'status', 'active', 'وضعیت', 'فعال'],
  },
  CATEGORIES: {
    code: ['code', 'category code', 'کد دسته بندی', 'کد'],
    name_fa: ['name_fa', 'title', 'name', 'نام فارسی', 'نام دسته بندی', 'عنوان'],
    name_en: ['name_en', 'title en', 'english name', 'نام انگلیسی'],
    sort_order: ['sort_order', 'order', 'sort', 'ترتیب'],
    is_active: ['is_active', 'status', 'active', 'وضعیت', 'فعال'],
  },
};

@Injectable()
export class ImportExportService {
  constructor(
    @InjectRepository(ImportJob)
    private readonly jobRepo: Repository<ImportJob>,
    @InjectRepository(ImportRow)
    private readonly rowRepo: Repository<ImportRow>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
    private readonly dataSource: DataSource,
    private readonly auditWriter: AuditWriter,
  ) {}

  /**
   * Parse CSV/Excel data buffer or text content into header array and data object rows.
   */
  parseRawContent(fileContent: string): { headers: string[]; rows: Record<string, any>[] } {
    const lines = fileContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      throw new BadRequestException('File is empty');
    }

    // Determine delimiter (comma, semicolon, tab)
    const firstLine = lines[0];
    let delimiter = ',';
    if (firstLine.includes('\t')) delimiter = '\t';
    else if (firstLine.includes(';')) delimiter = ';';

    const headers = firstLine.split(delimiter).map((h) => h.replace(/^["']|["']$/g, '').trim());
    const rows: Record<string, any>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(delimiter).map((p) => p.replace(/^["']|["']$/g, '').trim());
      if (parts.length === 0 || (parts.length === 1 && parts[0] === '')) continue;

      const rowObj: Record<string, any> = {};
      headers.forEach((h, idx) => {
        rowObj[h] = parts[idx] !== undefined ? parts[idx] : '';
      });
      rows.push(rowObj);
    }

    return { headers, rows };
  }

  /**
   * Upload & stage spreadsheet file
   */
  async createStagedJob(
    tenantId: string,
    entityType: ImportEntityType,
    fileName: string,
    fileContent: string,
  ): Promise<ImportJob> {
    const { headers, rows } = this.parseRawContent(fileContent);

    const autoMapping = this.generateAutoMapping(headers, entityType);
    const mappingObj: Record<string, string> = {};
    autoMapping.forEach((m) => {
      if (m.mappedField) {
        mappingObj[m.header] = m.mappedField;
      }
    });

    const job = this.jobRepo.create({
      tenant_id: tenantId,
      entity_type: entityType,
      file_name: fileName,
      status: 'STAGED',
      total_rows: rows.length,
      valid_rows: 0,
      error_rows: 0,
      column_mapping: mappingObj,
      value_mapping: {},
    });

    const savedJob = await this.jobRepo.save(job);

    const importRows = rows.map((r, idx) =>
      this.rowRepo.create({
        job_id: savedJob.id,
        row_number: idx + 1,
        raw_data: r,
        status: 'STAGED',
      }),
    );

    await this.rowRepo.save(importRows);

    return savedJob;
  }

  /**
   * Auto-mapping engine with fuzzy/dictionary matching heuristics
   */
  generateAutoMapping(headers: string[], entityType: ImportEntityType): AutoMapResult[] {
    const dictionary = FIELD_DICTIONARIES[entityType] || {};
    const results: AutoMapResult[] = [];

    const assignedFields = new Set<string>();

    headers.forEach((header) => {
      const normalizedHeader = header.toLowerCase().trim();
      let bestMatch: string | null = null;
      let highestConfidence = 0;

      for (const [fieldName, synonyms] of Object.entries(dictionary)) {
        if (assignedFields.has(fieldName)) continue;

        for (const synonym of synonyms) {
          const normSyn = synonym.toLowerCase().trim();
          if (normalizedHeader === normSyn) {
            bestMatch = fieldName;
            highestConfidence = 100;
            break;
          } else if (normalizedHeader.includes(normSyn) || normSyn.includes(normalizedHeader)) {
            if (highestConfidence < 85) {
              bestMatch = fieldName;
              highestConfidence = 85;
            }
          }
        }
        if (highestConfidence === 100) break;
      }

      if (bestMatch && highestConfidence >= 70) {
        assignedFields.add(bestMatch);
      } else {
        bestMatch = null;
        highestConfidence = 0;
      }

      results.push({
        header,
        mappedField: bestMatch,
        confidence: highestConfidence,
      });
    });

    return results;
  }

  /**
   * Extract distinct raw values for mapped enum/lookup columns
   */
  async extractDistinctValues(jobId: string, columnMapping: Record<string, string>): Promise<Record<string, string[]>> {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Import job not found');

    const rows = await this.rowRepo.find({ where: { job_id: jobId } });
    const result: Record<string, Set<string>> = {};

    Object.entries(columnMapping).forEach(([header, targetField]) => {
      if (['is_active', 'category_code', 'customer_group_id'].includes(targetField)) {
        result[targetField] = new Set<string>();
      }
    });

    rows.forEach((r) => {
      Object.entries(columnMapping).forEach(([header, targetField]) => {
        if (result[targetField]) {
          const val = r.raw_data[header];
          if (val !== undefined && val !== null && String(val).trim() !== '') {
            result[targetField].add(String(val).trim());
          }
        }
      });
    });

    const finalResult: Record<string, string[]> = {};
    Object.entries(result).forEach(([field, setVal]) => {
      finalResult[field] = Array.from(setVal);
    });

    return finalResult;
  }

  /**
   * Perform row-by-row dry-run validation
   */
  async validateJob(
    jobId: string,
    columnMapping: Record<string, string>,
    valueMapping: Record<string, Record<string, string>> = {},
  ): Promise<ImportJob> {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Import job not found');

    const rows = await this.rowRepo.find({ where: { job_id: jobId }, order: { row_number: 'ASC' } });

    let validCount = 0;
    let errorCount = 0;
    const errorSummary: Array<{ row: number; column: string; message: string }> = [];

    const updatedRows: ImportRow[] = [];

    for (const r of rows) {
      const errors: string[] = [];
      const parsedData: Record<string, any> = {};

      Object.entries(columnMapping).forEach(([header, targetField]) => {
        let rawVal = r.raw_data[header];
        if (rawVal !== undefined && rawVal !== null) {
          rawVal = String(rawVal).trim();
        } else {
          rawVal = '';
        }

        // Apply value mapping if present
        if (valueMapping[targetField] && valueMapping[targetField][rawVal] !== undefined) {
          rawVal = valueMapping[targetField][rawVal];
        }

        parsedData[targetField] = rawVal;
      });

      // Domain Schema Validation per Entity
      if (job.entity_type === 'CUSTOMERS') {
        if (!parsedData.first_name) errors.push('First Name is required');
        if (!parsedData.last_name) errors.push('Last Name is required');
        if (!parsedData.mobile) errors.push('Mobile phone is required');
        else if (!/^(\+?\d{10,15}|09\d{9})$/.test(parsedData.mobile)) errors.push('Invalid phone number format');
      } else if (job.entity_type === 'PRODUCTS') {
        if (!parsedData.code) errors.push('Product Code is required');
        if (!parsedData.name_fa && !parsedData.name) errors.push('Product Name is required');
        if (parsedData.base_price === undefined || parsedData.base_price === '') {
          errors.push('Base price must be a valid number');
        } else {
          try {
            const priceStr = MoneyUtil.format(parsedData.base_price, 4);
            if (MoneyUtil.lessThan(priceStr, '0')) {
              errors.push('Base price cannot be negative');
            }
          } catch {
            errors.push('Base price must be a valid number');
          }
        }
      } else if (job.entity_type === 'CATEGORIES') {
        if (!parsedData.code) errors.push('Category Code is required');
        if (!parsedData.name_fa && !parsedData.name) errors.push('Category Name is required');
      }

      if (errors.length === 0) {
        r.status = 'VALID';
        r.errors = [];
        validCount++;
      } else {
        r.status = 'INVALID';
        r.errors = errors;
        errorCount++;
        errors.forEach((msg) => {
          errorSummary.push({ row: r.row_number, column: job.entity_type, message: msg });
        });
      }

      r.parsed_data = parsedData;
      updatedRows.push(r);
    }

    await this.rowRepo.save(updatedRows);

    job.status = 'VALIDATED';
    job.column_mapping = columnMapping;
    job.value_mapping = valueMapping;
    job.valid_rows = validCount;
    job.error_rows = errorCount;
    job.error_summary = errorSummary;

    return await this.jobRepo.save(job);
  }

  /**
   * Fetch import job with full row details
   */
  async getJobWithRows(jobId: string): Promise<{ job: ImportJob; rows: ImportRow[] }> {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Import job not found');
    const rows = await this.rowRepo.find({ where: { job_id: jobId }, order: { row_number: 'ASC' } });
    return { job, rows };
  }

  /**
   * Execute atomic batch database insertion for validated rows
   */
  async executeJob(jobId: string, userId: string): Promise<{ importedCount: number; failedCount: number }> {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Import job not found');

    const validRows = await this.rowRepo.find({ where: { job_id: jobId, status: 'VALID' } });

    let importedCount = 0;
    let failedCount = 0;

    await this.dataSource.transaction(async (manager) => {
      for (const row of validRows) {
        try {
          const data = row.parsed_data || {};
          const tenantId = job.tenant_id;

          if (job.entity_type === 'CUSTOMERS') {
            const customerCode = data.code || `CUST-IMP-${Date.now().toString().slice(-6)}-${row.row_number}`;
            let customer = await manager.findOne(Customer, { where: { tenant_id: tenantId, code: customerCode } });

            const isActive = data.is_active === 'false' || data.is_active === '0' || data.is_active === 'غیرفعال' ? false : true;

            if (!customer) {
              customer = manager.create(Customer, {
                tenant_id: tenantId,
                code: customerCode,
                first_name: data.first_name,
                last_name: data.last_name,
                mobile: data.mobile,
                email: data.email || null,
                national_id: data.national_id || null,
                is_active: isActive,
                created_by: userId,
              });
            } else {
              customer.first_name = data.first_name;
              customer.last_name = data.last_name;
              customer.mobile = data.mobile;
              if (data.email) customer.email = data.email;
              if (data.national_id) customer.national_id = data.national_id;
              customer.is_active = isActive;
              customer.updated_by = userId;
            }
            await manager.save(customer);
          } else if (job.entity_type === 'PRODUCTS') {
            let product = await manager.findOne(Product, { where: { tenant_id: tenantId, code: data.code } });
            const isActive = data.is_active === 'false' || data.is_active === '0' ? false : true;
            const priceStr = MoneyUtil.format(data.base_price || '0', 4);
            const productName = data.name_fa || data.name_en || data.name || 'Imported Product';

            let catId: string | null = null;
            if (data.category_code) {
              const cat = await manager.findOne(Category, { where: { tenant_id: tenantId, code: data.category_code } });
              if (cat) catId = cat.id;
            }

            if (!catId) {
              const defaultCat = await manager.findOne(Category, { where: { tenant_id: tenantId } });
              catId = defaultCat?.id || null;
            }

            if (!product) {
              product = manager.create(Product, {
                tenant_id: tenantId,
                code: data.code,
                name: productName,
                category_id: catId || undefined,
                base_price: priceStr,
                is_active: isActive,
              });
            } else {
              product.name = productName;
              if (catId) product.category_id = catId;
              product.base_price = priceStr;
              product.is_active = isActive;
            }
            await manager.save(product);
          } else if (job.entity_type === 'CATEGORIES') {
            let category = await manager.findOne(Category, { where: { tenant_id: tenantId, code: data.code } });
            const isActive = data.is_active === 'false' || data.is_active === '0' ? false : true;
            const categoryName = data.name_fa || data.name_en || data.name || 'Imported Category';

            if (!category) {
              category = manager.create(Category, {
                tenant_id: tenantId,
                code: data.code,
                name: categoryName,
                sort_order: Number(data.sort_order || 0),
                is_active: isActive,
              });
            } else {
              category.name = categoryName;
              category.sort_order = Number(data.sort_order || category.sort_order);
              category.is_active = isActive;
            }
            await manager.save(category);
          }

          row.status = 'IMPORTED';
          await manager.save(row);
          importedCount++;
        } catch (err) {
          failedCount++;
          row.status = 'INVALID';
          row.errors = [(err as Error).message];
          await manager.save(row);
        }
      }
    });

    job.status = 'COMPLETED';
    await this.jobRepo.save(job);

    await this.auditWriter.write({
      tenantId: job.tenant_id,
      actorType: 'ADMIN',
      actorId: userId,
      action: 'IMPORT_COMPLETED',
      entityType: job.entity_type,
      entityId: job.id,
      correlationId: `IMP-${Date.now()}`,
      afterData: { importedCount, failedCount, fileName: job.file_name },
    });

    return { importedCount, failedCount };
  }

  /**
   * System Reset: Clear operational data
   */
  async systemReset(tenantId: string, userId: string): Promise<{ resetTables: string[] }> {
    const resetTables = [
      'order_item_option',
      'order_item',
      'order_header',
      'payment_allocation',
      'payment_attempt',
      'payment',
      'refund_allocation',
      'refund_item',
      'refund_request',
      'cash_drawer_transaction',
      'cash_drawer_shift',
      'customer_credit_transaction',
      'delivery_assignment',
      'courier_settlement_line',
      'courier_settlement',
      'kitchen_ticket_item',
      'kitchen_ticket',
      'table_event',
      'table_session',
      'offline_queue_item',
      'sync_conflict_record',
      'import_row',
      'import_job',
    ];

    await this.dataSource.transaction(async (manager) => {
      for (const table of resetTables) {
        const cols = await manager.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = 'tenant_id'`,
          [table],
        );
        if (cols && cols.length > 0) {
          await manager.query(`DELETE FROM "${table}" WHERE tenant_id = $1`, [tenantId]);
        } else {
          await manager.query(`DELETE FROM "${table}"`);
        }
      }
    });

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId: userId,
      action: 'SYSTEM_DATA_RESET',
      entityType: 'SYSTEM',
      entityId: tenantId,
      correlationId: `RESET-${Date.now()}`,
      afterData: { resetTables },
    });

    return { resetTables };
  }

  /**
   * Apply database seed profile
   */
  async applySeedProfile(tenantId: string, userId: string, profileId: string): Promise<{ success: boolean; profile: string }> {
    if (profileId === 'DEMO_RESTAURANT') {
      let burgerCat = await this.categoryRepo.findOne({ where: { tenant_id: tenantId, code: 'CAT-BURGER' } });
      if (!burgerCat) {
        burgerCat = await this.categoryRepo.save(this.categoryRepo.create({
          tenant_id: tenantId,
          code: 'CAT-BURGER',
          name: 'Burgers & Sandwiches',
          sort_order: 1,
          is_active: true,
        }));
      }

      let p1 = await this.productRepo.findOne({ where: { tenant_id: tenantId, code: 'PROD-BURGER-01' } });
      if (!p1) {
        await this.productRepo.save(this.productRepo.create({
          tenant_id: tenantId,
          code: 'PROD-BURGER-01',
          name: 'Special House Burger',
          category_id: burgerCat.id,
          base_price: '250000.0000',
          is_active: true,
        }));
      }
    }

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId: userId,
      action: 'SYSTEM_SEED_APPLIED',
      entityType: 'SYSTEM',
      entityId: tenantId,
      correlationId: `SEED-${Date.now()}`,
      afterData: { profileId },
    });

    return { success: true, profile: profileId };
  }

  /**
   * Get Available Seed Profiles
   */
  getSeedProfiles() {
    return [
      {
        id: 'MINIMAL',
        name: 'Minimal Base Profile',
        description: 'Default baseline setup with single tenant, master branch, default terminal, and currency.',
      },
      {
        id: 'DEMO_RESTAURANT',
        name: 'Demo Restaurant & Quick Service',
        description: 'Populates sample categories (Burgers, Drinks, Combos), products, pricing, and initial stock.',
      },
    ];
  }
}
