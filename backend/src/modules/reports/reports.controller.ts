import { Controller, Get, Post, Delete, Body, Param, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ReportsService } from './reports.service';

@Controller('api/v1/reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('catalog')
  async getCatalog() {
    return await this.reportsService.getCatalog();
  }

  @Get('dashboard-summary')
  async getDashboardSummary(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.reportsService.getDashboardSummary(tenantId);
  }

  @Post('query')
  async queryReportPost(@Body('reportCode') reportCode: string, @Body('filters') filters: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.reportsService.queryReport(tenantId, reportCode, filters);
  }

  @Post('export')
  async exportReportPost(
    @Body('reportCode') reportCode: string,
    @Body('filters') filters: any,
    @Body('format') format: 'CSV' | 'XLSX',
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.reportsService.exportReport(tenantId, reportCode, filters, format || 'CSV');
  }

  @Get('saved-views')
  async getSavedViews(@Query('reportCode') reportCode: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.reportsService.getSavedViews(tenantId, reportCode);
  }

  @Post('saved-views')
  async createSavedView(@Body() dto: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId;
    return await this.reportsService.createSavedView(tenantId, userId, dto);
  }

  @Delete('saved-views/:id')
  async deleteSavedView(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.reportsService.deleteSavedView(tenantId, id);
  }

  @Get('audit')
  async getAuditLogs(@Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.reportsService.getAuditLogs(tenantId, query);
  }

  @Get('alerts')
  async getAlerts(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.reportsService.getAlerts(tenantId);
  }

  @Post('alerts/:id/acknowledge')
  async acknowledgeAlert(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId;
    return await this.reportsService.acknowledgeAlert(tenantId, id, userId);
  }

  @Get('report-exports/:id')
  async getExportJob(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.reportsService.getExportJob(tenantId, id);
  }

  @Post(':reportCode/exports')
  async exportReportPath(
    @Param('reportCode') reportCode: string,
    @Body() body: any,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const format = body.format || 'CSV';
    const filters = body.filters || {};
    return await this.reportsService.exportReport(tenantId, reportCode, filters, format);
  }

  // Dynamic parameterized routes MUST be at the bottom
  @Get(':reportCode')
  async queryReportGet(@Param('reportCode') reportCode: string, @Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.reportsService.queryReport(tenantId, reportCode, query);
  }
}
