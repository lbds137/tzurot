/**
 * Tests for MultiTagRecovery — the startup hook that rehydrates in-flight
 * multi-tag fan-outs after a bot restart.
 *
 * Strategy: mock every external dep (persistence, coordinator, queue,
 * personalityService, Discord client). Drive the recovery lifecycle by
 * feeding in pre-built snapshots and asserting on the calls the recovery
 * service makes downstream.
 *
 * The core invariant under test: rebuildSlot polls BullMQ for the prior
 * job's authoritative state and dispatches accordingly — completed/failed
 * results from the prior process get delivered via handleJobResult AFTER
 * adoption, in-flight jobs are trusted to the live stream subscription,
 * and unrecoverable jobs (evicted from Redis) get a synthetic error
 * delivered.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Client, Message, Channel } from 'discord.js';
import type { Queue } from 'bullmq';
import { ChannelType } from 'discord.js';
import type { LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { MultiTagRecovery, type MultiTagRecoveryDeps } from './MultiTagRecovery.js';
import type { CoordinatorEntrySnapshot, SlotSnapshot } from './MultiTagPersistence.js';

// Stable UUID for the test user's default persona; exercised in every resolution assertion.
const RESOLVED_PERSONA_ID = '00000000-0000-4000-8000-000000000aaa';

function buildPersonality(name: string): LoadedPersonality {
  return {
    id: `id-${name.toLowerCase()}`,
    slug: name.toLowerCase(),
    displayName: name,
    name,
  } as unknown as LoadedPersonality;
}

function buildSnapshot(
  overrides: Partial<CoordinatorEntrySnapshot> = {}
): CoordinatorEntrySnapshot {
  return {
    groupId: 'group-1',
    sourceMessageId: 'msg-1',
    channelId: 'channel-1',
    guildId: 'guild-1',
    userId: 'user-1',
    userMessageTime: '2026-05-15T10:00:00Z',
    userMessageContent: 'hi everyone',
    slots: [
      {
        slotIndex: 0,
        personalityId: 'id-alice',
        personalitySlug: 'alice',
        personaId: RESOLVED_PERSONA_ID,
        source: 'mention',
        isAutoResponse: false,
        jobId: 'old-job-Alice',
        status: 'pending',
      },
    ],
    createdAt: 1737900000000,
    truncated: false,
    ...overrides,
  };
}

/**
 * Builder for the mocked BullMQ Job returned by queue.getJob. State and
 * payload are parameterized; the mock surface is intentionally narrow —
 * production code only reads `getState()`, `returnvalue`, and
 * `failedReason`, so the test mock matches.
 */
function buildMockJob(opts: {
  state: string;
  returnvalue?: LLMGenerationResult;
  failedReason?: string;
}): {
  getState: ReturnType<typeof vi.fn>;
  returnvalue?: LLMGenerationResult;
  failedReason?: string;
} {
  return {
    getState: vi.fn().mockResolvedValue(opts.state),
    returnvalue: opts.returnvalue,
    failedReason: opts.failedReason,
  };
}

