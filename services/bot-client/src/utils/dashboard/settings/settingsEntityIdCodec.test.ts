/**
 * Tests for the settings customId entityId codec: UUID compaction, the
 * canonical round-trip guard, pass-through of every non-UUID producer shape,
 * and legacy raw-UUID ids parsing to the same entity.
 */

import { describe, it, expect } from 'vitest';
import { generatePersonalityUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { compactEntityId, expandEntityId } from './settingsEntityIdCodec.js';
import { buildSettingsCustomId, parseSettingsCustomId } from './types.js';

/** Byte-edge fixtures with hand-computed encodings (16 zero bytes, 16 0xff bytes). */
const ALL_ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const ALL_ZERO_COMPACT = '~AAAAAAAAAAAAAAAAAAAAAA';
const ALL_F_UUID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const ALL_F_COMPACT = '~_____________________w';

/** A v5-shaped personality id (the shape generatePersonalityUuid emits), whose encoding uses `_`. */
const PERSONALITY_UUID = '765a9b5a-857f-5822-bc60-37cc8aada4ac';
const PERSONALITY_COMPACT = '~dlqbWoV_WCK8YDfMiq2krA';

/** A Discord snowflake (channel and user ids are both snowflakes). */
const SNOWFLAKE = '1234567890123456789';

describe('compactEntityId', () => {
  it.each([
    [ALL_ZERO_UUID, ALL_ZERO_COMPACT],
    [ALL_F_UUID, ALL_F_COMPACT],
    [PERSONALITY_UUID, PERSONALITY_COMPACT],
  ])('compacts %s to %s (23 chars)', (uuid, compact) => {
    const result = compactEntityId(uuid);
    expect(result).toBe(compact);
    expect(result).toHaveLength(23);
  });

  it.each([
    ['global', 'global'],
    ['a snowflake', SNOWFLAKE],
    ['an uppercase UUID', PERSONALITY_UUID.toUpperCase()],
    ['a mixed-case UUID', '765A9b5a-857f-5822-bc60-37cc8aada4ac'],
    ['an undashed UUID', PERSONALITY_UUID.replaceAll('-', '')],
    ['a UUID with surrounding whitespace', ` ${PERSONALITY_UUID}`],
    ['an empty string', ''],
  ])('returns %s unchanged', (_label, value) => {
    expect(compactEntityId(value)).toBe(value);
  });
});

describe('expandEntityId', () => {
  it.each([
    [ALL_ZERO_COMPACT, ALL_ZERO_UUID],
    [ALL_F_COMPACT, ALL_F_UUID],
    [PERSONALITY_COMPACT, PERSONALITY_UUID],
  ])('expands %s to %s', (compact, uuid) => {
    expect(expandEntityId(compact)).toBe(uuid);
  });

  it('round-trips a deterministic spread of generated personality ids', () => {
    for (let i = 0; i < 64; i++) {
      const uuid = generatePersonalityUuid(`codec-round-trip-${i}`);
      const compact = compactEntityId(uuid);
      expect(compact).toMatch(/^~[A-Za-z0-9_-]{22}$/);
      expect(expandEntityId(compact)).toBe(uuid);
    }
  });

  it.each([
    ['a legacy raw UUID', PERSONALITY_UUID],
    ['global', 'global'],
    ['a snowflake', SNOWFLAKE],
    ['a marker with 21 chars', `~${'A'.repeat(21)}`],
    ['a marker with 23 chars', `~${'A'.repeat(23)}`],
    ['a marker with a non-base64url char', `~${'A'.repeat(21)}+`],
    ['a marker with padding', `~${'A'.repeat(21)}=`],
    ['a bare marker', '~'],
  ])('returns %s unchanged', (_label, value) => {
    expect(expandEntityId(value)).toBe(value);
  });

  it('rejects a non-canonical segment that decodes to the same bytes as a canonical one', () => {
    const nonCanonical = `~${'A'.repeat(21)}B`;
    // The lenient decoder maps both spellings to 16 zero bytes; only the
    // canonical spelling may expand.
    expect(Buffer.from(nonCanonical.slice(1), 'base64url')).toEqual(
      Buffer.from(ALL_ZERO_COMPACT.slice(1), 'base64url')
    );
    expect(expandEntityId(nonCanonical)).toBe(nonCanonical);
    expect(expandEntityId(ALL_ZERO_COMPACT)).toBe(ALL_ZERO_UUID);
  });
});

describe('settings customId round-trip per entityId producer', () => {
  // One id of each producer's shape (see the codec module doc): none can begin
  // with the `~` marker, so each parses back to exactly the entityId it was
  // built from.
  it.each([
    ['characterDashboardShared personality.id', PERSONALITY_UUID],
    ['channel/settings channelId', SNOWFLAKE],
    ['settings/defaults/edit userId', '278863839632818186'],
    ["admin/settings 'global'", 'global'],
  ])('%s parses back unchanged', (_producer, entityId) => {
    expect(entityId.startsWith('~')).toBe(false);
    const customId = buildSettingsCustomId(
      'character-overrides',
      'set',
      entityId,
      'shareHistoryAcrossPersonalities:guilds-only'
    );
    expect(parseSettingsCustomId(customId)).toEqual({
      entityType: 'character-overrides',
      action: 'set',
      entityId,
      extra: 'shareHistoryAcrossPersonalities:guilds-only',
    });
  });

  it('writes a UUID entityId compacted into the customId', () => {
    expect(buildSettingsCustomId('character-overrides', 'back', PERSONALITY_UUID)).toBe(
      `character-overrides::back::${PERSONALITY_COMPACT}`
    );
  });

  it('writes a non-UUID entityId raw into the customId', () => {
    expect(buildSettingsCustomId('channel-settings', 'back', SNOWFLAKE)).toBe(
      `channel-settings::back::${SNOWFLAKE}`
    );
  });

  it('parses a legacy raw-UUID customId (rendered before compaction) to the same UUID', () => {
    const legacyId = `character-overrides::set::${PERSONALITY_UUID}::shareHistoryAcrossPersonalities:guilds-only`;
    expect(parseSettingsCustomId(legacyId)).toEqual({
      entityType: 'character-overrides',
      action: 'set',
      entityId: PERSONALITY_UUID,
      extra: 'shareHistoryAcrossPersonalities:guilds-only',
    });
  });

  it('parses the compacted and legacy spellings of one id to the same entityId', () => {
    const compacted = buildSettingsCustomId('character-settings', 'select', PERSONALITY_UUID);
    const legacy = `character-settings::select::${PERSONALITY_UUID}`;
    expect(compacted).not.toBe(legacy);
    expect(parseSettingsCustomId(compacted)?.entityId).toBe(PERSONALITY_UUID);
    expect(parseSettingsCustomId(legacy)?.entityId).toBe(PERSONALITY_UUID);
  });
});

describe('buildSettingsCustomId length guard', () => {
  it('allows a customId exactly at the cap', () => {
    const prefix = buildSettingsCustomId('character-settings', 'set', SNOWFLAKE, '');
    const extra = 'x'.repeat(DISCORD_LIMITS.CUSTOM_ID_MAX_LENGTH - prefix.length);
    const result = buildSettingsCustomId('character-settings', 'set', SNOWFLAKE, extra);
    expect(result).toHaveLength(DISCORD_LIMITS.CUSTOM_ID_MAX_LENGTH);
  });

  it('throws when the joined customId exceeds the cap', () => {
    const prefix = buildSettingsCustomId('character-settings', 'set', SNOWFLAKE, '');
    const extra = 'x'.repeat(DISCORD_LIMITS.CUSTOM_ID_MAX_LENGTH - prefix.length + 1);
    expect(() => buildSettingsCustomId('character-settings', 'set', SNOWFLAKE, extra)).toThrow(
      'customId for character-settings::set is 101 chars (max 100)'
    );
  });
});
