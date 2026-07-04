import { describe, it, expect, vi } from 'vitest';
import type { Request } from 'express';
import { normalizeSlugForUser } from '@tzurot/common-types/utils/slugUtils';
import {
  applyOwnerNamePromotion,
  buildCollisionMessage,
  computeNameForPromotion,
  getDiscordUsernameFromRequest,
} from './normalizeConfigNameOnPromote.js';

// Mock isBotOwner so we can flip between bot-owner and regular-user identities
// independent of process env. The actual `normalizeSlugForUser` is fully tested
// in common-types; here we focus on the route-level decision logic that wraps it.
vi.mock('@tzurot/common-types/utils/slugUtils', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/slugUtils')>(
    '@tzurot/common-types/utils/slugUtils'
  );
  return {
    ...actual,
    // vi.fn so tests can assert the arguments that cross this seam (e.g. the
    // maxLength cap) — not just the return value, which the mock never truncates.
    normalizeSlugForUser: vi.fn((slug: string, _id: string, username: string): string => {
      // Recreate the production-equivalent contract for these tests:
      // - bot-owner ('owner-id') gets unchanged slug
      // - others get `-${username}` suffix, idempotent if already present
      if (_id === 'owner-id') return slug;
      const suffix = `-${username}`;
      return slug.endsWith(suffix) ? slug : `${slug}${suffix}`;
    }),
  };
});

const REGULAR_USER = { discordId: 'user-456', discordUsername: 'bob' };
const BOT_OWNER = { discordId: 'owner-id', discordUsername: 'lbds137' };

