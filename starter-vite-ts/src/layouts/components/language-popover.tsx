import type { IconButtonProps } from '@mui/material/IconButton';

import { m } from 'framer-motion';
import { useCallback } from 'react';
import { usePopover } from 'minimal-shared/hooks';

import MenuList from '@mui/material/MenuList';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';

import { useAuthStore } from 'src/store/useAuthStore';

import { FlagIcon } from 'src/components/flag-icon';
import { useSettingsContext } from 'src/components/settings';
import { CustomPopover } from 'src/components/custom-popover';
import { varTap, varHover, transitionTap } from 'src/components/animate';

// ----------------------------------------------------------------------

export type LanguagePopoverProps = IconButtonProps & {
  data?: {
    value: string;
    label: string;
    countryCode: string;
  }[];
};

export const DEFAULT_LANGS = [
  { value: 'fa', label: 'فارسی', countryCode: 'IR' },
  { value: 'en', label: 'English', countryCode: 'GB' },
];

export function LanguagePopover({ data = DEFAULT_LANGS, sx, ...other }: LanguagePopoverProps) {
  const langs = data.length > 0 ? data : DEFAULT_LANGS;
  const { open, anchorEl, onClose, onOpen } = usePopover();
  const { locale, setLocale } = useAuthStore();
  const settings = useSettingsContext();

  const currentLang = langs.find((lang) => lang.value === locale) || langs[0];

  const handleChangeLang = useCallback(
    (lang: string) => {
      setLocale(lang);
      settings.setField('direction', lang === 'fa' ? 'rtl' : 'ltr');
      onClose();
    },
    [setLocale, settings, onClose]
  );

  const renderMenuList = () => (
    <CustomPopover open={open} anchorEl={anchorEl} onClose={onClose}>
      <MenuList sx={{ width: 160, minHeight: 72 }}>
        {langs?.map((option) => (
          <MenuItem
            key={option.value}
            selected={option.value === currentLang?.value}
            onClick={() => handleChangeLang(option.value)}
            sx={{ gap: 1.5 }}
          >
            <FlagIcon code={option.countryCode} />
            {option.label}
          </MenuItem>
        ))}
      </MenuList>
    </CustomPopover>
  );

  return (
    <>
      <IconButton
        component={m.button}
        whileTap={varTap(0.96)}
        whileHover={varHover(1.04)}
        transition={transitionTap()}
        aria-label="Languages button"
        onClick={onOpen}
        sx={[
          (theme) => ({
            p: 0,
            width: 40,
            height: 40,
            ...(open && { bgcolor: theme.vars.palette.action.selected }),
          }),
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
        {...other}
      >
        <FlagIcon code={currentLang?.countryCode} />
      </IconButton>

      {renderMenuList()}
    </>
  );
}
