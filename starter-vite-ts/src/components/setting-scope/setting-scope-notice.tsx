import { useTranslation } from 'react-i18next';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';

// ----------------------------------------------------------------------

/**
 * Says which level owns what is on screen.
 *
 * Every settings screen reads a value that came from somewhere — head office, or this
 * branch's own override — and until it says so, an inherited value looks exactly like a
 * local one and a chain-wide screen looks editable to an account that cannot write it.
 * The server has enforced both rules for a while; this is the part the operator sees.
 */
export type SettingScopeNoticeProps = {
  /**
   * `CHAIN` for a group with no branch dimension at all — one set of currencies, tender
   * types, reason codes for the whole chain. `BRANCH` for a group a location may diverge
   * on, which is the list in the server's BRANCH_OVERRIDABLE_SETTING_GROUPS.
   */
  kind: 'CHAIN' | 'BRANCH';
  /**
   * Whether the signed-in *account* acts for the chain rather than one site. This is the
   * account's reach, not the scope chosen in the header — the two differ for an
   * unconfined admin who is currently looking at one branch. Only `CHAIN` reads it.
   */
  isHeadOffice?: boolean;
  /** The branch currently in scope; empty at chain level. */
  branchId?: string | null;
  branchName?: string | null;
  /** Where the displayed value came from. Only meaningful when `kind` is BRANCH. */
  source?: 'ORG' | 'BRANCH';
  /** Offered only when this branch actually has an override to drop. */
  onFollowHeadOffice?: () => void;
  busy?: boolean;
  sx?: object;
};

export function SettingScopeNotice({
  kind,
  isHeadOffice = true,
  branchId,
  branchName,
  source = 'ORG',
  onFollowHeadOffice,
  busy = false,
  sx,
}: SettingScopeNoticeProps) {
  const { t } = useTranslation();
  const mergedSx = { mb: 3, ...sx };

  if (kind === 'CHAIN') {
    // An account pinned to a site can reach this screen only by typing the address, and
    // its writes come back 403. Saying why beats letting it discover that at the save.
    return (
      <Alert severity={isHeadOffice ? 'info' : 'warning'} sx={mergedSx}>
        {isHeadOffice
          ? t(
              'settings.scope.chainWide',
              'Decided once for the whole chain at head office. There is no per-branch version of this.'
            )
          : t(
              'settings.scope.chainWideReadOnly',
              'This is decided for the whole chain at head office, so it is read-only inside {{branch}}.',
              { branch: branchName || '' }
            )}
      </Alert>
    );
  }

  // With no branch in scope the value on screen is the organization's own — the one every
  // branch without an override follows. A branch account never reaches this state; its
  // scope is pinned to its own site.
  if (!branchId) {
    return (
      <Alert severity="info" sx={mergedSx}>
        {t(
          'settings.scope.editingOrg',
          'Editing the organization value. Every branch without its own override follows this.'
        )}
      </Alert>
    );
  }

  return (
    <Alert
      severity={source === 'BRANCH' ? 'warning' : 'info'}
      sx={mergedSx}
      action={
        source === 'BRANCH' && onFollowHeadOffice ? (
          <Button color="inherit" size="small" disabled={busy} onClick={onFollowHeadOffice}>
            {t('settings.scope.resetToOrg', 'Follow head office')}
          </Button>
        ) : undefined
      }
    >
      {source === 'BRANCH'
        ? t('settings.scope.branchOverride', '{{branch}} overrides head office for this group.', {
            branch: branchName || '',
          })
        : t(
            'settings.scope.inherited',
            'Inherited from head office. Saving creates an override for {{branch}}.',
            { branch: branchName || '' }
          )}
    </Alert>
  );
}