describe('computeNameForPromotion', () => {
  describe('not promoting to global', () => {
    it('returns requestedName unchanged when post-state is not global', () => {
      const result = computeNameForPromotion({
        currentName: 'old',
        currentIsGlobal: false,
        requestedName: 'new',
        requestedIsGlobal: false,
        ...REGULAR_USER,
      });
      expect(result).toBe('new');
    });

    it('returns undefined when no rename and not promoting', () => {
      const result = computeNameForPromotion({
        currentName: 'old',
        currentIsGlobal: false,
        ...REGULAR_USER,
      });
      expect(result).toBeUndefined();
    });

    it('returns undefined when toggling isGlobal true→false (no name change)', () => {
      const result = computeNameForPromotion({
        currentName: 'old-bob',
        currentIsGlobal: true,
        requestedIsGlobal: false,
        ...REGULAR_USER,
      });
      // No name in patch; no normalization since post-state is private
      expect(result).toBeUndefined();
    });

    it('does NOT retroactively rename already-global config on a non-name update', () => {
      // The user updates only `description` on a legacy global config whose
      // name predates this PR (no suffix). Without the narrow trigger, the
      // helper would silently rename it to `OfficialVoice-bob`. With the
      // narrow trigger (only on promotion or explicit rename), the helper
      // returns undefined — no name field added to the patch.
      const result = computeNameForPromotion({
        currentName: 'OfficialVoice',
        currentIsGlobal: true,
        // requestedIsGlobal undefined (user didn't touch it)
        // requestedName undefined (user only edited description, not name)
        ...REGULAR_USER,
      });
      expect(result).toBeUndefined();
    });

    it('does NOT rename already-global config when isGlobal:true is resent without name', () => {
      // Bot-client dashboard PUT may resend isGlobal: true with the current
      // value (no actual change). This is not a "promotion" — currentIsGlobal
      // was already true. Helper should treat as no-op.
      const result = computeNameForPromotion({
        currentName: 'OfficialVoice',
        currentIsGlobal: true,
        requestedIsGlobal: true,
        ...REGULAR_USER,
      });
      expect(result).toBeUndefined();
    });
  });

  describe('promoting non-bot-owner to global', () => {
    it('suffixes the requestedName when toggling false→true', () => {
      const result = computeNameForPromotion({
        currentName: 'MyVoice',
        currentIsGlobal: false,
        requestedIsGlobal: true,
        ...REGULAR_USER,
      });
      expect(result).toBe('MyVoice-bob');
    });

    it('normalizes config names with the 100-char cap, not the 50-char slug default (seam)', () => {
      vi.mocked(normalizeSlugForUser).mockClear();
      const longName = 'A'.repeat(70); // over the 50 slug cap, under the 100 config-name cap
      computeNameForPromotion({
        currentName: longName,
        currentIsGlobal: false,
        requestedIsGlobal: true,
        ...REGULAR_USER,
      });
      // The wiring that actually matters: the 100 cap must cross the seam. Asserting
      // the return value alone would pass even if the 4th arg were dropped (reverting
      // to the default 50) — the mock never truncates. This asserts the arg instead.
      expect(normalizeSlugForUser).toHaveBeenCalledWith(longName, 'user-456', 'bob', 100);
    });

    it('suffixes a fresh rename when post-state is global', () => {
      const result = computeNameForPromotion({
        currentName: 'OldName',
        currentIsGlobal: true,
        requestedName: 'AdminVoice',
        ...REGULAR_USER,
      });
      expect(result).toBe('AdminVoice-bob');
    });

    it('idempotent: does not double-suffix when already normalized', () => {
      const result = computeNameForPromotion({
        currentName: 'OldName-bob',
        currentIsGlobal: true,
        requestedName: 'NewName-bob',
        ...REGULAR_USER,
      });
      // requestedName is already suffixed; normalizeSlugForUser returns it unchanged.
      // The helper then sees normalized === baseName and returns the original
      // requestedName to preserve route intent.
      expect(result).toBe('NewName-bob');
    });

    it('uses currentName as base when toggling without rename', () => {
      const result = computeNameForPromotion({
        currentName: 'PrivateVoice',
        currentIsGlobal: false,
        requestedIsGlobal: true,
        // No requestedName
        ...REGULAR_USER,
      });
      expect(result).toBe('PrivateVoice-bob');
    });
  });

  describe('empty discordUsername fallback', () => {
    it('falls through to user-id-based suffix per normalizeSlugForUser semantics', () => {
      // When the username header is missing/malformed, getDiscordUsernameFromRequest
      // returns ''. The mocked normalizeSlugForUser appends `-${username}` even for
      // empty username (mock simplification); the production normalizeSlugForUser
      // detects this and falls back to `-${discordUserId}`. This test documents
      // that the route helper passes the empty string through to the slug
      // function rather than short-circuiting.
      const result = computeNameForPromotion({
        currentName: 'OldName',
        currentIsGlobal: false,
        requestedIsGlobal: true,
        discordId: 'user-456',
        discordUsername: '',
      });
      // Mock returns 'OldName-' (mock simplification); real production behavior
      // would yield 'OldName-user-456'. The test asserts the fall-through path
      // is taken — a return value distinct from the input.
      expect(result).not.toBe('OldName');
      expect(result).toContain('OldName');
    });
  });

  describe('bot owner', () => {
    it('returns requestedName unchanged when promoting to global', () => {
      const result = computeNameForPromotion({
        currentName: 'old',
        currentIsGlobal: false,
        requestedName: 'kyutai-self-hosted',
        requestedIsGlobal: true,
        ...BOT_OWNER,
      });
      expect(result).toBe('kyutai-self-hosted');
    });

    it('returns undefined when no rename and post-state is global', () => {
      const result = computeNameForPromotion({
        currentName: 'kyutai-self-hosted',
        currentIsGlobal: true,
        ...BOT_OWNER,
      });
      // Bot owner with no rename → normalize returns base unchanged → helper
      // returns requestedName (undefined) to preserve "no field to update"
      expect(result).toBeUndefined();
    });
  });
});

describe('getDiscordUsernameFromRequest', () => {
  it('decodes a URI-encoded username header', () => {
    const req = { headers: { 'x-user-username': 'cool%20user' } } as unknown as Request;
    expect(getDiscordUsernameFromRequest(req)).toBe('cool user');
  });

  it('returns plain string when no encoding needed', () => {
    const req = { headers: { 'x-user-username': 'bob' } } as unknown as Request;
    expect(getDiscordUsernameFromRequest(req)).toBe('bob');
  });

  it('returns empty string on missing header', () => {
    const req = { headers: {} } as unknown as Request;
    expect(getDiscordUsernameFromRequest(req)).toBe('');
  });

  it('returns empty string on malformed URI', () => {
    // %ZZ is not valid percent-encoding; decodeURIComponent throws
    const req = { headers: { 'x-user-username': '%ZZ' } } as unknown as Request;
    expect(getDiscordUsernameFromRequest(req)).toBe('');
  });

  it('returns empty string on non-string header value (array)', () => {
    // Express can deliver array values for repeated headers
    const req = { headers: { 'x-user-username': ['a', 'b'] } } as unknown as Request;
    expect(getDiscordUsernameFromRequest(req)).toBe('');
  });
});

