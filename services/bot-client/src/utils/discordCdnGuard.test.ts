import { describe, it, expect, vi } from 'vitest';
import type { Logger } from 'pino';
import { validateDiscordCdnUrl } from './discordCdnGuard.js';

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
      expect(result.reason).toBe('invalid-url');
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
