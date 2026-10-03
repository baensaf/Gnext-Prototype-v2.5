import type { Customer } from 'src/api/customerApi';

import { useTranslation } from 'react-i18next';
import React, { useRef, useState, useEffect } from 'react';

import BlockIcon from '@mui/icons-material/Block';
import SearchIcon from '@mui/icons-material/Search';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { Box, Chip, Stack, Button, TextField, Typography, Autocomplete, InputAdornment, CircularProgress } from '@mui/material';

const MIN_CHARS = 3;
const DEBOUNCE_MS = 300;

const label = (c: Customer) => `${`${c.first_name || ''} ${c.last_name || ''}`.trim()} (${c.mobile})`;

type Props = {
  value: Customer | null;
  onChange: (customer: Customer | null) => void;
  /** Best matches for what was typed (3+ characters), from the server. */
  search: (q: string) => Promise<Customer[]>;
  /** Opens the register dialog, with the digits typed so far as the mobile. */
  onRegister: (typed: string) => void;
  placeholder: string;
  disabled?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
};

/**
 * The till's customer picker. It never loads the customer list (a chain can have 500,000):
 * the cashier types a mobile or a name, and after 3 characters the server sends the best 20,
 * the exact mobile first. When nothing matches, "Register" opens the register dialog with
 * what was typed.
 */
export function PosCustomerPicker({ value, onChange, search, onRegister, placeholder, disabled, inputRef }: Props) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [options, setOptions] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);

  const typed = input.trim();
  const tooShort = typed.length < MIN_CHARS;

  useEffect(() => {
    // The input shows the picked customer's label; that is not a search.
    if (tooShort || (value && input === label(value))) {
      setOptions(value ? [value] : []);
      setLoading(false);
      return undefined;
    }
    const call = ++latest.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const found = await search(typed);
        if (call === latest.current) {
          setOptions(found);
          setFailed(false);
        }
      } catch {
        if (call === latest.current) {
          setOptions([]);
          setFailed(true);
        }
      } finally {
        if (call === latest.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  const noOptions = tooShort ? (
    <Typography variant="body2" color="text.secondary">
      {t('pos.customerSearch.typeMore', { count: MIN_CHARS })}
    </Typography>
  ) : failed ? (
    <Typography variant="body2" color="error">
      {t('pos.customerSearch.failed')}
    </Typography>
  ) : (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
      <Typography variant="body2" color="text.secondary">
        {t('pos.customerSearch.noMatch')}
      </Typography>
      <Button
        size="small"
        startIcon={<PersonAddIcon />}
        // The listbox closes on blur; act on mouse down so the click lands.
        onMouseDown={(e) => {
          e.preventDefault();
          onRegister(/^[\d\s+۰-۹٠-٩]+$/.test(typed) ? typed : '');
        }}
      >
        {t('pos.customerSearch.register')}
      </Button>
    </Stack>
  );

  return (
    <Autocomplete
      fullWidth
      size="small"
      disabled={disabled}
      value={value}
      options={options}
      // The server already filtered and ranked them.
      filterOptions={(o) => o}
      getOptionLabel={label}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      inputValue={input}
      onInputChange={(_e, next) => setInput(next)}
      onChange={(_e, next) => onChange(next)}
      loading={loading}
      noOptionsText={noOptions}
      loadingText={t('pos.customerSearch.searching')}
      renderOption={(props, c) => {
        const { key, ...rest } = props as any;
        return (
          <Box component="li" key={key} {...rest}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', width: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {`${c.first_name || ''} ${c.last_name || ''}`.trim() || '—'}
                </Typography>
                <Typography variant="caption" color="text.secondary" dir="ltr">
                  {c.mobile}
                </Typography>
              </Box>
              {c.is_blocked && <Chip size="small" color="error" icon={<BlockIcon />} label={t('customers.directory.blocked')} />}
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
