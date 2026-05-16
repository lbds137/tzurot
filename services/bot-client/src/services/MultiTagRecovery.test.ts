/**
 * Tests for MultiTagRecovery — the startup hook that rehydrates in-flight
 * multi-tag fan-outs after a bot restart.
 *
 * Strategy: mock every external dep (persistence, coordinator, chatManager,
 * jobTracker, personalityService, Discord client). Drive the recovery
 * lifecycle by feeding in pre-built snapshots and asserting on the calls
 * the recovery service makes downstream.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Client, Message, Channel } from 'discord.js';
import { ChannelType } from 'discord.js';
import type { LoadedPersonality } from '@tzurot/common-types';
import { MultiTagRecovery, type MultiTagRecoveryDeps } from './MultiTagRecovery.js';
import type { CoordinatorEntrySnapshot } from './MultiTagPersistence.js';

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

describe('MultiTagRecovery', () => {
  let persistence: {
    scanAllEntries: ReturnType<typeof vi.fn>;
    markStale: ReturnType<typeof vi.fn>;
    deleteEntry: ReturnType<typeof vi.fn>;
    updateEntry: ReturnType<typeof vi.fn>;
  };
  let coordinator: {
    adoptRehydratedEntry: ReturnType<typeof vi.fn>;
    noteRecoveryMarkedStale: ReturnType<typeof vi.fn>;
    handleSafetyTimeoutPublic: ReturnType<typeof vi.fn>;
  };
  let chatManager: {
    submitChatJob: ReturnType<typeof vi.fn>;
  };
  let jobTracker: {
    trackJob: ReturnType<typeof vi.fn>;
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
    };
    coordinator = {
      adoptRehydratedEntry: vi.fn().mockResolvedValue(undefined),
      noteRecoveryMarkedStale: vi.fn(),
      handleSafetyTimeoutPublic: vi.fn().mockResolvedValue(undefined),
    };
    chatManager = {
      submitChatJob: vi.fn().mockImplementation(async ({ personality }) => ({
        kind: 'submitted',
        jobId: `new-job-${personality.name}`,
        trackingContext: { personaId: `persona-${personality.name}` },
      })),
    };
    jobTracker = { trackJob: vi.fn() };
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
      chatManager: chatManager as unknown as MultiTagRecoveryDeps['chatManager'],
      jobTracker: jobTracker as unknown as MultiTagRecoveryDeps['jobTracker'],
      personalityService:
        personalityService as unknown as MultiTagRecoveryDeps['personalityService'],
      discordClient: discordClient as unknown as Client,
    });
  });

  describe('happy path', () => {
    it('rehydrates a single pending slot and reports stats', async () => {
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.entriesScanned).toBe(1);
      expect(stats.entriesResumed).toBe(1);
      expect(stats.slotsResubmitted).toBe(1);
      expect(stats.staleJobIdsMarked).toBe(1);

      // Old jobId marked stale
      expect(persistence.markStale).toHaveBeenCalledWith('old-job-Alice');
      // New job submitted + tracked
      expect(chatManager.submitChatJob).toHaveBeenCalledOnce();
      expect(jobTracker.trackJob).toHaveBeenCalledWith('new-job-alice', expect.any(Object), {
        skipOrderingRegistration: true,
      });
      // Adopted into coordinator
      expect(coordinator.adoptRehydratedEntry).toHaveBeenCalledOnce();
      // Coordinator notified about stale marks
      expect(coordinator.noteRecoveryMarkedStale).toHaveBeenCalledOnce();
      // Updated snapshot persisted with the new jobId, not the stale one.
      // This locks in the EXPIRE→SET fix in updateEntry: the new jobId's
      // reverse-index must be CREATED here, not just have its TTL
      // refreshed (refresh on a non-existent key is a Redis no-op).
      expect(persistence.updateEntry).toHaveBeenCalledOnce();
      expect(persistence.updateEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          slots: expect.arrayContaining([
            expect.objectContaining({ jobId: 'new-job-alice', status: 'pending' }),
          ]),
        })
      );
    });

    it('rehydrates multiple pending slots with fresh jobIds each', async () => {
      const snapshot = buildSnapshot({
        slots: [
          {
            slotIndex: 0,
            personalityId: 'id-alice',
            personalitySlug: 'Alice',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Alice',
            status: 'pending',
          },
          {
            slotIndex: 1,
            personalityId: 'id-bob',
            personalitySlug: 'Bob',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Bob',
            status: 'pending',
          },
        ],
      });
      persistence.scanAllEntries.mockResolvedValue([snapshot]);

      const stats = await recovery.run();

      expect(stats.slotsResubmitted).toBe(2);
      expect(stats.staleJobIdsMarked).toBe(2);
      expect(persistence.markStale).toHaveBeenCalledWith('old-job-Alice');
      expect(persistence.markStale).toHaveBeenCalledWith('old-job-Bob');
    });
  });

  describe('discard cases', () => {
    it('discards an entry when the channel can no longer be fetched', async () => {
      discordClient.channels.fetch.mockResolvedValue(null);
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.entriesDiscarded).toBe(1);
      expect(stats.entriesResumed).toBe(0);
      // Old jobId still marked stale to protect against late delivery
      expect(persistence.markStale).toHaveBeenCalledWith('old-job-Alice');
      // Entry removed from Redis
      expect(persistence.deleteEntry).toHaveBeenCalledOnce();
      // Coordinator NOT adopted
      expect(coordinator.adoptRehydratedEntry).not.toHaveBeenCalled();
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
      // Recovery now tries ID first, falls back to slug. Both must return
      // null for the slot to be treated as revoked.
      personalityService.loadPersonality.mockResolvedValue(null);
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.slotsAccessRevoked).toBe(1);
      // Slot still marked stale; the slot stays in the entry as errored
      expect(persistence.markStale).toHaveBeenCalledWith('old-job-Alice');
      // Resubmit NOT called because personality couldn't be loaded
      expect(chatManager.submitChatJob).not.toHaveBeenCalled();
      // Entry STILL adopted (errored slot is delivered as an error message)
      expect(coordinator.adoptRehydratedEntry).toHaveBeenCalledOnce();
      expect(stats.entriesResumed).toBe(1);
    });

    it('keeps slot as errored (not dropped) when personality is inaccessible at recovery', async () => {
      const snapshot = buildSnapshot({
        slots: [
          {
            slotIndex: 0,
            personalityId: 'id-a',
            personalitySlug: 'a',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-a',
            status: 'pending',
          },
        ],
      });
      personalityService.loadPersonality.mockResolvedValue(null);
      persistence.scanAllEntries.mockResolvedValue([snapshot]);

      const stats = await recovery.run();

      // Revoked slots are kept (with sentinel personality) rather than
      // dropped — the group still flushes a fallback error message for
      // that slot rather than silently vanishing it. So the entry IS
      // adopted, and `slotsAccessRevoked` reflects the loss.
      expect(stats.slotsAccessRevoked).toBe(1);
      expect(stats.entriesResumed).toBe(1);
      expect(stats.entriesDiscarded).toBe(0);
    });

    it('falls back to slug lookup when ID lookup returns null (slug rename)', async () => {
      // Scenario: personality was renamed (new slug) between snapshot
      // write and recovery. Looking up by the OLD slug from the snapshot
      // would fail, but the ID is stable. Reverse: this test simulates
      // ID failing first (loader doesn't recognize the UUID for some
      // reason), and the slug fallback rescues the lookup.
      personalityService.loadPersonality.mockImplementation(
        async (nameOrId: string): Promise<LoadedPersonality | null> => {
          // ID-form lookup fails; slug-form succeeds.
          if (nameOrId.startsWith('id-')) return null;
          return buildPersonality(nameOrId);
        }
      );
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      // Both lookups attempted: ID first (null), then slug (success).
      expect(personalityService.loadPersonality).toHaveBeenCalledWith('id-alice', 'user-1');
      expect(personalityService.loadPersonality).toHaveBeenCalledWith('alice', 'user-1');
      // Slot recovered via slug fallback — not treated as revoked.
      expect(stats.slotsAccessRevoked).toBe(0);
      expect(stats.slotsResubmitted).toBe(1);
    });
  });

  describe('terminal slots', () => {
    it('preserves slots already in completed/errored state without resubmitting', async () => {
      const snapshot = buildSnapshot({
        slots: [
          {
            slotIndex: 0,
            personalityId: 'id-alice',
            personalitySlug: 'Alice',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Alice',
            status: 'completed',
          },
          {
            slotIndex: 1,
            personalityId: 'id-bob',
            personalitySlug: 'Bob',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Bob',
            status: 'pending',
          },
        ],
      });
      persistence.scanAllEntries.mockResolvedValue([snapshot]);

      const stats = await recovery.run();

      expect(stats.slotsResubmitted).toBe(1); // Only Bob
      expect(stats.staleJobIdsMarked).toBe(1); // Only Bob's jobId
      // Alice not resubmitted
      expect(chatManager.submitChatJob).toHaveBeenCalledOnce();
      expect(chatManager.submitChatJob).toHaveBeenCalledWith(
        expect.objectContaining({ personality: expect.objectContaining({ slug: 'bob' }) })
      );
    });

    it('skips updateEntry when every slot is already terminal (adoptRehydratedEntry flushes immediately)', async () => {
      // When all slots are terminal at recovery time, adoptRehydratedEntry
      // calls flushEntry → deliverGroup → deleteEntry synchronously. The
      // subsequent updateEntry call must be skipped so we don't orphan a
      // snapshot at a Redis key that was just deleted.
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
        ],
      });
      persistence.scanAllEntries.mockResolvedValue([snapshot]);

      const stats = await recovery.run();

      expect(stats.entriesResumed).toBe(1);
      expect(stats.slotsResubmitted).toBe(0); // Nothing to resubmit
      // Adopted into coordinator (which would synchronously flush)
      expect(coordinator.adoptRehydratedEntry).toHaveBeenCalledOnce();
      // updateEntry NOT called — entry was already terminal, no new state
      // to persist back, and deleteEntry already ran inside the flush.
      expect(persistence.updateEntry).not.toHaveBeenCalled();
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
    it('calls noteRecoveryMarkedStale only when at least one stale jobId was marked', async () => {
      // Pure-terminal entries: no pending slots, no stale marks.
      const allTerminalSnapshot = buildSnapshot({
        slots: [
          {
            slotIndex: 0,
            personalityId: 'id-alice',
            personalitySlug: 'Alice',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Alice',
            status: 'completed',
          },
        ],
      });
      persistence.scanAllEntries.mockResolvedValue([allTerminalSnapshot]);

      await recovery.run();

      expect(coordinator.noteRecoveryMarkedStale).not.toHaveBeenCalled();
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
            personalitySlug: 'Alice',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Alice',
            status: 'completed',
          },
        ],
      });
      // Channel gone → entry discarded
      discordClient.channels.fetch.mockResolvedValue(null);
      persistence.scanAllEntries.mockResolvedValue([allTerminalSnapshot]);

      const stats = await recovery.run();

      expect(stats.entriesDiscarded).toBe(1);
      expect(stats.staleJobIdsMarked).toBe(0); // no pending slots to mark
      // Defensive: flag flipped via the entriesDiscarded branch
      expect(coordinator.noteRecoveryMarkedStale).toHaveBeenCalledOnce();
    });
  });
});
