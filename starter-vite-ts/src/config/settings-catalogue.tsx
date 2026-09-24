import { useTranslation } from 'react-i18next';

import TuneIcon from '@mui/icons-material/Tune';
import EventIcon from '@mui/icons-material/Event';
import GavelIcon from '@mui/icons-material/Gavel';
import PrintIcon from '@mui/icons-material/Print';
import ShieldIcon from '@mui/icons-material/Shield';
import EditNoteIcon from '@mui/icons-material/EditNote';
import PaymentsIcon from '@mui/icons-material/Payments';
import TranslateIcon from '@mui/icons-material/Translate';
import TwoWheelerIcon from '@mui/icons-material/TwoWheeler';
import StorefrontIcon from '@mui/icons-material/Storefront';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import NightsStayIcon from '@mui/icons-material/NightsStay';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import CountertopsIcon from '@mui/icons-material/Countertops';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';

import { useWorkspaceScope } from 'src/contexts/branch-context';
import { useAuthStore, useIsHeadOffice } from 'src/store/useAuthStore';

import { canReachPath, fitsWorkspace } from './role-access';

/**
 * Every settings destination the Settings Hub lists. Kept apart from the hub page so the
 * header search can offer the same cards: most of these have no sidebar link, and a search
 * that only knew the sidebar could not find Business Day or Calendar at all.
 */

export type SettingScope = 'BRANCH' | 'ORG';

