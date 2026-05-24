import { describe, it, expect } from 'vitest';
import {
  DiscordSnowflakeSchema,
  RecentUsersResponseSchema,
  DmSessionSetRequestSchema,
  DmSessionSetResponseSchema,
  MessagePersonalityResponseSchema,
} from './internal.js';

describe('DiscordSnowflakeSchema', () => {
  it('accepts a 17-digit snowflake', () => {
    expect(DiscordSnowflakeSchema.safeParse('12345678901234567').success).toBe(true);
  });

  it('accepts an 18-digit snowflake (most common length today)', () => {
    expect(DiscordSnowflakeSchema.safeParse('123456789012345678').success).toBe(true);
  });

  it('accepts a 20-digit snowflake (max length)', () => {
    expect(DiscordSnowflakeSchema.safeParse('12345678901234567890').success).toBe(true);
  });

  it('rejects a 16-digit string (too short)', () => {
    expect(DiscordSnowflakeSchema.safeParse('1234567890123456').success).toBe(false);
  });

  it('rejects a 21-digit string (too long)', () => {
    expect(DiscordSnowflakeSchema.safeParse('123456789012345678901').success).toBe(false);
  });

  it('rejects non-numeric strings', () => {
    expect(DiscordSnowflakeSchema.safeParse('not-a-snowflake').success).toBe(false);
  });

  it('rejects strings with mixed digits and letters', () => {
    expect(DiscordSnowflakeSchema.safeParse('12345678901234567a').success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(DiscordSnowflakeSchema.safeParse('').success).toBe(false);
  });

  it('rejects non-string inputs (numbers)', () => {
    expect(DiscordSnowflakeSchema.safeParse(123456789012345678).success).toBe(false);
  });
});

describe('RecentUsersResponseSchema', () => {
  it('accepts a valid response with snowflake IDs', () => {
    const data = {
      discordIds: ['111111111111111111', '222222222222222222'],
      sinceDays: 30,
    };
    const result = RecentUsersResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('accepts empty discordIds', () => {
    const data = { discordIds: [], sinceDays: 30 };
    const result = RecentUsersResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('accepts the snowflake length range (17 and 20 digits)', () => {
    const data = {
      discordIds: ['12345678901234567', '12345678901234567890'], // 17 and 20 digits
      sinceDays: 30,
    };
    const result = RecentUsersResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('rejects negative sinceDays', () => {
    const data = { discordIds: [], sinceDays: -1 };
    const result = RecentUsersResponseSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects zero sinceDays', () => {
    const data = { discordIds: [], sinceDays: 0 };
    const result = RecentUsersResponseSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects non-string discordIds', () => {
    const data = { discordIds: [123], sinceDays: 30 };
    const result = RecentUsersResponseSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects empty discordId strings', () => {
    const data = { discordIds: [''], sinceDays: 30 };
    const result = RecentUsersResponseSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric discordId strings', () => {
    const data = { discordIds: ['not-a-snowflake'], sinceDays: 30 };
    const result = RecentUsersResponseSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects discordId strings shorter than 17 digits', () => {
    const data = { discordIds: ['1234567890123456'], sinceDays: 30 }; // 16 digits
    const result = RecentUsersResponseSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects discordId strings longer than 20 digits', () => {
    const data = { discordIds: ['123456789012345678901'], sinceDays: 30 }; // 21 digits
    const result = RecentUsersResponseSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe('DmSessionSetRequestSchema and DmSessionSetResponseSchema', () => {
  it('request accepts valid channelId + personalitySlug', () => {
    expect(
      DmSessionSetRequestSchema.safeParse({
        channelId: '123456789012345678',
        personalitySlug: 'lila',
      }).success
    ).toBe(true);
  });

  it('response shape mirrors request shape (echo of what was set)', () => {
    expect(
      DmSessionSetResponseSchema.safeParse({
        channelId: '123456789012345678',
        personalitySlug: 'lila',
      }).success
    ).toBe(true);
  });

  it('request rejects missing channelId', () => {
    expect(DmSessionSetRequestSchema.safeParse({ personalitySlug: 'lila' }).success).toBe(false);
  });
});

describe('MessagePersonalityResponseSchema', () => {
  it('accepts a full response with name', () => {
    expect(
      MessagePersonalityResponseSchema.safeParse({
        personalityId: 'personality-uuid',
        personalityName: 'Lila',
      }).success
    ).toBe(true);
  });

  it('accepts response with null personalityName (denormalized name may be absent)', () => {
    expect(
      MessagePersonalityResponseSchema.safeParse({
        personalityId: 'personality-uuid',
        personalityName: null,
      }).success
    ).toBe(true);
  });

  it('accepts response without personalityName at all (optional field)', () => {
    expect(
      MessagePersonalityResponseSchema.safeParse({ personalityId: 'personality-uuid' }).success
    ).toBe(true);
  });

  it('rejects missing personalityId', () => {
    expect(MessagePersonalityResponseSchema.safeParse({ personalityName: 'Lila' }).success).toBe(
      false
    );
  });
});
