// Tests for the safe external-image fetcher.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as dns } from 'node:dns';
import {
  validateExternalImageUrl,
  isPrivateOrInternalIp,
  assertResolvedHostnameIsPublic,
  fetchExternalImageBytes,
  EXTERNAL_FETCH_USER_AGENT,
} from './safeExternalFetch.js';

describe('validateExternalImageUrl', () => {
  it('accepts a public-hostname https URL and returns it sanitized', () => {
    // Pin: the function reconstructs the URL from validated components, which
    // is the taint-flow break (the returned string is what gets fetched, not
    // the raw input). A regression that returned `rawUrl` directly would still
    // pass naive shape checks but reintroduce taint.
    const out = validateExternalImageUrl('https://i.imgur.com/abc.jpg?x=1');
    expect(out).toBe('https://i.imgur.com/abc.jpg?x=1');
  });

  it('rejects non-https schemes', () => {
    expect(() => validateExternalImageUrl('http://i.imgur.com/x.jpg')).toThrow(
      /protocol must be https/
    );
    expect(() => validateExternalImageUrl('ftp://i.imgur.com/x.jpg')).toThrow(
      /protocol must be https/
    );
  });

  it('rejects URLs with embedded credentials (basic-auth shape)', () => {
    // Construct credentials at runtime so secretlint doesn't flag the source.
    const url = `https://${['user', 'pass'].join(':')}@i.imgur.com/x.jpg`;
    expect(() => validateExternalImageUrl(url)).toThrow(/credentials not allowed/);
  });

  it('rejects URLs on non-standard ports', () => {
    // Port 443 is the HTTPS default and Node normalizes it to '' — only
    // truly non-standard ports should be flagged.
    expect(() => validateExternalImageUrl('https://i.imgur.com:8443/x.jpg')).toThrow(
      /non-standard port/
    );
  });

  it('rejects IPv4 literal as hostname (must go through DNS)', () => {
    expect(() => validateExternalImageUrl('https://203.0.113.1/x.jpg')).toThrow(
      /IP addresses not allowed/
    );
  });

  it('rejects IPv6 literal as hostname (bracketed form)', () => {
    expect(() => validateExternalImageUrl('https://[2606:4700:4700::1111]/x.jpg')).toThrow(
      /IP addresses not allowed/
    );
  });

  it('rejects bracketed IPv4-mapped IPv6 literals (Node normalizes the hostname to all-hex form)', () => {
    // Node's URL parser normalizes `[::ffff:127.0.0.1]` → `[::ffff:7f00:1]`,
    // converting the dotted-quad to two hex hextets. The resulting hostname
    // is all hex+colons+brackets, so the IPv6 pattern `^\[?[0-9a-f:]+\]?$`
    // matches and the IP-literal check fires. Pin this so a future reader
    // doesn't assume the "regex misses dots → bracketed mapped IPv6 slips
    // past validation → DNS-level guard catches it" reasoning is correct
    // — the DNS-level guard exists, but the URL-validation layer rejects
    // first (defense-in-depth, not split responsibility).
    expect(() => validateExternalImageUrl('https://[::ffff:127.0.0.1]/x.png')).toThrow(
      /IP addresses not allowed/
    );
  });

  it('drops the URL fragment from the sanitized output (parity with validateAttachmentUrl)', () => {
    // Fragments don't go over the wire. Stripping prevents cache-key
    // fragment-divergence and matches the strict-validator's behavior so the
    // two-tier routing in DownloadAttachmentsStep produces consistent output
    // regardless of which validator handled the URL.
    const sanitized = validateExternalImageUrl('https://i.imgur.com/x.jpg#frag');
    expect(sanitized).toBe('https://i.imgur.com/x.jpg');
  });

  it('preserves the URL query string in the sanitized output', () => {
    const sanitized = validateExternalImageUrl('https://i.imgur.com/x.jpg?w=512&q=80');
    expect(sanitized).toBe('https://i.imgur.com/x.jpg?w=512&q=80');
  });
});

