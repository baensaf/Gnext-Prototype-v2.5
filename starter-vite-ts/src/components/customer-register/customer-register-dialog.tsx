import type { AddressDraftState } from './customer-address-fields';
import type { Customer, CustomerRegistration } from 'src/api/customerApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import {
  Grid,
  Alert,
  Stack,
  Button,
  Dialog,
  Divider,
  TextField,
  Typography,
  DialogTitle,
  ToggleButton,
  DialogContent,
  DialogActions,
  InputAdornment,
  CircularProgress,
  ToggleButtonGroup,
} from '@mui/material';

import { fromToman, useCurrencyLabel } from 'src/utils/currency';

import { VersionTag } from 'src/components/version-tag';
import { CalendarDateField } from 'src/components/calendar-date-field';

import { CustomerAddressFields } from './customer-address-fields';

type AddressRow = AddressDraftState & { key: number };

const emptyAddress = (key: number, title: string): AddressRow => ({
  key,
  title,
  address_text: '',
  postal_code: '',
  latitude: null,
  longitude: null,
  showMap: false,
});

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (customer: Customer) => void;
  /** The POS passes its own source (the agent till has no customers yet). */
  createCustomer: (data: CustomerRegistration) => Promise<Customer>;
  /** Credit is granted by head office only (V3); branches never see the field. */
  showCredit?: boolean;
  /** Start with one empty address, as a delivery order needs one. */
  startWithAddress?: boolean;
  /** Pre-fills the mobile, e.g. what the cashier typed into the search. */
  initialMobile?: string;
  /** Pre-fills the name, when the cashier searched by name. */
  initialName?: string;
};

/**
 * Register a customer in one step: the name in one box, the mobile (which is also the
 * customer code), optional gender, birthday and wedding date, and any delivery addresses,
 * each with an optional pin on the map. Used by the customers page and the POS.
 */
export function CustomerRegisterDialog({ open, onClose, onCreated, createCustomer, showCredit, startWithAddress, initialMobile, initialName }: Props) {
  const { t } = useTranslation();
  const currency = useCurrencyLabel();

  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [gender, setGender] = useState<'MALE' | 'FEMALE' | null>(null);
  const [birthDate, setBirthDate] = useState('');
  const [marriageDate, setMarriageDate] = useState('');
  const [creditLimit, setCreditLimit] = useState('0');
  const [addresses, setAddresses] = useState<AddressRow[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultTitle = t('customers.register.addressTitleDefault');

  // A fresh form each time it opens.
  useEffect(() => {
    if (!open) return;
    setName(initialName || '');
    setMobile(initialMobile || '');
    setGender(null);
    setBirthDate('');
    setMarriageDate('');
    setCreditLimit('0');
    setAddresses(startWithAddress ? [emptyAddress(0, defaultTitle)] : []);
    setNextKey(1);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const addAddress = () => {
    setAddresses((list) => [...list, emptyAddress(nextKey, list.length === 0 ? defaultTitle : '')]);
    setNextKey((k) => k + 1);
  };
  const patchAddress = (key: number, patch: Partial<AddressRow>) =>
    setAddresses((list) => list.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  const removeAddress = (key: number) => setAddresses((list) => list.filter((a) => a.key !== key));

  const errorText = (err: any) => {
    switch (err?.code) {
      case 'CUSTOMER_MOBILE_EXISTS':
        return t('customers.register.errors.mobileExists');
      case 'INVALID_MOBILE':
        return t('customers.register.errors.invalidMobile');
      case 'ADDRESS_REQUIRED':
        return t('customers.register.errors.addressText');
      default:
        return err?.detail || err?.message || t('customers.register.errors.saveFailed');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !mobile.trim()) {
      setError(t('customers.register.errors.nameAndMobile'));
      return;
    }
    // A row left completely empty is dropped; one with a pin or title but no text is an error.
    const filled = addresses.filter((a) => a.address_text.trim() || a.postal_code?.trim() || a.latitude != null);
    if (filled.some((a) => !a.address_text.trim())) {
      setError(t('customers.register.errors.addressText'));
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const created = await createCustomer({
        name: name.trim(),
        mobile: mobile.trim(),
        gender,
        birth_date: birthDate || undefined,
        marriage_date: marriageDate || undefined,
        ...(showCredit ? { credit_limit: fromToman(creditLimit || '0') } : {}),
        addresses: filled.map((a) => ({
          title: a.title.trim() || defaultTitle,
          address_text: a.address_text.trim(),
          postal_code: a.postal_code?.trim() || undefined,
          latitude: a.latitude ?? null,
          longitude: a.longitude ?? null,
        })),
      });
      onCreated(created);
    } catch (err: any) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="sm" fullWidth aria-keyshortcuts="Escape">
      <form onSubmit={handleSubmit}>
        <DialogTitle sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
          <PersonAddIcon color="primary" />
          {t('customers.register.title')}
        </DialogTitle>
        <DialogContent dividers>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t('customers.register.name')}
                required
                fullWidth
                autoFocus
                size="small"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t('customers.register.mobile')}
                required
                fullWidth
                size="small"
                value={mobile}
                placeholder="0912…"
                helperText={t('customers.register.mobileHelper')}
                onChange={(e) => setMobile(e.target.value)}
                slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'tel' } }}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                {t('customers.register.gender')}
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={gender}
                onChange={(_e, next) => setGender(next)}
              >
                <ToggleButton value="MALE">{t('customers.register.male')}</ToggleButton>
                <ToggleButton value="FEMALE">{t('customers.register.female')}</ToggleButton>
              </ToggleButtonGroup>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <CalendarDateField
                label={t('customers.register.birthDate')}
                fullWidth
                size="small"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <CalendarDateField
                label={t('customers.register.marriageDate')}
                fullWidth
                size="small"
                value={marriageDate}
                onChange={(e) => setMarriageDate(e.target.value)}
              />
            </Grid>
            {showCredit && (
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label={
                    <>
                      {t('customers.register.creditLimit')} <VersionTag feature="customers.credit" />
                    </>
                  }
                  type="number"
                  fullWidth
                  size="small"
                  value={creditLimit}
                  placeholder="0"
                  onChange={(e) => setCreditLimit(e.target.value)}
                  slotProps={{ input: { endAdornment: <InputAdornment position="end">{currency}</InputAdornment> } }}
                />
              </Grid>
            )}
          </Grid>

          <Divider sx={{ my: 2.5 }} />

          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
              {t('customers.register.addresses')}
            </Typography>
            <Button size="small" startIcon={<AddIcon />} onClick={addAddress}>
              {t('customers.register.addAddress')}
            </Button>
          </Stack>
          {addresses.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              {t('customers.register.noAddresses')}
            </Typography>
          )}
          <Stack spacing={2}>
            {addresses.map((a) => (
              <CustomerAddressFields
                key={a.key}
                value={a}
                onChange={(patch) => patchAddress(a.key, patch)}
                onRemove={() => removeAddress(a.key)}
              />
            ))}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={saving}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <PersonAddIcon />}
          >
            {t('customers.register.submit')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
