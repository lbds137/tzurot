/**
 * Tests for recoverLateResult (direct unit tests; MessageHandler.test.ts also
 * exercises it through handleJobResult and the real deliverJobResult).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Client } from 'discord.js';
import type { LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import { PartialDeliveryError } from '../services/partialDelivery.js';
import { recoverLateResult, type LateResultRecoveryDeps } from './lateResultRecovery.js';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return { ...actual, createLogger: () => mockLogger };
});

const mockFetchTypingChannel = vi.fn();
vi.mock('../utils/fetchTypingChannel.js', () => ({
  fetchTypingChannel: (...args: unknown[]) => mockFetchTypingChannel(...args),
}));

const mockReportDeliveryFailure = vi.fn();
const mockReportQuotaFallbackRescue = vi.fn();
vi.mock('../observability/ErrorChannelReporter.js', () => ({
  reportDeliveryFailure: (...args: unknown[]) => mockReportDeliveryFailure(...args),
  reportQuotaFallbackRescue: (...args: unknown[]) => mockReportQuotaFallbackRescue(...args),
}));

// The module must never confirm delivery; if it ever imports the gateway
// module, this mock makes the call observable.
const mockConfirmDelivery = vi.fn();
vi.mock('../utils/gatewayServiceCalls.js', () => ({
  confirmDelivery: (...args: unknown[]) => mockConfirmDelivery(...args),
}));

const ctx = {
  channelId: 'channel-late',
  guildId: 'guild-1',
  clientId: 'bot-1',
  personalitySlug: 'lila',
  recipientUserId: 'user-1',
  isAutoResponse: false,
};
const personality = { id: 'p-lila', name: 'lila', slug: 'lila', displayName: 'Lila' };
const channel = { id: 'channel-late' };
const okResult = {
  requestId: 'req-late',
  success: true,
  content: 'The real reply that arrived late',
  metadata: { modelUsed: 'anthropic/claude-sonnet-4' },
} as LLMGenerationResult;

describe('recoverLateResult', () => {
  const coordinator = {
    getSyntheticTimeout: vi.fn(),
    clearSyntheticTimeout: vi.fn(),
  };
  const personalityService = { loadPersonality: vi.fn() };
  const responseSender = { sendResponse: vi.fn() };
  const client = {} as Client;
  let deps: LateResultRecoveryDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    coordinator.getSyntheticTimeout.mockResolvedValue(ctx);
    coordinator.clearSyntheticTimeout.mockResolvedValue(undefined);
    personalityService.loadPersonality.mockResolvedValue(personality);
    mockFetchTypingChannel.mockResolvedValue(channel);
    responseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['m1'] });
    deps = {
      coordinator,
      personalityService,
      client,
      responseSender,
    } as unknown as LateResultRecoveryDeps;
  });

  it('returns null and clears nothing when there is no marker', async () => {
    coordinator.getSyntheticTimeout.mockResolvedValue(null);

    expect(await recoverLateResult(deps, 'job-1', okResult)).toBeNull();
    expect(coordinator.clearSyntheticTimeout).not.toHaveBeenCalled();
    expect(responseSender.sendResponse).not.toHaveBeenCalled();
    expect(mockConfirmDelivery).not.toHaveBeenCalled();
  });

  it.each([
    ['failed', { requestId: 'r', success: false, error: 'boom' }],
    ['empty', { requestId: 'r', success: true, content: '' }],
  ])('%s late result -> delivered, no send, marker cleared', async (_name, late) => {
    const disposition = await recoverLateResult(deps, 'job-1', late as LLMGenerationResult);

    expect(disposition).toBe('delivered');
    expect(responseSender.sendResponse).not.toHaveBeenCalled();
    expect(personalityService.loadPersonality).not.toHaveBeenCalled();
    expect(coordinator.clearSyntheticTimeout).toHaveBeenCalledWith('job-1');
    expect(mockConfirmDelivery).not.toHaveBeenCalled();
  });

  it('personality unloadable -> dropped, marker cleared, error logged with reason', async () => {
    personalityService.loadPersonality.mockResolvedValue(null);

    expect(await recoverLateResult(deps, 'job-1', okResult)).toBe('dropped');
    expect(responseSender.sendResponse).not.toHaveBeenCalled();
    expect(coordinator.clearSyntheticTimeout).toHaveBeenCalledWith('job-1');
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1', reason: 'personality-unloadable' }),
      expect.stringContaining('NOT confirming')
    );
    expect(mockConfirmDelivery).not.toHaveBeenCalled();
  });

  it('channel missing -> dropped, marker cleared, error logged with reason', async () => {
    mockFetchTypingChannel.mockResolvedValue(null);

    expect(await recoverLateResult(deps, 'job-1', okResult)).toBe('dropped');
    expect(responseSender.sendResponse).not.toHaveBeenCalled();
    expect(coordinator.clearSyntheticTimeout).toHaveBeenCalledWith('job-1');
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        channelId: 'channel-late',
        reason: 'channel-missing',
      }),
      expect.stringContaining('NOT confirming')
    );
    expect(mockConfirmDelivery).not.toHaveBeenCalled();
  });

  it('send throws -> dropped, marker cleared, reported, error logged with reason', async () => {
    const boom = new Error('rate limited');
    responseSender.sendResponse.mockRejectedValue(boom);

    expect(await recoverLateResult(deps, 'job-1', okResult)).toBe('dropped');
    expect(coordinator.clearSyntheticTimeout).toHaveBeenCalledWith('job-1');
    expect(mockReportDeliveryFailure).toHaveBeenCalledWith(boom, okResult, 'lila');
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1', err: boom, reason: 'send-failed' }),
      expect.stringContaining('NOT confirming')
    );
    expect(mockConfirmDelivery).not.toHaveBeenCalled();
  });

  it('send throws PartialDeliveryError -> delivered, marker cleared, reported, logged', async () => {
    const partial = new PartialDeliveryError({
      chunkMessageIds: ['m1'],
      deliveredContent: 'part',
      totalChunks: 2,
      cause: new Error('boom'),
    });
    responseSender.sendResponse.mockRejectedValue(partial);

    expect(await recoverLateResult(deps, 'job-1', okResult)).toBe('delivered');
    expect(coordinator.clearSyntheticTimeout).toHaveBeenCalledWith('job-1');
    expect(mockReportDeliveryFailure).toHaveBeenCalledWith(partial, okResult, 'lila');
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1', err: partial, reason: 'send-partial' }),
      expect.stringContaining('treating as delivered')
    );
    expect(mockConfirmDelivery).not.toHaveBeenCalled();
  });

  it('success -> delivered; exact args cross the sendResponse seam; marker cleared', async () => {
    expect(await recoverLateResult(deps, 'job-1', okResult)).toBe('delivered');

    expect(personalityService.loadPersonality).toHaveBeenCalledWith('lila', 'user-1');
    expect(mockFetchTypingChannel).toHaveBeenCalledWith(client, 'channel-late');
    expect(responseSender.sendResponse).toHaveBeenCalledTimes(1);
    const opts = responseSender.sendResponse.mock.calls[0][0];
    expect(opts.content.endsWith('The real reply that arrived late')).toBe(true);
    expect(opts.content.startsWith('-# ')).toBe(true);
    expect(opts.content).toContain('took longer than expected');
    expect(opts.personality).toBe(personality);
    expect(opts.channel).toBe(channel);
    expect(opts.guildId).toBe('guild-1');
    expect(opts.clientId).toBe('bot-1');
    expect(opts.recipientUserId).toBe('user-1');
    expect(opts.isAutoResponse).toBe(false);
    expect(mockReportQuotaFallbackRescue).toHaveBeenCalledWith(okResult, 'lila');
    expect(coordinator.clearSyntheticTimeout).toHaveBeenCalledWith('job-1');
    expect(mockConfirmDelivery).not.toHaveBeenCalled();
  });
});
