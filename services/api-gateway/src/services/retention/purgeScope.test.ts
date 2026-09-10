import { describe, it, expect, vi } from 'vitest';

const { getConfigMock, getOutboundDmAllowlistMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  getOutboundDmAllowlistMock: vi.fn(),
}));

vi.mock('@tzurot/common-types/config/config', () => ({
  getConfig: getConfigMock,
}));
vi.mock('@tzurot/common-types/utils/outboundDmAllowlist', () => ({
  getOutboundDmAllowlist: getOutboundDmAllowlistMock,
}));

import { resolvePurgeScope, purgeScopeAllowlist, purgeScopeRefusal } from './purgeScope.js';

describe('resolvePurgeScope', () => {
  it('an allowlist set in development resolves to the allowlist kind', () => {
    getOutboundDmAllowlistMock.mockReturnValue(new Set(['100000000000000001']));
    getConfigMock.mockReturnValue({ NODE_ENV: 'development' });

    expect(resolvePurgeScope()).toEqual({
      kind: 'allowlist',
      discordIds: new Set(['100000000000000001']),
    });
  });

  it('an allowlist set in production resolves to the allowlist kind', () => {
    getOutboundDmAllowlistMock.mockReturnValue(new Set(['100000000000000002']));
    getConfigMock.mockReturnValue({ NODE_ENV: 'production' });

    expect(resolvePurgeScope()).toEqual({
      kind: 'allowlist',
      discordIds: new Set(['100000000000000002']),
    });
  });

  it('no allowlist in production resolves to unrestricted', () => {
    getOutboundDmAllowlistMock.mockReturnValue(null);
    getConfigMock.mockReturnValue({ NODE_ENV: 'production' });

    expect(resolvePurgeScope()).toEqual({ kind: 'unrestricted' });
  });

  it('no allowlist in development resolves to unscoped_non_production', () => {
    getOutboundDmAllowlistMock.mockReturnValue(null);
    getConfigMock.mockReturnValue({ NODE_ENV: 'development' });

    expect(resolvePurgeScope()).toEqual({ kind: 'unscoped_non_production' });
  });

  it('no allowlist in test resolves to unscoped_non_production', () => {
    getOutboundDmAllowlistMock.mockReturnValue(null);
    getConfigMock.mockReturnValue({ NODE_ENV: 'test' });

    expect(resolvePurgeScope()).toEqual({ kind: 'unscoped_non_production' });
  });

  it('an empty allowlist Set in production still resolves to the allowlist kind (restricts to nobody)', () => {
    getOutboundDmAllowlistMock.mockReturnValue(new Set());
    getConfigMock.mockReturnValue({ NODE_ENV: 'production' });

    expect(resolvePurgeScope()).toEqual({ kind: 'allowlist', discordIds: new Set() });
  });
});

describe('purgeScopeAllowlist', () => {
  it('unrestricted resolves to null (no SQL narrowing)', () => {
    expect(purgeScopeAllowlist({ kind: 'unrestricted' })).toBeNull();
  });

  it('allowlist resolves to the same set', () => {
    const discordIds = new Set(['100000000000000001']);
    expect(purgeScopeAllowlist({ kind: 'allowlist', discordIds })).toBe(discordIds);
  });

  it('unscoped_non_production resolves to an empty set (selects nobody)', () => {
    const result = purgeScopeAllowlist({ kind: 'unscoped_non_production' });
    expect(result).toEqual(new Set());
  });
});

describe('purgeScopeRefusal', () => {
  it('unrestricted never refuses', () => {
    expect(purgeScopeRefusal({ kind: 'unrestricted' }, '100000000000000001')).toBeNull();
  });

  it('an allowlist member is not refused', () => {
    const scope = { kind: 'allowlist' as const, discordIds: new Set(['100000000000000001']) };
    expect(purgeScopeRefusal(scope, '100000000000000001')).toBeNull();
  });

  it('a non-member of the allowlist is refused as outside_allowlist', () => {
    const scope = { kind: 'allowlist' as const, discordIds: new Set(['100000000000000001']) };
    expect(purgeScopeRefusal(scope, '900000000000000009')).toBe('outside_allowlist');
  });

  it('unscoped_non_production refuses every id as unscoped_non_production', () => {
    const scope = { kind: 'unscoped_non_production' as const };
    expect(purgeScopeRefusal(scope, '100000000000000001')).toBe('unscoped_non_production');
    expect(purgeScopeRefusal(scope, 'anything')).toBe('unscoped_non_production');
  });
});
