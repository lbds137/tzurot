/**
 * Tests for multiTagDeliveryFlow. Most behavior is exercised via
 * MultiTagCoordinator.test.ts (integration through the coordinator's
 * public surface), but the flow's pure functions deserve direct
 * coverage so the structural test-colocation rule is satisfied AND so
 * the flow can be tested independently of coordinator wiring.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Message } from 'discord.js';
import type { TypingChannel } from '@tzurot/common-types/types/discord-types';
import type { LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { MULTI_TAG } from '@tzurot/common-types/constants/message';
import {
  deliverGroup,
  deliverErroredOutcomes,
  type DeliveryFlowDeps,
} from './multiTagDeliveryFlow.js';
import type { RuntimeEntry, RuntimeSlot } from './multiTagCoordinatorHelpers.js';
import { confirmDelivery, setDmSessionPersonality } from '../utils/gatewayServiceCalls.js';
import { reportJobError } from '../observability/ErrorChannelReporter.js';

vi.mock('../utils/gatewayServiceCalls.js', () => ({
  confirmDelivery: vi.fn(),
  setDmSessionPersonality: vi.fn(),
}));

vi.mock('../observability/ErrorChannelReporter.js', () => {
  const reportJobError = vi.fn();
  return {
    reportJobError,
    // Mirrors the real implementation's no-op-when-absent + delegate-to-
    // reportJobError(category, requestId, { rescued: true }) shape, so
    // existing `vi.mocked(reportJobError)` assertions keep working unchanged
    // for the success-path seam.
    // KEPT IN SYNC BY HAND with reportQuotaFallbackRescue in
    // ErrorChannelReporter.ts — behavior changes there (including the
    // rescued opts flag) are caught only by that file's own tests, not these
    // wiring tests (the reporter's module-level client + dedup caches make
    // exercising the real chain here more fragile than this hand-mirror).
    reportQuotaFallbackRescue: (
      quotaFallback: { category: string } | undefined,
      requestId: string | undefined
    ) => {
      if (quotaFallback !== undefined) {
        reportJobError(quotaFallback.category, requestId, { rescued: true });
      }
    },
  };
});

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
    // Throwaway handle for the fixture; never armed for real. 0ms leaves no timer pending.
    timeoutHandle: setTimeout(() => undefined, 0),
    truncated: false,
    maxTags: 5,
    ...overrides,
  };
}

describe('deliverGroup', () => {
  let deps: DeliveryFlowDeps;
  let slotDelivery: {
    deliverSuccess: ReturnType<typeof vi.fn>;
    deliverError: ReturnType<typeof vi.fn>;
  };
  let persistence: {
    deleteEntry: ReturnType<typeof vi.fn>;
    clearDMBackfillTried: ReturnType<typeof vi.fn>;
    markSlotDelivered: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(confirmDelivery).mockResolvedValue(undefined);
    vi.mocked(setDmSessionPersonality).mockResolvedValue(undefined);
    slotDelivery = {
      deliverSuccess: vi.fn().mockResolvedValue({ chunkMessageIds: ['m1'] }),
      deliverError: vi.fn().mockResolvedValue(undefined),
    };
    persistence = {
      deleteEntry: vi.fn().mockResolvedValue(undefined),
      clearDMBackfillTried: vi.fn().mockResolvedValue(undefined),
      markSlotDelivered: vi.fn().mockResolvedValue(undefined),
    };
    deps = {
      slotDelivery: slotDelivery as unknown as DeliveryFlowDeps['slotDelivery'],
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
    expect(vi.mocked(reportJobError)).not.toHaveBeenCalled();
  });

  it('reports a failed slot to the error channel with its category and requestId', async () => {
    // The seam this pins: a persona erroring at a user via the prefix-trigger
    // path must reach the owner error channel — the beta.207 smoke test found
    // this path silently bypassing the reporter.
    const entry = buildEntry({
      slots: [
        buildSlot('Alice', {
          result: {
            requestId: 'req-Alice',
            success: false,
            error: '400 not a valid model ID',
            errorInfo: { category: 'api_error' },
          } as unknown as LLMGenerationResult,
        }),
      ],
    });

    await deliverGroup(entry, deps);

    expect(slotDelivery.deliverError).toHaveBeenCalledOnce();
    expect(vi.mocked(reportJobError)).toHaveBeenCalledWith('api_error', 'req-Alice');
  });

  it('reports a successful quota-fallback rescue slot carrying a non-deny-listed category (model_not_found)', async () => {
    // Mirrors MessageHandler's success-path check: a slot that succeeded
    // only because the tier-aware fallback retargeted away from a
    // misconfigured model must still reach the owner channel.
    const entry = buildEntry({
      slots: [
        buildSlot('Alice', {
          result: {
            requestId: 'req-Alice-rescue',
            success: true,
            content: 'Rescued response',
            metadata: {
              quotaFallback: {
                fromModel: 'delisted/model',
                toModel: 'admin/default',
                category: 'model_not_found',
                mode: 'reactive',
              },
            },
          } as unknown as LLMGenerationResult,
        }),
      ],
    });

    await deliverGroup(entry, deps);

    expect(slotDelivery.deliverSuccess).toHaveBeenCalledOnce();
    expect(vi.mocked(reportJobError)).toHaveBeenCalledWith('model_not_found', 'req-Alice-rescue', {
      rescued: true,
    });
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

  it('skips confirmDelivery for timed-out slots but confirms completed ones', async () => {
    const entry = buildEntry({
      slots: [
        buildSlot('Alice', { slotIndex: 0, jobId: 'job-Alice', status: 'completed' }),
        buildSlot('Bob', { slotIndex: 1, jobId: 'job-Bob', status: 'timedout', result: undefined }),
      ],
    });

    await deliverGroup(entry, deps);

    // Completed slot gets confirmed; timed-out slot does NOT (ai-worker never
    // wrote its JobResult row → confirmDelivery would be a guaranteed 404).
    expect(vi.mocked(confirmDelivery)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(confirmDelivery)).toHaveBeenCalledWith('job-Alice');
    expect(vi.mocked(confirmDelivery)).not.toHaveBeenCalledWith('job-Bob');
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

  it('overlays personalityErrorMessage when synthesized failure result lacks it', async () => {
    // Path: JobFailureListener or MultiTagRecovery synthesized a failure result
    // and routed it via coordinator.handleJobResult. The synthetic result has
    // `success: false` but no `personalityErrorMessage`. Without the overlay,
    // `??` would short-circuit and the user sees DEFAULT_ERROR instead of the
    // personality's voice.
    const entry = buildEntry({
      slots: [
        buildSlot('Alice', {
          status: 'errored',
          result: {
            requestId: 'r1',
            success: false,
            error: 'Upstream gateway failure',
          } as LLMGenerationResult,
          personalityErrorMessage: 'Static crackles. Did something break?',
        }),
      ],
    });

    await deliverGroup(entry, deps);

    const [rendered, synthetic] = slotDelivery.deliverError.mock.calls[0];
    expect(synthetic.personalityErrorMessage).toBe('Static crackles. Did something break?');
    expect(rendered).toContain('Static crackles');
    expect(rendered).not.toContain('Sorry, I encountered an error');
  });

  it('overlays personalityErrorMessage on completed-but-empty success result', async () => {
    // Path: ai-worker emits success:true with empty content (rare upstream
    // edge — rate-limit soft-fail). hasUsableContent returns false; we route
    // through the error path. The original result has no personalityErrorMessage,
    // so without the overlay the user sees DEFAULT_ERROR.
    const entry = buildEntry({
      slots: [
        buildSlot('Alice', {
          status: 'completed',
          result: {
            requestId: 'r1',
            success: true,
            content: '',
          } as LLMGenerationResult,
          personalityErrorMessage: 'Words escape me, just for a moment.',
        }),
      ],
    });

    await deliverGroup(entry, deps);

    const [rendered, synthetic] = slotDelivery.deliverError.mock.calls[0];
    expect(synthetic.personalityErrorMessage).toBe('Words escape me, just for a moment.');
    expect(rendered).toContain('Words escape me');
    expect(rendered).not.toContain('Sorry, I encountered an error');
  });

  it('preserves an already-set personalityErrorMessage on the result without overwriting', async () => {
    // Sanity: if the upstream already enriched the result, don't replace it
    // with `slot.personality.errorMessage` (which may differ if the persona
    // was edited mid-flight).
    const entry = buildEntry({
      slots: [
        buildSlot('Alice', {
          status: 'errored',
          result: {
            requestId: 'r1',
            success: false,
            error: 'Upstream',
            personalityErrorMessage: 'Original enriched message',
          } as LLMGenerationResult,
          personalityErrorMessage: 'Slot-personality message (should NOT win)',
        }),
      ],
    });

    await deliverGroup(entry, deps);

    const [, synthetic] = slotDelivery.deliverError.mock.calls[0];
    expect(synthetic.personalityErrorMessage).toBe('Original enriched message');
  });

  it('writes slot-delivered marker after each successful slot send', async () => {
    const entry = buildEntry({
      slots: [
        buildSlot('Alice', { slotIndex: 0, jobId: 'job-Alice' }),
        buildSlot('Bob', { slotIndex: 1, jobId: 'job-Bob' }),
      ],
    });

    await deliverGroup(entry, deps);

    expect(persistence.markSlotDelivered).toHaveBeenCalledWith('job-Alice');
    expect(persistence.markSlotDelivered).toHaveBeenCalledWith('job-Bob');
    expect(persistence.markSlotDelivered).toHaveBeenCalledTimes(2);
  });

  it('writes slot-delivered marker after error-path delivery too', async () => {
    // `timedout` status → hasUsableContent returns false → routes through
    // deliverError. The marker is still written because the user-visible
    // Discord message DID land (an in-character error message); a recovery
    // re-dispatch would still be a duplicate.
    const entry = buildEntry({
      slots: [buildSlot('Alice', { status: 'timedout', result: undefined, jobId: 'job-Alice' })],
    });

    await deliverGroup(entry, deps);

    expect(slotDelivery.deliverError).toHaveBeenCalledOnce();
    expect(persistence.markSlotDelivered).toHaveBeenCalledWith('job-Alice');
  });

  it('does NOT write slot-delivered marker when delivery throws', async () => {
    slotDelivery.deliverSuccess.mockRejectedValueOnce(new Error('Discord 500'));
    const entry = buildEntry({
      slots: [
        buildSlot('Alice', { slotIndex: 0, jobId: 'job-Alice' }),
        buildSlot('Bob', { slotIndex: 1, jobId: 'job-Bob' }),
      ],
    });

    await deliverGroup(entry, deps);

    // Alice's send threw — no marker. Bob's send succeeded — marker.
    expect(persistence.markSlotDelivered).not.toHaveBeenCalledWith('job-Alice');
    expect(persistence.markSlotDelivered).toHaveBeenCalledWith('job-Bob');
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
    expect(vi.mocked(confirmDelivery)).toHaveBeenCalledWith('job-Alice');
    expect(vi.mocked(confirmDelivery)).toHaveBeenCalledWith('job-Bob');
  });

  it('appends a truncation notice when entry.truncated is true', async () => {
    const entry = buildEntry({ truncated: true, maxTags: MULTI_TAG.MAX_TAGS });

    await deliverGroup(entry, deps);

    expect(entry.message.reply).toHaveBeenCalledWith(
      `_(Only the first ${MULTI_TAG.MAX_TAGS} tagged characters respond.)_`
    );
  });

  it('quotes the entry cap in the notice, not the in-code default', async () => {
    // The stamped cap is what the resolver applied; an admin change landing
    // between resolution and delivery must not rewrite the number the user
    // sees. 3 is deliberately different from MULTI_TAG.MAX_TAGS.
    const entry = buildEntry({ truncated: true, maxTags: 3 });

    await deliverGroup(entry, deps);

    expect(entry.message.reply).toHaveBeenCalledWith(
      '_(Only the first 3 tagged characters respond.)_'
    );
  });

  it('uses the singular wording at a cap of 1 — the registry floor makes it reachable', async () => {
    const entry = buildEntry({ truncated: true, maxTags: 1 });

    await deliverGroup(entry, deps);

    expect(entry.message.reply).toHaveBeenCalledWith(
      '_(Only the first 1 tagged character responds.)_'
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

    expect(vi.mocked(confirmDelivery)).toHaveBeenCalledWith('job-Alice');
    expect(vi.mocked(confirmDelivery)).toHaveBeenCalledWith('job-Bob');
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
    expect(vi.mocked(setDmSessionPersonality)).toHaveBeenCalledWith(entry.channel.id, 'bob');
    // Backfill sentinel cleared so post-activation bare DMs take the fast path
    expect(persistence.clearDMBackfillTried).toHaveBeenCalledWith(entry.channel.id);
  });

  it('does NOT write DM session state for guild channels', async () => {
    const entry = buildEntry({ guildId: 'guild-1' });

    await deliverGroup(entry, deps);

    expect(vi.mocked(setDmSessionPersonality)).not.toHaveBeenCalled();
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
    expect(vi.mocked(confirmDelivery)).toHaveBeenCalled();
    expect(persistence.deleteEntry).toHaveBeenCalled();
  });
});

describe('deliverErroredOutcomes', () => {
  it('contains a rejecting delivery — the sibling character still speaks', async () => {
    // The allSettled containment is the guarantee the coordinator's
    // fire-and-forget call relies on; pin it here rather than only in a
    // comment. deliverErrorNoPersist swallows internally today, but the
    // containment must hold even if it is ever refactored to throw.
    const deliverErrorNoPersist = vi
      .fn()
      .mockRejectedValueOnce(new Error('webhook send failed'))
      .mockResolvedValue(undefined);
    const deps = {
      slotDelivery: { deliverErrorNoPersist } as unknown as DeliveryFlowDeps['slotDelivery'],
    };
    const message = {
      id: 'msg-source',
      guildId: 'guild-1',
      client: { user: { id: 'bot-1' } },
    } as unknown as Message;
    const channel = { id: 'channel-1' } as unknown as TypingChannel;
    const spec = (name: string): LLMGenerationResult =>
      ({ requestId: `req-${name}`, success: false, error: 'boom' }) as LLMGenerationResult;

    await expect(
      deliverErroredOutcomes(
        { message, channel },
        [
          { personality: buildPersonality('Alice'), isAutoResponse: false, spec: spec('Alice') },
          { personality: buildPersonality('Bob'), isAutoResponse: false, spec: spec('Bob') },
        ],
        deps
      )
    ).resolves.toBeUndefined();

    // Both were attempted — Alice's rejection did not drop Bob's delivery.
    expect(deliverErrorNoPersist).toHaveBeenCalledTimes(2);
    const deliveredIds = deliverErrorNoPersist.mock.calls.map(
      c => (c[2] as { personality: { id: string } }).personality.id
    );
    expect(deliveredIds).toEqual(['id-alice', 'id-bob']);
  });

  it('reports each errored outcome to the error channel with its category and requestId', async () => {
    const deliverErrorNoPersist = vi.fn().mockResolvedValue(undefined);
    const deps = {
      slotDelivery: { deliverErrorNoPersist } as unknown as DeliveryFlowDeps['slotDelivery'],
    };
    const message = {
      id: 'msg-source',
      guildId: 'guild-1',
      client: { user: { id: 'bot-1' } },
    } as unknown as Message;
    const channel = { id: 'channel-1' } as unknown as TypingChannel;
    const spec = {
      requestId: 'req-Alice',
      success: false,
      error: 'submit blew up',
      errorInfo: { category: 'api_error' },
    } as unknown as LLMGenerationResult;

    await deliverErroredOutcomes(
      { message, channel },
      [{ personality: buildPersonality('Alice'), isAutoResponse: false, spec }],
      deps
    );

    expect(vi.mocked(reportJobError)).toHaveBeenCalledWith('api_error', 'req-Alice');
  });
});
