import type { Theme, SxProps } from '@mui/material/styles';
import type { ButtonBaseProps } from '@mui/material/ButtonBase';

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
import { useRouter } from 'src/routes/hooks';

import { useBranchContext } from 'src/contexts/branch-context';

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
  const { branches, selectedBranch, selectedBranchId, setSelectedBranchId } = useBranchContext();

  const activeName = selectedBranch?.name || data?.[0]?.name || 'Active Branch';
  const activeCode = selectedBranch?.code || data?.[0]?.plan || 'BRANCH';

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
          Active Branch / Store
        </Typography>
      </Box>

      <Divider sx={{ mb: 0.5, borderStyle: 'dashed' }} />

      <Scrollbar sx={{ maxHeight: 260 }}>
        <MenuList sx={{ p: 0.5 }}>
          {branches.map((branch) => (
            <MenuItem
              key={branch.id}
              selected={branch.id === selectedBranchId}
              onClick={() => {
                setSelectedBranchId(branch.id);
                onClose();
              }}
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
                  Code: {branch.code}
                </Typography>
              </Box>

              <Label color={branch.id === selectedBranchId ? 'primary' : 'default'} sx={{ height: 20, fontSize: '0.65rem' }}>
                {branch.code}
              </Label>
            </MenuItem>
          ))}
        </MenuList>
      </Scrollbar>

      <Divider sx={{ my: 0.5, borderStyle: 'dashed' }} />

      <Button
        fullWidth
        startIcon={<Iconify width={18} icon="mingcute:location-fill" />}
        onClick={() => {
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
        Manage Branches
      </Button>
    </CustomPopover>
  );

  return (
    <>
      {renderButton()}
      {renderMenuList()}
    </>
  );
}
