import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getRailwayRedisUrl,
  buildInspectorRedisConfig,
  DEFAULT_QUEUE_NAME,
  type ExecFn,
} from './bullmqConnection.js';

describe('getRailwayRedisUrl', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.REDIS_URL;
  });

  it('local: returns REDIS_URL env var, defaulting to localhost', async () => {
    process.env.REDIS_URL = 'redis://custom:1234';
    expect(await getRailwayRedisUrl('local')).toBe('redis://custom:1234');

    delete process.env.REDIS_URL;
    expect(await getRailwayRedisUrl('local')).toBe('redis://localhost:6379');
  });

  it('remote: prefers REDIS_PUBLIC_URL over the internal REDIS_URL', async () => {
    // The internal URL only resolves inside Railway's network — returning it
    // off-platform produces a client that hangs instead of connecting.
    const exec: ExecFn = vi.fn().mockReturnValue(
      JSON.stringify({
        REDIS_URL: 'redis://default:pw@redis.railway.internal:6379',
        REDIS_PUBLIC_URL: 'redis://default:pw@proxy.rlwy.net:46994',
      })
    );

    expect(await getRailwayRedisUrl('prod', exec)).toBe('redis://default:pw@proxy.rlwy.net:46994');
  });

  it('remote: queries the capitalized "Redis" service name first (the template default)', async () => {
    const exec = vi.fn().mockReturnValue(JSON.stringify({ REDIS_PUBLIC_URL: 'redis://x' }));

    await getRailwayRedisUrl('prod', exec as ExecFn);

    expect(exec).toHaveBeenCalledWith('railway', [
      'variables',
      '--json',
      '--service',
      'Redis',
      '--environment',
      'production',
    ]);
  });

  it('remote: falls back to the lowercase service name when the capitalized lookup fails', async () => {
    const exec = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('service not found');
      })
      .mockReturnValueOnce(JSON.stringify({ REDIS_PUBLIC_URL: 'redis://lower' }));

    expect(await getRailwayRedisUrl('dev', exec as ExecFn)).toBe('redis://lower');
    expect(exec).toHaveBeenNthCalledWith(
      2,
      'railway',
      expect.arrayContaining(['--service', 'redis', '--environment', 'development'])
    );
  });

  it('remote: falls back to REDIS_URL when no public URL exists, and null when neither does', async () => {
    const withInternalOnly: ExecFn = vi
      .fn()
      .mockReturnValue(JSON.stringify({ REDIS_URL: 'redis://internal-only' }));
    expect(await getRailwayRedisUrl('prod', withInternalOnly)).toBe('redis://internal-only');

    const withNeither = vi.fn().mockReturnValue(JSON.stringify({ OTHER: 'x' }));
    expect(await getRailwayRedisUrl('prod', withNeither as ExecFn)).toBeNull();
  });
});

describe('buildInspectorRedisConfig', () => {
  it('always selects IPv4 — this tooling runs off-platform against localhost or the public proxy', () => {
    const config = buildInspectorRedisConfig('redis://default:pw@proxy.rlwy.net:46994');

    expect(config.family).toBe(4);
    expect(config.host).toBe('proxy.rlwy.net');
    expect(config.port).toBe(46994);
  });
});

describe('DEFAULT_QUEUE_NAME', () => {
  it("matches ai-worker's main queue", () => {
    expect(DEFAULT_QUEUE_NAME).toBe('ai-requests');
  });
});
