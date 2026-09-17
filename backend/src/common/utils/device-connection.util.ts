import { BadRequestException } from '@nestjs/common';

/** How the agent reaches a device on the branch LAN (protocol §6.1). */
export type DeviceConnection =
  | { kind: 'tcp'; host: string; port: number }
  | { kind: 'windows'; printer_name: string }
  | { kind: 'serial'; port: string; baud: number };

const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const COM_PORT = /^COM[1-9]\d{0,2}$/i;

function invalid(detail: string): BadRequestException {
  return new BadRequestException({ code: 'INVALID_CONNECTION', title: 'Invalid Device Connection', detail });
}

/**
 * Reads a connection from a form. `null`, `''` or `{ kind: 'none' }` mean "no agent: use the
 * simulator"; anything else must be complete, so the agent is never sent half a device.
 */
export function parseDeviceConnection(input: unknown, allowed: DeviceConnection['kind'][]): DeviceConnection | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw invalid('Connection must be an object.');
  const c = input as Record<string, any>;
  if (!c.kind || c.kind === 'none') return null;
  if (!allowed.includes(c.kind)) throw invalid(`Connection kind must be one of: ${allowed.join(', ')}.`);

  switch (c.kind) {
    case 'tcp': {
      const host = String(c.host ?? '').trim();
      const port = Number(c.port ?? 9100);
      if (!HOST.test(host)) throw invalid('Enter the device IP address or host name.');
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalid('Port must be between 1 and 65535.');
      return { kind: 'tcp', host, port };
    }
    case 'windows': {
      const name = String(c.printer_name ?? '').trim();
      if (!name || name.length > 160) throw invalid('Enter the printer name exactly as Windows shows it.');
      return { kind: 'windows', printer_name: name };
    }
    case 'serial': {
      const port = String(c.port ?? '').trim().toUpperCase();
      const baud = Number(c.baud ?? 9600);
      if (!COM_PORT.test(port)) throw invalid('Serial port must look like COM3.');
      if (![9600, 19200, 38400, 57600, 115200].includes(baud)) throw invalid('Baud rate must be 9600, 19200, 38400, 57600 or 115200.');
      return { kind: 'serial', port, baud };
    }
  }
  throw invalid('Unknown connection kind.');
}