describe('isPrivateOrInternalIp', () => {
  // Exhaustive enumeration of IPv4 private/internal ranges. Each test case
  // pins one specific range — a regression that drops a range would surface
  // here and not in some downstream end-to-end flow.
  it.each([
    ['10.0.0.1', '10.0.0.0/8 RFC 1918'],
    ['10.255.255.255', '10.0.0.0/8 upper bound'],
    ['172.16.0.1', '172.16.0.0/12 RFC 1918 lower'],
    ['172.31.255.255', '172.16.0.0/12 upper'],
    ['192.168.1.1', '192.168.0.0/16 RFC 1918'],
    ['127.0.0.1', '127.0.0.0/8 loopback'],
    ['169.254.169.254', '169.254.0.0/16 link-local (cloud metadata!)'],
    ['100.64.0.1', '100.64.0.0/10 CGNAT'],
    ['100.127.255.255', '100.64.0.0/10 CGNAT upper'],
    ['224.0.0.1', '224.0.0.0/4 multicast'],
    ['240.0.0.1', '240.0.0.0/4 reserved'],
    ['255.255.255.255', 'broadcast'],
    ['0.0.0.0', '0.0.0.0/8 "this" network lower bound'],
    ['0.255.255.255', '0.0.0.0/8 "this" network upper bound'],
  ])('rejects %s (%s)', ip => {
    expect(isPrivateOrInternalIp(ip)).toBe(true);
  });

  it.each([
    ['1.1.1.1', 'Cloudflare DNS'],
    ['8.8.8.8', 'Google DNS'],
    ['203.0.113.1', 'TEST-NET-3 (documentation, but routable in this check)'],
    ['172.15.255.255', '172.16.0.0/12 lower-edge — JUST below private range'],
    ['172.32.0.0', '172.16.0.0/12 upper-edge — JUST above private range'],
    ['100.63.255.255', 'CGNAT lower-edge — JUST below private range'],
    ['100.128.0.0', 'CGNAT upper-edge — JUST above private range'],
    ['223.255.255.255', 'JUST below multicast'],
  ])('accepts %s (%s)', ip => {
    expect(isPrivateOrInternalIp(ip)).toBe(false);
  });

  it('rejects IPv6 loopback (::1) and unspecified (::)', () => {
    expect(isPrivateOrInternalIp('::1')).toBe(true);
    expect(isPrivateOrInternalIp('::')).toBe(true);
    // Uncompressed forms — same addresses, different syntactic representation.
    // dns.lookup returns canonical (::1, ::) but the helper may receive arbitrary input.
    expect(isPrivateOrInternalIp('0:0:0:0:0:0:0:1')).toBe(true);
    expect(isPrivateOrInternalIp('0:0:0:0:0:0:0:0')).toBe(true);
  });

  it('rejects IPv6 unique local addresses (fc00::/7)', () => {
    expect(isPrivateOrInternalIp('fc00::1')).toBe(true);
    expect(isPrivateOrInternalIp('fd00:dead:beef::1')).toBe(true);
  });

  it('rejects IPv6 deprecated site-local (fec0::/10) across the full prefix range', () => {
    // fec0::/10 spans first hextets fec0–feff. RFC 3879 deprecated these in
    // 2004 and no modern infra uses them, but the guard stays for defensive
    // completeness. Pin all four prefix groups.
    expect(isPrivateOrInternalIp('fec0::1')).toBe(true);
    expect(isPrivateOrInternalIp('fed0::1')).toBe(true);
    expect(isPrivateOrInternalIp('fee0::1')).toBe(true);
    expect(isPrivateOrInternalIp('feff::1')).toBe(true);
  });

  it('rejects IPv6 link-local (fe80::/10) across the full prefix range', () => {
    // fe80::/10 spans first hextet fe80–febf. Pin all four prefix groups.
    expect(isPrivateOrInternalIp('fe80::1')).toBe(true);
    expect(isPrivateOrInternalIp('fe90::1')).toBe(true);
    expect(isPrivateOrInternalIp('fea0::1')).toBe(true);
    expect(isPrivateOrInternalIp('febf::1')).toBe(true);
  });

  it('rejects IPv6 multicast (ff00::/8)', () => {
    expect(isPrivateOrInternalIp('ff02::1')).toBe(true);
  });

  it('recurses into IPv4-mapped IPv6 (::ffff:a.b.c.d) so wrapped private IPs are caught', () => {
    // Without recursion, an attacker could disguise a 192.168.1.1 target as
    // ::ffff:192.168.1.1 and bypass the family check. Pin the recursion.
    expect(isPrivateOrInternalIp('::ffff:192.168.1.1')).toBe(true);
    expect(isPrivateOrInternalIp('::ffff:127.0.0.1')).toBe(true);
    // Public IPv4 wrapped — should NOT be flagged.
    expect(isPrivateOrInternalIp('::ffff:1.1.1.1')).toBe(false);
  });

  it('recurses into 6to4 IPv6 (2002:hhhh:hhhh::) so private IPv4 in tunnel form is caught', () => {
    // 6to4 embeds a 32-bit IPv4 in the second + third hextets:
    // `2002:c0a8:0101::` decodes to 192.168.1.1; `2002:7f00:0001::` to
    // 127.0.0.1. Without this guard, an AAAA record pointing at a 6to4
    // address would bypass our private-range check.
    expect(isPrivateOrInternalIp('2002:c0a8:0101::')).toBe(true); // 192.168.1.1
    expect(isPrivateOrInternalIp('2002:7f00:0001::')).toBe(true); // 127.0.0.1
    expect(isPrivateOrInternalIp('2002:0a00:0001::')).toBe(true); // 10.0.0.1
    expect(isPrivateOrInternalIp('2002:a9fe:a9fe::')).toBe(true); // 169.254.169.254 (link-local)
    // Public IPv4 wrapped in 6to4 — should NOT be flagged.
    expect(isPrivateOrInternalIp('2002:0101:0101::')).toBe(false); // 1.1.1.1
  });

  it('rejects malformed 6to4 (fail closed)', () => {
    // A bare `2002::` with no embedded IPv4 hextets, or hextets that don't
    // parse as numbers, should fail closed rather than slip through.
    expect(isPrivateOrInternalIp('2002::')).toBe(true); // missing hextets
    expect(isPrivateOrInternalIp('2002:zzzz:0001::')).toBe(true); // unparseable
  });

  it('rejects Teredo tunneling (2001:0000::/32) wholesale across all canonical forms', () => {
    // Teredo encodes a private IPv4 endpoint plus public server. Modern OSes
    // largely deprecated it but the address space is still routable and no
    // legitimate external image host uses it. Blanket-reject the prefix.
    //
    // Critical: cover BOTH the uncompressed (`2001:0000:`) form AND the RFC
    // 5952 canonical compressed form (`2001:0:`) that Node's dns.lookup
    // actually returns. A previous version of this guard checked only
    // `2001:0000:` and `2001::` — the canonical-compressed form (which is
    // what production traffic exclusively produces) silently slipped past.
    expect(isPrivateOrInternalIp('2001:0000:4136:e378:8000:63bf:3fff:fdd2')).toBe(true); // uncompressed
    expect(isPrivateOrInternalIp('2001:0:4136:e378:8000:63bf:3fff:fdd2')).toBe(true); // RFC 5952 canonical
    expect(isPrivateOrInternalIp('2001::1')).toBe(true); // degenerate all-zeros form
  });

  it('accepts a public IPv6 address (Cloudflare 2606:4700:4700::1111)', () => {
    expect(isPrivateOrInternalIp('2606:4700:4700::1111')).toBe(false);
  });

  it('fails closed on unparseable input (neither IPv4 nor IPv6)', () => {
    // The function is invoked only after Node's `dns.lookup` returns, but
    // defense in depth: a malformed input should reject, not slip through
    // as "not in any private range, must be public."
    expect(isPrivateOrInternalIp('not-an-ip')).toBe(true);
    expect(isPrivateOrInternalIp('')).toBe(true);
  });
});

