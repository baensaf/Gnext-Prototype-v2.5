import { useTranslation } from 'react-i18next';

import BuildIcon from '@mui/icons-material/Build';
import ListAltIcon from '@mui/icons-material/ListAlt';
import StorefrontIcon from '@mui/icons-material/Storefront';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';

import { useWorkspaceScope } from 'src/contexts/branch-context';
import { useAuthStore, useIsHeadOffice } from 'src/store/useAuthStore';

import { canReachPath, fitsWorkspace } from './role-access';

/**
 * Every settings destination the Settings page lists. Kept apart from the page so the
 * header search can offer the same links: most of these have no sidebar link, and a search
 * that only knew the sidebar could not find Business Day or Calendar at all.
 */

/**
 * Who decides the value.
 * - `ORG`: head office, once, for every branch. Not listed inside a branch, which cannot
 *   change it.
 * - `INHERITED`: head office sets the chain's default and a branch may set its own (the
 *   server's BRANCH_OVERRIDABLE_SETTING_GROUPS). The page itself shows which applies.
 * - `BRANCH`: each branch keeps its own; nothing to inherit.
 */
export type SettingScope = 'BRANCH' | 'INHERITED' | 'ORG';

export interface SettingItem {
  /** Not shown on the page; the header search and the link's tooltip read it. */
  description: string;
  id: string;
  path: string;
  scope: SettingScope;
  tags: string[];
  title: string;
}

export interface SettingCategory {
  categoryDescription: string;
  categoryTitle: string;
  icon: React.ReactNode;
  id: string;
  items: SettingItem[];
}

