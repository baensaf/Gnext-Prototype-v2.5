import { useTranslation } from 'react-i18next';

import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import AlertTitle from '@mui/material/AlertTitle';

import { usePathname } from 'src/routes/hooks';
import { RouterLink } from 'src/routes/components/router-link';

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

  const { isHeadOffice, branches, loading, setSelectedBranchId } = branchScope;

  // Before the first branch list the scope is still being settled; rendering the page now
  // would fire its requests unfiltered. A later refresh keeps the list, so it never unmounts.
  if (loading && branches.length === 0) return null;
  if (!isHeadOffice) return <>{children}</>;

  // A till has no place in a production kitchen, so only branches that run this page.
  const fitting = branches.filter((branch) =>
    fitsWorkspace(pathname, { isHeadOffice: false, branchType: branch.branch_type ?? 'RESTAURANT' })
  );

  return (
    <Box sx={{ p: 3, maxWidth: 640, mx: 'auto' }}>
      <Alert severity="info">
        <AlertTitle>{t('access.pickBranchTitle', 'Pick a branch to open this page')}</AlertTitle>
        {fitting.length > 0
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
