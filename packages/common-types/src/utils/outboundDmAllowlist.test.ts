import { describe, it, expect, vi, afterEach } from 'vitest';

const getConfigMock = vi.hoisted(() => vi.fn());
vi.mock('../config/config.js', () => ({ getConfig: getConfigMock }));

const warnMock = vi.hoisted(() => vi.fn());
vi.mock('./logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: warnMock, error: vi.fn() }),
}));

import { getOutboundDmAllowlist } from './outboundDmAllowlist.js';

afterEach(() => {
  vi.clearAllMocks();
});

const ID_A = '278863839632818186';
const ID_B = '123456789012345678';

describe('getOutboundDmAllowlist', () => {
  it('returns null (unrestricted) when unset', () => {
    getConfigMock.mockReturnValue({});
    expect(getOutboundDmAllowlist()).toBeNull();
  });

  it('returns null for an empty/whitespace value', () => {
    getConfigMock.mockReturnValue({ OUTBOUND_DM_ALLOWLIST: '  ' });
    expect(getOutboundDmAllowlist()).toBeNull();
  });

  it('parses a comma-separated list with whitespace tolerance', () => {
    getConfigMock.mockReturnValue({ OUTBOUND_DM_ALLOWLIST: `${ID_A}, ${ID_B} ,` });
    expect([...getOutboundDmAllowlist()!].sort()).toEqual([ID_B, ID_A].sort());
  });

  it('drops non-snowflake entries with a warn (fail-closed stays intact)', () => {
    getConfigMock.mockReturnValue({ OUTBOUND_DM_ALLOWLIST: `${ID_A},not-an-id,42` });
    const allowlist = getOutboundDmAllowlist();
    expect([...allowlist!]).toEqual([ID_A]);
    expect(warnMock).toHaveBeenCalledWith(
      { dropped: 2, kept: 1 },
      expect.stringContaining('non-snowflake')
    );
  });

  it('a garbage-only value restricts to NOBODY rather than falling open', () => {
    getConfigMock.mockReturnValue({ OUTBOUND_DM_ALLOWLIST: 'oops,typo' });
    const allowlist = getOutboundDmAllowlist();
    expect(allowlist).not.toBeNull();
    expect(allowlist!.size).toBe(0);
  });
});
