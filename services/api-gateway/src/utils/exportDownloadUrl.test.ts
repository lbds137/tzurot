import { describe, expect, it, vi } from 'vitest';

const mockGetConfig = vi.fn();

vi.mock('@tzurot/common-types/config/config', () => ({
  getConfig: () => mockGetConfig(),
}));

import { buildExportDownloadUrl, resolveExportBaseUrl } from './exportDownloadUrl.js';

describe('resolveExportBaseUrl', () => {
  it('prefers PUBLIC_GATEWAY_URL when set', () => {
    mockGetConfig.mockReturnValue({
      PUBLIC_GATEWAY_URL: 'https://public.example.invalid',
      GATEWAY_URL: 'https://internal.example.invalid',
    });
    expect(resolveExportBaseUrl()).toBe('https://public.example.invalid');
  });

  it('falls back to GATEWAY_URL when PUBLIC_GATEWAY_URL is unset', () => {
    mockGetConfig.mockReturnValue({
      PUBLIC_GATEWAY_URL: undefined,
      GATEWAY_URL: 'https://internal.example.invalid',
    });
    expect(resolveExportBaseUrl()).toBe('https://internal.example.invalid');
  });

  it('falls back to empty string when neither is set', () => {
    mockGetConfig.mockReturnValue({ PUBLIC_GATEWAY_URL: undefined, GATEWAY_URL: undefined });
    expect(resolveExportBaseUrl()).toBe('');
  });
});

describe('buildExportDownloadUrl', () => {
  it('builds the download URL from the resolved base URL and token', () => {
    mockGetConfig.mockReturnValue({
      PUBLIC_GATEWAY_URL: 'https://public.example.invalid',
      GATEWAY_URL: undefined,
    });
    expect(buildExportDownloadUrl('abc123')).toBe('https://public.example.invalid/exports/abc123');
  });

  it('encodes the token (SSRF guard against path-traversal/query-injection tokens)', () => {
    mockGetConfig.mockReturnValue({
      PUBLIC_GATEWAY_URL: 'https://public.example.invalid',
      GATEWAY_URL: undefined,
    });
    expect(buildExportDownloadUrl('../evil?x=1')).toBe(
      'https://public.example.invalid/exports/..%2Fevil%3Fx%3D1'
    );
  });
});
