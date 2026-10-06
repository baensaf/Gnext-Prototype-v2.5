import { useTranslation } from 'react-i18next';

import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';

import { agentMode } from 'src/utils/agent-mode';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';

// ----------------------------------------------------------------------

/**
 * Says where this copy of the app runs: on the branch PC itself, or on another register that
 * reaches the agent over the branch network. The agent's version is in its tooltip. Renders
 * nothing outside agent mode.
 */
export function AgentChip() {
  const { t } = useTranslation();

  if (!agentMode) return null;

  return (
    <Tooltip
      title={t('agent.chip.tooltip', 'Gnext agent {{version}}', { version: agentMode.version || '?' })}
    >
      <Box component="span" sx={{ mr: 0.5, display: { xs: 'none', sm: 'inline-flex' } }}>
        <Label
          color="info"
          startIcon={<Iconify width={16} icon="solar:monitor-bold" />}
          sx={{ height: 24 }}
        >
          {agentMode.lan
            ? t('agent.chip.lan', 'Register on the branch network')
            : t('agent.chip.branchPc', 'Branch PC')}
        </Label>
      </Box>
    </Tooltip>
  );
}
