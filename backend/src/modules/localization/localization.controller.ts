import { Controller, Get, Put, Post, Query, Body, Req, Res, Header } from '@nestjs/common';
import { Request, Response } from 'express';
import { LocalizationService } from './localization.service';
import { HeadOfficeOnly } from '../../common/decorators/roles.decorator';

@Controller('api/v1/localization')
export class LocalizationController {
  constructor(private readonly localizationService: LocalizationService) {}

  @Get('strings')
  async getStrings(
    @Query('entityType') entityType: string,
    @Query('entityId') entityId: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.localizationService.getStringsForEntity(tenantId, entityType, entityId);
  }

  @Get('bilingual-map')
  async getBilingualMap(
    @Query('entityType') entityType: string,
    @Query('entityId') entityId: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.localizationService.getBilingualMap(tenantId, entityType, entityId);
  }

  @HeadOfficeOnly()
  @Put('strings')
  async upsertStrings(@Body() body: { strings: any[] }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.localizationService.upsertStrings(tenantId, body.strings || []);
  }

  @Get('translations/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="translations.csv"')
  async exportCsv(@Req() req: Request, @Res() res: Response) {
    const tenantId = (req as any).tenantId;
    const csvContent = await this.localizationService.exportCsv(tenantId);
    return res.status(200).send(csvContent);
  }

  @HeadOfficeOnly()
  @Post('translations/import')
  async importCsv(@Body() body: { csv: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.localizationService.importCsv(tenantId, body.csv || '');
  }
}
