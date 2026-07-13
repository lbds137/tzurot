/**
 * Tests for bot-protection detection on shapes.inc responses.
 */

import { describe, it, expect } from 'vitest';
import { detectBotProtection } from './shapesBotProtection.js';

function responseWithHeaders(headerInit: Record<string, string>, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headerInit),
  } as unknown as Response;
}

describe('detectBotProtection', () => {
  it('returns null for a normal JSON response', () => {
    expect(
      detectBotProtection(responseWithHeaders({ 'content-type': 'application/json' }))
    ).toBeNull();
  });

  it('returns null when no relevant headers are present at all', () => {
    expect(detectBotProtection(responseWithHeaders({}))).toBeNull();
  });

  it('does NOT treat cf-ray alone as a signal (present on all Cloudflare-proxied traffic)', () => {
    expect(
      detectBotProtection(
        responseWithHeaders({
          'cf-ray': '8f1a2b3c4d5e6f70-EWR',
          'content-type': 'application/json',
        })
      )
    ).toBeNull();
  });

  it('detects Cloudflare active mitigation via cf-mitigated', () => {
    const signal = detectBotProtection(responseWithHeaders({ 'cf-mitigated': 'challenge' }));
    expect(signal).toContain('cf-mitigated');
    expect(signal).toContain('challenge');
  });

  it('detects Datadome via x-datadome', () => {
    expect(detectBotProtection(responseWithHeaders({ 'x-datadome': 'protected' }))).toContain(
      'x-datadome'
    );
  });

  it('detects PerimeterX via any x-px* header', () => {
    expect(detectBotProtection(responseWithHeaders({ 'x-px-block': '1' }))).toContain('x-px-block');
    expect(detectBotProtection(responseWithHeaders({ 'x-pxhd': 'abc' }))).toContain('x-pxhd');
  });

  it('detects the Datadome header FAMILY, not just the bare name', () => {
    expect(detectBotProtection(responseWithHeaders({ 'x-datadome-cid': 'abc' }))).toContain(
      'x-datadome-cid'
    );
  });

  it('detects an HTML block page on a JSON endpoint via content-type', () => {
    const signal = detectBotProtection(
      responseWithHeaders({ 'content-type': 'text/html; charset=utf-8' })
    );
    expect(signal).toContain('HTML response');
  });

  it('detects an HTML block page on a 403 (auth-shaped block)', () => {
    const signal = detectBotProtection(responseWithHeaders({ 'content-type': 'text/html' }, 403));
    expect(signal).toContain('HTML response');
  });

  it('does NOT treat an HTML error page on a transient 5xx/429 as a bot wall', () => {
    // nginx/CDN default error pages are HTML — a 502 with an HTML body must
    // stay a retryable server error, not a hard bot-protection failure. Real
    // challenges on those statuses announce themselves via vendor headers.
    expect(
      detectBotProtection(responseWithHeaders({ 'content-type': 'text/html' }, 502))
    ).toBeNull();
    expect(
      detectBotProtection(responseWithHeaders({ 'content-type': 'text/html' }, 429))
    ).toBeNull();
  });

  it('still detects vendor headers regardless of status (headers beat status)', () => {
    expect(
      detectBotProtection(responseWithHeaders({ 'cf-mitigated': 'challenge' }, 503))
    ).toContain('cf-mitigated');
  });
});
