import { Injectable } from '@nestjs/common';
import { DiscountEvaluationService, DiscountQuoteResult } from './discount-evaluation.service';
import { DiscountQuoteRequestDto } from './dtos/discounts.dto';

/** Quotes and the manual discount limits; group discounts live in CustomerGroupsService. */
@Injectable()
export class DiscountsService {
  constructor(private readonly evaluationService: DiscountEvaluationService) {}

  async evaluateQuote(tenantId: string, request: DiscountQuoteRequestDto, callerRole?: string | null): Promise<DiscountQuoteResult> {
    return await this.evaluationService.evaluateQuote(tenantId, request, callerRole);
  }

  async getManualDiscountLimits(tenantId: string, callerRole?: string | null) {
    return await this.evaluationService.getManualDiscountLimits(tenantId, callerRole);
  }
}
