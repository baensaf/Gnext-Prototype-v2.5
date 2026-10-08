import { useTranslation } from 'react-i18next';

import Badge from '@mui/material/Badge';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import MoveToInboxIcon from '@mui/icons-material/MoveToInbox';

import { useRouter } from 'src/routes/hooks';

import { useIncomingOrders } from 'src/contexts/incoming-orders-context';

// ----------------------------------------------------------------------

/**
 * The header's count of online orders that need someone: new ones to answer and alerts to see.
 * Opens the POS's Online tab for a cashier, or the full-page board for anyone without a till.
 */
export function IncomingOrdersButton() {
  const { t } = useTranslation();
  const router = useRouter();
  const online = useIncomingOrders();

  if (!online?.enabled) return null;

  const count = online.waiting.length + online.issues.filter((card) => card.issue !== 'WITH_SUPPORT').length;

  return (
    <Tooltip title={t('online.title')}>
      <IconButton aria-label={t('online.title')} onClick={() => router.push(online.panelPath())}>
        <Badge badgeContent={count} color="error">
          <MoveToInboxIcon />
        </Badge>
      </IconButton>
    </Tooltip>
  );
}