describe('assertResolvedHostnameIsPublic', () => {
  beforeEach(() => {
    vi.spyOn(dns, 'lookup');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes when every resolved IP is public', async () => {
    vi.mocked(dns.lookup).mockResolvedValueOnce([
      { address: '1.1.1.1', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ] as never);

    await expect(assertResolvedHostnameIsPublic('cloudflare.example')).resolves.toBeUndefined();
  });

  it('throws when ANY resolved IP is private (covers IPv4-public/IPv6-private mismatch)', async () => {
    // The whole point of `{ all: true }`: even one private IP in the result
    // set must reject, because fetch could pick that one for the connection.
    vi.mocked(dns.lookup).mockResolvedValueOnce([
      { address: '1.1.1.1', family: 4 },
      { address: 'fe80::1', family: 6 },
    ] as never);

    await expect(assertResolvedHostnameIsPublic('mixed.example')).rejects.toThrow(
      /private\/internal IP\(s\): fe80::1/
    );
  });

  it('throws when DNS resolution fails entirely (NXDOMAIN, network error)', async () => {
    vi.mocked(dns.lookup).mockRejectedValueOnce(
      Object.assign(new Error('getaddrinfo ENOTFOUND nowhere.invalid'), { code: 'ENOTFOUND' })
    );

    await expect(assertResolvedHostnameIsPublic('nowhere.invalid')).rejects.toThrow(
      /Could not resolve hostname/
    );
  });

  it('throws when DNS lookup returns an empty result set', async () => {
    // Documented theoretical edge case — `{ all: true }` should normally throw
    // ENODATA on no-answer rather than return [], but the guard prevents an
    // empty array from being interpreted as "no offenders → safe."
    vi.mocked(dns.lookup).mockResolvedValueOnce([] as never);

    await expect(assertResolvedHostnameIsPublic('void.example')).rejects.toThrow(/no addresses/);
  });
});

describe('fetchExternalImageBytes', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.spyOn(dns, 'lookup');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('runs the DNS+IP guard before fetching', async () => {
    // Ordering pin: assertResolvedHostnameIsPublic must complete (and pass)
    // before fetch is called. A regression that flipped the order would let
    // the request hit the network before the guard even ran.
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;
    vi.mocked(dns.lookup).mockRejectedValueOnce(new Error('NXDOMAIN'));

    await expect(fetchExternalImageBytes('https://nowhere.invalid/x.png')).rejects.toThrow(
      /Could not resolve hostname/
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('passes the browser User-Agent and image/ Content-Type assertion through to the fetch helper', async () => {
    vi.mocked(dns.lookup).mockResolvedValueOnce([{ address: '1.1.1.1', family: 4 }] as never);

    const fetchSpy = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': '4' }),
        arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3, 4]).buffer),
      } as Response)
    ) as typeof fetch;
    globalThis.fetch = fetchSpy;

    const buf = await fetchExternalImageBytes('https://i.imgur.com/x.jpg');
    expect(Array.from(buf)).toEqual([1, 2, 3, 4]);

    // Pin both contract bits in one assertion: UA wired correctly, and the
    // request shape matches what the underlying helper expects (signal,
    // redirect, etc. are added by fetchAttachmentBytes itself).
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://i.imgur.com/x.jpg',
      expect.objectContaining({
        headers: { 'User-Agent': EXTERNAL_FETCH_USER_AGENT },
        redirect: 'error',
      })
    );
  });

  it('rejects when the fetched Content-Type is not image/* (memory-exhaustion guard)', async () => {
    vi.mocked(dns.lookup).mockResolvedValueOnce([{ address: '1.1.1.1', family: 4 }] as never);

    const arrayBuffer = vi.fn();
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'text/html' }),
        arrayBuffer,
      } as unknown as Response)
    ) as typeof fetch;

    await expect(
      fetchExternalImageBytes('https://evil.example.com/looks-like-an-image.png')
    ).rejects.toThrow(/Unexpected Content-Type/);
    // The body must NOT be consumed when Content-Type fails the assertion.
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('rejects when the resolved IP is private (loopback simulation)', async () => {
    vi.mocked(dns.lookup).mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }] as never);

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;

    await expect(fetchExternalImageBytes('https://lo.example/x.png')).rejects.toThrow(
      /127\.0\.0\.1/
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
