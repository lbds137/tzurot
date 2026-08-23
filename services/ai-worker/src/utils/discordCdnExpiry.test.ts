import { describe, it, expect } from 'vitest';
import {
  isDiscordCdnUrl,
  readDiscordCdnExpiry,
  assertDiscordCdnUrlNotExpired,
  ExpiredCdnUrlError,
  CDN_EXPIRY_SKEW_MS,
} from './discordCdnExpiry.js';

const NOW_MS = 1_800_000_000_000; // an arbitrary fixed "now" for these tests

function urlWithExSeconds(exSeconds: number): string {
  return `https://cdn.discordapp.com/attachments/1/2/x.png?ex=${exSeconds.toString(16)}&is=abc&hm=def`;
}

function urlWithExMs(exMs: number): string {
  return `https://cdn.discordapp.com/attachments/1/2/x.png?ex=${exMs.toString(16)}&is=abc&hm=def`;
}

describe('isDiscordCdnUrl', () => {
  it('is true for cdn.discordapp.com', () => {
    expect(isDiscordCdnUrl('https://cdn.discordapp.com/attachments/1/2/x.png')).toBe(true);
  });

  it('is true for media.discordapp.net', () => {
    expect(isDiscordCdnUrl('https://media.discordapp.net/attachments/1/2/x.png')).toBe(true);
  });

  it('is false for a non-Discord host', () => {
    expect(isDiscordCdnUrl('https://i.redd.it/x.jpg')).toBe(false);
  });

  it('is true for a trailing-root-dot host form (same normalization as the fetch path)', () => {
    expect(isDiscordCdnUrl('https://cdn.discordapp.com./attachments/1/2/a.png?ex=68a1b2c3')).toBe(
      true
    );
  });

  it('is false for a lookalike host (no substring match)', () => {
    expect(isDiscordCdnUrl('https://cdn.discordapp.com.attacker.io/x.png')).toBe(false);
  });

  it('is false for http (non-https)', () => {
    expect(isDiscordCdnUrl('http://cdn.discordapp.com/x.png')).toBe(false);
  });

  it('is false and does not throw on a malformed URL', () => {
    expect(() => isDiscordCdnUrl('not a url')).not.toThrow();
    expect(isDiscordCdnUrl('not a url')).toBe(false);
  });
});

describe('readDiscordCdnExpiry', () => {
  it('fails open with not-discord-cdn for a non-CDN host', () => {
    expect(readDiscordCdnExpiry('https://i.redd.it/x.jpg?ex=68123456')).toEqual({
      known: false,
      reason: 'not-discord-cdn',
    });
  });

  it('fails open with no-ex-param when ex is absent', () => {
    expect(readDiscordCdnExpiry('https://cdn.discordapp.com/attachments/1/2/x.png')).toEqual({
      known: false,
      reason: 'no-ex-param',
    });
  });

  it('fails open with unparseable-ex for a non-hex value', () => {
    const url = 'https://cdn.discordapp.com/attachments/1/2/x.png?ex=zzzz&is=abc&hm=def';
    expect(readDiscordCdnExpiry(url)).toEqual({
      known: false,
      reason: 'unparseable-ex',
    });
  });

  it('classifies a value in the epoch-seconds range as seconds', () => {
    const exSeconds = Math.floor(NOW_MS / 1000) + 3600; // 1h in the future
    const result = readDiscordCdnExpiry(urlWithExSeconds(exSeconds));
    expect(result).toEqual({ known: true, expiresAtMs: exSeconds * 1000 });
  });

  it('classifies a value in the epoch-milliseconds range as milliseconds', () => {
    const exMs = NOW_MS + 3600_000;
    const result = readDiscordCdnExpiry(urlWithExMs(exMs));
    expect(result).toEqual({ known: true, expiresAtMs: exMs });
  });

  it('fails open with unparseable-ex for a value outside both plausible ranges', () => {
    // Too small to be a plausible epoch in either unit.
    expect(readDiscordCdnExpiry(urlWithExSeconds(42))).toEqual({
      known: false,
      reason: 'unparseable-ex',
    });
  });
});

describe('expiry boundary (via assertDiscordCdnUrlNotExpired)', () => {
  it('does not throw for a live (future-ex) URL', () => {
    const exSeconds = Math.floor(NOW_MS / 1000) + 3600;
    expect(() => assertDiscordCdnUrlNotExpired(urlWithExSeconds(exSeconds), NOW_MS)).not.toThrow();
  });

  it('throws for a URL well past ex + skew', () => {
    const exSeconds = Math.floor(NOW_MS / 1000) - 3600;
    expect(() => assertDiscordCdnUrlNotExpired(urlWithExSeconds(exSeconds), NOW_MS)).toThrow(
      ExpiredCdnUrlError
    );
  });

  it('does not throw inside the skew window', () => {
    const exSeconds = Math.floor(NOW_MS / 1000) - 60;
    expect(() => assertDiscordCdnUrlNotExpired(urlWithExSeconds(exSeconds), NOW_MS)).not.toThrow();
  });

  it('fails open (no throw) for a non-hex ex value', () => {
    const url = 'https://cdn.discordapp.com/attachments/1/2/x.png?ex=not-hex';
    expect(() => assertDiscordCdnUrlNotExpired(url, NOW_MS)).not.toThrow();
  });

  it('fails open (no throw) for a missing ex param', () => {
    expect(() =>
      assertDiscordCdnUrlNotExpired('https://cdn.discordapp.com/attachments/1/2/x.png', NOW_MS)
    ).not.toThrow();
  });

  it('fails open (no throw) for a non-Discord host', () => {
    expect(() =>
      assertDiscordCdnUrlNotExpired('https://i.redd.it/x.jpg?ex=1', NOW_MS)
    ).not.toThrow();
  });
});

describe('media.discordapp.net (second allowlisted host)', () => {
  it('runs the full expiry path identically to cdn.discordapp.com', () => {
    // Well past 2017-era epoch-seconds: expired.
    const url = 'https://media.discordapp.net/attachments/1/2/a.png?ex=5d000000';
    expect(() => assertDiscordCdnUrlNotExpired(url, Date.now())).toThrow(ExpiredCdnUrlError);
  });
});

describe('assertDiscordCdnUrlNotExpired', () => {
  it('does not throw on a live URL', () => {
    const exSeconds = Math.floor(NOW_MS / 1000) + 3600;
    expect(() => assertDiscordCdnUrlNotExpired(urlWithExSeconds(exSeconds), NOW_MS)).not.toThrow();
  });

  it('throws ExpiredCdnUrlError with the right expiresAtMs on an expired URL', () => {
    const exSeconds = Math.floor((NOW_MS - CDN_EXPIRY_SKEW_MS - 3600_000) / 1000);
    const expectedExpiresAtMs = exSeconds * 1000;
    try {
      assertDiscordCdnUrlNotExpired(urlWithExSeconds(exSeconds), NOW_MS);
      expect.fail('expected assertDiscordCdnUrlNotExpired to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ExpiredCdnUrlError);
      expect((error as ExpiredCdnUrlError).expiresAtMs).toBe(expectedExpiresAtMs);
    }
  });
});
