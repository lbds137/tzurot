/**
 * Tests for the pure projection helpers extracted from MultiTagCoordinator.
 *
 * Both functions are field-mapping projections — small, but with real logic
 * (ISO-date conversion, slot-array transformation, nullable handling). Per
 * `02-code-standards.md`, modules with logic get colocated tests rather
 * than structure-test exclusions.
 */

import { describe, it, expect } from 'vitest';
import type { Message } from 'discord.js';
import type { TypingChannel } from '@tzurot/common-types/types/discord-types';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import {
  ApiErrorCategory,
  ApiErrorType,
  USER_ERROR_MESSAGES,
} from '@tzurot/common-types/constants/error';
import {
  buildSlotContext,
  buildSyntheticErrorResult,
  toSnapshot,
  type RuntimeEntry,
  type RuntimeSlot,
} from './multiTagCoordinatorHelpers.js';

function buildPersonality(name: string): LoadedPersonality {
  return {
    id: `pid-${name}`,
    name,
    displayName: name,
    slug: name.toLowerCase(),
  } as unknown as LoadedPersonality;
}

function buildSlot(name: string, overrides: Partial<RuntimeSlot> = {}): RuntimeSlot {
  return {
    slotIndex: 0,
    personality: buildPersonality(name),
    personaId: `persona-${name}`,
    source: 'mention',
    isAutoResponse: false,
    jobId: `job-${name}`,
    status: 'pending',
    ...overrides,
  };
}

function buildEntry(overrides: Partial<RuntimeEntry> = {}): RuntimeEntry {
  return {
    groupId: 'group-1',
    sourceMessageId: 'msg-1',
    message: { id: 'msg-1', author: { id: 'user-1' } } as unknown as Message,
    channel: { id: 'channel-1' } as unknown as TypingChannel,
    guildId: 'guild-1',
    clientId: 'bot-1',
    userId: 'user-1',
    userMessageTime: new Date('2026-05-15T10:00:00Z'),
    userMessageContent: 'hi everyone',
    slots: [buildSlot('Alice')],
    createdAt: 1737900000000,
    // Throwaway handle for the fixture; never armed for real. 0ms leaves no timer pending.
    timeoutHandle: setTimeout(() => undefined, 0),
    truncated: false,
    ...overrides,
  };
}

describe('buildSlotContext', () => {
  it('projects entry + slot into the SlotDelivery shape', () => {
    const entry = buildEntry();
    const slot = buildSlot('Bob', { slotIndex: 1, isAutoResponse: true });

    const ctx = buildSlotContext(entry, slot);

    expect(ctx).toMatchObject({
      message: entry.message,
      channel: entry.channel,
      guildId: 'guild-1',
      clientId: 'bot-1',
      personality: slot.personality,
      personaId: 'persona-Bob',
      userMessageContent: 'hi everyone',
      userMessageTime: entry.userMessageTime,
      isAutoResponse: true,
      recipientUserId: 'user-1',
    });
    clearTimeout(entry.timeoutHandle);
  });

  it('passes through null guildId for DM channels', () => {
    const entry = buildEntry({ guildId: null });
    const ctx = buildSlotContext(entry, entry.slots[0]);
    expect(ctx.guildId).toBeNull();
    clearTimeout(entry.timeoutHandle);
  });

  it('passes through undefined clientId', () => {
    const entry = buildEntry({ clientId: undefined });
    const ctx = buildSlotContext(entry, entry.slots[0]);
    expect(ctx.clientId).toBeUndefined();
    clearTimeout(entry.timeoutHandle);
  });
});