describe('applyOwnerNamePromotion', () => {
  const config = { name: 'MyConfig', isGlobal: false };

  it('returns body unchanged when no promotion or rename', () => {
    const body: { name?: string; isGlobal?: boolean; description: string } = {
      description: 'new description',
    };
    const result = applyOwnerNamePromotion(body, config, REGULAR_USER);
    expect(result).toEqual({ description: 'new description' });
  });

  it('suffixes the name when promoting to global as a regular user', () => {
    const body = { name: 'Cool', isGlobal: true };
    const result = applyOwnerNamePromotion(body, config, REGULAR_USER);
    expect(result).toEqual({ name: 'Cool-bob', isGlobal: true });
  });

  it('leaves the name unchanged when bot owner promotes to global', () => {
    const body = { name: 'Official', isGlobal: true };
    const result = applyOwnerNamePromotion(body, config, BOT_OWNER);
    expect(result).toEqual({ name: 'Official', isGlobal: true });
  });

  it('preserves arbitrary extra fields on the body', () => {
    const body = { name: 'Renamed', isGlobal: true, advancedParameters: { temp: 0.7 } };
    const result = applyOwnerNamePromotion(body, config, REGULAR_USER);
    expect(result).toEqual({
      name: 'Renamed-bob',
      isGlobal: true,
      advancedParameters: { temp: 0.7 },
    });
  });

  it('works generically for a TTS-shaped body', () => {
    const ttsBody = { name: 'MyVoice', provider: 'mistral', isGlobal: true };
    const result = applyOwnerNamePromotion(ttsBody, config, REGULAR_USER);
    expect(result).toEqual({ name: 'MyVoice-bob', provider: 'mistral', isGlobal: true });
  });

  it('omits the name field when computeNameForPromotion returns undefined (no rename)', () => {
    const globalConfig = { name: 'AlreadyGlobal', isGlobal: true };
    // Description-only update on an already-global config — no rename triggered
    const body: { name?: string; isGlobal?: boolean; description: string } = {
      description: 'updated desc',
    };
    const result = applyOwnerNamePromotion(body, globalConfig, REGULAR_USER);
    expect(result).toEqual({ description: 'updated desc' });
    expect(result).not.toHaveProperty('name');
  });
});

describe('buildCollisionMessage', () => {
  it('returns promotion-rename message when effectiveName differs from requestedName', () => {
    // Non-owner promoting "MyVoice" to global → normalized to "MyVoice-bob",
    // and that suffixed name happens to collide with a pre-existing global.
    expect(
      buildCollisionMessage({
        effectiveName: 'MyVoice-bob',
        requestedName: 'MyVoice',
        configKind: 'config',
      })
    ).toBe('Promotion would rename your config to "MyVoice-bob", but that name is already taken');
  });

  it('returns promotion-rename message when requestedName is undefined', () => {
    // User sends only `{ isGlobal: true }` (no rename) — requestedName is
    // undefined, so `effectiveName !== requestedName` is `true` for any
    // string. This routes through the promotion branch, which is the
    // correct UX (user is promoting, not picking a self-collision).
    expect(
      buildCollisionMessage({
        effectiveName: 'MyVoice-bob',
        requestedName: undefined,
        configKind: 'config',
      })
    ).toBe('Promotion would rename your config to "MyVoice-bob", but that name is already taken');
  });

  it('returns self-collision message when effectiveName matches requestedName', () => {
    // Bot owner (no suffix) or non-owner picking a name that doesn't need
    // normalization → effective and requested match → user-already-has-it
    // wording.
    expect(
      buildCollisionMessage({
        effectiveName: 'MyVoice',
        requestedName: 'MyVoice',
        configKind: 'TTS config',
      })
    ).toBe('You already have a TTS config named "MyVoice"');
  });
});
