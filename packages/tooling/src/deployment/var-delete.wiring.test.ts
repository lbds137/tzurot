/**
 * Wiring test (02-code-standards.md rule 7): every module in the
 * `runVarDelete → resolveRailwayIds → deleteRailwayVariable → railwayGraphql`
 * chain is unit-tested with its downstream collaborator mocked, so a wiring
 * bug — a field renamed between them, a shape mismatch — is invisible to
 * those tests. This file runs the REAL chain end-to-end and mocks ONLY the
 * external boundary: `node:child_process`'s `execFileSync` (the `railway
 * status --json` call) and `global.fetch` (the Railway GraphQL API call).
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
import { runVarDelete } from './var-delete.js';

const mockExecFileSync = vi.mocked(execFileSync) as unknown as Mock<(...args: unknown[]) => string>;

const RAILWAY_STATUS_FIXTURE = {
  id: 'proj-1',
  name: 'tzurot',
  environments: {
    edges: [
      { node: { id: 'env-dev', name: 'development' } },
      { node: { id: 'env-prod', name: 'production' } },
    ],
  },
  services: {
    edges: [{ node: { id: 'svc-bot', name: 'bot-client' } }],
  },
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('wiring (real chain, external boundary mocked only)', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockExecFileSync.mockReturnValue(JSON.stringify(RAILWAY_STATUS_FIXTURE));
    mockFetch = vi.fn().mockResolvedValue(jsonResponse(200, { data: { variableDelete: true } }));
    vi.stubGlobal('fetch', mockFetch);
    process.env.TZUROT_RAILWAY_API_TOKEN = 'tok-SENTINEL-do-not-leak';
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.TZUROT_RAILWAY_API_TOKEN;
  });

  it('service-scoped delete resolves ids through the real chain into the fetch body', async () => {
    await runVarDelete({
      env: 'dev',
      service: 'bot-client',
      name: 'SOME_KEY',
      dryRun: false,
      yes: true,
    });

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'railway',
      ['status', '--json'],
      expect.anything()
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-SENTINEL-do-not-leak');
    const parsedBody = JSON.parse(init.body as string) as {
      variables: { input: Record<string, unknown> };
    };
    expect(parsedBody.variables.input).toEqual({
      projectId: 'proj-1',
      environmentId: 'env-dev',
      serviceId: 'svc-bot',
      name: 'SOME_KEY',
    });
    expect(Object.hasOwn(parsedBody.variables.input, 'serviceId')).toBe(true);
  });

  it('shared (project-level) delete omits serviceId through the real chain', async () => {
    await runVarDelete({
      env: 'dev',
      service: null,
      name: 'SOME_KEY',
      dryRun: false,
      yes: true,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const parsedBody = JSON.parse(init.body as string) as {
      variables: { input: Record<string, unknown> };
    };
    expect(parsedBody.variables.input).toEqual({
      projectId: 'proj-1',
      environmentId: 'env-dev',
      name: 'SOME_KEY',
    });
    expect(Object.hasOwn(parsedBody.variables.input, 'serviceId')).toBe(false);
  });
});
