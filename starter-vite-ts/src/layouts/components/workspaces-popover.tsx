import type { Theme, SxProps } from '@mui/material/styles';
import type { ButtonBaseProps } from '@mui/material/ButtonBase';
import type { WorkspaceScope } from 'src/config/role-access';

import { useTranslation } from 'react-i18next';
import { usePopover } from 'minimal-shared/hooks';

import Box from '@mui/material/Box';
import Avatar from '@mui/material/Avatar';
import Divider from '@mui/material/Divider';
import MenuList from '@mui/material/MenuList';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import ButtonBase from '@mui/material/ButtonBase';
import Button, { buttonClasses } from '@mui/material/Button';

import { paths } from 'src/routes/paths';
import { useRouter, usePathname } from 'src/routes/hooks';

import { canReachPath, fitsWorkspace } from 'src/config/role-access';
import { useAuthStore, useIsHeadOffice } from 'src/store/useAuthStore';
import { HEAD_OFFICE_SCOPE, useBranchContextOptional } from 'src/contexts/branch-context';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { CustomPopover } from 'src/components/custom-popover';

// ----------------------------------------------------------------------

export type WorkspacesPopoverProps = ButtonBaseProps & {
  data?: {
    id: string;
    name: string;
    logo?: string;
    plan?: string;
  }[];
};

