import { useTranslation } from 'react-i18next';

import Badge from '@mui/material/Badge';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import MoveToInboxIcon from '@mui/icons-material/MoveToInbox';

import { paths } from 'src/routes/paths';
import { useRouter } from 'src/routes/hooks';

import { useIncomingOrders } from 'src/contexts/incoming-orders-context';

// ----------------------------------------------------------------------

/** The header's count of orders waiting for the store. Opens the Incoming Orders queue. */
export function IncomingOrdersButton() {
  const { t } = useTranslation();
  const router = useRouter();
  const incoming = useIncomingOrders();

  if (!incoming?.enabled) return null;

  const count = incoming.orders.length;

  return (
    <Tooltip title={t('orders.incoming.title', 'Incoming Orders')}>
      <IconButton
        aria-label={t('orders.incoming.title', 'Incoming Orders')}
        onClick={() => router.push(paths.app.orders.incoming)}
      >
        <Badge badgeContent={count} color="error">
          <MoveToInboxIcon />
        </Badge>
      </IconButton>
    </Tooltip>
  );
}
