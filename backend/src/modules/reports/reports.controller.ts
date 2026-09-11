import { Controller, Get, Post, Delete, Body, Param, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ReportsService } from './reports.service';
import { UserScope, effectiveBranchId } from '../../common/utils/user-scope.util';

/** The signed-in account's scope, as the session guard recorded it. */
function actorScope(req: Request): UserScope {
  return { role: (req as any).userRole, branchId: (req as any).userBranchId ?? null };
}

@Controller('api/v1/reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('catalog')
  async getCatalog(@Req() req: Request) {
    return await this.reportsService.getCatalog(actorScope(req));
  }

  /**
   * A branch account always gets its own site. Head office gets the branch it has switched
   * into, so the dashboard agrees with the header, and the chain when it names none.
   */
  @Get('dashboard-summary')
  async getDashboardSummary(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.reportsService.getDashboardSummary(
      tenantId,
      effectiveBranchId((req as any).userBranchId, branchId),
    );
  }

  @Post('query')
  async queryReportPost(@Body('reportCode') reportCode: string, @Body('filters') filters: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.reportsService.queryReport(tenantId, reportCode, filters, actorScope(req));
  }

  @Post('export')
  async exportReportPost(
    @Body('reportCode') reportCode: string,
    @Body('filters') filters: any,
    @Body('format') format: 'CSV' | 'XLSX',
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.reportsService.exportReport(tenantId, reportCode, filters, format || 'CSV', actorScope(req));
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
    return await this.reportsService.getAuditLogs(tenantId, query, (req as any).userBranchId ?? undefined);
  }

  @Get('alerts')
  async getAlerts(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.reportsService.getAlerts(tenantId, (req as any).userBranchId ?? undefined);
  }

  @Post('alerts/:id/acknowledge')
  async acknowledgeAlert(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId;
    return await this.reportsService.acknowledgeAlert(tenantId, id, userId, (req as any).userBranchId ?? undefined);
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
    return await this.reportsService.exportReport(tenantId, reportCode, filters, format, actorScope(req));
  }

  // Dynamic parameterized routes MUST be at the bottom
  @Get(':reportCode')
  async queryReportGet(@Param('reportCode') reportCode: string, @Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.reportsService.queryReport(tenantId, reportCode, query, actorScope(req));
  }
}
