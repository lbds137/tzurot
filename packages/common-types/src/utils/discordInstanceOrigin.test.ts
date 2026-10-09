import { describe, it, expect } from 'vitest';
import {
  normalizeDiscordInstanceOrigin,
  discordRestOptions,
  matchesInstanceOrigin,
  matchesInstanceCdnUrl,
  escapeRegExpLiteral,
  instanceMessageLinkPattern,
} from './discordInstanceOrigin.js';

const ORIGIN = 'https://deck.tailnet.example:8443';
const IPV6_ORIGIN_ROOT = 'https://[::1]:8443';
const buildIpv6MessageLinkRegex = () => new RegExp(instanceMessageLinkPattern(IPV6_ORIGIN_ROOT));

describe('normalizeDiscordInstanceOrigin', () => {
  it('accepts a bare origin, with or without a trailing slash', () => {
    expect(normalizeDiscordInstanceOrigin(ORIGIN)).toBe(ORIGIN);
    expect(normalizeDiscordInstanceOrigin(`${ORIGIN}/`)).toBe(ORIGIN);
  });

  it('strips a default https port', () => {
    expect(normalizeDiscordInstanceOrigin('https://x.example:443')).toBe('https://x.example');
  });
  it('accepts an IPv6-literal origin', () =>
    expect(normalizeDiscordInstanceOrigin(IPV6_ORIGIN_ROOT)).toBe(IPV6_ORIGIN_ROOT));
  it('accepts an IPv6-literal origin with a trailing slash', () =>
    expect(normalizeDiscordInstanceOrigin(`${IPV6_ORIGIN_ROOT}/`)).toBe(IPV6_ORIGIN_ROOT));

  it('normalizes an uppercase host to lowercase', () => {
    expect(normalizeDiscordInstanceOrigin('https://DECK.TAILNET.EXAMPLE:8443')).toBe(ORIGIN);
  });

  it('throws for a non-https scheme', () => {
    expect(() => normalizeDiscordInstanceOrigin('http://deck.tailnet.example:8443')).toThrow();
  });

  it('throws for a path beyond root', () => {
    expect(() => normalizeDiscordInstanceOrigin(`${ORIGIN}/api`)).toThrow();
  });

  it('throws for a query string', () => {
    expect(() => normalizeDiscordInstanceOrigin(`${ORIGIN}/?x=1`)).toThrow();
  });

  it('throws for a fragment', () => {
    expect(() => normalizeDiscordInstanceOrigin(`${ORIGIN}/#frag`)).toThrow();
  });

  it('throws for embedded credentials', () => {
    expect(() => normalizeDiscordInstanceOrigin('https://u:p@h.example')).toThrow();
  });

  it('throws for a non-URL string', () => {
    expect(() => normalizeDiscordInstanceOrigin('not a url')).toThrow();
  });
});

describe('discordRestOptions', () => {
  it('returns undefined when origin is undefined', () => {
    expect(discordRestOptions(undefined)).toBeUndefined();
  });

  it('builds api/cdn/mediaProxy from the origin', () => {
    expect(discordRestOptions(ORIGIN)).toEqual({
      api: `${ORIGIN}/api`,
      cdn: ORIGIN,
      mediaProxy: ORIGIN,
    });
  });
});

describe('matchesInstanceOrigin', () => {
  it('is false when origin is unset', () => {
    expect(matchesInstanceOrigin(new URL(`${ORIGIN}/x`), undefined)).toBe(false);
  });

  it('is true for a URL under the configured origin, ignoring path/query', () => {
    expect(matchesInstanceOrigin(new URL(`${ORIGIN}/attachments/1/2/a.png?ex=1`), ORIGIN)).toBe(
      true
    );
  });

  it('is false for the same host on a different port', () => {
    expect(matchesInstanceOrigin(new URL('https://deck.tailnet.example:9443/x'), ORIGIN)).toBe(
      false
    );
  });

  it('is false for the same host with no port', () => {
    expect(matchesInstanceOrigin(new URL('https://deck.tailnet.example/x'), ORIGIN)).toBe(false);
  });

  it('is false for http on the same host and port', () => {
    expect(matchesInstanceOrigin(new URL('http://deck.tailnet.example:8443/x'), ORIGIN)).toBe(
      false
    );
  });

  it('is false for a look-alike host with the origin as a prefix', () => {
    expect(
      matchesInstanceOrigin(new URL('https://deck.tailnet.example.evil.io:8443/x'), ORIGIN)
    ).toBe(false);
  });

  it('is false for a look-alike host with the origin as a suffix', () => {
    expect(matchesInstanceOrigin(new URL('https://xdeck.tailnet.example:8443/x'), ORIGIN)).toBe(
      false
    );
  });

  it('is false when the candidate URL carries credentials', () => {
    expect(matchesInstanceOrigin(new URL('https://u:p@deck.tailnet.example:8443/x'), ORIGIN)).toBe(
      false
    );
  });

  it('matches an origin on the default port only without an explicit port', () => {
    const defaultPortOrigin = 'https://inst.example';
    expect(matchesInstanceOrigin(new URL('https://inst.example/x'), defaultPortOrigin)).toBe(true);
    expect(matchesInstanceOrigin(new URL('https://inst.example:8443/x'), defaultPortOrigin)).toBe(
      false
    );
  });
  it('is true for an IPv6-literal origin on the same host+port', () => {
    expect(matchesInstanceOrigin(new URL(`${IPV6_ORIGIN_ROOT}/x`), IPV6_ORIGIN_ROOT)).toBe(true);
  });
  it('is false for an IPv6-literal origin on a different port', () =>
    expect(matchesInstanceOrigin(new URL('https://[::1]:9443/x'), IPV6_ORIGIN_ROOT)).toBe(false));
  it('is false for a different IPv6-literal host on the same port', () =>
    expect(matchesInstanceOrigin(new URL('https://[::2]:8443/x'), IPV6_ORIGIN_ROOT)).toBe(false));
  it('is false for http on the same IPv6-literal host and port', () =>
    expect(matchesInstanceOrigin(new URL('http://[::1]:8443/x'), IPV6_ORIGIN_ROOT)).toBe(false));
});

