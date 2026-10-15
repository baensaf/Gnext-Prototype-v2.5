import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { HeadOfficeOnly, MANAGER_AND_ABOVE, Roles } from '../../common/decorators/roles.decorator';
import { BranchOwned } from '../../common/decorators/branch-owned.decorator';
import { effectiveBranchId } from '../../common/utils/user-scope.util';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { Payment } from '../../entities/Payment.entity';
import { TaraService } from './tara.service';
import { TaraPayService } from './tara-pay.service';

class TaraConnectDto {
  @IsString()
  @MaxLength(120)
  username: string;

  /** Left out when only the username changes. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;
}

class TaraBranchCodeDto {
  @IsString()
  @MaxLength(40)
  branchCode: string;
}

class TaraAssignDto {
  @IsOptional()
  @IsUUID()
  registerId?: string | null;
}

class TaraGroupsDto {
  @IsOptional()
  @IsInt()
  defaultGroupId?: number | null;

  @IsOptional()
  @IsObject()
  categoryGroups?: Record<string, number | null>;
}

const tenantOf = (req: Request) => (req as any).tenantId as string;
const userOf = (req: Request) => ((req as any).user?.id || (req as any).userId) as string | undefined;

@Controller('api/v1/tara')
export class TaraController {
  constructor(
    private readonly tara: TaraService,
    private readonly pay: TaraPayService,
  ) {}

  /** The Tara settings page: the chain's login, branch codes and terminals, product groups. */
  @HeadOfficeOnly()
  @Roles(...MANAGER_AND_ABOVE)
  @Get('setup')
  async setup(@Req() req: Request) {
    return await this.tara.getSetup(tenantOf(req));
  }

  @HeadOfficeOnly()
  @Roles(...MANAGER_AND_ABOVE)
  @Put('connection')
  async connect(@Body() body: TaraConnectDto, @Req() req: Request) {
    return await this.tara.connect(tenantOf(req), body, userOf(req));
  }

  @HeadOfficeOnly()
  @Roles(...MANAGER_AND_ABOVE)
  @Delete('connection')
  async disconnect(@Req() req: Request) {
    return await this.tara.disconnect(tenantOf(req), userOf(req));
  }

  @HeadOfficeOnly()
  @Roles(...MANAGER_AND_ABOVE)
  @Put('branches/:branchId')
  async setBranchCode(@Param('branchId') branchId: string, @Body() body: TaraBranchCodeDto, @Req() req: Request) {
    return await this.tara.setBranchCode(tenantOf(req), branchId, body.branchCode, userOf(req));
  }

  @HeadOfficeOnly()
  @Roles(...MANAGER_AND_ABOVE)
  @Put('terminals/:id')
  async assignTerminal(@Param('id') id: string, @Body() body: TaraAssignDto, @Req() req: Request) {
    return await this.tara.assignTerminal(tenantOf(req), id, body.registerId ?? null);
  }

  @HeadOfficeOnly()
  @Roles(...MANAGER_AND_ABOVE)
  @Put('groups')
  async saveGroups(@Body() body: TaraGroupsDto, @Req() req: Request) {
    return await this.tara.saveGroups(tenantOf(req), body);
  }

  @HeadOfficeOnly()
  @Roles(...MANAGER_AND_ABOVE)
  @Post('groups/refresh')
  async refreshGroups(@Req() req: Request) {
    return await this.tara.refreshGroups(tenantOf(req));
  }

  /** Whether the till asking can take Tara for this order. */
  @Get('till')
  async till(@Query('orderId') orderId: string, @Query('branchId') branchId: string, @Req() req: Request) {
    const userBranchId = (req as any).userBranchId as string | undefined;
    return await this.tara.tillStatusFor(tenantOf(req), orderId || null, effectiveBranchId(userBranchId, branchId), userBranchId);
  }

  /** The barcodes the simulated Tara knows, for the Simulation page and the pay panel's hint. */
  @Get('demo-customers')
  demoCustomers() {
    return this.tara.demoCustomers();
  }

  /** A manager asks Tara again about a sale that never got an answer. */
  @Roles(...MANAGER_AND_ABOVE)
  @BranchOwned(Payment, { through: { entity: OrderHeader, foreignKey: 'order_id' } })
  @Post('payments/:id/check')
  async check(@Param('id') id: string, @Req() req: Request) {
    return await this.pay.checkNow(tenantOf(req), id, userOf(req));
  }
}
