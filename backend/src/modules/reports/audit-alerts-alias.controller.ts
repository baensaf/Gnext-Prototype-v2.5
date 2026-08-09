import { Controller, Get, Post, Delete, Body, Param, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { ReportsService } from './reports.service';

@Controller('api/v1')
export class AuditAlertsAliasController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('audit-events')
  async getAuditEvents(@Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.reportsService.getAuditLogs(tenantId, query);
  }

  @Get('audit-events/:id')
  async getAuditEventById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const result = await this.reportsService.getAuditLogs(tenantId, { limit: 100 });
    const match = result.data.find((e: any) => e.id === id);
    return match || result.data[0] || {};
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

  @Get('saved-report-views')
  async getSavedReportViews(@Query('reportCode') reportCode: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.reportsService.getSavedViews(tenantId, reportCode);
  }

  @Post('saved-report-views')
  async createSavedReportView(@Body() dto: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId;
    return await this.reportsService.createSavedView(tenantId, userId, dto);
  }

  @Delete('saved-report-views/:id')
  async deleteSavedReportView(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.reportsService.deleteSavedView(tenantId, id);
  }

  @Get('report-exports/:id')
  async getReportExportJob(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.reportsService.getExportJob(tenantId, id);
  }
}
