import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';
import { validateDiscordCdnUrl } from './discordCdnGuard.js';

const { mockGetConfig } = vi.hoisted(() => ({ mockGetConfig: vi.fn() }));

vi.mock('@tzurot/common-types/config/config', () => ({ getConfig: mockGetConfig }));

beforeEach(() => mockGetConfig.mockReturnValue({ DISCORD_INSTANCE_ORIGIN: undefined }));

function mockLogger(): Logger {
  return { warn: vi.fn() } as unknown as Logger;
}

describe('validateDiscordCdnUrl', () => {
  it('accepts cdn.discordapp.com URLs', () => {
    const result = validateDiscordCdnUrl('https://cdn.discordapp.com/attachments/1/2/file.png');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.hostname).toBe('cdn.discordapp.com');
    }
  });

  it('accepts media.discordapp.net URLs', () => {
    const result = validateDiscordCdnUrl('https://media.discordapp.net/external/abc/image.jpg');
    expect(result.ok).toBe(true);
  });

  it('rejects URLs with unexpected hosts', () => {
    const result = validateDiscordCdnUrl('https://evil.example.com/file.png');
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'unexpected-host') {
      expect(result.rawHost).toBe('evil.example.com');
    } else {
      throw new Error('expected unexpected-host failure variant');
    }
  });

  it('rejects malformed URLs', () => {
    const result = validateDiscordCdnUrl('not-a-url');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid-url');
    }
  });

  it('rejects non-https protocols even with allowed host', () => {
    const result = validateDiscordCdnUrl('http://cdn.discordapp.com/attachments/1/2/file.png');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('non-https');
    }
  });

  it('logs a warning when host is unexpected and logger is provided', () => {
    const logger = mockLogger();
    validateDiscordCdnUrl('https://evil.example.com/file.png', logger);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'evil.example.com' }),
      expect.stringMatching(/Unexpected attachment URL host/)
    );
  });

  it('does not log when host is valid', () => {
    const logger = mockLogger();
    validateDiscordCdnUrl('https://cdn.discordapp.com/x.png', logger);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('validateDiscordCdnUrl with a configured instance origin', () => {
  const ORIGIN = 'https://deck.tailnet.example:8443';

  it('rejects an instance-origin URL when no origin is configured', () => {
    const result = validateDiscordCdnUrl(`${ORIGIN}/attachments/a.png`, undefined, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unexpected-host');
    }
  });

  it('accepts a URL under the configured instance origin', () => {
    const result = validateDiscordCdnUrl(`${ORIGIN}/attachments/a.png`, undefined, ORIGIN);
    expect(result).toEqual({ ok: true, hostname: 'deck.tailnet.example' });
  });

  it('rejects the same host on a different port', () => {
    const result = validateDiscordCdnUrl(
      'https://deck.tailnet.example:9443/attachments/a.png',
      undefined,
      ORIGIN
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unexpected-host');
    }
  });

  it('rejects http even on the configured host and port', () => {
    const result = validateDiscordCdnUrl(
      'http://deck.tailnet.example:8443/attachments/a.png',
      undefined,
      ORIGIN
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('non-https');
    }
  });

  it('rejects a look-alike host', () => {
    const result = validateDiscordCdnUrl(
      'https://deck.tailnet.example.evil.io:8443/attachments/a.png',
      undefined,
      ORIGIN
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unexpected-host');
    }
  });

  it('rejects the instance REST API path even though it shares the origin', () => {
    const result = validateDiscordCdnUrl(`${ORIGIN}/api/v10/users/@me`, undefined, ORIGIN);
    expect(result.ok).toBe(false);
  });
  it('still accepts a real Discord CDN URL when an instance origin is configured', () => {
    const result = validateDiscordCdnUrl(
      'https://cdn.discordapp.com/attachments/1/2/file.png',
      undefined,
      ORIGIN
    );
    expect(result.ok).toBe(true);
  });
  it('accepts an instance-origin URL via getConfig when no explicit origin param is passed', () => {
    mockGetConfig.mockReturnValue({ DISCORD_INSTANCE_ORIGIN: ORIGIN });
    const result = validateDiscordCdnUrl(`${ORIGIN}/attachments/a.png`);
    expect(result).toEqual({ ok: true, hostname: 'deck.tailnet.example' });
  });
});
