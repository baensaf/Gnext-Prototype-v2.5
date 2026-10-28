import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import { Request } from 'express';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { HeadOfficeOnly, MANAGER_AND_ABOVE, Roles } from '../../common/decorators/roles.decorator';
import { SNAPPFOOD_MODES, SnappfoodMode } from '../../entities/SnappfoodConnection.entity';
import { SnappfoodSetupService } from './snappfood-setup.service';

class SnappfoodBranchDto {
  @IsIn(SNAPPFOOD_MODES as unknown as string[])
  mode: SnappfoodMode;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  vendorCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  clientId?: string | null;

  /** Left out to keep the one saved. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientSecret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  username?: string | null;

  /** Left out to keep the one saved. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;
}

class SnappfoodHmacDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  secret?: string | null;
}

const tenantOf = (req: Request) => (req as any).tenantId as string;
const userOf = (req: Request) => ((req as any).user?.id || (req as any).userId) as string | undefined;

/** The Snappfood settings page: the webhook address to give Snappfood, and each branch's account. */
@Controller('api/v1/snappfood')
export class SnappfoodSetupController {
  constructor(private readonly setup: SnappfoodSetupService) {}

  @HeadOfficeOnly()
  @Roles(...MANAGER_AND_ABOVE)
  @Get('setup')
  async getSetup(@Req() req: Request) {
    return await this.setup.getSetup(tenantOf(req));
  }

  @HeadOfficeOnly()
  @Roles(...MANAGER_AND_ABOVE)
  @Post('webhook/rotate')
  async rotate(@Req() req: Request) {
    return await this.setup.rotateToken(tenantOf(req), userOf(req));
  }

  @HeadOfficeOnly()
  @Roles(...MANAGER_AND_ABOVE)
  @Put('webhook/hmac')
  async setHmac(@Body() body: SnappfoodHmacDto, @Req() req: Request) {
    return await this.setup.setHmacSecret(tenantOf(req), body.secret ?? null, userOf(req));
  }

  @HeadOfficeOnly()
  @Roles(...MANAGER_AND_ABOVE)
  @Put('branches/:branchId')
  async saveBranch(@Param('branchId') branchId: string, @Body() body: SnappfoodBranchDto, @Req() req: Request) {
    return await this.setup.saveBranch(tenantOf(req), branchId, body, userOf(req));
  }

  @HeadOfficeOnly()
  @Roles(...MANAGER_AND_ABOVE)
  @Post('branches/:branchId/test')
  async test(@Param('branchId') branchId: string, @Req() req: Request) {
    return await this.setup.testBranch(tenantOf(req), branchId);
  }
}
