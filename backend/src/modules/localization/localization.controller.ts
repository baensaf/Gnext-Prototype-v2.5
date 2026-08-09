import { Controller, Get, Put, Query, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { LocalizationService } from './localization.service';

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

  @Put('strings')
  async upsertStrings(@Body() body: { strings: any[] }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.localizationService.upsertStrings(tenantId, body.strings || []);
  }
}
