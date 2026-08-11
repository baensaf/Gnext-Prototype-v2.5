import { Controller, Post, Get, Param, Body, Req, Query, UseInterceptors, UploadedFile, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { ImportExportService, AutoMapResult } from './import-export.service';
import { ApprovalService } from '../approval/approval.service';
import { ImportEntityType } from '../../entities/ImportJob.entity';

@Controller('api/v1')
export class ImportExportController {
  constructor(
    private readonly importExportService: ImportExportService,
    private readonly approvalService: ApprovalService,
  ) {}

  @Post('import/upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: any,
    @Body('entityType') entityType: ImportEntityType,
    @Body('fileContent') fileContentString?: string,
    @Req() req?: Request,
  ) {
    const tenantId = (req as any)?.tenantId;

    let content = fileContentString;
    let originalName = 'import_file.csv';

    if (file) {
      content = file.buffer.toString('utf-8');
      originalName = file.originalname;
    }

    if (!content) {
      throw new BadRequestException('File or fileContent is required');
    }
    if (!entityType || !['CUSTOMERS', 'PRODUCTS', 'CATEGORIES'].includes(entityType)) {
      throw new BadRequestException('Valid entityType (CUSTOMERS, PRODUCTS, CATEGORIES) is required');
    }

    const job = await this.importExportService.createStagedJob(tenantId, entityType, originalName, content);
    return { success: true, data: job };
  }

  @Get('import/job/:id')
  async getJobDetail(@Param('id') id: string) {
    const data = await this.importExportService.getJobWithRows(id);
    return { success: true, data };
  }

  @Post('import/auto-map')
  async autoMapHeaders(@Body() body: { headers: string[]; entityType: ImportEntityType }) {
    if (!body.headers || !body.entityType) {
      throw new BadRequestException('headers and entityType are required');
    }
    const mapping = this.importExportService.generateAutoMapping(body.headers, body.entityType);
    return { success: true, data: mapping };
  }

  @Post('import/distinct-values')
  async getDistinctValues(@Body() body: { jobId: string; columnMapping: Record<string, string> }) {
    if (!body.jobId || !body.columnMapping) {
      throw new BadRequestException('jobId and columnMapping are required');
    }
    const values = await this.importExportService.extractDistinctValues(body.jobId, body.columnMapping);
    return { success: true, data: values };
  }

  @Post('import/validate')
  async validateJob(@Body() body: { jobId: string; columnMapping: Record<string, string>; valueMapping?: Record<string, Record<string, string>> }) {
    if (!body.jobId || !body.columnMapping) {
      throw new BadRequestException('jobId and columnMapping are required');
    }
    const job = await this.importExportService.validateJob(body.jobId, body.columnMapping, body.valueMapping);
    return { success: true, data: job };
  }

  @Post('import/execute')
  async executeJob(@Body() body: { jobId: string }, @Req() req: Request) {
    if (!body.jobId) {
      throw new BadRequestException('jobId is required');
    }
    const userId = (req as any)?.user?.id;
    if (!userId) {
      throw new UnauthorizedException('User session required');
    }
    const result = await this.importExportService.executeJob(body.jobId, userId);
    return { success: true, data: result };
  }

  @Post('system/reset')
  async resetSystemData(@Body() body: { pin?: string }, @Req() req: Request) {
    const tenantId = (req as any)?.tenantId;
    const userId = (req as any)?.user?.id;
    if (!userId) {
      throw new UnauthorizedException('User session required');
    }
    if (!body.pin) {
      throw new BadRequestException('Manager PIN is required for system reset');
    }

    await this.approvalService.verifyManagerPin(tenantId, userId, body.pin, 'SYSTEM_RESET');
    const result = await this.importExportService.systemReset(tenantId, userId);
    return { success: true, data: result };
  }

  @Get('system/seed-profiles')
  getSeedProfiles() {
    const profiles = this.importExportService.getSeedProfiles();
    return { success: true, data: profiles };
  }

  @Post('system/apply-seed')
  async applySeedProfile(@Body() body: { pin?: string; profileId?: string }, @Req() req: Request) {
    const tenantId = (req as any)?.tenantId;
    const userId = (req as any)?.user?.id;
    if (!userId) {
      throw new UnauthorizedException('User session required');
    }
    if (!body.pin || !body.profileId) {
      throw new BadRequestException('Manager PIN and profileId are required');
    }

    await this.approvalService.verifyManagerPin(tenantId, userId, body.pin, 'SYSTEM_SEED');
    const result = await this.importExportService.applySeedProfile(tenantId, userId, body.profileId);
    return { success: true, data: result };
  }
}
