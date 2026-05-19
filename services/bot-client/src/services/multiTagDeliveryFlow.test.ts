/**
 * Tests for multiTagDeliveryFlow. Most behavior is exercised via
 * MultiTagCoordinator.test.ts (integration through the coordinator's
 * public surface), but the flow's pure functions deserve direct
 * coverage so the structural test-colocation rule is satisfied AND so
 * the flow can be tested independently of coordinator wiring.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Message } from 'discord.js';
import type { LLMGenerationResult, LoadedPersonality, TypingChannel } from '@tzurot/common-types';
import { MULTI_TAG } from '@tzurot/common-types';
import { deliverGroup, type DeliveryFlowDeps } from './multiTagDeliveryFlow.js';
import type { RuntimeEntry, RuntimeSlot } from './multiTagCoordinatorHelpers.js';

function buildPersonality(name: string, errorMessage?: string): LoadedPersonality {
  return {
    id: `id-${name.toLowerCase()}`,
    slug: name.toLowerCase(),
    displayName: name,
    name,
    errorMessage,
  } as unknown as LoadedPersonality;
}

function buildSlot(
  name: string,
  overrides: Partial<RuntimeSlot> & { personalityErrorMessage?: string } = {}
): RuntimeSlot {
  const { personalityErrorMessage, ...slotOverrides } = overrides;
  return {
    slotIndex: 0,
    personality: buildPersonality(name, personalityErrorMessage),
    personaId: `persona-${name}`,
    source: 'mention',
    isAutoResponse: false,
    jobId: `job-${name}`,
    status: 'completed',
    result: {
      requestId: `req-${name}`,
      success: true,
      content: `Hello from ${name}`,
    },
    ...slotOverrides,
  };
}

function buildEntry(overrides: Partial<RuntimeEntry> = {}): RuntimeEntry {
  const message = {
    id: 'msg-source',
    reply: vi.fn().mockResolvedValue({ id: 'reply-1' }),
  } as unknown as Message;
  const channel = { id: 'channel-1' } as unknown as TypingChannel;
  return {
    groupId: 'group-1',
    sourceMessageId: 'msg-source',
    message,
    channel,
    guildId: 'guild-1',
    clientId: 'bot-1',
    userId: 'user-1',
    userMessageTime: new Date('2026-05-15T10:00:00Z'),
    userMessageContent: 'hi everyone',
    slots: [buildSlot('Alice')],
    createdAt: Date.now(),
    timeoutHandle: setTimeout(() => undefined, 100000),
    truncated: false,
    ...overrides,
  };
}

describe('deliverGroup', () => {
  let deps: DeliveryFlowDeps;
  let slotDelivery: {
    deliverSuccess: ReturnType<typeof vi.fn>;
    deliverError: ReturnType<typeof vi.fn>;
  };
  let gatewayClient: {
    confirmDelivery: ReturnType<typeof vi.fn>;
    setDmSessionPersonality: ReturnType<typeof vi.fn>;
  };
  let persistence: {
    deleteEntry: ReturnType<typeof vi.fn>;
    clearDMBackfillTried: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    slotDelivery = {
      deliverSuccess: vi.fn().mockResolvedValue({ chunkMessageIds: ['m1'] }),
      deliverError: vi.fn().mockResolvedValue(undefined),
    };
    gatewayClient = {
      confirmDelivery: vi.fn().mockResolvedValue(undefined),
      setDmSessionPersonality: vi.fn().mockResolvedValue(undefined),
    };
    persistence = {
      deleteEntry: vi.fn().mockResolvedValue(undefined),
      clearDMBackfillTried: vi.fn().mockResolvedValue(undefined),
    };
    deps = {
      slotDelivery: slotDelivery as unknown as DeliveryFlowDeps['slotDelivery'],
      gatewayClient: gatewayClient as unknown as DeliveryFlowDeps['gatewayClient'],
      persistence: persistence as unknown as DeliveryFlowDeps['persistence'],
    };
  });

  it('delivers each slot via deliverSuccess in slot order', async () => {
    const entry = buildEntry({
      slots: [
        buildSlot('Alice', { slotIndex: 0, jobId: 'job-Alice' }),
        buildSlot('Bob', { slotIndex: 1, jobId: 'job-Bob' }),
      ],
    });

    await deliverGroup(entry, deps);

    expect(slotDelivery.deliverSuccess).toHaveBeenCalledTimes(2);
    expect(slotDelivery.deliverError).not.toHaveBeenCalled();
  });

  it('routes empty-content "success" through deliverError instead', async () => {
    const entry = buildEntry({
      slots: [
        buildSlot('Alice', {
          result: {
            requestId: 'r1',
            success: true,
            content: '', // Empty
          } as LLMGenerationResult,
        }),
      ],
    });

    await deliverGroup(entry, deps);

    expect(slotDelivery.deliverSuccess).not.toHaveBeenCalled();
    expect(slotDelivery.deliverError).toHaveBeenCalledOnce();
  });

  it('routes timed-out slots through deliverError with a synthetic error', async () => {
    const entry = buildEntry({
      slots: [buildSlot('Alice', { status: 'timedout', result: undefined })],
    });

    await deliverGroup(entry, deps);

    expect(slotDelivery.deliverError).toHaveBeenCalledOnce();
    const synthetic = slotDelivery.deliverError.mock.calls[0][1];
    expect(synthetic.success).toBe(false);
    expect(synthetic.error).toContain('timed out');
    // Synthetic carries structured errorInfo so buildErrorContent can format
    // the user-facing message (with spoiler) instead of returning the
    // generic bot fallback.
    expect(synthetic.errorInfo).toBeDefined();
    expect(synthetic.errorInfo.category).toBe('timeout');
    expect(synthetic.errorInfo.referenceId).toBe(entry.groupId);
  });

  it('renders the personality error message on safety timeout when configured', async () => {
    const entry = buildEntry({
      slots: [
        buildSlot('Alice', {
          status: 'timedout',
          result: undefined,
          personalityErrorMessage: 'My circuits got fried, sorry darling.',
        }),
      ],
    });

    await deliverGroup(entry, deps);

    const [rendered, synthetic] = slotDelivery.deliverError.mock.calls[0];
    expect(synthetic.personalityErrorMessage).toBe('My circuits got fried, sorry darling.');
    // Rendered output uses the personality's voice, not the generic default.
    expect(rendered).toContain('My circuits got fried');
    expect(rendered).not.toContain('Sorry, I encountered an error');
  });

  it('uses the timeout-category user message when no personality errorMessage is configured', async () => {
    const entry = buildEntry({
      slots: [buildSlot('Alice', { status: 'timedout', result: undefined })],
    });

    await deliverGroup(entry, deps);

    const [rendered] = slotDelivery.deliverError.mock.calls[0];
    // No personalityErrorMessage on the slot's personality, so buildErrorContent
    // falls through to USER_ERROR_MESSAGES[timeout] — the timeout-specific
    // user message, NOT the generic bot fallback.
    expect(rendered).toContain('took too long');
  });

  it('uses UNKNOWN category when a slot has no result and is not timed-out', async () => {
    // Slot ended up at deliverError without a result and without 'timedout'
    // status — rare path that happens when an upstream error path marks the
    // slot 'errored' but doesn't populate result.
    const entry = buildEntry({
      slots: [buildSlot('Alice', { status: 'errored', result: undefined })],
    });

    await deliverGroup(entry, deps);

    const [rendered, synthetic] = slotDelivery.deliverError.mock.calls[0];
    expect(synthetic.error).toBe('No response received');
    expect(synthetic.errorInfo.category).toBe('unknown');
    expect(synthetic.errorInfo.type).toBe('unknown');
    // No personalityErrorMessage configured → falls through to the
    // UNKNOWN category's user message, NOT the generic bot fallback.
    expect(rendered).not.toContain('Sorry, I encountered an error');
  });

  it('continues delivering remaining slots when one slot throws', async () => {
    slotDelivery.deliverSuccess
      .mockRejectedValueOnce(new Error('first slot exploded'))
      .mockResolvedValueOnce({ chunkMessageIds: ['m2'] });

    const entry = buildEntry({
      slots: [
        buildSlot('Alice', { slotIndex: 0, jobId: 'job-Alice' }),
        buildSlot('Bob', { slotIndex: 1, jobId: 'job-Bob' }),
      ],
    });

    await deliverGroup(entry, deps);

    expect(slotDelivery.deliverSuccess).toHaveBeenCalledTimes(2);
    // Cleanup still runs for both slots.
    expect(gatewayClient.confirmDelivery).toHaveBeenCalledWith('job-Alice');
    expect(gatewayClient.confirmDelivery).toHaveBeenCalledWith('job-Bob');
  });

  it('appends a truncation notice when entry.truncated is true', async () => {
    const entry = buildEntry({ truncated: true });

    await deliverGroup(entry, deps);

    expect(entry.message.reply).toHaveBeenCalledWith(
      `_(Only the first ${MULTI_TAG.MAX_TAGS} tagged personalities respond.)_`
    );
  });

  it('does NOT append a truncation notice when entry.truncated is false', async () => {
    const entry = buildEntry({ truncated: false });

    await deliverGroup(entry, deps);

    expect(entry.message.reply).not.toHaveBeenCalled();
  });

  it('confirms delivery for each slot and deletes the Redis entry', async () => {
    const entry = buildEntry({
      slots: [
        buildSlot('Alice', { slotIndex: 0, jobId: 'job-Alice' }),
        buildSlot('Bob', { slotIndex: 1, jobId: 'job-Bob' }),
      ],
    });

    await deliverGroup(entry, deps);

    expect(gatewayClient.confirmDelivery).toHaveBeenCalledWith('job-Alice');
    expect(gatewayClient.confirmDelivery).toHaveBeenCalledWith('job-Bob');
    expect(persistence.deleteEntry).toHaveBeenCalledOnce();
  });

  it('writes DM session state + clears backfill sentinel for DM channels', async () => {
    const entry = buildEntry({
      guildId: null,
      slots: [
        buildSlot('Alice', { slotIndex: 0, jobId: 'job-Alice' }),
        buildSlot('Bob', { slotIndex: 1, jobId: 'job-Bob' }),
      ],
    });

    await deliverGroup(entry, deps);

    // Bob is textually-last mention → new active session
    expect(gatewayClient.setDmSessionPersonality).toHaveBeenCalledWith(entry.channel.id, 'bob');
    // Backfill sentinel cleared so post-activation bare DMs take the fast path
    expect(persistence.clearDMBackfillTried).toHaveBeenCalledWith(entry.channel.id);
  });

  it('does NOT write DM session state for guild channels', async () => {
    const entry = buildEntry({ guildId: 'guild-1' });

    await deliverGroup(entry, deps);

    expect(gatewayClient.setDmSessionPersonality).not.toHaveBeenCalled();
    expect(persistence.clearDMBackfillTried).not.toHaveBeenCalled();
  });

  it('still completes cleanup when persistence.deleteEntry rejects', async () => {
    persistence.deleteEntry.mockRejectedValue(new Error('Redis blip'));

    const entry = buildEntry();

    // Should not throw — Redis TTL will reclaim
    await expect(deliverGroup(entry, deps)).resolves.toBeUndefined();
  });

  it('swallows truncation-notice send failures without breaking cleanup', async () => {
    const message = {
      id: 'msg-source',
      reply: vi.fn().mockRejectedValue(new Error('Discord refused')),
    } as unknown as Message;
    const entry = buildEntry({ message, truncated: true });

    await expect(deliverGroup(entry, deps)).resolves.toBeUndefined();
    // Confirmation cleanup still ran despite the failed notice
    expect(gatewayClient.confirmDelivery).toHaveBeenCalled();
    expect(persistence.deleteEntry).toHaveBeenCalled();
  });
});