export interface SettingItem {
  badge?: {
    color: 'default' | 'error' | 'info' | 'primary' | 'secondary' | 'success' | 'warning';
    label: string;
  };
  description: string;
  icon: React.ReactNode;
  id: string;
  path: string;
  /** ORG is defined once at head office and inherited; BRANCH is set per location. */
  scope: SettingScope;
  /**
   * A card that is only a setting at head office. Inside a branch the page behind it is
   * something else (Moadian: that branch's invoices, already under Reports & Compliance),
   * so the hub leaves it out there rather than promise a setting the branch cannot change.
   */
  headOfficeScopeOnly?: boolean;
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
      id: 'organization',
      categoryTitle: t('settings.hub.domains.organization.title', 'Organization & Stores'),
      categoryDescription: t(
        'settings.hub.domains.organization.description',
        'Tenant profile, branch locations, operating schedules, and multi-currency settings.'
      ),
      icon: <StorefrontIcon color="primary" sx={{ fontSize: 28 }} />,
      items: [
        {
          id: 'general',
          scope: 'ORG',
          title: t('settings.hub.items.general.title', 'General Settings & Currencies'),
          description: t(
            'settings.hub.items.general.description',
            'Tenant organization name, timezone, locale defaults, base currency, and multi-currency limits.'
          ),
          path: '/app/settings/general',
          icon: <TuneIcon sx={{ color: 'primary.main' }} />,
          badge: { color: 'info', label: t('settings.hub.items.general.badge', '9 Currencies') },
          tags: ['general', 'tenant', 'currency', 'timezone', 'locale', 'organization', 'base currency', 'عمومی', 'ارز', 'سازمان', 'زبان', 'منطقه زمانی'],
        },
        {
          id: 'branches',
          scope: 'ORG',
          title: t('settings.hub.items.branches.title', 'Branches & Operating Hours'),
          description: t(
            'settings.hub.items.branches.description',
            'Store locations, operational schedules, table arrangements, tax profiles, and branch statuses.'
          ),
          path: '/app/operations/branches',
          icon: <StorefrontIcon sx={{ color: 'warning.main' }} />,
          badge: { color: 'success', label: t('settings.hub.items.branches.badge', '3 Locations') },
          tags: ['branches', 'stores', 'hours', 'locations', 'tables', 'tax', 'schedules', 'شعب', 'فروشگاه', 'میزها', 'مالیات', 'ساعات کاری'],
        },
        {
          id: 'branchOverrides',
          scope: 'BRANCH',
          title: t('settings.hub.items.branchOverrides.title', 'Branch Overrides'),
          description: t(
            'settings.hub.items.branchOverrides.description',
            'What one location does differently from head office, and what it is not allowed to change.'
          ),
          path: '/app/settings/branch-overrides',
          icon: <StorefrontIcon sx={{ color: 'info.main' }} />,
          tags: ['override', 'inherit', 'branch', 'head office', 'scope', 'chain', 'اختصاصی', 'شعبه', 'دفتر مرکزی', 'وراثت'],
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
          icon: <ShieldIcon sx={{ color: 'primary.main' }} />,
          tags: ['roles', 'permissions', 'access', 'cashier', 'manager', 'head office', 'نقش', 'دسترسی', 'مجوز', 'صندوق‌دار'],
        },
      ],
    },
    {
      id: 'hardware',
      categoryTitle: t('settings.hub.domains.hardware.title', 'Hardware & Peripherals'),
      categoryDescription: t(
        'settings.hub.domains.hardware.description',
        'POS hardware terminals, network receipt printers, kitchen routing, and bump screens.'
      ),
      icon: <PointOfSaleIcon color="info" sx={{ fontSize: 28 }} />,
      items: [
        {
          id: 'terminals',
          scope: 'BRANCH',
          title: t('settings.hub.items.terminals.title', 'Terminals Registry'),
          description: t(
            'settings.hub.items.terminals.description',
            'POS hardware register pairing, terminal serial numbers, peripheral setup, and device status.'
          ),
          path: '/app/operations/terminals',
          icon: <PointOfSaleIcon sx={{ color: 'info.main' }} />,
          badge: { color: 'primary', label: t('settings.hub.items.terminals.badge', 'Active Pairs') },
          tags: ['terminals', 'pos', 'registers', 'devices', 'hardware', 'pairing', 'serials', 'پایانه‌ها', 'صندوق', 'دستگاه‌ها', 'سخت‌افزار'],
        },
        {
          id: 'printers',
          scope: 'BRANCH',
          title: t('settings.hub.items.printers.title', 'Printers & Print Routing'),
          description: t(
            'settings.hub.items.printers.description',
            'Network receipt printers, kitchen ticket routing, print templates, and queue failover.'
          ),
          path: '/app/operations/printers',
          icon: <PrintIcon sx={{ color: 'secondary.main' }} />,
          badge: { color: 'secondary', label: t('settings.hub.items.printers.badge', 'Station Routing') },
          tags: ['printers', 'receipts', 'kitchen tickets', 'routing', 'templates', 'queue', 'hardware', 'چاپگر', 'فیش', 'پرینتر', 'آشپزخانه'],
        },
        {
          id: 'kds',
          scope: 'BRANCH',
          title: t('settings.hub.items.kds.title', 'KDS Configuration'),
          description: t(
            'settings.hub.items.kds.description',
            'Kitchen display screens, preparation timers, item routing, and order bumping rules.'
          ),
          path: '/app/operations/kds-configuration',
          icon: <CountertopsIcon sx={{ color: 'info.main' }} />,
          badge: { color: 'info', label: t('settings.hub.items.kds.badge', 'KDS Active') },
          tags: ['kds', 'kitchen', 'screens', 'preparation', 'timers', 'bumping', 'stations', 'نمایشگر آشپزخانه', 'کی‌دی‌اس', 'آماده‌سازی'],
        },
      ],
    },
    {
      id: 'security',
      categoryTitle: t('settings.hub.domains.securityAudit.title', 'Security & Approvals'),
      categoryDescription: t(
        'settings.hub.domains.securityAudit.description',
        'PIN escalation governance, role discount authorizations, and anti-fraud thresholds.'
      ),
      icon: <ShieldIcon color="error" sx={{ fontSize: 28 }} />,
      items: [
        {
          id: 'approvals',
          scope: 'ORG',
          title: t('settings.hub.items.approvals.title', 'Approval Policies & PIN Escalation'),
          description: t(
            'settings.hub.items.approvals.description',
            'Manager override thresholds, void/reprint rules, self-approval prevention, and escalation paths.'
          ),
          path: '/app/settings/approvals',
          icon: <ShieldIcon sx={{ color: 'info.main' }} />,
          badge: { color: 'info', label: t('settings.hub.items.approvals.badge', 'Policy Engine') },
          tags: ['approvals', 'manager', 'security', 'limits', 'overrides', 'policy', 'escalations', 'pin', 'تایید', 'مدیر', 'امنیت', 'سقف مجاز', 'پین'],
        },
        {
          id: 'discountAuthorizations',
          scope: 'ORG',
          title: t('settings.hub.items.discountAuthorizations.title', 'Manual Discount Authorizations'),
          description: t(
            'settings.hub.items.discountAuthorizations.description',
            'Role-based manual discount percentage and fixed amount caps for cashiers, supervisors, and managers.'
          ),
          path: '/app/settings/discount-authorizations',
          icon: <GavelIcon sx={{ color: 'warning.main' }} />,
          badge: { color: 'warning', label: t('settings.hub.items.discountAuthorizations.badge', 'Role Limits') },
          tags: ['discounts', 'authorizations', 'roles', 'limits', 'cashier', 'supervisor', 'manager', 'caps', 'policy', 'تخفیف', 'سقف اختیارات', 'صندوق‌دار'],
        },
      ],
    },
    {
      id: 'workflow',
      categoryTitle: t('settings.hub.domains.orderPos.title', 'Order & Financial Policies'),
      categoryDescription: t(
        'settings.hub.domains.orderPos.description',
        'Order lifecycle states, auto-acceptance rules, reason codes, and payment gateways.'
      ),
      icon: <ReceiptLongIcon color="warning" sx={{ fontSize: 28 }} />,
      items: [
        {
          id: 'orderWorkflow',
          scope: 'BRANCH',
          title: t('settings.hub.items.orderWorkflow.title', 'Order Workflow Settings'),
          description: t(
            'settings.hub.items.orderWorkflow.description',
            'Order lifecycle states, auto-acceptance rules, dining modes, and kitchen routing.'
          ),
          path: '/app/settings/order-workflow',
          icon: <ReceiptLongIcon sx={{ color: 'warning.main' }} />,
          badge: { color: 'warning', label: t('settings.hub.items.orderWorkflow.badge', 'Workflow V2') },
          tags: ['order', 'workflow', 'lifecycle', 'auto accept', 'dining', 'kitchen routing', 'سفارش', 'گردش کار', 'پذیرش خودکار'],
        },
        {
          id: 'shiftPolicy',
          scope: 'BRANCH',
          title: t('settings.hub.items.shiftPolicy.title', 'Shift & Drawer Policy'),
          description: t(
            'settings.hub.items.shiftPolicy.description',
            'Default opening float, how far a drawer may be out before a manager signs off, and blind counting at close.'
          ),
          path: '/app/settings/shift-policy',
          icon: <PointOfSaleIcon sx={{ color: 'success.main' }} />,
          tags: ['shift', 'drawer', 'float', 'variance', 'blind count', 'cash', 'شیفت', 'صندوق', 'کشو', 'مغایرت'],
        },
        {
          id: 'businessDay',
          scope: 'BRANCH',
          title: t('settings.hub.items.businessDay.title'),
          description: t('settings.hub.items.businessDay.description'),
          path: '/app/settings/business-day',
          icon: <NightsStayIcon sx={{ color: 'primary.main' }} />,
          tags: ['business day', 'cutoff', 'overnight', 'hours', 'day close', 'روز کاری', 'پایان روز', 'ساعت کاری', 'بستن روز'],
        },
        {
          id: 'courierPay',
          scope: 'BRANCH',
          title: t('settings.hub.items.courierPay.title'),
          description: t('settings.hub.items.courierPay.description'),
          path: '/app/settings/courier-pay',
          icon: <TwoWheelerIcon sx={{ color: 'primary.main' }} />,
          tags: ['courier', 'pay', 'delivery fee', 'zone rate', 'failed delivery', 'سفیر', 'دستمزد', 'پیک', 'کرایه'],
        },
        {
          id: 'calendar',
          scope: 'ORG',
          title: t('settings.hub.items.calendar.title'),
          description: t('settings.hub.items.calendar.description'),
          path: '/app/settings/calendar',
          icon: <EventIcon sx={{ color: 'info.main' }} />,
          tags: ['calendar', 'jalali', 'shamsi', 'gregorian', 'date', 'week', 'تقویم', 'شمسی', 'میلادی', 'تاریخ'],
        },
        {
          id: 'payments',
          scope: 'ORG',
          title: t('settings.hub.items.payments.title', 'Payments & Refund Methods'),
          description: t(
            'settings.hub.items.payments.description',
            'EFT POS terminals, card gateways, cash drawers, refund limits, and payment methods.'
          ),
          path: '/app/settings/payments-refunds',
          icon: <PaymentsIcon sx={{ color: 'success.main' }} />,
          badge: { color: 'success', label: t('settings.hub.items.payments.badge', 'Gateways Ready') },
          tags: ['payments', 'refunds', 'gateways', 'eft', 'cash drawer', 'cards', 'transactions', 'پرداخت', 'استرداد', 'کارتخوان', 'پوز', 'مرجوعی'],
        },
        {
          id: 'moadian',
          scope: 'ORG',
          headOfficeScopeOnly: true,
          title: t('settings.hub.items.moadian.title', 'Moadian e-invoicing'),
          description: t(
            'settings.hub.items.moadian.description',
            'Tax memory ID, economic code and the simulated tax office; every e-invoice and where it stands.'
          ),
          path: '/app/moadian',
          icon: <ReceiptLongIcon sx={{ color: 'info.main' }} />,
          badge: { color: 'info', label: t('settings.hub.items.moadian.badge', 'Simulated') },
          tags: ['moadian', 'tax', 'e-invoice', 'vat', 'مودیان', 'مالیات', 'صورتحساب الکترونیکی'],
        },
        {
          id: 'reasons',
          scope: 'ORG',
          title: t('settings.hub.items.reasons.title', 'Reason Codes & Compliance'),
          description: t(
            'settings.hub.items.reasons.description',
            'Predefined audit reason codes for order voids, customer refunds, cash variances, and discounts.'
          ),
          path: '/app/settings/reasons',
          icon: <GavelIcon sx={{ color: 'error.main' }} />,
          badge: { color: 'default', label: t('settings.hub.items.reasons.badge', 'Audit Ready') },
          tags: ['reasons', 'audit', 'voids', 'refunds', 'variances', 'compliance', 'codes', 'علت', 'ابطال', 'ممیزی', 'دلایل'],
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
          icon: <EditNoteIcon sx={{ color: 'primary.main' }} />,
          tags: ['notes', 'templates', 'kitchen', 'instructions', 'chips', 'یادداشت', 'توضیحات', 'آشپزخانه'],
        },
      ],
    },
    {
      id: 'system',
      categoryTitle: t('settings.hub.domains.localizationData.title', 'System & Localization'),
      categoryDescription: t(
        'settings.hub.domains.localizationData.description',
        'Language and media localization, bulk Excel import/export, and data resets.'
      ),
      icon: <TranslateIcon color="secondary" sx={{ fontSize: 28 }} />,
      items: [
        {
          id: 'localization',
          scope: 'ORG',
          title: t('settings.hub.items.localization.title', 'Language & Media Localization'),
          description: t(
            'settings.hub.items.localization.description',
            'English/Persian language switcher, RTL/LTR layout controls, and media asset localization.'
          ),
          path: '/app/settings/localization',
          icon: <TranslateIcon sx={{ color: 'secondary.main' }} />,
          badge: { color: 'secondary', label: t('settings.hub.items.localization.badge', 'EN / FA RTL') },
          tags: ['localization', 'language', 'persian', 'english', 'rtl', 'ltr', 'media', 'i18n', 'بومی‌سازی', 'زبان', 'فارسی', 'انگلیسی', 'رسانه'],
        },
        {
          id: 'importExport',
          scope: 'ORG',
          title: t('settings.hub.items.importExport.title', 'Data Import & Export Wizard'),
          description: t(
            'settings.hub.items.importExport.description',
            'Bulk upload products, prices, modifier groups, and customers using standardized Excel templates.'
          ),
          path: '/app/catalog/import-export',
          icon: <FileUploadIcon sx={{ color: 'success.main' }} />,
          badge: { color: 'success', label: t('settings.hub.items.importExport.badge', 'Excel Wizard') },
          tags: ['import', 'export', 'excel', 'wizard', 'bulk', 'upload', 'migration', 'data', 'واردات', 'صادرات', 'اکسل', 'مهاجرت'],
        },
        {
          id: 'dataReset',
          scope: 'ORG',
          title: t('settings.hub.items.dataReset.title', 'Data Reset & System Seeds'),
          description: t(
            'settings.hub.items.dataReset.description',
            'Wipe transaction logs, seed mock products, reset sequence numbers, and reset environment state.'
          ),
          path: '/app/settings/data-reset',
          icon: <RestartAltIcon sx={{ color: 'error.main' }} />,
          badge: { color: 'error', label: t('settings.hub.items.dataReset.badge', 'Admin Tools') },
          tags: ['data reset', 'reset', 'seed', 'wipe', 'maintenance', 'database', 'environment', 'بازنشانی', 'پاکسازی', 'داده‌ها'],
        },
      ],
    },
  ];
}

/**
 * The same test the sidebar applies: the account may open it, and it belongs in the scope
 * the header is set to. Offering a card the menu had taken away made a promise the page
 * then refused.
 */
export function useIsSettingOnOffer(): (item: SettingItem) => boolean {
  const role = useAuthStore((state) => state.user?.role);
  const isHeadOffice = useIsHeadOffice();
  const workspace = useWorkspaceScope();
  return (item) =>
    canReachPath(role, item.path, isHeadOffice) &&
    fitsWorkspace(item.path, workspace) &&
    !(item.headOfficeScopeOnly && workspace && !workspace.isHeadOffice);
}