export function WorkspacesPopover({ data, sx, ...other }: WorkspacesPopoverProps) {
  const mediaQuery = 'sm';
  const router = useRouter();
  const { open, anchorEl, onClose, onOpen } = usePopover();
  const { t } = useTranslation();
  const branchScope = useBranchContextOptional();
  const branches = branchScope?.branches ?? [];
  const selectedBranch = branchScope?.selectedBranch ?? null;
  const selectedBranchId = branchScope?.selectedBranchId ?? '';
  const isHeadOffice = branchScope?.isHeadOffice ?? false;
  const canChangeScope = branchScope?.canChangeScope ?? true;
  const setSelectedBranchId = branchScope?.setSelectedBranchId;

  const pathname = usePathname();
  const role = useAuthStore((state) => state.user?.role);
  const accountIsHeadOffice = useIsHeadOffice();

  /**
   * Each scope has its own menu, so switching can leave you on a page the new one does not
   * offer — the POS at head office, the menu composer inside a shop. Staying there would
   * show a screen the sidebar has just taken away; the dashboard exists in both.
   */
  const switchScope = (id: string, scope: WorkspaceScope) => {
    setSelectedBranchId?.(id);
    onClose();
    if (!fitsWorkspace(pathname, scope)) router.push(paths.app.dashboard);
  };

  // Branches are the chain's to manage, so the way there goes through head office.
  const canManageBranches = canReachPath(role, paths.app.operations.branches, accountIsHeadOffice);

  const headOfficeName = t('branchScope.headOffice', 'All Branches (HQ)');

  const activeName = isHeadOffice
    ? headOfficeName
    : selectedBranch?.name || data?.[0]?.name || 'Active Branch';
  const activeCode = isHeadOffice
    ? t('branchScope.headOfficeCode', 'ORG')
    : selectedBranch?.code || data?.[0]?.plan || 'BRANCH';

  const buttonBg: SxProps<Theme> = {
    height: 1,
    zIndex: -1,
    opacity: 0,
    content: "''",
    borderRadius: 1,
    position: 'absolute',
    visibility: 'hidden',
    bgcolor: 'action.hover',
    width: 'calc(100% + 8px)',
    transition: (theme) =>
      theme.transitions.create(['opacity', 'visibility'], {
        easing: theme.transitions.easing.sharp,
        duration: theme.transitions.duration.shorter,
      }),
    ...(open && {
      opacity: 1,
      visibility: 'visible',
    }),
  };

  const renderButton = () => (
    <ButtonBase
      disableRipple
      onClick={onOpen}
      sx={[
        {
          py: 0.5,
          px: 1,
          borderRadius: 1.5,
          gap: { xs: 0.5, [mediaQuery]: 1 },
          '&::before': buttonBg,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      <Avatar
        sx={{
          width: 26,
          height: 26,
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          fontSize: '0.75rem',
          fontWeight: 700,
        }}
      >
        {activeName.charAt(0).toUpperCase()}
      </Avatar>

      <Box
        component="span"
        sx={{
          typography: 'subtitle2',
          fontWeight: 700,
          display: { xs: 'none', [mediaQuery]: 'inline-flex' },
        }}
      >
        {activeName}
      </Box>

      <Label
        color="info"
        sx={{
          height: 22,
          cursor: 'inherit',
          fontWeight: 700,
          display: { xs: 'none', [mediaQuery]: 'inline-flex' },
        }}
      >
        {activeCode}
      </Label>

      <Iconify width={16} icon="carbon:chevron-sort" sx={{ color: 'text.disabled' }} />
    </ButtonBase>
  );

  const renderMenuList = () => (
    <CustomPopover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      slotProps={{
        arrow: { placement: 'top-left' },
        paper: { sx: { mt: 0.5, ml: -1.55, width: 280 } },
      }}
    >
      <Box sx={{ p: 1.5, pb: 1 }}>
        <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>
          {t('branchScope.title', 'Active Scope')}
        </Typography>
      </Box>

      <Divider sx={{ mb: 0.5, borderStyle: 'dashed' }} />

      <Scrollbar sx={{ maxHeight: 260 }}>
        <MenuList sx={{ p: 0.5 }}>
          {/*
            Head office is a scope, not a location. Without it the app silently drops an
            org-level user inside whichever branch happens to sort first, which is the
            one place a chain operator is least likely to mean.
          */}
          <MenuItem
            disabled={!canChangeScope}
            selected={isHeadOffice}
            onClick={() => switchScope(HEAD_OFFICE_SCOPE, { isHeadOffice: true, branchType: null })}
            sx={{ height: 48, borderRadius: 1, gap: 1.5, display: canChangeScope ? 'flex' : 'none' }}
          >
            <Avatar
              sx={{
                width: 28,
                height: 28,
                bgcolor: isHeadOffice ? 'primary.main' : 'action.selected',
                color: isHeadOffice ? 'primary.contrastText' : 'text.primary',
              }}
            >
              <Iconify width={16} icon="solar:home-2-outline" />
            </Avatar>

            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography noWrap variant="body2" sx={{ fontWeight: isHeadOffice ? 700 : 500 }}>
                {headOfficeName}
              </Typography>
              <Typography noWrap variant="caption" color="text.secondary">
                {t('branchScope.headOfficeHint', 'Chain-wide view, no single store')}
              </Typography>
            </Box>

            <Label color={isHeadOffice ? 'primary' : 'default'} sx={{ height: 20, fontSize: '0.65rem' }}>
              {t('branchScope.headOfficeCode', 'ORG')}
            </Label>
          </MenuItem>

          {canChangeScope && <Divider sx={{ my: 0.5, borderStyle: 'dashed' }} />}

          {branches.map((branch) => (
            <MenuItem
              key={branch.id}
              selected={branch.id === selectedBranchId}
              onClick={() =>
                switchScope(branch.id, {
                  isHeadOffice: false,
                  branchType: branch.branch_type ?? 'RESTAURANT',
                })
              }
              sx={{ height: 48, borderRadius: 1, gap: 1.5 }}
            >
              <Avatar
                sx={{
                  width: 28,
                  height: 28,
                  bgcolor: branch.id === selectedBranchId ? 'primary.main' : 'action.selected',
                  color: branch.id === selectedBranchId ? 'primary.contrastText' : 'text.primary',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                }}
              >
                {branch.name.charAt(0).toUpperCase()}
              </Avatar>

              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography noWrap variant="body2" sx={{ fontWeight: branch.id === selectedBranchId ? 700 : 500 }}>
                  {branch.name}
                </Typography>
                <Typography noWrap variant="caption" color="text.secondary">
                  {branch.branch_type === 'COMMISSARY'
                    ? t('branchScope.type.commissary', 'Production kitchen — no sales')
                    : branch.branch_type === 'OFFICE'
                      ? t('branchScope.type.office', 'Office — no sales')
                      : t('branchScope.type.restaurant', 'Restaurant')}
                </Typography>
              </Box>

              <Label color={branch.id === selectedBranchId ? 'primary' : 'default'} sx={{ height: 20, fontSize: '0.65rem' }}>
                {branch.code}
              </Label>
            </MenuItem>
          ))}
        </MenuList>
      </Scrollbar>

      {canManageBranches && (
        <>
          <Divider sx={{ my: 0.5, borderStyle: 'dashed' }} />

          <Button
            fullWidth
            startIcon={<Iconify width={18} icon="mingcute:location-fill" />}
            onClick={() => {
              if (!isHeadOffice) setSelectedBranchId?.(HEAD_OFFICE_SCOPE);
              onClose();
              router.push(paths.app.operations.branches);
            }}
            sx={{
              gap: 1.5,
              justifyContent: 'flex-start',
              fontWeight: 'fontWeightMedium',
              [`& .${buttonClasses.startIcon}`]: {
                m: 0,
                width: 24,
                height: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              },
            }}
          >
            {t('branchScope.manage', 'Manage Branches')}
          </Button>
        </>
      )}
    </CustomPopover>
  );

  return (
    <>
      {renderButton()}
      {renderMenuList()}
    </>
  );
}
