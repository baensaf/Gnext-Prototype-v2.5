import * as fs from 'fs';
import * as path from 'path';
import { PrintRenderService, RenderDocOptions } from '../src/modules/printing/print-render.service';

/**
 * The offline till prints with a Go port of PrintRenderService (agent/internal/till/render.go),
 * so a ticket printed offline is the one the cloud prints (agent-protocol.md §13.8). Both sides
 * render the cases in agent/internal/till/testdata/tickets and must produce the stored pages
 * exactly. Change the renderer here, run this with UPDATE_TICKETS=1 to store the new pages, and
 * the agent's test fails until render.go matches.
 */
const DIR = path.resolve(__dirname, '../../agent/internal/till/testdata/tickets');

describe('offline till tickets match the cloud renderer', () => {
  const render = new PrintRenderService();
  const cases: Record<string, RenderDocOptions> = JSON.parse(fs.readFileSync(path.join(DIR, 'cases.json'), 'utf8'));

  it.each(Object.keys(cases))('%s', (name) => {
    const html = render.renderDocument(cases[name]);
    const file = path.join(DIR, `${name}.html`);
    if (process.env.UPDATE_TICKETS) fs.writeFileSync(file, html);
    expect(html).toBe(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
  });
});
