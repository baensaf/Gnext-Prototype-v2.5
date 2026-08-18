import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Avatar from '@mui/material/Avatar';
import ListItemText from '@mui/material/ListItemText';
import ListItemAvatar from '@mui/material/ListItemAvatar';
import ListItemButton from '@mui/material/ListItemButton';

import { fToNow } from 'src/utils/format-time';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';

// ----------------------------------------------------------------------

export type NotificationItemProps = {
  notification: {
    id: string;
    type?: string;
    severity?: 'INFO' | 'WARNING' | 'CRITICAL';
    title: string;
    message?: string;
    category?: string;
    isUnRead?: boolean;
    acknowledged?: boolean;
    avatarUrl?: string | null;
    createdAt?: string | number | null;
    created_at?: string;
  };
  onAcknowledge?: (id: string) => void;
};

export function NotificationItem({ notification, onAcknowledge }: NotificationItemProps) {
  const isUnRead = notification.acknowledged === false || notification.isUnRead === true;
  const severity = notification.severity || 'INFO';
  const createdAt = notification.created_at || notification.createdAt;

  const getSeverityColor = () => {
    switch (severity) {
      case 'CRITICAL':
        return 'error';
      case 'WARNING':
        return 'warning';
      case 'INFO':
      default:
        return 'info';
    }
  };

  const getSeverityIcon = () => {
    switch (severity) {
      case 'CRITICAL':
        return 'solar:danger-triangle-bold';
      case 'WARNING':
        return 'solar:danger-bold';
      case 'INFO':
      default:
        return 'solar:info-circle-bold';
    }
  };

  const formatCategory = () => {
    if (notification.category) return notification.category;
    if (notification.type) {
      return notification.type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return 'System';
  };

  const renderAvatar = () => (
    <ListItemAvatar>
      {notification.avatarUrl ? (
        <Avatar src={notification.avatarUrl} sx={{ bgcolor: 'background.neutral' }} />
      ) : (
        <Box
          sx={{
            width: 40,
            height: 40,
            display: 'flex',
            borderRadius: '50%',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: (theme) => {
              if (severity === 'CRITICAL') return theme.palette.error.lighter;
              if (severity === 'WARNING') return theme.palette.warning.lighter;
              return theme.palette.info.lighter;
            },
            color: (theme) => {
              if (severity === 'CRITICAL') return theme.palette.error.main;
              if (severity === 'WARNING') return theme.palette.warning.main;
              return theme.palette.info.main;
            },
          }}
        >
          <Iconify icon={getSeverityIcon()} width={22} />
        </Box>
      )}
    </ListItemAvatar>
  );

  const renderText = () => (
    <ListItemText
      primary={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mb: 0.5 }}>
          <Box component="span" sx={{ typography: 'subtitle2', fontWeight: 600 }}>
            {notification.title}
          </Box>
          <Label variant="soft" color={getSeverityColor()} sx={{ height: 20, fontSize: '0.7rem' }}>
            {severity}
          </Label>
        </Box>
      }
      secondary={
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          {notification.message && (
            <Box
              component="span"
              sx={{
                m: 0,
                mb: 0.5,
                typography: 'body2',
                color: 'text.secondary',
                fontSize: '0.8125rem',
                lineHeight: 1.4,
              }}
            >
              {notification.message}
            </Box>
          )}
          <Box
            sx={{
              gap: 0.75,
              display: 'flex',
              alignItems: 'center',
              typography: 'caption',
              color: 'text.disabled',
            }}
          >
            {createdAt ? fToNow(createdAt) : 'Just now'}
            <Box
              component="span"
              sx={{ width: 3, height: 3, borderRadius: '50%', bgcolor: 'currentColor' }}
            />
            {formatCategory()}
          </Box>
        </Box>
      }
    />
  );

  const renderUnReadBadge = () =>
    isUnRead && (
      <Box
        sx={{
          top: 20,
          width: 8,
          height: 8,
          right: 16,
          borderRadius: '50%',
          bgcolor: severity === 'CRITICAL' ? 'error.main' : 'warning.main',
          position: 'absolute',
        }}
      />
    );

  const renderActions = () => {
    if (isUnRead && onAcknowledge) {
      return (
        <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            size="small"
            variant="soft"
            color="inherit"
            startIcon={<Iconify icon="solar:check-circle-bold" width={16} />}
            onClick={(e) => {
              e.stopPropagation();
              onAcknowledge(notification.id);
            }}
            sx={{ fontSize: '0.75rem', py: 0.25, px: 1 }}
          >
            Acknowledge
          </Button>
        </Box>
      );
    }
    return (
      <Box sx={{ mt: 0.5, display: 'flex', justifyContent: 'flex-end' }}>
        <Label variant="outlined" color="default" sx={{ height: 18, fontSize: '0.65rem', color: 'text.disabled' }}>
          Acknowledged
        </Label>
      </Box>
    );
  };

  return (
    <ListItemButton
      disableRipple
      sx={[
        (theme) => ({
          p: 2,
          pr: 2.5,
          alignItems: 'flex-start',
          borderBottom: `dashed 1px ${theme.vars.palette.divider}`,
          bgcolor: isUnRead ? 'action.hover' : 'transparent',
          transition: theme.transitions.create('background-color'),
          '&:hover': {
            bgcolor: 'action.selected',
          },
        }),
      ]}
    >
      {renderUnReadBadge()}
      {renderAvatar()}

      <Box sx={{ minWidth: 0, flex: '1 1 auto', pl: 0.5 }}>
        {renderText()}
        {renderActions()}
      </Box>
    </ListItemButton>
  );
}
