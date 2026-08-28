import React from 'react';

import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';

import { RouterLink } from 'src/routes/components';

export interface BreadcrumbsLinkProps {
  href?: string;
  icon?: React.ReactElement;
  name: string;
}

export interface CustomBreadcrumbsProps {
  action?: React.ReactNode;
  heading?: string;
  links: BreadcrumbsLinkProps[];
  moreLink?: string[];
  sx?: object;
}

export function CustomBreadcrumbs({
  links,
  action,
  heading,
  moreLink,
  sx,
  ...other
}: CustomBreadcrumbsProps) {
  const lastLink = links[links.length - 1]?.name;

  return (
    <Box sx={{ mb: { xs: 2.5, md: 3 }, ...sx }} {...other}>
      <Stack
        spacing={1.5}
        sx={{
          flexDirection: { xs: 'column', sm: 'row' },
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ flexGrow: 1 }}>
          {/* HEADING */}
          {heading && (
            <Typography variant="h4" sx={{ fontWeight: 800, mb: 1 }}>
              {heading}
            </Typography>
          )}

          {/* BREADCRUMBS */}
          {!!links.length && (
            <Breadcrumbs
              separator={<NavigateNextIcon fontSize="small" sx={{ color: 'text.disabled' }} />}
            >
              {links.map((link) => {
                const isLast = link.name === lastLink;

                return isLast ? (
                  <Typography
                    key={link.name}
                    variant="body2"
                    sx={{
                      color: 'text.primary',
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                    }}
                  >
                    {link.icon && <Box sx={{ mr: 0.75, display: 'flex' }}>{link.icon}</Box>}
                    {link.name}
                  </Typography>
                ) : (
                  <Link
                    key={link.name}
                    component={RouterLink}
                    href={link.href || '#'}
                    variant="body2"
                    sx={{
                      color: 'text.secondary',
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      '&:hover': { color: 'primary.main', textDecoration: 'underline' },
                    }}
                  >
                    {link.icon && <Box sx={{ mr: 0.75, display: 'flex' }}>{link.icon}</Box>}
                    {link.name}
                  </Link>
                );
              })}
            </Breadcrumbs>
          )}
        </Box>

        {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
      </Stack>
    </Box>
  );
}
