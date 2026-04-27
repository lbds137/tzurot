import { describe, it, expect } from 'vitest';
import { RecentUsersResponseSchema } from './internal.js';

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
