import type { Customer } from 'src/api/customerApi';

import { useTranslation } from 'react-i18next';
import React, { useRef, useState, useEffect } from 'react';

import SearchIcon from '@mui/icons-material/Search';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { Box, Stack, TextField, Typography, Autocomplete, InputAdornment, CircularProgress } from '@mui/material';

import { localMobile } from 'src/utils/phone';

const MIN_CHARS = 3;
const DEBOUNCE_MS = 300;

/** The "Register new customer" row, always last in the list. */
const REGISTER_ID = '__register__';
const REGISTER = { id: REGISTER_ID } as Customer;
const isRegister = (c: Customer | null | undefined) => c?.id === REGISTER_ID;

const label = (c: Customer) => `${`${c.first_name || ''} ${c.last_name || ''}`.trim()} (${localMobile(c.mobile)})`;

/** What the cashier typed, as the register form's mobile (digits) or name (letters). */
const prefillFrom = (typed: string): { mobile?: string; name?: string } => {
  const text = typed.trim();
  if (!text) return {};
  if (/^[\d\s+۰-۹٠-٩-]+$/.test(text)) return { mobile: text };
  if (/\p{L}/u.test(text)) return { name: text };
  return {};
};

type Props = {
  value: Customer | null;
  onChange: (customer: Customer | null) => void;
  /** Best matches for what was typed (3+ characters), from the server. */
  search: (q: string) => Promise<Customer[]>;
  /** Opens the register dialog, with what was typed as the mobile or the name. */
  onRegister: (prefill: { mobile?: string; name?: string }) => void;
  placeholder: string;
  disabled?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
};

/**
 * The till's customer picker. It never loads the customer list (a chain can have 500,000):
 * the cashier types a mobile or a name, and after 3 characters the server sends the best 20,
 * the exact mobile first. The last row is always "Register new customer" (matches or not,
 * typed or not), so there is no separate add button; it opens the register form with what
 * was typed.
 */
export function PosCustomerPicker({ value, onChange, search, onRegister, placeholder, disabled, inputRef }: Props) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [found, setFound] = useState<Customer[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);

  const typed = input.trim();
  const showingValue = !!value && input === label(value);
  const tooShort = typed.length < MIN_CHARS || showingValue;

  useEffect(() => {
    // The input shows the picked customer's label; that is not a search.
    if (tooShort) {
      latest.current += 1;
      setFound(value ? [value] : []);
      setSearched(false);
      setLoading(false);
      return undefined;
    }
    const call = ++latest.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await search(typed);
        if (call === latest.current) {
          setFound(result);
          setFailed(false);
          setSearched(true);
        }
      } catch {
        if (call === latest.current) {
          setFound([]);
          setFailed(true);
          setSearched(true);
        }
      } finally {
        if (call === latest.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, showingValue]);

  // The note under "Register new customer": why the list above it is short or empty.
  const hint =
    typed.length < MIN_CHARS && !showingValue
      ? t('pos.customerSearch.typeMore', { count: MIN_CHARS })
      : loading
        ? t('pos.customerSearch.searching')
        : failed
          ? t('pos.customerSearch.failed')
          : searched && found.length === 0
            ? t('pos.customerSearch.noMatch')
            : '';

  return (
    <Autocomplete
      fullWidth
      size="small"
      // The first match is ready for Enter, as is "register new" when nothing matches. While the
      // search is out, "register new" waits, so an Enter typed ahead of the answer picks the
      // customer once found instead of opening a form for a number already on file.
      autoHighlight
      getOptionDisabled={(c) => isRegister(c) && (loading || (!tooShort && !searched))}
      disabled={disabled}
      value={value}
      options={[...found, REGISTER]}
      // The server already filtered and ranked them.
      filterOptions={(o) => o}
      // The register row keeps whatever was typed in the box.
      getOptionLabel={(c) => (isRegister(c) ? input : label(c))}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      inputValue={input}
      onInputChange={(_e, next) => setInput(next)}
      onChange={(_e, next) => {
        if (isRegister(next)) {
          onRegister(showingValue ? {} : prefillFrom(typed));
          return;
        }
        onChange(next);
      }}
      renderOption={(props, c) => {
        const { key, ...rest } = props as any;
        if (isRegister(c)) {
          return (
            <Box component="li" key={key} {...rest} sx={{ borderTop: found.length ? 1 : 0, borderColor: 'divider' }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', width: 1 }}>
                <PersonAddIcon fontSize="small" color="primary" />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" color="primary" sx={{ fontWeight: 600 }}>
                    {t('pos.customerSearch.registerNew')}
                  </Typography>
                  {hint && (
                    <Typography variant="caption" color={failed ? 'error' : 'text.secondary'}>
                      {hint}
                    </Typography>
                  )}
                </Box>
              </Stack>
            </Box>
          );
        }
        return (
          <Box component="li" key={key} {...rest}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', width: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {`${c.first_name || ''} ${c.last_name || ''}`.trim() || '—'}
                </Typography>
                <Typography variant="caption" color="text.secondary" dir="ltr">
                  {localMobile(c.mobile)}
                </Typography>
              </Box>
            </Stack>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          inputRef={inputRef}
          label={t('pos.customer')}
          placeholder={placeholder}
          slotProps={{
            ...params.slotProps,
            inputLabel: { ...params.slotProps.inputLabel, shrink: true },
            input: {
              ...params.slotProps.input,
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: (
                <>
                  {loading ? <CircularProgress color="inherit" size={16} /> : null}
                  {params.slotProps.input.endAdornment}
                </>
              ),
            },
          }}
        />
      )}
    />
  );
}
