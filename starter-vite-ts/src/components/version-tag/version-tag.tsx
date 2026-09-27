import type { Theme, SxProps } from '@mui/material/styles';
import type { LabelColor } from 'src/components/label';
import type { PhaseLabel, LabelledFeature } from 'src/config/version-labels';

import { create } from 'zustand';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';

import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';

import { pageLabel, FEATURE_LABELS } from 'src/config/version-labels';

import { Label } from 'src/components/label';

// ----------------------------------------------------------------------

const SHOW_KEY = 'gnext_version_labels';

function readShow(): boolean {
  try {
    return localStorage.getItem(SHOW_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** On by default: the labels are there for whoever explores the prototype. */
export const useVersionLabels = create<{ show: boolean; toggle: () => void }>((set, get) => ({
  show: readShow(),
  toggle: () => {
    const show = !get().show;
    try {
      localStorage.setItem(SHOW_KEY, show ? 'on' : 'off');
    } catch {
      // The choice then lasts until the page reloads.
    }
    set({ show });
  },
}));

const COLORS: Record<PhaseLabel, LabelColor> = {
  V1: 'success',
  V2: 'info',
  V3: 'warning',
  V4: 'secondary',
  F: 'error',
};

type VersionTagProps = {
  /** A feature from FEATURE_LABELS, or a label given directly. */
  feature?: LabelledFeature;
  label?: PhaseLabel;
  sx?: SxProps<Theme>;
};

/** A small V1–V4 / F chip that says which Phase 1 version ships the thing beside it. */
export function VersionTag({ feature, label, sx }: VersionTagProps) {
  const { t } = useTranslation();
  const show = useVersionLabels((s) => s.show);
  const value = label ?? (feature ? FEATURE_LABELS[feature] : undefined);
  if (!show || !value) return null;

  return (
    <Tooltip title={t(`versionLabels.meaning.${value}`)}>
      <Label
        color={COLORS[value]}
        variant="soft"
        sx={[{ flexShrink: 0, cursor: 'help' }, ...(Array.isArray(sx) ? sx : [sx])]}
      >
        {value}
      </Label>
    </Tooltip>
  );
}

/**
 * The header's switch for the labels. While they are on it shows the version of the page on
 * screen; a page nobody has labelled yet shows a neutral chip.
 */
export function VersionLabelsButton() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { show, toggle } = useVersionLabels();
  const value = pageLabel(pathname);

  return (
    <Tooltip title={show ? t('versionLabels.hide') : t('versionLabels.show')}>
      <IconButton onClick={toggle} aria-pressed={show} sx={{ px: 0.75, borderRadius: 1 }}>
        <Label color={show && value ? COLORS[value] : 'default'} variant={show ? 'soft' : 'outlined'}>
          {show ? (value ?? t('versionLabels.unlabelled')) : t('versionLabels.off')}
        </Label>
      </IconButton>
    </Tooltip>
  );
}
