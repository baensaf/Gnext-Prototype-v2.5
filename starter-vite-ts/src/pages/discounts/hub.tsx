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
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';

import { CouponsPage } from 'src/pages/discounts/coupons';
import { DiscountRulesPage } from 'src/pages/discounts/rules';
import WalletCashbackPage from 'src/pages/customer-club/wallet-cashback';
import CustomerDiscountsPage from 'src/pages/customer-club/customer-discounts';
import DiscountAuthorizationsPage from 'src/pages/settings/discount-authorizations';

interface DiscountsHubPageProps {
  defaultTab?: number;
}

export function DiscountsHubPage({ defaultTab = 0 }: DiscountsHubPageProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();

  const tabFromPath = useMemo(() => {
    const p = location.pathname;
    if (p.includes('/customer-rates') || p.includes('/customer-club/discounts')) return 1;
    if (p.includes('/coupons')) return 2;
    if (p.includes('/authorizations')) return 3;
    if (p.includes('/wallet') || p.includes('/customer-club/wallet')) return 4;
    return defaultTab;
  }, [location.pathname, defaultTab]);

  const [tabIndex, setTabIndex] = useState(tabFromPath);

  useEffect(() => {
    setTabIndex(tabFromPath);
  }, [tabFromPath]);

  const handleTabChange = (_event: React.SyntheticEvent, newIndex: number) => {
    setTabIndex(newIndex);
    const routes = [
      '/app/discounts/campaigns',
      '/app/discounts/customer-rates',
      '/app/discounts/coupons',
      '/app/discounts/authorizations',
      '/app/discounts/wallet',
    ];
    if (routes[newIndex]) {
      navigate(routes[newIndex]);
    }
  };

  return (
    <Box sx={{ pb: 6 }}>
      {/* Header */}
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            {t('discounts.hubTitle', 'Discounts & Promotions Hub')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t(
              'discounts.hubSubtitle',
              'Centralized promotional engine. Manage automated campaigns, customer-specific pricing, voucher coupons, cashier policy limits, and loyalty wallet rules.'
            )}
          </Typography>
        </Box>
      </Stack>

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
            icon={<LocalOfferIcon sx={{ mr: 1, fontSize: 20 }} />}
            iconPosition="start"
            label={t('discounts.tabCampaigns', 'Promotional Campaigns')}
          />
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
        {tabIndex === 0 && <DiscountRulesPage />}
        {tabIndex === 1 && <CustomerDiscountsPage />}
        {tabIndex === 2 && <CouponsPage />}
        {tabIndex === 3 && <DiscountAuthorizationsPage />}
        {tabIndex === 4 && <WalletCashbackPage />}
      </Box>
    </Box>
  );
}
