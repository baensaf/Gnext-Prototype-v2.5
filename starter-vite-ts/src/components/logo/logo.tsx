import type { LinkProps } from '@mui/material/Link';

import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { mergeClasses } from 'minimal-shared/utils';

import Link from '@mui/material/Link';
import { styled, useTheme } from '@mui/material/styles';

import { RouterLink } from 'src/routes/components';

import { logoClasses } from './classes';

// ----------------------------------------------------------------------

export type LogoProps = LinkProps & {
  isSingle?: boolean;
  disabled?: boolean;
};

export function Logo({
  sx,
  disabled,
  className,
  href = '/',
  isSingle = true,
  ...other
}: LogoProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const uniqueId = useId();

  const TEXT_PRIMARY = theme.vars.palette.text.primary;
  const PRIMARY_LIGHTER = theme.vars.palette.primary.lighter;
  const PRIMARY_MAIN = theme.vars.palette.primary.main;
  const PRIMARY_DARK = theme.vars.palette.primary.dark;

  // The Gnext mark: a white G on a rounded tile, drawn on a 512 grid and scaled to `size`.
  // The same artwork, in the default green, is public/logo/logo-single.svg, the favicon and
  // the local agent's icon (agent/cmd/gnext-agent/winres/icon.png).
  const mark = (size: number) => {
    const k = size / 512;
    return (
      <>
        <defs>
          <linearGradient
            id={`${uniqueId}-bg`}
            x1={64 * k}
            y1={32 * k}
            x2={448 * k}
            y2={480 * k}
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor={PRIMARY_MAIN} />
            <stop offset="1" stopColor={PRIMARY_DARK} />
          </linearGradient>
        </defs>
        <rect width={size} height={size} rx={116 * k} fill={`url(#${uniqueId}-bg)`} />
        <g transform={`scale(${k})`}>
          <path
            d="M349.3 162.7A132 132 0 1 0 388 256H268"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="64"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="412" cy="116" r="28" fill={PRIMARY_LIGHTER} />
        </g>
      </>
    );
  };

  const singleLogo = (
    <svg width="100%" height="100%" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      {mark(512)}
    </svg>
  );

  const fullLogo = (
    <svg width="100%" height="100%" viewBox="0 0 360 128" xmlns="http://www.w3.org/2000/svg">
      {mark(128)}
      <text
        x="148"
        y="90"
        fill={TEXT_PRIMARY}
        fontFamily={theme.typography.fontFamily}
        fontSize="72"
        fontWeight="700"
        letterSpacing="-1"
        direction="ltr"
      >
        Gnext
      </text>
    </svg>
  );

  return (
    <LogoRoot
      component={RouterLink}
      href={href}
      aria-label={t('app.title', 'Gnext')}
      underline="none"
      className={mergeClasses([logoClasses.root, className])}
      sx={[
        {
          width: 40,
          height: 40,
          ...(!isSingle && { width: 102, height: 36 }),
          ...(disabled && { pointerEvents: 'none' }),
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      {isSingle ? singleLogo : fullLogo}
    </LogoRoot>
  );
}

// ----------------------------------------------------------------------

const LogoRoot = styled(Link)(() => ({
  flexShrink: 0,
  color: 'transparent',
  display: 'inline-flex',
  verticalAlign: 'middle',
}));
