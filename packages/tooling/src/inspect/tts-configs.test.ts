/**
 * Tests for the `inspect:tts-configs` ops command.
 *
 * The implementation runs an inline tsx subprocess to query the DB. We
 * test the pure parts (script-builder output, env validation) directly,
 * and mock execFileSync to assert the subprocess is invoked correctly
 * for each environment.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('chalk', () => ({
  default: {
    cyan: (s: string) => s,
    dim: (s: string) => s,
  },
}));

const { mockExecFileSync, mockGetRailwayDatabaseUrl, mockGetRailwayEnvName } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  mockGetRailwayDatabaseUrl: vi.fn(),
  mockGetRailwayEnvName: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

vi.mock('../utils/env-runner.js', () => ({
  getRailwayDatabaseUrl: mockGetRailwayDatabaseUrl,
  getRailwayEnvName: mockGetRailwayEnvName,
}));

import { inspectTtsConfigs, buildInspectorScript } from './tts-configs.js';

describe('buildInspectorScript', () => {
  it('embeds the configured take limit in the rendered script', () => {
    const script = buildInspectorScript(200);
    expect(script).toContain('take: 200');
    expect(script).toContain("'⚠️  Result may be truncated at the ' + 200 + '-row take limit");
  });

  it('produces deterministic output for the same input', () => {
    expect(buildInspectorScript(50)).toBe(buildInspectorScript(50));
  });

  it('different take limits produce different scripts', () => {
    expect(buildInspectorScript(100)).not.toBe(buildInspectorScript(200));
  });

  it('imports the prisma factory from common-types', () => {
    const script = buildInspectorScript(200);
    expect(script).toContain(
      "import { createPrismaClient } from '@tzurot/common-types/services/prisma';"
    );
    expect(script).toContain(
      "import { DB_POOL_DEFAULTS } from '@tzurot/common-types/services/poolConfig';"
    );
  });

  it('selects exactly the columns the formatter prints', () => {
    const script = buildInspectorScript(200);
    expect(script).toContain('id: true');
    expect(script).toContain('ownerId: true');
    expect(script).toContain('name: true');
    expect(script).toContain('isGlobal: true');
    expect(script).toContain('provider: true');
  });

  it('orders results by name ascending so cross-env diffs are stable', () => {
    const script = buildInspectorScript(200);
    expect(script).toContain("orderBy: [{ name: 'asc' }]");
  });
});

describe('inspectTtsConfigs', () => {
  beforeEach(() => {
    // Guard: afterEach alone leaks DATABASE_URL if a test fails early.
    delete process.env.DATABASE_URL;
    mockExecFileSync.mockReset();
    mockGetRailwayDatabaseUrl.mockReset();
    mockGetRailwayEnvName.mockReset();
    mockGetRailwayEnvName.mockImplementation((env: string) => env);
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('uses Railway DATABASE_PUBLIC_URL for env=dev', async () => {
    mockGetRailwayDatabaseUrl.mockReturnValue('postgresql://dev-host/db');

    await inspectTtsConfigs({ env: 'dev' });

    expect(mockGetRailwayDatabaseUrl).toHaveBeenCalledWith('dev');
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
    const call = mockExecFileSync.mock.calls[0];
    expect(call[0]).toBe('tsx');
    expect(call[1]).toEqual(['-e', expect.stringContaining('prisma.ttsConfig.findMany')]);
    expect(call[2].env.DATABASE_URL).toBe('postgresql://dev-host/db');
  });

  it('uses Railway DATABASE_PUBLIC_URL for env=prod', async () => {
    mockGetRailwayDatabaseUrl.mockReturnValue('postgresql://prod-host/db');

    await inspectTtsConfigs({ env: 'prod' });

    expect(mockGetRailwayDatabaseUrl).toHaveBeenCalledWith('prod');
    const call = mockExecFileSync.mock.calls[0];
    expect(call[2].env.DATABASE_URL).toBe('postgresql://prod-host/db');
  });

  it('uses local DATABASE_URL for env=local', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/db';

    await inspectTtsConfigs({ env: 'local' });

    expect(mockGetRailwayDatabaseUrl).not.toHaveBeenCalled();
    const call = mockExecFileSync.mock.calls[0];
    expect(call[2].env.DATABASE_URL).toBe('postgresql://localhost/db');
  });

  it('throws when env=local but DATABASE_URL is not set', async () => {
    delete process.env.DATABASE_URL;

    await expect(inspectTtsConfigs({ env: 'local' })).rejects.toThrow(
      'DATABASE_URL not set in local environment'
    );
  });

  it('throws on an invalid env value', async () => {
    await expect(inspectTtsConfigs({ env: 'staging' as unknown as 'dev' })).rejects.toThrow(
      'Invalid env: staging'
    );
  });
});
