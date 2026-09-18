import { PriceListService } from '../../src/modules/catalog/price-lists.service';
import { inStorePrice } from '../../src/common/utils/price-list.util';

/**
 * A PriceListService for unit tests where no branch is on a price list: everything sells at
 * its base price (the size's, else the product's).
 */
export function basePriceLists() {
  return {
    provide: PriceListService,
    useValue: {
      listForBranch: jest.fn().mockResolvedValue(null),
      pricesForBranch: jest.fn().mockResolvedValue(new Map()),
      resolveInStorePrice: jest.fn(async (_tenantId: string, _branchId: string, product: any, variant: any) =>
        inStorePrice(new Map(), product, variant),
      ),
    },
  };
}
