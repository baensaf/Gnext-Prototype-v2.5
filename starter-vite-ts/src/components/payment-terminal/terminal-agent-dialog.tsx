import type { PaymentDevice, TerminalConnection } from 'src/api/paymentApi';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Alert,
  Stack,
  Button,
  Dialog,
  Select,
  MenuItem,
  TextField,
  InputLabel,
  DialogTitle,
  FormControl,
  DialogContent,
  DialogActions,
} from '@mui/material';

import { paymentApi } from 'src/api/paymentApi';

// ----------------------------------------------------------------------

type Kind = 'none' | 'tcp' | 'serial';

const DRIVERS = [
  { value: 'sep', label: 'Saman (SEP)' },
  { value: 'fake', label: 'Test driver (fake)' },
];
const BAUD_RATES = ['9600', '19200', '38400', '57600', '115200'];

type Props = {
  device: PaymentDevice | null;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * How the branch agent reaches a card terminal and which protocol it speaks. A terminal with
 * no connection stays on the simulator.
 */
export function TerminalAgentDialog({ device, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<Kind>('none');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8888');
  const [serialPort, setSerialPort] = useState('');
  const [baud, setBaud] = useState('9600');
  const [driver, setDriver] = useState('sep');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const c = device?.agent_connection;
    setKind(c?.kind ?? 'none');
    setHost(c?.kind === 'tcp' ? c.host : '');
    setPort(c?.kind === 'tcp' ? String(c.port) : '8888');
    setSerialPort(c?.kind === 'serial' ? c.port : '');
    setBaud(c?.kind === 'serial' ? String(c.baud) : '9600');
    setDriver(device?.agent_driver || 'sep');
    setError(null);
  }, [device]);

  const handleSave = async () => {
    if (!device) return;
    const connection: TerminalConnection | null =
      kind === 'tcp'
        ? { kind: 'tcp', host: host.trim(), port: Number(port) }
        : kind === 'serial'
          ? { kind: 'serial', port: serialPort.trim(), baud: Number(baud) }
          : null;
    setSaving(true);
    try {
      await paymentApi.setDeviceAgent(device.id, { agentConnection: connection, agentDriver: connection ? driver : null });
      onSaved();
    } catch (err: any) {
      setError(err?.detail || err?.message || t('payments.terminalAgent.saveError', 'Could not save the terminal connection'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!device} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        {t('payments.terminalAgent.title', 'Branch agent connection')} — {device?.name}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {!device?.branch_id && (
            <Alert severity="warning">
              {t('payments.terminalAgent.needsBranch', 'This terminal is not assigned to a branch, so no branch agent can drive it.')}
            </Alert>
          )}
          <FormControl fullWidth>
            <InputLabel>{t('payments.terminalAgent.kind', 'Connection')}</InputLabel>
            <Select value={kind} label={t('payments.terminalAgent.kind', 'Connection')} onChange={(e) => setKind(e.target.value as Kind)}>
              <MenuItem value="none">{t('payments.terminalAgent.none', 'Simulated (no branch agent)')}</MenuItem>
              <MenuItem value="tcp">{t('payments.terminalAgent.tcp', 'Network (TCP)')}</MenuItem>
              <MenuItem value="serial">{t('payments.terminalAgent.serial', 'Serial port')}</MenuItem>
            </Select>
          </FormControl>

          {kind === 'tcp' && (
            <Stack direction="row" spacing={2}>
              <TextField
                label={t('payments.terminalAgent.host', 'IP address')}
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.60"
                slotProps={{ htmlInput: { dir: 'ltr' } }}
                fullWidth
                required
              />
              <TextField
                label={t('payments.terminalAgent.port', 'Port')}
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                sx={{ width: 130 }}
                required
              />
            </Stack>
          )}
          {kind === 'serial' && (
            <Stack direction="row" spacing={2}>
              <TextField
                label={t('payments.terminalAgent.serialPort', 'Serial port')}
                value={serialPort}
                onChange={(e) => setSerialPort(e.target.value.toUpperCase())}
                placeholder="COM3"
                slotProps={{ htmlInput: { dir: 'ltr' } }}
                fullWidth
                required
              />
              <FormControl sx={{ width: 150 }}>
                <InputLabel>{t('payments.terminalAgent.baud', 'Baud rate')}</InputLabel>
                <Select value={baud} label={t('payments.terminalAgent.baud', 'Baud rate')} onChange={(e) => setBaud(String(e.target.value))}>
                  {BAUD_RATES.map((b) => (
                    <MenuItem key={b} value={b}>
                      {b}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
          )}
          {kind !== 'none' && (
            <>
              <FormControl fullWidth>
                <InputLabel>{t('payments.terminalAgent.driver', 'Terminal protocol')}</InputLabel>
                <Select value={driver} label={t('payments.terminalAgent.driver', 'Terminal protocol')} onChange={(e) => setDriver(e.target.value)}>
                  {DRIVERS.map((d) => (
                    <MenuItem key={d.value} value={d.value}>
                      {d.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Alert severity="info">
                {t(
                  'payments.terminalAgent.help',
                  'Card payments at this branch are charged on this terminal through the branch agent.'
                )}
              </Alert>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {t('common.save', 'Save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
