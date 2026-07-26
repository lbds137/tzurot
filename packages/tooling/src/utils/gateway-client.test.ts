import { describe, it, expect, vi, beforeEach } from 'vitest';

const execFileSyncMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ execFileSync: execFileSyncMock }));

import { getServiceClientForEnv, resolveServiceClientOrExit } from './gateway-client.js';

const RAILWAY_VARS = {
  PUBLIC_GATEWAY_URL: 'https://api-gateway-development.up.railway.app',
  RAILWAY_PUBLIC_DOMAIN: 'api-gateway-development.up.railway.app',
  INTERNAL_SERVICE_SECRET: 'secret-value',
};

describe('getServiceClientForEnv', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execFileSyncMock.mockReturnValue(JSON.stringify(RAILWAY_VARS));
  });

  it('reads the gateway credentials from the api-gateway Railway service', () => {
    const client = getServiceClientForEnv('dev');

    expect(client).toBeDefined();
    // Array args (never string interpolation) and the mapped Railway env name.
    expect(execFileSyncMock).toHaveBeenCalledWith(
      'railway',
      ['variables', '--environment', 'development', '--service', 'api-gateway', '--json'],
      expect.objectContaining({ encoding: 'utf-8' })
    );
  });

  it('maps prod to the production Railway environment', () => {
    getServiceClientForEnv('prod');

    expect(execFileSyncMock.mock.calls[0][1]).toContain('production');
  });

  it('falls back to the public domain when PUBLIC_GATEWAY_URL is unset', () => {
    const { PUBLIC_GATEWAY_URL: _dropped, ...withoutUrl } = RAILWAY_VARS;
    execFileSyncMock.mockReturnValue(JSON.stringify(withoutUrl));

    // Constructs without throwing — the bare domain gets an https:// scheme.
    expect(() => getServiceClientForEnv('dev')).not.toThrow();
  });

  it('throws an actionable error naming the missing secret', () => {
    execFileSyncMock.mockReturnValue(
      JSON.stringify({ PUBLIC_GATEWAY_URL: RAILWAY_VARS.PUBLIC_GATEWAY_URL })
    );

    // An opaque 401 later is much worse than a named variable now.
    expect(() => getServiceClientForEnv('dev')).toThrow(/INTERNAL_SERVICE_SECRET/);
    expect(() => getServiceClientForEnv('dev')).toThrow(/api-gateway/);
  });

  it('reads local credentials from the ambient env, not Railway', () => {
    const prevUrl = process.env.PUBLIC_GATEWAY_URL;
    const prevSecret = process.env.INTERNAL_SERVICE_SECRET;
    process.env.PUBLIC_GATEWAY_URL = 'http://localhost:3000';
    process.env.INTERNAL_SERVICE_SECRET = 'local-secret';
    try {
      expect(getServiceClientForEnv('local')).toBeDefined();
      expect(execFileSyncMock).not.toHaveBeenCalled();
    } finally {
      process.env.PUBLIC_GATEWAY_URL = prevUrl;
      process.env.INTERNAL_SERVICE_SECRET = prevSecret;
    }
  });

  it('throws when the local gateway URL is unset', () => {
    const prevUrl = process.env.PUBLIC_GATEWAY_URL;
    const prevGateway = process.env.GATEWAY_URL;
    delete process.env.PUBLIC_GATEWAY_URL;
    delete process.env.GATEWAY_URL;
    try {
      expect(() => getServiceClientForEnv('local')).toThrow(/PUBLIC_GATEWAY_URL/);
    } finally {
      process.env.PUBLIC_GATEWAY_URL = prevUrl;
      process.env.GATEWAY_URL = prevGateway;
    }
  });
});

describe('resolveServiceClientOrExit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    execFileSyncMock.mockReturnValue(JSON.stringify(RAILWAY_VARS));
  });

  it('returns the client and leaves the exit code alone on success', () => {
    expect(resolveServiceClientOrExit('dev')).not.toBeNull();
    expect(process.exitCode).toBeUndefined();
  });

  it('reports the actionable message and exits nonzero instead of throwing', () => {
    // Credential resolution fails routinely (Railway CLI not logged in, a
    // missing variable). Every gateway-backed command routes through here, so
    // an uncaught throw would surface as an unhandled rejection in all of them.
    execFileSyncMock.mockImplementation(() => {
      throw new Error('Check that the Railway CLI is logged in');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(resolveServiceClientOrExit('prod')).toBeNull();

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Railway CLI is logged in'));
    errorSpy.mockRestore();
    process.exitCode = undefined;
  });
});
