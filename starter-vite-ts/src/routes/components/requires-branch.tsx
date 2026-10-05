import { useTranslation } from 'react-i18next';

import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import AlertTitle from '@mui/material/AlertTitle';

import { usePathname } from 'src/routes/hooks';
import { RouterLink } from 'src/routes/components/router-link';

import { isKioskHost } from 'src/config/kiosk-host';
import { fitsWorkspace } from 'src/config/role-access';
import { useBranchContextOptional } from 'src/contexts/branch-context';

type RequiresBranchProps = {
  children: React.ReactNode;
  /** Head office's read-only view of the same thing across branches, where there is one. */
  rollup?: string;
};

/**
 * For a screen that runs one site. At head office the sidebar leaves these out, but a typed
 * or bookmarked address still opened them with no branch, and every call then went out
 * unfiltered: a dispatch board with the whole chain's deliveries on it. Here head office is
 * asked which branch it means instead.
 *
 * Only the scope is checked. Whether the account may open the page at all is RoleGuard's.
 */
export function RequiresBranch({ children, rollup }: RequiresBranchProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const branchScope = useBranchContextOptional();

  if (!branchScope) return <>{children}</>;

  const { isHeadOffice, branches, selectedBranch, setSelectedBranchId, hasNoBranch } = branchScope;

  if (hasNoBranch) return <NoBranchNotice />;

  if (!isHeadOffice) {
    // No branch yet means the list has not arrived (the provider reports "not loading" while
    // signed out, just before it starts), and the page's first requests would go out with
    // no branch on them. A later refresh keeps the old list, so this never unmounts a page.
    return selectedBranch ? <>{children}</> : null;
  }
  // A saved head-office scope is known before the list is; wait for it rather than flash
  // "no branch can run this page".
  if (branches.length === 0) return null;

  // A till has no place in a production kitchen, so only branches that run this page. The
  // kiosk host has no path of its own to ask about; only a restaurant has guests to serve.
  const kioskHost = isKioskHost();
  const fitting = branches.filter((branch) =>
    kioskHost
      ? (branch.branch_type ?? 'RESTAURANT') === 'RESTAURANT'
      : fitsWorkspace(pathname, { isHeadOffice: false, branchType: branch.branch_type ?? 'RESTAURANT' })
  );

  return (
    <Box sx={{ p: 3, maxWidth: 640, mx: 'auto' }}>
      <Alert severity="info">
        <AlertTitle>{t('access.pickBranchTitle', 'Pick a branch to open this page')}</AlertTitle>
        {kioskHost && fitting.length > 0
          ? t('access.pickBranchKiosk', 'Pick the branch this kiosk serves. Head office is not a branch, so it has no menu of its own to sell from.')
          : fitting.length > 0
          ? t(
              'access.pickBranchBody',
              'This page runs one branch at a time. The header is set to head office, which is not a branch, so it would show every branch mixed together.'
            )
          : t('access.pickBranchNone', 'No branch can run this page. Production kitchens and offices do not sell.')}
      </Alert>

      <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 2, flexWrap: 'wrap' }}>
        {fitting.map((branch) => (
          <Button key={branch.id} variant="outlined" onClick={() => setSelectedBranchId(branch.id)}>
            {branch.name}
          </Button>
        ))}
        {rollup && (
          <Button component={RouterLink} href={rollup} color="inherit">
            {t('access.pickBranchRollup', 'See all branches instead')}
          </Button>
        )}
      </Stack>
    </Box>
  );
}

/**
 * For an account whose branch was archived: it stays active, with no branch to work in,
 * until head office gives it another. Shown instead of any page.
 */
export function NoBranchNotice() {
  const { t } = useTranslation();
  return (
    <Box sx={{ p: 3, maxWidth: 640, mx: 'auto' }}>
      <Alert severity="info">
        <AlertTitle>{t('branchMgmt.noBranch.title', 'You have no branch to work in')}</AlertTitle>
        {t(
          'branchMgmt.noBranch.body',
          'The branch you worked at has been archived. Ask head office to give you another branch; your account and PIN stay as they are.'
        )}
      </Alert>
    </Box>
  );
}

/** Every page of the app sits behind this: an account with no branch sees only the notice. */
export function NoBranchGate({ children }: { children: React.ReactNode }) {
  const branchScope = useBranchContextOptional();
  return branchScope?.hasNoBranch ? <NoBranchNotice /> : <>{children}</>;
}