describe('MultiTagRecovery', () => {
  let persistence: {
    scanAllEntries: ReturnType<typeof vi.fn>;
    markStale: ReturnType<typeof vi.fn>;
    deleteEntry: ReturnType<typeof vi.fn>;
    updateEntry: ReturnType<typeof vi.fn>;
    isSlotDelivered: ReturnType<typeof vi.fn>;
  };
  let coordinator: {
    adoptRehydratedEntry: ReturnType<typeof vi.fn>;
    noteRecoveryMarkedStale: ReturnType<typeof vi.fn>;
    handleSafetyTimeoutPublic: ReturnType<typeof vi.fn>;
    handleJobResult: ReturnType<typeof vi.fn>;
  };
  let queue: {
    getJob: ReturnType<typeof vi.fn>;
  };
  let personalityService: {
    loadPersonality: ReturnType<typeof vi.fn>;
  };
  let discordClient: {
    channels: { fetch: ReturnType<typeof vi.fn> };
  };
  let mockChannel: {
    id: string;
    type: ChannelType;
    messages: { fetch: ReturnType<typeof vi.fn> };
  };
  let mockMessage: { id: string; client: { user: { id: string } } };
  let recovery: MultiTagRecovery;

  beforeEach(() => {
    persistence = {
      scanAllEntries: vi.fn().mockResolvedValue([]),
      markStale: vi.fn().mockResolvedValue(undefined),
      deleteEntry: vi.fn().mockResolvedValue(undefined),
      updateEntry: vi.fn().mockResolvedValue(undefined),
      isSlotDelivered: vi.fn().mockResolvedValue(false),
    };
    coordinator = {
      adoptRehydratedEntry: vi.fn().mockResolvedValue(undefined),
      noteRecoveryMarkedStale: vi.fn(),
      handleSafetyTimeoutPublic: vi.fn().mockResolvedValue(undefined),
      handleJobResult: vi.fn().mockResolvedValue(undefined),
    };
    // Default: every job returns 'active' state — the "trust the stream"
    // path. Individual tests override per-jobId via mockImplementation.
    queue = {
      getJob: vi.fn().mockImplementation(async () => buildMockJob({ state: 'active' })),
    };
    personalityService = {
      // Recovery looks up by ID first (stable), falls back to slug (mutable).
      // Snapshots in this test use `personalityId: 'id-alice'` and
      // `personalitySlug: 'alice'` — strip the `id-` prefix so both lookup
      // shapes map to the same logical personality.
      loadPersonality: vi.fn().mockImplementation(async (nameOrId: string) => {
        const slug = nameOrId.startsWith('id-') ? nameOrId.slice(3) : nameOrId;
        return buildPersonality(slug);
      }),
    };
    mockMessage = { id: 'msg-1', client: { user: { id: 'bot-1' } } };
    mockChannel = {
      id: 'channel-1',
      type: ChannelType.DM,
      messages: {
        fetch: vi.fn().mockResolvedValue(mockMessage as unknown as Message),
      },
    };
    discordClient = {
      channels: {
        fetch: vi.fn().mockResolvedValue(mockChannel as unknown as Channel),
      },
    };

    recovery = new MultiTagRecovery({
      persistence: persistence as unknown as MultiTagRecoveryDeps['persistence'],
      coordinator: coordinator as unknown as MultiTagRecoveryDeps['coordinator'],
      personalityService:
        personalityService as unknown as MultiTagRecoveryDeps['personalityService'],
      discordClient: discordClient as unknown as Client,
      queue: queue as unknown as Queue,
    });
  });

  describe('completed-job recovery (synthetic delivery)', () => {
    it("polls BullMQ, finds 'completed' state, and delivers job.returnvalue via handleJobResult", async () => {
      const priorResult: LLMGenerationResult = {
        requestId: 'old-job-Alice',
        success: true,
        content: 'response from the prior process',
      };
      queue.getJob.mockResolvedValue(
        buildMockJob({ state: 'completed', returnvalue: priorResult })
      );
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.entriesScanned).toBe(1);
      expect(stats.entriesResumed).toBe(1);
      expect(stats.slotsRecoveredCompleted).toBe(1);
      expect(stats.slotsTrustedToStream).toBe(0);
      // Entry adopted; THEN handleJobResult invoked with prior process's result.
      expect(coordinator.adoptRehydratedEntry).toHaveBeenCalledOnce();
      expect(coordinator.handleJobResult).toHaveBeenCalledOnce();
      expect(coordinator.handleJobResult).toHaveBeenCalledWith('old-job-Alice', priorResult);
      // No stale marking on the recovered slot — its jobId is still the live
      // tracking ID, and the prior result is what we're consuming.
      expect(persistence.markStale).not.toHaveBeenCalled();
    });

    it('preserves call ordering: adoptRehydratedEntry runs strictly before handleJobResult', async () => {
      // The coordinator's jobToGroup map is populated by adoption; calling
      // handleJobResult first would silently drop the result (warn + return).
      // This ordering is load-bearing.
      const callOrder: string[] = [];
      coordinator.adoptRehydratedEntry.mockImplementation(async () => {
        callOrder.push('adopt');
      });
      coordinator.handleJobResult.mockImplementation(async () => {
        callOrder.push('handleJobResult');
      });
      queue.getJob.mockResolvedValue(
        buildMockJob({
          state: 'completed',
          returnvalue: { requestId: 'old-job-Alice', success: true, content: 'hi' },
        })
      );
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      await recovery.run();

      expect(callOrder).toEqual(['adopt', 'handleJobResult']);
    });
  });

  describe('failed-job recovery (synthetic error delivery)', () => {
    it("polls BullMQ, finds 'failed' state, and synthesizes an error LLMGenerationResult", async () => {
      queue.getJob.mockResolvedValue(
        buildMockJob({ state: 'failed', failedReason: 'OpenRouter 502 Bad Gateway' })
      );
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.slotsRecoveredFailed).toBe(1);
      expect(coordinator.handleJobResult).toHaveBeenCalledWith(
        'old-job-Alice',
        expect.objectContaining({
          requestId: 'old-job-Alice',
          success: false,
          error: 'OpenRouter 502 Bad Gateway',
        })
      );
    });

    it("falls back to 'Unknown failure' when job has no failedReason", async () => {
      queue.getJob.mockResolvedValue(buildMockJob({ state: 'failed' }));
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      await recovery.run();

      expect(coordinator.handleJobResult).toHaveBeenCalledWith(
        'old-job-Alice',
        expect.objectContaining({ success: false, error: 'Unknown failure' })
      );
    });
  });

  describe('in-flight job recovery (trust the stream)', () => {
    it.each(['active', 'waiting', 'delayed', 'prioritized', 'waiting-children'])(
      "leaves slot pending with old jobId when state is '%s'",
      async (state: string) => {
        queue.getJob.mockResolvedValue(buildMockJob({ state }));
        persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

        const stats = await recovery.run();

        expect(stats.slotsTrustedToStream).toBe(1);
        expect(stats.slotsRecoveredCompleted).toBe(0);
        expect(stats.slotsRecoveredFailed).toBe(0);
        expect(coordinator.adoptRehydratedEntry).toHaveBeenCalledOnce();
        // No deferred delivery; the live stream + QueueEvents will deliver
        // once they attach.
        expect(coordinator.handleJobResult).not.toHaveBeenCalled();
        // Slot keeps its original jobId — not marked stale, not resubmitted.
        expect(persistence.markStale).not.toHaveBeenCalled();
      }
    );
  });

  describe('unrecoverable job (evicted from Redis or unknown state)', () => {
    it('delivers synthetic "Result unavailable after restart" when getJob returns null', async () => {
      queue.getJob.mockResolvedValue(null);
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.slotsUnrecoverable).toBe(1);
      expect(coordinator.handleJobResult).toHaveBeenCalledWith(
        'old-job-Alice',
        expect.objectContaining({
          success: false,
          error: 'Result unavailable after restart',
        })
      );
    });

    it("treats 'completed' with undefined returnvalue as unrecoverable (worker-crash or GC-race guard)", async () => {
      // Architectural guarantee: ai-worker handlers return LLMGenerationResult.
      // Edge cases that break that guarantee at runtime: worker crash after
      // moveToCompleted but before returnvalue persist, or removeOnComplete
      // GC racing the state→returnvalue read window. Routing through the
      // unrecoverable path keeps the user-visible error message correct
      // ("Result unavailable") instead of letting a malformed result reach
      // coordinator.handleJobResult.
      queue.getJob.mockResolvedValue(buildMockJob({ state: 'completed', returnvalue: undefined }));
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.slotsUnrecoverable).toBe(1);
      expect(stats.slotsRecoveredCompleted).toBe(0);
      expect(coordinator.handleJobResult).toHaveBeenCalledWith(
        'old-job-Alice',
        expect.objectContaining({
          success: false,
          error: 'Result unavailable after restart',
        })
      );
    });

    it("delivers synthetic error when state is 'unknown' (or any future BullMQ state)", async () => {
      queue.getJob.mockResolvedValue(buildMockJob({ state: 'unknown' }));
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.slotsUnrecoverable).toBe(1);
      expect(coordinator.handleJobResult).toHaveBeenCalledWith(
        'old-job-Alice',
        expect.objectContaining({ success: false })
      );
    });
  });

  describe('error tolerance during state polling', () => {
    it("falls back to 'inFlight' (no delivery, trust stream) when queue.getJob throws", async () => {
      queue.getJob.mockRejectedValue(new Error('Redis blip'));
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.slotsTrustedToStream).toBe(1);
      expect(stats.slotsUnrecoverable).toBe(0);
      expect(coordinator.handleJobResult).not.toHaveBeenCalled();
      // Slot still adopted — recovery continues normally.
      expect(coordinator.adoptRehydratedEntry).toHaveBeenCalledOnce();
    });

    it("falls back to 'inFlight' when job.getState throws", async () => {
      queue.getJob.mockResolvedValue({
        getState: vi.fn().mockRejectedValue(new Error('Connection lost')),
        returnvalue: undefined,
        failedReason: undefined,
      });
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.slotsTrustedToStream).toBe(1);
      expect(coordinator.handleJobResult).not.toHaveBeenCalled();
    });
  });

  describe('mixed entries', () => {
    it('routes each slot independently when an entry has slots in different BullMQ states', async () => {
      const completedResult: LLMGenerationResult = {
        requestId: 'old-job-Alice',
        success: true,
        content: 'Alice completed during the gap',
      };
      // Slot A completed; slot B still active.
      queue.getJob.mockImplementation(async (jobId: string) => {
        if (jobId === 'old-job-Alice') {
          return buildMockJob({ state: 'completed', returnvalue: completedResult });
        }
        if (jobId === 'old-job-Bob') {
          return buildMockJob({ state: 'active' });
        }
        return null;
      });
      const snapshot = buildSnapshot({
        slots: [
          {
            slotIndex: 0,
            personalityId: 'id-alice',
            personalitySlug: 'alice',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Alice',
            status: 'pending',
          },
          {
            slotIndex: 1,
            personalityId: 'id-bob',
            personalitySlug: 'bob',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Bob',
            status: 'pending',
          },
        ],
      });
      persistence.scanAllEntries.mockResolvedValue([snapshot]);

      const stats = await recovery.run();

      expect(stats.slotsRecoveredCompleted).toBe(1);
      expect(stats.slotsTrustedToStream).toBe(1);
      // Only Alice's completed result delivers; Bob waits for the stream.
      expect(coordinator.handleJobResult).toHaveBeenCalledOnce();
      expect(coordinator.handleJobResult).toHaveBeenCalledWith('old-job-Alice', completedResult);
    });

    it('continues delivering remaining slots when one handleJobResult throws mid-loop', async () => {
      // Per-delivery try/catch: a throw from one handleJobResult must not
      // skip subsequent deliveries. The outer recoverOne catch is too
      // coarse — it would log "Recovery failed for entry" and abandon the
      // remaining work even if other slots have already-completed results
      // sitting on BullMQ ready to deliver.
      const aliceResult: LLMGenerationResult = {
        requestId: 'old-job-Alice',
        success: true,
        content: 'alice content',
      };
      const bobResult: LLMGenerationResult = {
        requestId: 'old-job-Bob',
        success: true,
        content: 'bob content',
      };
      queue.getJob.mockImplementation(async (jobId: string) => {
        if (jobId === 'old-job-Alice') {
          return buildMockJob({ state: 'completed', returnvalue: aliceResult });
        }
        if (jobId === 'old-job-Bob') {
          return buildMockJob({ state: 'completed', returnvalue: bobResult });
        }
        return null;
      });
      // First delivery (Alice) throws; second delivery (Bob) must still proceed.
      coordinator.handleJobResult
        .mockRejectedValueOnce(new Error('handleJobResult failed for Alice'))
        .mockResolvedValueOnce(undefined);
      const snapshot = buildSnapshot({
        slots: [
          {
            slotIndex: 0,
            personalityId: 'id-alice',
            personalitySlug: 'alice',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Alice',
            status: 'pending',
          },
          {
            slotIndex: 1,
            personalityId: 'id-bob',
            personalitySlug: 'bob',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Bob',
            status: 'pending',
          },
        ],
      });
      persistence.scanAllEntries.mockResolvedValue([snapshot]);

      await recovery.run();

      // Both deliveries attempted despite the first throwing.
      expect(coordinator.handleJobResult).toHaveBeenCalledTimes(2);
      expect(coordinator.handleJobResult).toHaveBeenNthCalledWith(1, 'old-job-Alice', aliceResult);
      expect(coordinator.handleJobResult).toHaveBeenNthCalledWith(2, 'old-job-Bob', bobResult);
    });
  });

  describe('idempotent re-dispatch (slot-delivered marker)', () => {
    it('skips dispatch when a prior run already delivered the slot', async () => {
      // Scenario: previous bot lifecycle delivered the message to Discord
      // but crashed before deliverGroup's deleteEntry call ran. The entry
      // snapshot still shows the flush-trigger slot as pending, BullMQ
      // shows the job as completed. Without the marker check, recovery
      // would re-dispatch → second user-visible delivery.
      const aliceResult: LLMGenerationResult = {
        requestId: 'old-job-Alice',
        success: true,
        content: 'alice content (already delivered)',
      };
      queue.getJob.mockImplementation(async (jobId: string) => {
        if (jobId === 'old-job-Alice') {
          return buildMockJob({ state: 'completed', returnvalue: aliceResult });
        }
        return null;
      });
      persistence.isSlotDelivered.mockImplementation(
        async (jobId: string) => jobId === 'old-job-Alice'
      );
      const snapshot = buildSnapshot({
        slots: [
          {
            slotIndex: 0,
            personalityId: 'id-alice',
            personalitySlug: 'alice',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Alice',
            status: 'pending',
          },
        ],
      });
      persistence.scanAllEntries.mockResolvedValue([snapshot]);

      const stats = await recovery.run();

      expect(persistence.isSlotDelivered).toHaveBeenCalledWith('old-job-Alice');
      expect(coordinator.handleJobResult).not.toHaveBeenCalled();
      expect(stats.slotsAlreadyDelivered).toBe(1);
    });

    it('dispatches normally when the marker is absent', async () => {
      const aliceResult: LLMGenerationResult = {
        requestId: 'old-job-Alice',
        success: true,
        content: 'alice content',
      };
      queue.getJob.mockImplementation(async (jobId: string) => {
        if (jobId === 'old-job-Alice') {
          return buildMockJob({ state: 'completed', returnvalue: aliceResult });
        }
        return null;
      });
      // Default isSlotDelivered returns false — exercised here explicitly.
      persistence.isSlotDelivered.mockResolvedValue(false);
      const snapshot = buildSnapshot({
        slots: [
          {
            slotIndex: 0,
            personalityId: 'id-alice',
            personalitySlug: 'alice',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Alice',
            status: 'pending',
          },
        ],
      });
      persistence.scanAllEntries.mockResolvedValue([snapshot]);

      const stats = await recovery.run();

      expect(coordinator.handleJobResult).toHaveBeenCalledWith('old-job-Alice', aliceResult);
      expect(stats.slotsAlreadyDelivered).toBe(0);
    });

    it('skips per-slot based on marker presence in mixed entries', async () => {
      // Slot A: previously delivered (marker present). Slot B: not delivered.
      // Only Slot B's dispatch should fire.
      const aliceResult: LLMGenerationResult = {
        requestId: 'old-job-Alice',
        success: true,
        content: 'alice (delivered)',
      };
      const bobResult: LLMGenerationResult = {
        requestId: 'old-job-Bob',
        success: true,
        content: 'bob (not delivered)',
      };
      queue.getJob.mockImplementation(async (jobId: string) => {
        if (jobId === 'old-job-Alice') {
          return buildMockJob({ state: 'completed', returnvalue: aliceResult });
        }
        if (jobId === 'old-job-Bob') {
          return buildMockJob({ state: 'completed', returnvalue: bobResult });
        }
        return null;
      });
      persistence.isSlotDelivered.mockImplementation(
        async (jobId: string) => jobId === 'old-job-Alice'
      );
      const snapshot = buildSnapshot({
        slots: [
          {
            slotIndex: 0,
            personalityId: 'id-alice',
            personalitySlug: 'alice',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Alice',
            status: 'pending',
          },
          {
            slotIndex: 1,
            personalityId: 'id-bob',
            personalitySlug: 'bob',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Bob',
            status: 'pending',
          },
        ],
      });
      persistence.scanAllEntries.mockResolvedValue([snapshot]);

      const stats = await recovery.run();

      expect(coordinator.handleJobResult).toHaveBeenCalledOnce();
      expect(coordinator.handleJobResult).toHaveBeenCalledWith('old-job-Bob', bobResult);
      expect(stats.slotsAlreadyDelivered).toBe(1);
    });
  });

  describe('discard cases', () => {
    it('discards an entry when the channel can no longer be fetched', async () => {
      discordClient.channels.fetch.mockResolvedValue(null);
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.entriesDiscarded).toBe(1);
      expect(stats.entriesResumed).toBe(0);
      // Pending jobIds still marked stale on discard — late deliveries
      // wouldn't have an entry to route to and should be silently dropped.
      expect(persistence.markStale).toHaveBeenCalledWith('old-job-Alice');
      expect(persistence.deleteEntry).toHaveBeenCalledOnce();
      expect(coordinator.adoptRehydratedEntry).not.toHaveBeenCalled();
      // No state poll either — the discard short-circuits before slot rebuild.
      expect(queue.getJob).not.toHaveBeenCalled();
    });

    it('discards an entry when the source message is gone', async () => {
      mockChannel.messages.fetch.mockRejectedValue(new Error('Unknown Message'));
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.entriesDiscarded).toBe(1);
      expect(persistence.deleteEntry).toHaveBeenCalledOnce();
      expect(coordinator.adoptRehydratedEntry).not.toHaveBeenCalled();
    });

    it('discards when channel type is not a TypingChannel', async () => {
      // Voice channels don't support sendTyping — not a TypingChannel.
      const voiceChannel = {
        id: 'voice-1',
        type: ChannelType.GuildVoice,
      };
      discordClient.channels.fetch.mockResolvedValue(voiceChannel as unknown as Channel);
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.entriesDiscarded).toBe(1);
    });
  });

  describe('access-revoked slots', () => {
    it('marks a slot errored when its personality is no longer accessible', async () => {
      // Recovery tries ID first, falls back to slug. Both must return null
      // for the slot to be treated as revoked.
      personalityService.loadPersonality.mockResolvedValue(null);
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.slotsAccessRevoked).toBe(1);
      // No state poll — when the personality is gone we can't render the
      // result anyway, so the slot becomes a synthetic-error slot regardless
      // of the prior job's state.
      expect(queue.getJob).not.toHaveBeenCalled();
      // Entry STILL adopted (errored slot is delivered as an error message)
      expect(coordinator.adoptRehydratedEntry).toHaveBeenCalledOnce();
      expect(stats.entriesResumed).toBe(1);
    });

    it('falls back to slug lookup when ID lookup returns null (slug rename)', async () => {
      // Scenario: ID-form lookup fails (loader doesn't recognize the UUID
      // for some reason), slug-form succeeds. Slot recovers normally.
      personalityService.loadPersonality.mockImplementation(
        async (nameOrId: string): Promise<LoadedPersonality | null> => {
          if (nameOrId.startsWith('id-')) return null;
          return buildPersonality(nameOrId);
        }
      );
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      await recovery.run();

      expect(personalityService.loadPersonality).toHaveBeenCalledWith('id-alice', 'user-1');
      expect(personalityService.loadPersonality).toHaveBeenCalledWith('alice', 'user-1');
      // State poll runs because the slug fallback rescued the personality.
      expect(queue.getJob).toHaveBeenCalledWith('old-job-Alice');
    });
  });

  describe('personaId resolution from the snapshot', () => {
    function legacyAliceSlot(): SlotSnapshot {
      // A slot WITHOUT personaId — the shape a snapshot had before the field
      // was added (in-flight at that deploy).
      return {
        slotIndex: 0,
        personalityId: 'id-alice',
        personalitySlug: 'alice',
        source: 'mention',
        isAutoResponse: false,
        jobId: 'old-job-Alice',
        status: 'pending',
      };
    }

    it('attaches the snapshot personaId to the recovered slot (no re-resolution)', async () => {
      // The persona was resolved at fan-out time and captured in the snapshot.
      // Recovery reads it verbatim — a real `personas.id` FK means
      // `saveAssistantMessage` succeeds and the recovered message persists.
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      await recovery.run();

      const adoptedEntry = coordinator.adoptRehydratedEntry.mock.calls[0]?.[0] as {
        slots: Array<{ personaId: string }>;
      };
      expect(adoptedEntry.slots[0]?.personaId).toBe(RESOLVED_PERSONA_ID);
    });

    it('falls back to a synthetic personaId when the snapshot persona is the system default (empty)', async () => {
      // Empty personaId = system-default summon (no real persona). The slot
      // still adopts and delivers — the synthetic `recovery-fallback-*` is
      // caught by the saveAssistantMessage try/catch, so the user gets their
      // message; history just doesn't persist for this edge case.
      persistence.scanAllEntries.mockResolvedValue([
        buildSnapshot({ slots: [{ ...legacyAliceSlot(), personaId: '' }] }),
      ]);

      const stats = await recovery.run();

      expect(stats.entriesResumed).toBe(1);
      const adoptedEntry = coordinator.adoptRehydratedEntry.mock.calls[0]?.[0] as {
        slots: Array<{ personaId: string }>;
      };
      expect(adoptedEntry.slots[0]?.personaId).toBe('recovery-fallback-alice');
    });

    it('falls back to a synthetic personaId for a legacy snapshot missing the field', async () => {
      // Recovery must not re-resolve (would need Prisma), so a legacy snapshot
      // with no personaId gets the synthetic fallback.
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot({ slots: [legacyAliceSlot()] })]);

      const stats = await recovery.run();

      expect(stats.entriesResumed).toBe(1);
      const adoptedEntry = coordinator.adoptRehydratedEntry.mock.calls[0]?.[0] as {
        slots: Array<{ personaId: string }>;
      };
      expect(adoptedEntry.slots[0]?.personaId).toBe('recovery-fallback-alice');
    });

    it('attaches the snapshot personaId on the terminal (non-pending) path too', async () => {
      // A slot already completed/errored before recovery ran goes through
      // buildPreservedTerminalSlot, which also reads the snapshot personaId —
      // so the preserved terminal message persists under the right persona.
      persistence.scanAllEntries.mockResolvedValue([
        buildSnapshot({
          slots: [{ ...legacyAliceSlot(), personaId: RESOLVED_PERSONA_ID, status: 'completed' }],
        }),
      ]);

      await recovery.run();

      const adoptedEntry = coordinator.adoptRehydratedEntry.mock.calls[0]?.[0] as {
        slots: Array<{ personaId: string }>;
      };
      expect(adoptedEntry.slots[0]?.personaId).toBe(RESOLVED_PERSONA_ID);
    });

    it('uses the snapshot personaId even when the personality is revoked', async () => {
      // Revoked-personality path: the slot is forced errored, but its personaId
      // still comes from the snapshot, so the synthetic-error message persists
      // under the user's own persona.
      personalityService.loadPersonality.mockResolvedValue(null);
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      await recovery.run();

      const adoptedEntry = coordinator.adoptRehydratedEntry.mock.calls[0]?.[0] as {
        slots: Array<{ personaId: string; status: string }>;
      };
      expect(adoptedEntry.slots[0]?.status).toBe('errored');
      expect(adoptedEntry.slots[0]?.personaId).toBe(RESOLVED_PERSONA_ID);
    });
  });

  describe('terminal slots in snapshot', () => {
    it('preserves slots already in completed/errored state without polling BullMQ', async () => {
      const snapshot = buildSnapshot({
        slots: [
          {
            slotIndex: 0,
            personalityId: 'id-alice',
            personalitySlug: 'alice',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Alice',
            status: 'completed',
          },
          {
            slotIndex: 1,
            personalityId: 'id-bob',
            personalitySlug: 'bob',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Bob',
            status: 'pending',
          },
        ],
      });
      persistence.scanAllEntries.mockResolvedValue([snapshot]);

      await recovery.run();

      // Only Bob's pending slot triggers a state poll; Alice's snapshot-terminal
      // slot is preserved as-is.
      expect(queue.getJob).toHaveBeenCalledOnce();
      expect(queue.getJob).toHaveBeenCalledWith('old-job-Bob');
    });
  });

  describe('empty + error paths', () => {
    it('reports zero stats and does not call coordinator when no entries exist', async () => {
      persistence.scanAllEntries.mockResolvedValue([]);

      const stats = await recovery.run();

      expect(stats.entriesScanned).toBe(0);
      expect(coordinator.adoptRehydratedEntry).not.toHaveBeenCalled();
      expect(coordinator.noteRecoveryMarkedStale).not.toHaveBeenCalled();
    });

    it('returns zero stats when scanAllEntries throws (graceful skip)', async () => {
      persistence.scanAllEntries.mockRejectedValue(new Error('Redis down'));

      const stats = await recovery.run();

      expect(stats.entriesScanned).toBe(0);
      expect(stats.entriesResumed).toBe(0);
    });

    it('continues recovering remaining entries when one entry throws', async () => {
      const snap1 = buildSnapshot({ groupId: 'g1', sourceMessageId: 'm1' });
      const snap2 = buildSnapshot({ groupId: 'g2', sourceMessageId: 'm2' });
      persistence.scanAllEntries.mockResolvedValue([snap1, snap2]);
      // First channel.fetch throws; second succeeds.
      discordClient.channels.fetch
        .mockRejectedValueOnce(new Error('unexpected'))
        .mockResolvedValueOnce(mockChannel as unknown as Channel);

      const stats = await recovery.run();

      // First entry: channel fetch threw → fetchTypingChannel returns null
      // → entry discarded. Second entry: succeeds normally.
      expect(stats.entriesScanned).toBe(2);
      expect(stats.entriesDiscarded + stats.entriesResumed).toBe(2);
    });
  });

  describe('coordinator notification', () => {
    it('does NOT call noteRecoveryMarkedStale when no entries are discarded and no stale marks happen', async () => {
      // Happy path: pending slots adopted with old jobIds, no stale marks
      // generated. The flag should stay off so MessageHandler's hot path
      // doesn't do unnecessary stale-set lookups.
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      await recovery.run();

      expect(coordinator.noteRecoveryMarkedStale).not.toHaveBeenCalled();
    });

    it('calls noteRecoveryMarkedStale when entries are discarded', async () => {
      // Channel gone → entry discarded → pending jobIds marked stale.
      discordClient.channels.fetch.mockResolvedValue(null);
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.entriesDiscarded).toBe(1);
      expect(stats.staleJobIdsMarked).toBe(1);
      expect(coordinator.noteRecoveryMarkedStale).toHaveBeenCalledOnce();
    });

    it('calls noteRecoveryMarkedStale when entries are discarded even without stale jobIds', async () => {
      // Edge case the defensive `entriesDiscarded > 0` branch covers:
      // an entry with ONLY terminal slots gets discarded (e.g., channel
      // deleted). `discardEntry` won't mark any stale jobIds (no pending
      // slots), so `staleJobIdsMarked` stays 0 — but we still want the
      // fast-path flag flipped in case a delayed result arrives for one
      // of the terminal jobIds.
      const allTerminalSnapshot = buildSnapshot({
        slots: [
          {
            slotIndex: 0,
            personalityId: 'id-alice',
            personalitySlug: 'alice',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Alice',
            status: 'completed',
          },
        ],
      });
      discordClient.channels.fetch.mockResolvedValue(null);
      persistence.scanAllEntries.mockResolvedValue([allTerminalSnapshot]);

      const stats = await recovery.run();

      expect(stats.entriesDiscarded).toBe(1);
      expect(stats.staleJobIdsMarked).toBe(0);
      expect(coordinator.noteRecoveryMarkedStale).toHaveBeenCalledOnce();
    });
  });
});
