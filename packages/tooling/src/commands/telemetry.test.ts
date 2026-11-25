/**
 * Registration tests for `telemetry:upstream`: an omitted `--days` must reach
 * the report as undefined (so the report's retention default applies), and the
 * help text must name the retention constant rather than a literal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cac } from 'cac';
import { registerTelemetryCommands } from './telemetry.js';
import { telemetryUpstreamReport } from '../telemetry/upstream-report.js';
import { DIAGNOSTIC_RETENTION_DAYS } from '@tzurot/common-types/constants/diagnostics';

vi.mock('../telemetry/upstream-report.js', () => ({
  telemetryUpstreamReport: vi.fn().mockResolvedValue(undefined),
}));

const mockUpstreamReport = vi.mocked(telemetryUpstreamReport);

describe('registerTelemetryCommands: telemetry:upstream', () => {
  let cli: ReturnType<typeof cac>;

  beforeEach(() => {
    cli = cac('test');
    registerTelemetryCommands(cli);
    mockUpstreamReport.mockClear();
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('passes days as undefined when --days is omitted, so the report default applies', async () => {
    cli.parse(['node', 'test', 'telemetry:upstream', '--env', 'dev'], { run: false });
    await cli.runMatchedCommand();

    expect(mockUpstreamReport).toHaveBeenCalledTimes(1);
    expect(mockUpstreamReport).toHaveBeenCalledWith(
      expect.objectContaining({ env: 'dev', days: undefined })
    );
  });

  it('declares no cac default on --days, so the retention constant is the only default', () => {
    const command = cli.commands.find(c => c.name === 'telemetry:upstream');
    const days = command?.options.find(o => o.name === 'days');

    expect(days).toBeDefined();
    expect(days?.config.default).toBeUndefined();
  });

  it('builds the --days help text from DIAGNOSTIC_RETENTION_DAYS', () => {
    const command = cli.commands.find(c => c.name === 'telemetry:upstream');
    const days = command?.options.find(o => o.name === 'days');

    expect(days?.description).toBe(
      `Trailing window in days (diagnostic retention is ${DIAGNOSTIC_RETENTION_DAYS})`
    );
  });
});