describe('toSnapshot', () => {
  it('serializes runtime entry into the Redis-storable shape', () => {
    const entry = buildEntry({
      slots: [
        buildSlot('Alice', { slotIndex: 0, status: 'completed' }),
        buildSlot('Bob', { slotIndex: 1, isAutoResponse: true, status: 'pending' }),
      ],
    });

    const snap = toSnapshot(entry);

    expect(snap.groupId).toBe('group-1');
    expect(snap.sourceMessageId).toBe('msg-1');
    expect(snap.channelId).toBe('channel-1');
    expect(snap.guildId).toBe('guild-1');
    expect(snap.userId).toBe('user-1');
    expect(snap.userMessageContent).toBe('hi everyone');
    expect(snap.createdAt).toBe(1737900000000);
    expect(snap.slots).toEqual([
      {
        slotIndex: 0,
        personalityId: 'pid-Alice',
        personalitySlug: 'alice',
        personaId: 'persona-Alice',
        source: 'mention',
        isAutoResponse: false,
        jobId: 'job-Alice',
        status: 'completed',
      },
      {
        slotIndex: 1,
        personalityId: 'pid-Bob',
        personalitySlug: 'bob',
        personaId: 'persona-Bob',
        source: 'mention',
        isAutoResponse: true,
        jobId: 'job-Bob',
        status: 'pending',
      },
    ]);
    clearTimeout(entry.timeoutHandle);
  });

  it('converts userMessageTime to ISO string', () => {
    const entry = buildEntry({ userMessageTime: new Date('2026-05-15T10:00:00.000Z') });
    const snap = toSnapshot(entry);
    expect(snap.userMessageTime).toBe('2026-05-15T10:00:00.000Z');
    expect(typeof snap.userMessageTime).toBe('string');
    clearTimeout(entry.timeoutHandle);
  });

  it('preserves null guildId in the snapshot (DM case)', () => {
    const entry = buildEntry({ guildId: null });
    const snap = toSnapshot(entry);
    expect(snap.guildId).toBeNull();
    clearTimeout(entry.timeoutHandle);
  });

  it('does not include runtime-only fields (timeoutHandle, message, channel object)', () => {
    const entry = buildEntry();
    const snap = toSnapshot(entry) as unknown as Record<string, unknown>;
    expect(snap).not.toHaveProperty('timeoutHandle');
    expect(snap).not.toHaveProperty('message');
    // `channel` becomes the flat `channelId` string.
    expect(snap).not.toHaveProperty('channel');
    clearTimeout(entry.timeoutHandle);
  });

  it('maps personality.id and personality.slug onto slot fields', () => {
    const entry = buildEntry({
      slots: [
        buildSlot('Capitalized', { slotIndex: 0 }), // personality.slug is .toLowerCase()
      ],
    });
    const snap = toSnapshot(entry);
    expect(snap.slots[0].personalityId).toBe('pid-Capitalized');
    expect(snap.slots[0].personalitySlug).toBe('capitalized');
    clearTimeout(entry.timeoutHandle);
  });
});

describe('buildSyntheticErrorResult', () => {
  it('builds a success:false result carrying the persona errorMessage and category-sourced fields', () => {
    const personality = {
      ...buildPersonality('Alice'),
      errorMessage: '*Alice sighs* something broke on my end.',
    } as LoadedPersonality;

    const result = buildSyntheticErrorResult(personality, {
      requestId: 'req-abc',
      category: ApiErrorCategory.TIMEOUT,
      type: ApiErrorType.TRANSIENT,
      technicalMessage: 'Response timed out',
    });

    expect(result.success).toBe(false);
    expect(result.requestId).toBe('req-abc');
    expect(result.error).toBe('Response timed out');
    // The persona's own voice is carried so buildErrorContent renders it.
    expect(result.personalityErrorMessage).toBe('*Alice sighs* something broke on my end.');
    expect(result.errorInfo).toMatchObject({
      type: ApiErrorType.TRANSIENT,
      category: ApiErrorCategory.TIMEOUT,
      // userMessage is sourced from the shared table, not hand-written.
      userMessage: USER_ERROR_MESSAGES[ApiErrorCategory.TIMEOUT],
      technicalMessage: 'Response timed out',
      referenceId: 'req-abc',
      // Never auto-retries on a synthesized path — the user re-prompts.
      shouldRetry: false,
    });
  });

  it('leaves personalityErrorMessage undefined when the persona has none (generic fallback path)', () => {
    const result = buildSyntheticErrorResult(buildPersonality('Bob'), {
      requestId: 'req-xyz',
      category: ApiErrorCategory.UNKNOWN,
      type: ApiErrorType.UNKNOWN,
      technicalMessage: 'Slot submission failed',
    });

    expect(result.personalityErrorMessage).toBeUndefined();
    expect(result.errorInfo?.userMessage).toBe(USER_ERROR_MESSAGES[ApiErrorCategory.UNKNOWN]);
  });
});
