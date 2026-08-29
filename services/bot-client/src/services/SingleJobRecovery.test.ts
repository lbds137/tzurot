/**
 * SingleJobRecovery Unit Tests
 *
 * Every collaborator is mocked, so the tests assert what crosses each seam:
 * the exact context handed to `jobTracker.trackJob` (recovery's whole output),
 * the ids used for the Discord and personality lookups, and which entries are
 * deleted. A recovery that adopted a structurally-wrong context would satisfy
 * a "resumed = 1" assertion while still dropping the user's reply.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Client } from 'discord.js';
import { TRACKED_JOB_MAX_LIFETIME_MS, type JobTracker } from './JobTracker.js';
import type { PersistedJobContext, SingleJobPersistence } from './SingleJobPersistence.js';
import { SingleJobRecovery } from './SingleJobRecovery.js';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import { fetchTypingChannel } from '../utils/fetchTypingChannel.js';

vi.mock('../utils/fetchTypingChannel.js', () => ({
  fetchTypingChannel: vi.fn(),
}));

const mockFetchTypingChannel = vi.mocked(fetchTypingChannel);

const PERSONALITY = { id: 'pers-uuid', slug: 'lila', name: 'Lila' };

function messageEntry(overrides: Partial<PersistedJobContext> = {}): PersistedJobContext {
  return {
    jobId: 'job-msg',
    kind: 'message',
    channelId: 'channel-1',
    guildId: 'guild-1',
    clientId: 'bot-1',
    userMessageTime: '2026-08-29T16:40:03.694Z',
    personalityId: 'pers-uuid',
    personalitySlug: 'lila',
    personaId: 'persona-1',
    userId: 'user-1',
    startTime: Date.now() - 60_000,
    sourceMessageId: 'msg-1',
    userMessageContent: 'hello there',
    isAutoResponse: false,
    ...overrides,
  } as PersistedJobContext;
}

function slashEntry(overrides: Partial<PersistedJobContext> = {}): PersistedJobContext {
  return {
    jobId: 'job-slash',
    kind: 'slash',
    channelId: 'channel-2',
    guildId: null,
    clientId: 'bot-1',
    userMessageTime: '2026-08-29T16:40:03.694Z',
    personalityId: 'pers-uuid',
    personalitySlug: 'lila',
    personaId: 'persona-2',
    userId: 'user-2',
    startTime: Date.now() - 60_000,
    characterSlug: 'lila',
    isWeighInMode: false,
    ...overrides,
  } as PersistedJobContext;
}

describe('SingleJobRecovery', () => {
  let persistence: { scanAll: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  let jobTracker: { trackJob: ReturnType<typeof vi.fn> };
  let personalityService: { loadPersonality: ReturnType<typeof vi.fn> };
  let channel: { id: string; messages: { fetch: ReturnType<typeof vi.fn> } };
  let recovery: SingleJobRecovery;

  beforeEach(() => {
    vi.clearAllMocks();
    persistence = {
      scanAll: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    jobTracker = { trackJob: vi.fn() };
    personalityService = { loadPersonality: vi.fn().mockResolvedValue(PERSONALITY) };
    channel = { id: 'channel-1', messages: { fetch: vi.fn().mockResolvedValue({ id: 'msg-1' }) } };
    mockFetchTypingChannel.mockResolvedValue(channel as never);

    recovery = new SingleJobRecovery({
      persistence: persistence as unknown as SingleJobPersistence,
      jobTracker: jobTracker as unknown as JobTracker,
      personalityService: personalityService as unknown as IPersonalityLoader,
      discordClient: {} as Client,
    });
  });

  describe('run', () => {
    it('returns zeroed stats and touches nothing when there is nothing to recover', async () => {
      const stats = await recovery.run();

      expect(stats).toEqual({
        entriesScanned: 0,
        entriesResumed: 0,
        entriesDiscarded: 0,
        entriesExpired: 0,
      });
      expect(jobTracker.trackJob).not.toHaveBeenCalled();
    });

    it('degrades to a no-op when the scan itself throws — startup must not fail', async () => {
      persistence.scanAll.mockRejectedValue(new Error('Redis down'));

      await expect(recovery.run()).resolves.toMatchObject({ entriesScanned: 0 });
    });

    it('re-adopts a message job with the rebuilt context and its ORIGINAL startTime', async () => {
      const entry = messageEntry();
      persistence.scanAll.mockResolvedValue([entry]);

      const stats = await recovery.run();

      expect(stats.entriesResumed).toBe(1);
      expect(jobTracker.trackJob).toHaveBeenCalledWith(
        'job-msg',
        {
          kind: 'message',
          channel,
          guildId: 'guild-1',
          clientId: 'bot-1',
          userMessageTime: new Date('2026-08-29T16:40:03.694Z'),
          personality: PERSONALITY,
          personaId: 'persona-1',
          message: { id: 'msg-1' },
          userMessageContent: 'hello there',
          isAutoResponse: false,
        },
        { startTime: entry.startTime }
      );
    });

    it('re-adopts a slash job without attempting a source-message fetch', async () => {
      persistence.scanAll.mockResolvedValue([slashEntry()]);

      const stats = await recovery.run();

      expect(stats.entriesResumed).toBe(1);
      expect(channel.messages.fetch).not.toHaveBeenCalled();
      expect(jobTracker.trackJob).toHaveBeenCalledWith(
        'job-slash',
        expect.objectContaining({
          kind: 'slash',
          characterSlug: 'lila',
          isWeighInMode: false,
          userId: 'user-2',
          guildId: null,
        }),
        expect.anything()
      );
    });

    it('re-adopting restores the typing indicator by going through the normal tracking path', async () => {
      // TASK-820: a rehydrated job showed no typing indicator. Adoption via
      // `trackJob` (rather than a direct map write) is what makes the
      // indicator resume, so the seam assertion IS the acceptance check.
      persistence.scanAll.mockResolvedValue([messageEntry()]);

      await recovery.run();

      expect(jobTracker.trackJob).toHaveBeenCalledTimes(1);
    });

    it('looks the personality up by id first, falling back to slug on a rename', async () => {
      personalityService.loadPersonality
        .mockResolvedValueOnce(null) // id lookup misses
        .mockResolvedValueOnce(PERSONALITY); // slug lookup hits
      persistence.scanAll.mockResolvedValue([messageEntry()]);

      const stats = await recovery.run();

      expect(personalityService.loadPersonality).toHaveBeenNthCalledWith(1, 'pers-uuid', 'user-1');
      expect(personalityService.loadPersonality).toHaveBeenNthCalledWith(2, 'lila', 'user-1');
      expect(stats.entriesResumed).toBe(1);
    });

    it('discards and deletes an entry whose channel is gone', async () => {
      mockFetchTypingChannel.mockResolvedValue(null);
      persistence.scanAll.mockResolvedValue([messageEntry()]);

      const stats = await recovery.run();

      expect(stats).toMatchObject({ entriesResumed: 0, entriesDiscarded: 1 });
      expect(persistence.delete).toHaveBeenCalledWith('job-msg');
      expect(jobTracker.trackJob).not.toHaveBeenCalled();
    });

    it('discards an entry whose source message was deleted', async () => {
      channel.messages.fetch.mockRejectedValue(new Error('Unknown Message'));
      persistence.scanAll.mockResolvedValue([messageEntry()]);

      const stats = await recovery.run();

      expect(stats).toMatchObject({ entriesResumed: 0, entriesDiscarded: 1 });
      expect(persistence.delete).toHaveBeenCalledWith('job-msg');
    });

    it('discards an entry whose personality is no longer accessible', async () => {
      personalityService.loadPersonality.mockResolvedValue(null);
      persistence.scanAll.mockResolvedValue([messageEntry()]);

      const stats = await recovery.run();

      expect(stats).toMatchObject({ entriesResumed: 0, entriesDiscarded: 1 });
    });

    it('treats a throwing personality load as inaccessible rather than failing recovery', async () => {
      personalityService.loadPersonality.mockRejectedValue(new Error('gateway 500'));
      persistence.scanAll.mockResolvedValue([messageEntry()]);

      await expect(recovery.run()).resolves.toMatchObject({ entriesDiscarded: 1 });
    });

    it('expires an entry older than the tracker slot lifetime instead of adopting it', async () => {
      // A restart must not hand a wedged job a fresh budget; past this age the
      // in-memory orphan sweep would already have released the slot.
      persistence.scanAll.mockResolvedValue([
        messageEntry({ startTime: Date.now() - TRACKED_JOB_MAX_LIFETIME_MS - 1000 }),
      ]);

      const stats = await recovery.run();

      expect(stats).toMatchObject({ entriesExpired: 1, entriesDiscarded: 1, entriesResumed: 0 });
      expect(jobTracker.trackJob).not.toHaveBeenCalled();
      // The age gate runs BEFORE the Discord fetches — a boot clearing several
      // zombies must not spend an API call per entry it is about to delete.
      expect(mockFetchTypingChannel).not.toHaveBeenCalled();
    });

    it('adopts an entry that is just inside the lifetime bound', async () => {
      // Pins the boundary in the other direction, so the gate above cannot be
      // satisfied by a comparison that rejects everything.
      persistence.scanAll.mockResolvedValue([
        messageEntry({ startTime: Date.now() - (TRACKED_JOB_MAX_LIFETIME_MS - 5000) }),
      ]);

      await expect(recovery.run()).resolves.toMatchObject({ entriesResumed: 1, entriesExpired: 0 });
    });

    it('keeps processing after one entry throws', async () => {
      persistence.scanAll.mockResolvedValue([messageEntry({ jobId: 'job-bad' }), slashEntry()]);
      jobTracker.trackJob.mockImplementationOnce(() => {
        throw new Error('adoption exploded');
      });

      const stats = await recovery.run();

      expect(stats.entriesResumed).toBe(1);
      expect(jobTracker.trackJob).toHaveBeenCalledTimes(2);
    });

    it('recovers every entry in a multi-entry scan', async () => {
      persistence.scanAll.mockResolvedValue([messageEntry(), slashEntry()]);

      const stats = await recovery.run();

      expect(stats).toMatchObject({ entriesScanned: 2, entriesResumed: 2 });
    });
  });
});
