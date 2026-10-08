import { useSearchParams } from 'react-router';

import Box from '@mui/material/Box';

import { OnlineBoard } from 'src/components/online-orders';

// ----------------------------------------------------------------------

/**
 * The Online board on a page of its own: for a manager without a till, or a second screen
 * beside the counter. A cashier answers the same board on the POS's Online tab.
 */
export function IncomingOrdersPage() {
  const [searchParams] = useSearchParams();

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <OnlineBoard variant="page" highlightId={searchParams.get('order')} />
    </Box>
  );
}
