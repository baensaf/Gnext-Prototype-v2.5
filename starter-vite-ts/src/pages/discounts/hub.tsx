import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import React, { useMemo, useState, useEffect } from 'react';

import Tab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Tabs from '@mui/material/Tabs';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import GroupIcon from '@mui/icons-material/Group';
import SecurityIcon from '@mui/icons-material/Security';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';

import { DashboardContent } from 'src/layouts/dashboard';
import { CouponsPage } from 'src/pages/discounts/coupons';
import WalletCashbackPage from 'src/pages/customer-club/wallet-cashback';
import CustomerDiscountsPage from 'src/pages/customer-club/customer-discounts';
import DiscountAuthorizationsPage from 'src/pages/settings/discount-authorizations';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

interface DiscountsHubPageProps {
  defaultTab?: number;
}

export function DiscountsHubPage({ defaultTab = 0 }: DiscountsHubPageProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();

  const tabFromPath = useMemo(() => {
    const p = location.pathname;
    if (p.includes('/coupons')) return 1;
    if (p.includes('/authorizations') || p.includes('/discount-authorizations')) return 2;
    if (p.includes('/wallet') || p.includes('/customer-club/wallet')) return 3;
    if (p.includes('/customer-rates') || p.includes('/customer-club/discounts') || p.includes('/discounts')) return 0;
    return defaultTab < 4 ? defaultTab : 0;
  }, [location.pathname, defaultTab]);

  const [tabIndex, setTabIndex] = useState(tabFromPath);

  useEffect(() => {
    setTabIndex(tabFromPath);
  }, [tabFromPath]);

  const handleTabChange = (_event: React.SyntheticEvent, newIndex: number) => {
    setTabIndex(newIndex);
    const routes = [
      '/app/discounts/customer-rates',
      '/app/discounts/coupons',
      '/app/discounts/authorizations',
      '/app/discounts/wallet',
    ];
    if (routes[newIndex]) {
      navigate(routes[newIndex]);
    }
  };

  const isFromSettings = location.pathname.startsWith('/app/settings');

  return (
    <DashboardContent>
      {/* Header */}
      <CustomBreadcrumbs
        heading={t('discounts.hubTitle', 'Discounts & Promotions Hub')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          ...(isFromSettings
            ? [{ name: t('nav.settingsHub', 'Settings'), href: '/app/settings' }]
            : []),
          { name: t('discounts.hubTitle', 'Discounts Hub') },
        ]}
      />

      {/* Main Navigation Tabs */}
      <Card sx={{ mb: 3, borderRadius: 2 }}>
        <Tabs
          value={tabIndex}
          onChange={handleTabChange}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            px: 2,
            bgcolor: 'background.paper',
            borderBottom: 1,
            borderColor: 'divider',
            '& .MuiTab-root': {
              minHeight: 56,
              fontWeight: 700,
              fontSize: '0.9rem',
            },
          }}
        >
          <Tab
            icon={<GroupIcon sx={{ mr: 1, fontSize: 20 }} />}
            iconPosition="start"
            label={t('discounts.tabCustomerRates', 'Customer-Specific Rates')}
          />
          <Tab
            icon={<ConfirmationNumberIcon sx={{ mr: 1, fontSize: 20 }} />}
            iconPosition="start"
            label={t('discounts.tabCoupons', 'One-Time Coupons Studio')}
          />
          <Tab
            icon={<SecurityIcon sx={{ mr: 1, fontSize: 20 }} />}
            iconPosition="start"
            label={t('discounts.tabAuthorizations', 'Cashier Role Caps & PIN Rules')}
          />
          <Tab
            icon={<AccountBalanceWalletIcon sx={{ mr: 1, fontSize: 20 }} />}
            iconPosition="start"
            label={t('discounts.tabWallet', 'Loyalty Wallet & Cashback')}
          />
        </Tabs>
      </Card>

      {/* Tab Panels */}
      <Box>
        {tabIndex === 0 && <CustomerDiscountsPage isEmbedded />}
        {tabIndex === 1 && <CouponsPage isEmbedded />}
        {tabIndex === 2 && <DiscountAuthorizationsPage isEmbedded />}
        {tabIndex === 3 && <WalletCashbackPage isEmbedded />}
      </Box>
    </DashboardContent>
  );
}
