import { Controller, Get, Post, Body, Param, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { ReportsService } from './reports.service';

@Controller('api/v1/reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('catalog')
  async getCatalog() {
    return await this.reportsService.getCatalog();
  }

  @Post('query')
  async queryReport(@Body('reportCode') reportCode: string, @Body('filters') filters: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.reportsService.queryReport(tenantId, reportCode, filters);
  }

  @Post('export')
  async exportReport(
    @Body('reportCode') reportCode: string,
    @Body('filters') filters: any,
    @Body('format') format: 'CSV' | 'XLSX',
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.reportsService.exportReport(tenantId, reportCode, filters, format || 'CSV');
  }

  @Get('audit')
  async getAuditLogs(@Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.reportsService.getAuditLogs(tenantId, query);
  }

  @Get('alerts')
  async getAlerts(@Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.reportsService.getAlerts(tenantId);
  }

  @Post('alerts/:id/acknowledge')
  async acknowledgeAlert(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.reportsService.acknowledgeAlert(tenantId, id);
  }
}
