import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Channel } from 'discord.js';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import type { UserClient } from '@tzurot/clients';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

vi.mock('@tzurot/common-types/utils/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/utils/logger')>();
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const mockIsBotOwner = vi.fn((_id: string) => false);
vi.mock('@tzurot/common-types/utils/ownerMiddleware', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@tzurot/common-types/utils/ownerMiddleware')>();
  return { ...actual, isBotOwner: (id: string) => mockIsBotOwner(id) };
});

const mockGetDenylistCache = vi.fn();
vi.mock('../serviceRegistry.js', () => ({
  getDenylistCache: () => mockGetDenylistCache(),
}));

const mockEvaluateNsfwGate = vi.fn();
const mockSendVerificationConfirmation = vi.fn().mockResolvedValue(undefined);
const mockTrackPending = vi.fn().mockResolvedValue(undefined);
vi.mock('../../utils/nsfwVerification.js', () => ({
  evaluateNsfwGate: (...args: unknown[]) => mockEvaluateNsfwGate(...args),
  sendVerificationConfirmation: (...args: unknown[]) => mockSendVerificationConfirmation(...args),
  trackPendingVerificationMessage: (...args: unknown[]) => mockTrackPending(...args),
  NSFW_VERIFICATION_MESSAGE: 'NSFW_PROMPT',
  NSFW_VERIFICATION_CHECK_FAILED_MESSAGE: 'NSFW_CHECK_FAILED',
}));

import { runSlashChatGates } from './slashChatGates.js';

const personality = { id: 'pers-1' } as LoadedPersonality;
const channel = { type: 0 } as unknown as Channel;
const userClient = {} as UserClient;

function makeContext(): { context: DeferredCommandContext; editReply: ReturnType<typeof vi.fn> } {
  const editReply = vi.fn().mockResolvedValue({ id: 'reply-1', channelId: 'chan-1' });
  const context = {
    user: { id: 'actor-1' },
    editReply,
  } as unknown as DeferredCommandContext;
  return { context, editReply };
}

describe('runSlashChatGates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsBotOwner.mockReturnValue(false);
    // Default: NSFW gate allows, not a new verification.
    mockEvaluateNsfwGate.mockResolvedValue({ allowed: true, wasNewVerification: false });
  });

  describe('denylist', () => {
    it('blocks and replies when the personality is denied to the actor', async () => {
      mockGetDenylistCache.mockReturnValue({ isPersonalityDenied: vi.fn().mockReturnValue(true) });
      const { context, editReply } = makeContext();

      const blocked = await runSlashChatGates(context, personality, channel, userClient);

      expect(blocked).toBe(true);
      expect(editReply).toHaveBeenCalledTimes(1);
      // The NSFW gate must not run once denied.
      expect(mockEvaluateNsfwGate).not.toHaveBeenCalled();
    });

    it('bypasses the denylist for the bot owner', async () => {
      mockIsBotOwner.mockReturnValue(true);
      mockGetDenylistCache.mockReturnValue({ isPersonalityDenied: vi.fn().mockReturnValue(true) });
      const { context } = makeContext();

      const blocked = await runSlashChatGates(context, personality, channel, userClient);

      expect(blocked).toBe(false);
      expect(mockEvaluateNsfwGate).toHaveBeenCalled();
    });

    it('degrades open when no denylist cache is registered', async () => {
      mockGetDenylistCache.mockReturnValue(undefined);
      const { context } = makeContext();

      const blocked = await runSlashChatGates(context, personality, channel, userClient);

      expect(blocked).toBe(false);
      expect(mockEvaluateNsfwGate).toHaveBeenCalled();
    });
  });

  describe('NSFW gate', () => {
    beforeEach(() => {
      mockGetDenylistCache.mockReturnValue(undefined);
    });

    it('blocks with the verification prompt AND tracks it when not verified', async () => {
      mockEvaluateNsfwGate.mockResolvedValue({ allowed: false, reason: 'not-verified' });
      const { context, editReply } = makeContext();

      const blocked = await runSlashChatGates(context, personality, channel, userClient);

      expect(blocked).toBe(true);
      expect(editReply).toHaveBeenCalledWith({ content: 'NSFW_PROMPT' });
      expect(mockTrackPending).toHaveBeenCalledWith('actor-1', 'reply-1', 'chan-1');
    });

    it('still blocks (and swallows) when tracking the verification prompt fails', async () => {
      mockEvaluateNsfwGate.mockResolvedValue({ allowed: false, reason: 'not-verified' });
      mockTrackPending.mockRejectedValueOnce(new Error('redis down'));
      const { context } = makeContext();

      const blocked = await runSlashChatGates(context, personality, channel, userClient);
      // Flush the fire-and-forget .catch so its swallow-and-warn path runs.
      await new Promise(resolve => setTimeout(resolve, 0));

      // A tracking failure never changes the gate outcome — the user is still blocked.
      expect(blocked).toBe(true);
    });

    it('blocks with the retry message and does NOT track on a check failure', async () => {
      mockEvaluateNsfwGate.mockResolvedValue({ allowed: false, reason: 'check-failed' });
      const { context, editReply } = makeContext();

      const blocked = await runSlashChatGates(context, personality, channel, userClient);

      expect(blocked).toBe(true);
      expect(editReply).toHaveBeenCalledWith({ content: 'NSFW_CHECK_FAILED' });
      expect(mockTrackPending).not.toHaveBeenCalled();
    });

    it('sends a confirmation and proceeds on a first-time verification', async () => {
      mockEvaluateNsfwGate.mockResolvedValue({ allowed: true, wasNewVerification: true });
      const { context } = makeContext();

      const blocked = await runSlashChatGates(context, personality, channel, userClient);

      expect(blocked).toBe(false);
      expect(mockSendVerificationConfirmation).toHaveBeenCalledWith(channel);
    });

    it('proceeds without a confirmation when already verified', async () => {
      const { context } = makeContext();

      const blocked = await runSlashChatGates(context, personality, channel, userClient);

      expect(blocked).toBe(false);
      expect(mockSendVerificationConfirmation).not.toHaveBeenCalled();
    });
  });
});