describe('matchesInstanceCdnUrl', () => {
  it('accepts an allowed CDN prefix under the origin', () => {
    expect(matchesInstanceCdnUrl(new URL(`${ORIGIN}/attachments/1/2/a.png`), ORIGIN)).toBe(true);
  });
  it('rejects the instance REST API path', () => {
    expect(matchesInstanceCdnUrl(new URL(`${ORIGIN}/api/v10/users/@me`), ORIGIN)).toBe(false);
  });
  it('rejects a path-traversal-style /api/attachments/ segment', () => {
    expect(matchesInstanceCdnUrl(new URL(`${ORIGIN}/api/attachments/x`), ORIGIN)).toBe(false);
  });
  it('rejects a segment that merely starts with an allowed prefix', () => {
    expect(matchesInstanceCdnUrl(new URL(`${ORIGIN}/attachmentsX/1`), ORIGIN)).toBe(false);
  });
  it('rejects the bare root path', () => {
    expect(matchesInstanceCdnUrl(new URL(`${ORIGIN}/`), ORIGIN)).toBe(false);
  });
  it('rejects a bare origin with no path segment', () => {
    expect(matchesInstanceCdnUrl(new URL(ORIGIN), ORIGIN)).toBe(false);
  });
  it('rejects an allowed path on a non-origin host', () => {
    expect(
      matchesInstanceCdnUrl(new URL('https://evil.example/attachments/1/2/a.png'), ORIGIN)
    ).toBe(false);
  });
  it('is false when origin is undefined', () => {
    expect(matchesInstanceCdnUrl(new URL(`${ORIGIN}/attachments/1/2/a.png`), undefined)).toBe(
      false
    );
  });
});
describe('escapeRegExpLiteral', () => {
  it('escapes regex metacharacters so a literal match no longer matches an unescaped shape', () => {
    const pattern = new RegExp(escapeRegExpLiteral('a.b'));
    expect(pattern.test('a.b')).toBe(true);
    expect(pattern.test('axb')).toBe(false);
  });
});

describe('instanceMessageLinkPattern', () => {
  it('matches a guild message link under the origin, capturing guild/channel/message ids', () => {
    const regex = new RegExp(instanceMessageLinkPattern(ORIGIN));
    const match = regex.exec(`${ORIGIN}/channels/123/456/789`);
    expect(match?.[1]).toBe('123');
    expect(match?.[2]).toBe('456');
    expect(match?.[3]).toBe('789');
  });

  it('matches a DM link (@me) under the origin', () => {
    const regex = new RegExp(instanceMessageLinkPattern(ORIGIN));
    const match = regex.exec(`${ORIGIN}/channels/@me/456/789`);
    expect(match?.[1]).toBe('@me');
  });

  it('does not match the same path on a different port', () => {
    const regex = new RegExp(instanceMessageLinkPattern(ORIGIN));
    expect(regex.test('https://deck.tailnet.example:9443/channels/1/2/3')).toBe(false);
  });

  it('does not match a look-alike host', () => {
    const regex = new RegExp(instanceMessageLinkPattern(ORIGIN));
    expect(regex.test('https://deck.tailnet.example.evil.io:8443/channels/1/2/3')).toBe(false);
  });
  it('matches a message link under an IPv6-literal origin', () =>
    expect(buildIpv6MessageLinkRegex().exec(`${IPV6_ORIGIN_ROOT}/channels/1/2/3`)?.[3]).toBe('3'));
});
