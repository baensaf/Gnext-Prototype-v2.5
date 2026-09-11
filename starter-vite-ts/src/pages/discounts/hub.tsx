import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import React, { useMemo, useState, useEffect } from 'react';

import Tab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Tabs from '@mui/material/Tabs';
import GroupIcon from '@mui/icons-material/Group';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';

import { DashboardContent } from 'src/layouts/dashboard';
import { CouponsPage } from 'src/pages/discounts/coupons';
import WalletCashbackPage from 'src/pages/customer-club/wallet-cashback';
import CustomerDiscountsPage from 'src/pages/customer-club/customer-discounts';

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
    if (p.includes('/wallet')) return 2;
    if (p.includes('/customer-rates') || p.includes('/discounts')) return 0;
    return defaultTab < 3 ? defaultTab : 0;
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
      '/app/discounts/wallet',
    ];
    if (routes[newIndex]) {
      navigate(routes[newIndex]);
    }
  };

  return (
    <DashboardContent>
      {/* Header */}
      <CustomBreadcrumbs
        heading={t('discounts.hubTitle', 'Discounts & Coupons')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('discounts.hubTitle', 'Discounts & Coupons') },
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
        {tabIndex === 2 && <WalletCashbackPage isEmbedded />}
      </Box>
    </DashboardContent>
  );
}
