import type { CustomerAddressDraft } from 'src/api/customerApi';

import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import MapIcon from '@mui/icons-material/Map';
import DeleteIcon from '@mui/icons-material/Delete';
import { Box, Card, Grid, Stack, Button, TextField, IconButton, Typography, CircularProgress } from '@mui/material';

// Leaflet is only loaded when a map is on screen.
const LocationMap = lazy(() =>
  import('src/components/branch/branch-location-map').then((m) => ({ default: m.BranchLocationMap }))
);

/** An address being typed, plus whether its map is open. */
export type AddressDraftState = CustomerAddressDraft & { showMap?: boolean };

type Props = {
  value: AddressDraftState;
  onChange: (patch: Partial<AddressDraftState>) => void;
  onRemove?: () => void;
};

/**
 * One delivery address: a title, the text the courier reads, the postal code (which picks the
 * delivery zone) and an optional pin on the map.
 */
export function CustomerAddressFields({ value, onChange, onRemove }: Props) {
  const { t } = useTranslation();
  const hasPin = value.latitude != null && value.longitude != null;

  return (
    <Card variant="outlined" sx={{ p: 2 }}>
      <Grid container spacing={1.5}>
        <Grid size={{ xs: 12, sm: onRemove ? 5 : 6 }}>
          <TextField
            label={t('customers.register.addressTitle')}
            fullWidth
            size="small"
            value={value.title}
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </Grid>
        <Grid size={{ xs: onRemove ? 10 : 12, sm: 6 }}>
          <TextField
            label={t('customers.register.postalCode')}
            fullWidth
            size="small"
            value={value.postal_code || ''}
            onChange={(e) => onChange({ postal_code: e.target.value })}
            slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'numeric' } }}
          />
        </Grid>
        {onRemove && (
          <Grid size={{ xs: 2, sm: 1 }} sx={{ display: 'flex', alignItems: 'center' }}>
            <IconButton size="small" color="error" title={t('customers.register.removeAddress')} onClick={onRemove}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Grid>
        )}
        <Grid size={{ xs: 12 }}>
          <TextField
            label={t('customers.register.addressText')}
            fullWidth
            multiline
            minRows={2}
            size="small"
            value={value.address_text}
            onChange={(e) => onChange({ address_text: e.target.value })}
          />
        </Grid>
        <Grid size={{ xs: 12 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Button
              size="small"
              variant={value.showMap ? 'contained' : 'outlined'}
              startIcon={<MapIcon />}
              onClick={() => onChange({ showMap: !value.showMap })}
            >
              {hasPin ? t('customers.register.pinPlaced') : t('customers.register.pinOnMap')}
            </Button>
            {hasPin && (
              <Button size="small" color="inherit" onClick={() => onChange({ latitude: null, longitude: null })}>
                {t('customers.register.removePin')}
              </Button>
            )}
            <Typography variant="caption" color="text.secondary">
              {t('customers.register.pinOptional')}
            </Typography>
          </Stack>
          {value.showMap && (
            <Box sx={{ mt: 1.5 }}>
              <Suspense fallback={<CircularProgress size={24} />}>
                <LocationMap
                  height={260}
                  value={hasPin ? { latitude: Number(value.latitude), longitude: Number(value.longitude) } : null}
                  onChange={(pin) => onChange({ latitude: pin.latitude, longitude: pin.longitude })}
                />
              </Suspense>
            </Box>
          )}
        </Grid>
      </Grid>
    </Card>
  );
}
