import type { ReactNode, ReactElement } from 'react';
import type { RegisterShiftState } from 'src/components/shift/use-register-shift';

import { useTranslation } from 'react-i18next';
import { useContext, createContext } from 'react';

import { Tooltip } from '@mui/material';

import { kdsApi } from 'src/api/kdsApi';
import { orderApi } from 'src/api/orderApi';
import { dineInApi } from 'src/api/dineInApi';
import { paymentApi } from 'src/api/paymentApi';
import { catalogApi } from 'src/api/catalogApi';
import { approvalApi } from 'src/api/approvalApi';
import { settingsApi } from 'src/api/settingsApi';
import { customerApi } from 'src/api/customerApi';
import { deliveryApi } from 'src/api/deliveryApi';
import { discountsApi } from 'src/api/discountsApi';

import { useRegisterShift } from 'src/components/shift/use-register-shift';

// ----------------------------------------------------------------------

/**
 * What the register can do where it runs. The web POS does all of it; the offline till in
 * the branch agent (HANDOFF-offline-pos.md, decision 7) leaves some out and shows those
 * controls greyed out, so staff see the screen they know.
 */
export type PosFeature =
  | 'delivery' // the delivery order type, its addresses and zones
  | 'customers' // choosing and registering a customer
  | 'discounts' // coupons and manual discounts
  | 'park' // holding a cart as a draft and resuming it
  | 'stop' // taking an item off sale (86) from the tile
  | 'shiftActions' // choosing the register, opening and closing a shift
  | 'receipt'; // printing another copy of the receipt

/**
 * Where the register reads and writes. Each group has the same calls, with the same
 * signatures, as the API module it is named after, so the screens are the same code either
 * way: the web POS talks to the cloud, the offline till to the branch agent's /api/till.
 */
export type PosSource = {
  /** `cloud` is the web POS; `agent` is the offline till served by the branch agent. */
  kind: 'cloud' | 'agent';
  features: Record<PosFeature, boolean>;
  catalog: Pick<
    typeof catalogApi,
    | 'getCategories'
    | 'getProducts'
    | 'getProductById'
    | 'getProductVariants'
    | 'getNoteTemplates'
    | 'getOffScheduleProducts'
    | 'getAvailabilities'
    | 'getBranchPrices'
    | 'getDailyStock'
    | 'posStop'
    | 'posResume'
  >;
  orders: Pick<typeof orderApi, 'getOrders' | 'getOrderById' | 'createOrder' | 'updateDraft' | 'submitOrder' | 'cancelOrder'>;
  tables: Pick<typeof dineInApi, 'getTables'>;
  settings: Pick<typeof settingsApi, 'getReasonCodes' | 'getPaymentMethods'>;
  payments: Pick<typeof paymentApi, 'postPayment' | 'getOrderPayments' | 'voidPayment'>;
  customers: Pick<typeof customerApi, 'getCustomers' | 'createCustomer' | 'getAddresses' | 'createAddress'>;
  delivery: Pick<typeof deliveryApi, 'getZones'>;
  /** The live quote: tax, delivery fee and any discount on the cart. */
  discounts: Pick<typeof discountsApi, 'quoteDiscounts' | 'getManualDiscountLimits'>;
  approvals: Pick<typeof approvalApi, 'createRequest' | 'approveRequest' | 'verifyPin'>;
  printing: Pick<typeof kdsApi, 'reprintOrder'>;
  /**
   * The register this device is and the shift open on it. A hook: a source is fixed for
   * the life of the screen, so it is called on every render in the same order.
   */
  useRegisterShift: () => RegisterShiftState;
};

/** The web POS: the cloud's API modules themselves, so it behaves exactly as before. */
export const cloudPosSource: PosSource = {
  kind: 'cloud',
  features: {
    delivery: true,
    customers: true,
    discounts: true,
    park: true,
    stop: true,
    shiftActions: true,
    receipt: true,
  },
  catalog: catalogApi,
  orders: orderApi,
  tables: dineInApi,
  settings: settingsApi,
  payments: paymentApi,
  customers: customerApi,
  delivery: deliveryApi,
  discounts: discountsApi,
  approvals: approvalApi,
  printing: kdsApi,
  useRegisterShift,
};

const PosSourceContext = createContext<PosSource>(cloudPosSource);

/** Without a provider the register is the web POS. The offline till provides its own. */
export function PosSourceProvider({ source, children }: { source: PosSource; children: ReactNode }) {
  return <PosSourceContext.Provider value={source}>{children}</PosSourceContext.Provider>;
}

export function usePosSource(): PosSource {
  return useContext(PosSourceContext);
}

/**
 * Wraps a control the register can't offer here: the control stays where it is, disabled
 * by the caller, with a tooltip saying why. When the feature is on it renders the child as
 * before, with its own tooltip if it had one (`title`), so the web POS is not touched.
 * `grow` lets a full-width control keep its width.
 */
export function PosFeatureGate({
  off,
  title,
  grow,
  children,
}: {
  off: boolean;
  title?: ReactNode;
  grow?: boolean;
  children: ReactElement;
}) {
  const { t } = useTranslation();
  if (!off) return title ? <Tooltip title={title}>{children}</Tooltip> : children;
  return (
    <Tooltip title={t('pos.offline.unavailable')}>
      {/* A disabled control fires no pointer events, so the tooltip listens on a wrapper. */}
      <span style={{ display: 'inline-flex', flexShrink: 0, ...(grow ? { flexGrow: 1, minWidth: 0 } : {}) }}>
        {children}
      </span>
    </Tooltip>
  );
}