export function useSettingsCatalogue(): SettingCategory[] {
  const { t } = useTranslation();

  return [
    {
      id: 'business',
      categoryTitle: t('settings.hub.domains.business.title', 'Business'),
      categoryDescription: t(
        'settings.hub.domains.business.description',
        'The chain’s profile, dates and branches.'
      ),
      icon: <StorefrontIcon />,
      items: [
        {
          id: 'general',
          scope: 'ORG',
          title: t('settings.hub.items.general.title', 'Business profile'),
          description: t(
            'settings.hub.items.general.description',
            'The chain’s name and code, its default language and its time zone.'
          ),
          path: '/app/settings/general',
          tags: ['general', 'tenant', 'timezone', 'locale', 'language', 'organization', 'profile', 'عمومی', 'سازمان', 'زبان', 'منطقه زمانی', 'مشخصات'],
        },
        {
          id: 'calendar',
          scope: 'ORG',
          title: t('settings.hub.items.calendar.title', 'Calendar'),
          description: t(
            'settings.hub.items.calendar.description',
            'Jalali or Gregorian dates across the chain, and the first day of the week.'
          ),
          path: '/app/settings/calendar',
          tags: ['calendar', 'jalali', 'shamsi', 'gregorian', 'date', 'week', 'تقویم', 'شمسی', 'میلادی', 'تاریخ'],
        },
        {
          id: 'businessDay',
          scope: 'ORG',
          title: t('settings.hub.items.businessDay.title', 'Business Day'),
          description: t(
            'settings.hub.items.businessDay.description',
            'When the business day turns over for the whole chain (05:00 by default). Each day closes by itself.'
          ),
          path: '/app/settings/business-day',
          tags: ['business day', 'cutoff', 'overnight', 'day close', 'روز کاری', 'پایان روز', 'بستن روز'],
        },
        {
          id: 'branches',
          scope: 'ORG',
          title: t('settings.hub.items.branches.title', 'Branches'),
          description: t(
            'settings.hub.items.branches.description',
            'The chain’s branches: details, opening hours, location and status.'
          ),
          path: '/app/operations/branches',
          tags: ['branches', 'stores', 'hours', 'locations', 'opening hours', 'شعب', 'شعبه', 'فروشگاه', 'ساعات کاری'],
        },
      ],
    },
    {
      id: 'people',
      categoryTitle: t('settings.hub.domains.people.title', 'People & permissions'),
      categoryDescription: t(
        'settings.hub.domains.people.description',
        'Who signs in, what each role may do, and what needs a manager’s PIN.'
      ),
      icon: <ManageAccountsIcon />,
      items: [
        {
          id: 'users',
          scope: 'ORG',
          title: t('settings.hub.items.users.title', 'Users'),
          description: t(
            'settings.hub.items.users.description',
            'Every account, its role and branch, and who may approve.'
          ),
          path: '/app/settings/users',
          tags: ['users', 'accounts', 'staff', 'employees', 'pin', 'کاربران', 'حساب', 'کارکنان', 'پین'],
        },
        {
          id: 'roles',
          scope: 'ORG',
          title: t('settings.hub.items.roles.title', 'Roles & Permissions'),
          description: t(
            'settings.hub.items.roles.description',
            'What each role may see and do in a branch, and what stays with head office.'
          ),
          path: '/app/settings/roles',
          tags: ['roles', 'permissions', 'access', 'cashier', 'manager', 'head office', 'نقش', 'دسترسی', 'مجوز', 'صندوق‌دار'],
        },
        {
          id: 'approvals',
          scope: 'ORG',
          title: t('settings.hub.items.approvals.title', 'Approvals'),
          description: t(
            'settings.hub.items.approvals.description',
            'Which actions need a manager’s PIN, above what amount, and who may give it.'
          ),
          path: '/app/settings/approvals',
          tags: ['approvals', 'manager', 'security', 'limits', 'overrides', 'policy', 'pin', 'تایید', 'مدیر', 'امنیت', 'سقف مجاز', 'پین'],
        },
        {
          id: 'discountAuthorizations',
          scope: 'ORG',
          title: t('settings.hub.items.discountAuthorizations.title', 'Manual discount limits'),
          description: t(
            'settings.hub.items.discountAuthorizations.description',
            'How much manual discount a cashier, supervisor or manager may give, as a percentage or an amount.'
          ),
          path: '/app/settings/discount-authorizations',
          tags: ['discounts', 'authorizations', 'roles', 'limits', 'cashier', 'supervisor', 'manager', 'caps', 'تخفیف', 'سقف اختیارات', 'صندوق‌دار'],
        },
      ],
    },
    {
      id: 'selling',
      categoryTitle: t('settings.hub.domains.selling.title', 'Orders & payments'),
      categoryDescription: t(
        'settings.hub.domains.selling.description',
        'How orders flow, how drawers open, and how customers pay.'
      ),
      icon: <ReceiptLongIcon />,
      items: [
        {
          id: 'orderWorkflow',
          scope: 'INHERITED',
          title: t('settings.hub.items.orderWorkflow.title', 'Order workflow'),
          description: t(
            'settings.hub.items.orderWorkflow.description',
            'Order numbers, how long a cashier may change or cancel an order, incoming online orders and sales channels.'
          ),
          path: '/app/settings/order-workflow',
          tags: ['order', 'workflow', 'call number', 'auto accept', 'incoming', 'channels', 'edit window', 'سفارش', 'گردش کار', 'پذیرش خودکار', 'شماره سفارش'],
        },
        {
          id: 'shiftPolicy',
          scope: 'ORG',
          title: t('settings.hub.items.shiftPolicy.title', 'Shift & Drawer Policy'),
          description: t('settings.hub.items.shiftPolicy.description', 'The opening float a new shift is offered.'),
          path: '/app/settings/shift-policy',
          tags: ['shift', 'drawer', 'float', 'cash', 'شیفت', 'صندوق', 'کشو'],
        },
        {
          id: 'payments',
          scope: 'ORG',
          title: t('settings.hub.items.payments.title', 'Payment Methods'),
          description: t(
            'settings.hub.items.payments.description',
            'Payment methods, and the bank accounts the card terminals settle into.'
          ),
          path: '/app/settings/payments-refunds',
          tags: ['payments', 'tender', 'eft', 'cards', 'bank account', 'پرداخت', 'کارتخوان', 'پوز', 'حساب بانکی'],
        },
        {
          id: 'tara',
          scope: 'ORG',
          title: t('settings.hub.items.tara.title', 'Tara'),
          description: t(
            'settings.hub.items.tara.description',
            'Paying with Tara credit at the till: the Tara login, each branch’s Tara code and terminals, and product groups.'
          ),
          path: '/app/settings/tara',
          tags: ['tara', 'bnpl', 'credit', 'installments', 'تارا', 'اعتبار', 'خرید اعتباری'],
        },
        {
          id: 'snappfood',
          scope: 'ORG',
          title: t('settings.hub.items.snappfood.title', 'Snappfood'),
          description: t(
            'settings.hub.items.snappfood.description',
            'Receiving Snappfood orders for real: the webhook address to give Snappfood, and each branch’s vendor code and API account.'
          ),
          path: '/app/settings/snappfood',
          tags: ['snappfood', 'webhook', 'aggregator', 'vendor', 'api', 'اسنپ فود', 'اسنپ‌فود', 'وب‌هوک'],
        },
      ],
    },
    {
      id: 'lists',
      categoryTitle: t('settings.hub.domains.lists.title', 'Lists'),
      categoryDescription: t('settings.hub.domains.lists.description', 'The choices the register offers staff.'),
      icon: <ListAltIcon />,
      items: [
        {
          id: 'reasons',
          scope: 'ORG',
          title: t('settings.hub.items.reasons.title', 'Reason codes'),
          description: t(
            'settings.hub.items.reasons.description',
            'The reasons staff pick when they cancel an order, give a refund or explain a cash difference.'
          ),
          path: '/app/settings/reasons',
          tags: ['reasons', 'voids', 'cancel', 'refunds', 'variances', 'codes', 'علت', 'ابطال', 'دلایل'],
        },
        {
          id: 'note-templates',
          scope: 'ORG',
          title: t('settings.hub.items.noteTemplates.title', 'Order Note Templates'),
          description: t(
            'settings.hub.items.noteTemplates.description',
            'One-tap phrases the register offers when a cashier adds a note to an order or an item.'
          ),
          path: '/app/settings/note-templates',
          tags: ['notes', 'templates', 'kitchen', 'instructions', 'chips', 'یادداشت', 'توضیحات', 'آشپزخانه'],
        },
        {
          id: 'customerFields',
          scope: 'ORG',
          title: t('settings.hub.items.customerFields.title', 'Customer fields'),
          description: t(
            'settings.hub.items.customerFields.description',
            'Questions asked when a customer is registered, such as gender or a wedding date.'
          ),
          path: '/app/settings/customer-fields',
          tags: ['customers', 'fields', 'gender', 'birthday', 'wedding', 'مشتری', 'فیلد', 'جنسیت', 'ازدواج'],
        },
      ],
    },
    {
      id: 'devices',
      categoryTitle: t('settings.hub.domains.devices.title', 'Devices & printing'),
      categoryDescription: t(
        'settings.hub.domains.devices.description',
        'Tills, card terminals and printers, and the branch PC that reaches them.'
      ),
      icon: <PointOfSaleIcon />,
      items: [
        {
          id: 'terminals',
          scope: 'BRANCH',
          title: t('settings.hub.items.terminals.title', 'Registers'),
          description: t(
            'settings.hub.items.terminals.description',
            'The branch’s tills and kiosks, how each is paired, and whether it is online.'
          ),
          path: '/app/operations/terminals',
          tags: ['terminals', 'pos', 'registers', 'tills', 'devices', 'pairing', 'پایانه‌ها', 'صندوق', 'دستگاه‌ها'],
        },
        {
          id: 'card-terminals',
          scope: 'BRANCH',
          title: t('settings.hub.items.cardTerminals.title', 'Card terminals'),
          description: t(
            'settings.hub.items.cardTerminals.description',
            "The counter's card terminals and the couriers' mobile card readers, and how the branch agent reaches each one."
          ),
          path: '/app/operations/card-terminals',
          tags: ['card', 'eft', 'pos', 'terminal', 'saman', 'card reader', 'mobile pos', 'کارتخوان', 'پوز', 'پایانه پرداخت', 'سامان'],
        },
        {
          id: 'printers',
          scope: 'BRANCH',
          title: t('settings.hub.items.printers.title', 'Printers'),
          description: t(
            'settings.hub.items.printers.description',
            'Receipt and kitchen printers, how the branch agent reaches them, test pages and the print queue.'
          ),
          path: '/app/operations/printers',
          tags: ['printers', 'receipts', 'kitchen tickets', 'queue', 'چاپگر', 'فیش', 'پرینتر', 'آشپزخانه'],
        },
        {
          id: 'printRouting',
          scope: 'BRANCH',
          title: t('settings.hub.items.printRouting.title', 'Print routing'),
          description: t(
            'settings.hub.items.printRouting.description',
            'Which kitchen printer prints which categories and products.'
          ),
          path: '/app/operations/print-routing',
          tags: ['print routing', 'kitchen', 'categories', 'products', 'printers', 'مسیر چاپ', 'آشپزخانه', 'چاپگر'],
        },
        {
          id: 'agents',
          scope: 'ORG',
          title: t('settings.hub.items.agents.title', 'Branch agents'),
          description: t(
            'settings.hub.items.agents.description',
            'The PC in each branch that serves the tills and reaches its printers and card terminals: pairing, health and version.'
          ),
          path: '/app/operations/agents',
          tags: ['agent', 'branch agent', 'pc', 'pairing', 'offline', 'ایجنت', 'کد اتصال'],
        },
      ],
    },
    {
      id: 'admin',
      categoryTitle: t('settings.hub.domains.admin.title', 'Admin tools'),
      categoryDescription: t('settings.hub.domains.admin.description', 'For the demo environment, not daily work.'),
      icon: <BuildIcon />,
      items: [
        {
          id: 'dataReset',
          scope: 'ORG',
          title: t('settings.hub.items.dataReset.title', 'Data reset'),
          description: t(
            'settings.hub.items.dataReset.description',
            'Wipe transactions, reload the demo data and reset number sequences.'
          ),
          path: '/app/settings/data-reset',
          tags: ['data reset', 'reset', 'seed', 'wipe', 'demo', 'بازنشانی', 'پاکسازی', 'داده‌ها'],
        },
      ],
    },
  ];
}

/**
 * The same test the sidebar applies: the account may open it, and it belongs in the scope
 * the header is set to. Offering a link the menu had taken away made a promise the page
 * then refused. Inside a branch, head office's own settings are left out too: the branch
 * cannot change them, and listing them only to say so made the page long and the scope
 * hard to read.
 */
export function useIsSettingOnOffer(): (item: SettingItem) => boolean {
  const role = useAuthStore((state) => state.user?.role);
  const isHeadOffice = useIsHeadOffice();
  const workspace = useWorkspaceScope();
  const insideBranch = !!workspace && !workspace.isHeadOffice;
  return (item) =>
    canReachPath(role, item.path, isHeadOffice) &&
    fitsWorkspace(item.path, workspace) &&
    !(insideBranch && item.scope === 'ORG');
}
