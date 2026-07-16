import { describe, it, expect } from 'vitest';
import {
  GetNotificationPrefsResponseSchema,
  NotifyLevelSchema,
  UpdateNotificationPrefsInputSchema,
  UpdateNotificationPrefsResponseSchema,
  ListReleaseDmsResponseSchema,
  MarkReleaseDmsDeletedInputSchema,
  MarkReleaseDmsDeletedResponseSchema,
} from './notifications.js';

describe('NotifyLevelSchema', () => {
  it.each(['major', 'minor', 'patch'] as const)('accepts %s', level => {
    expect(NotifyLevelSchema.safeParse(level).success).toBe(true);
  });

  it.each(['prerelease', 'all', '', 'MINOR'])('rejects %s', value => {
    expect(NotifyLevelSchema.safeParse(value).success).toBe(false);
  });
});

describe('GetNotificationPrefsResponseSchema', () => {
  it('accepts a valid prefs payload', () => {
    const result = GetNotificationPrefsResponseSchema.safeParse({
      enabled: true,
      level: 'minor',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown level', () => {
    const result = GetNotificationPrefsResponseSchema.safeParse({
      enabled: true,
      level: 'prerelease',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing enabled flag', () => {
    const result = GetNotificationPrefsResponseSchema.safeParse({ level: 'major' });
    expect(result.success).toBe(false);
  });
});

describe('UpdateNotificationPrefsInputSchema', () => {
  it('accepts enabled alone', () => {
    expect(UpdateNotificationPrefsInputSchema.safeParse({ enabled: false }).success).toBe(true);
  });

  it('accepts level alone', () => {
    expect(UpdateNotificationPrefsInputSchema.safeParse({ level: 'patch' }).success).toBe(true);
  });

  it('accepts both fields together', () => {
    const result = UpdateNotificationPrefsInputSchema.safeParse({
      enabled: true,
      level: 'major',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty patch (neither field)', () => {
    const result = UpdateNotificationPrefsInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects a non-enum level', () => {
    expect(UpdateNotificationPrefsInputSchema.safeParse({ level: 'all' }).success).toBe(false);
  });

  it('rejects a non-boolean enabled', () => {
    expect(UpdateNotificationPrefsInputSchema.safeParse({ enabled: 'yes' }).success).toBe(false);
  });
});

describe('UpdateNotificationPrefsResponseSchema', () => {
  it('accepts the success envelope', () => {
    const result = UpdateNotificationPrefsResponseSchema.safeParse({
      success: true,
      enabled: false,
      level: 'patch',
    });
    expect(result.success).toBe(true);
  });

  it('rejects success: false (literal true required)', () => {
    const result = UpdateNotificationPrefsResponseSchema.safeParse({
      success: false,
      enabled: false,
      level: 'patch',
    });
    expect(result.success).toBe(false);
  });
});

describe('ListReleaseDmsResponseSchema', () => {
  it('accepts a list of standing release DMs', () => {
    const result = ListReleaseDmsResponseSchema.safeParse({
      messages: [
        { deliveryLogId: '123e4567-e89b-42d3-a456-426614174000', messageId: '1234567890' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty list', () => {
    expect(ListReleaseDmsResponseSchema.safeParse({ messages: [] }).success).toBe(true);
  });

  it('rejects a non-uuid deliveryLogId', () => {
    const result = ListReleaseDmsResponseSchema.safeParse({
      messages: [{ deliveryLogId: 'log-1', messageId: '1234567890' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('MarkReleaseDmsDeletedInputSchema', () => {
  it('accepts a list of ledger row ids', () => {
    const result = MarkReleaseDmsDeletedInputSchema.safeParse({
      deliveryLogIds: ['123e4567-e89b-42d3-a456-426614174000'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty list (nothing to stamp is a caller bug)', () => {
    expect(MarkReleaseDmsDeletedInputSchema.safeParse({ deliveryLogIds: [] }).success).toBe(false);
  });

  it('rejects a list past the cleanup cap', () => {
    const ids = Array.from(
      { length: 101 },
      (_unused, i) => `123e4567-e89b-42d3-a456-4266141${String(i).padStart(5, '0')}`
    );
    expect(MarkReleaseDmsDeletedInputSchema.safeParse({ deliveryLogIds: ids }).success).toBe(false);
  });
});

describe('MarkReleaseDmsDeletedResponseSchema', () => {
  it('accepts the success envelope with a count', () => {
    const result = MarkReleaseDmsDeletedResponseSchema.safeParse({ success: true, marked: 2 });
    expect(result.success).toBe(true);
  });

  it('rejects a negative marked count', () => {
    const result = MarkReleaseDmsDeletedResponseSchema.safeParse({ success: true, marked: -1 });
    expect(result.success).toBe(false);
  });
});
