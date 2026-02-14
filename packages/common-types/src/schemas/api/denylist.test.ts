import { describe, it, expect } from 'vitest';
import {
  denylistEntityTypeSchema,
  denylistScopeSchema,
  denylistModeSchema,
  DenylistAddSchema,
  DenylistEntrySchema,
  DenylistCacheResponseSchema,
} from './denylist.js';

describe('denylistEntityTypeSchema', () => {
  it('should accept USER and GUILD', () => {
    expect(denylistEntityTypeSchema.safeParse('USER').success).toBe(true);
    expect(denylistEntityTypeSchema.safeParse('GUILD').success).toBe(true);
  });

  it('should reject invalid types', () => {
    expect(denylistEntityTypeSchema.safeParse('CHANNEL').success).toBe(false);
    expect(denylistEntityTypeSchema.safeParse('BOT').success).toBe(false);
  });
});

describe('denylistScopeSchema', () => {
  it('should accept all valid scopes', () => {
    expect(denylistScopeSchema.safeParse('BOT').success).toBe(true);
    expect(denylistScopeSchema.safeParse('GUILD').success).toBe(true);
    expect(denylistScopeSchema.safeParse('CHANNEL').success).toBe(true);
    expect(denylistScopeSchema.safeParse('PERSONALITY').success).toBe(true);
  });

  it('should reject invalid scopes', () => {
    expect(denylistScopeSchema.safeParse('SERVER').success).toBe(false);
    expect(denylistScopeSchema.safeParse('USER').success).toBe(false);
  });
});

describe('denylistModeSchema', () => {
  it('should accept BLOCK and MUTE', () => {
    expect(denylistModeSchema.safeParse('BLOCK').success).toBe(true);
    expect(denylistModeSchema.safeParse('MUTE').success).toBe(true);
  });

  it('should reject invalid modes', () => {
    expect(denylistModeSchema.safeParse('SILENT').success).toBe(false);
    expect(denylistModeSchema.safeParse('block').success).toBe(false);
  });
});

describe('DenylistAddSchema', () => {
  it('should accept a valid USER + BOT entry with defaults', () => {
    const result = DenylistAddSchema.safeParse({
      type: 'USER',
      discordId: '123456789012345678',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scope).toBe('BOT');
      expect(result.data.scopeId).toBe('*');
      expect(result.data.mode).toBe('BLOCK');
    }
  });

  it('should accept explicit MUTE mode', () => {
    const result = DenylistAddSchema.safeParse({
      type: 'USER',
      discordId: '123456789012345678',
      mode: 'MUTE',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('MUTE');
    }
  });

  it('should reject invalid mode', () => {
    const result = DenylistAddSchema.safeParse({
      type: 'USER',
      discordId: '123456789012345678',
      mode: 'SILENT',
    });
    expect(result.success).toBe(false);
  });

  it('should accept a valid USER + CHANNEL entry', () => {
    const result = DenylistAddSchema.safeParse({
      type: 'USER',
      discordId: '123456789012345678',
      scope: 'CHANNEL',
      scopeId: '987654321098765432',
      reason: 'Spamming in this channel',
    });
    expect(result.success).toBe(true);
  });

  it('should accept a valid USER + PERSONALITY entry', () => {
    const result = DenylistAddSchema.safeParse({
      type: 'USER',
      discordId: '123456789012345678',
      scope: 'PERSONALITY',
      scopeId: 'some-personality-uuid',
    });
    expect(result.success).toBe(true);
  });

  it('should accept a valid GUILD + BOT entry', () => {
    const result = DenylistAddSchema.safeParse({
      type: 'GUILD',
      discordId: '123456789012345678',
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty discordId', () => {
    const result = DenylistAddSchema.safeParse({
      type: 'USER',
      discordId: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject discordId over 20 characters', () => {
    const result = DenylistAddSchema.safeParse({
      type: 'USER',
      discordId: '123456789012345678901',
    });
    expect(result.success).toBe(false);
  });

  it('should reject reason over 500 characters', () => {
    const result = DenylistAddSchema.safeParse({
      type: 'USER',
      discordId: '123456789012345678',
      reason: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid entity type', () => {
    const result = DenylistAddSchema.safeParse({
      type: 'CHANNEL',
      discordId: '123456789012345678',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid scope', () => {
    const result = DenylistAddSchema.safeParse({
      type: 'USER',
      discordId: '123456789012345678',
      scope: 'SERVER',
    });
    expect(result.success).toBe(false);
  });

  it('should reject scopeId over 40 characters', () => {
    const result = DenylistAddSchema.safeParse({
      type: 'USER',
      discordId: '123456789012345678',
      scope: 'CHANNEL',
      scopeId: 'a'.repeat(41),
    });
    expect(result.success).toBe(false);
  });
});

describe('DenylistEntrySchema', () => {
  const validEntry = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    type: 'USER' as const,
    discordId: '123456789012345678',
    scope: 'BOT' as const,
    scopeId: '*',
    mode: 'BLOCK' as const,
    reason: null,
    addedBy: '999999999999999999',
    addedAt: '2026-01-15T00:00:00.000Z',
  };

  it('should accept a valid entry', () => {
    const result = DenylistEntrySchema.safeParse(validEntry);
    expect(result.success).toBe(true);
  });

  it('should coerce addedAt string to Date', () => {
    const result = DenylistEntrySchema.safeParse(validEntry);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.addedAt).toBeInstanceOf(Date);
    }
  });

  it('should accept entry with reason', () => {
    const result = DenylistEntrySchema.safeParse({
      ...validEntry,
      reason: 'Abusive behavior',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid UUID id', () => {
    const result = DenylistEntrySchema.safeParse({
      ...validEntry,
      id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});

describe('DenylistCacheResponseSchema', () => {
  it('should accept empty entries array', () => {
    const result = DenylistCacheResponseSchema.safeParse({ entries: [] });
    expect(result.success).toBe(true);
  });

  it('should accept entries array with valid entries', () => {
    const result = DenylistCacheResponseSchema.safeParse({
      entries: [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          type: 'USER',
          discordId: '123456789012345678',
          scope: 'BOT',
          scopeId: '*',
          mode: 'BLOCK',
          reason: null,
          addedBy: '999999999999999999',
          addedAt: '2026-01-15T00:00:00.000Z',
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
