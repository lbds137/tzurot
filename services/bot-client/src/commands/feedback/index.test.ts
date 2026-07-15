/**
 * Tests for /feedback (submission flow + best-effort owner-channel post).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetConfig } from '@tzurot/common-types/config/config';
import feedbackCommand from './index.js';
import type { SafeCommandContext } from '../../utils/commandContext/types.js';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

const CHANNEL_ID = '900000000000000099';

describe('/feedback command', () => {
  const mockEditReply = vi.fn();
  const mockChannelSend = vi.fn();
  const mockChannelsFetch = vi.fn();
  let stub: { submitFeedback: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    resetConfig();
    stub = { submitFeedback: vi.fn() };
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
    mockChannelsFetch.mockResolvedValue({
      isTextBased: () => true,
      send: mockChannelSend,
    });
  });

  afterEach(() => {
    delete process.env.FEEDBACK_CHANNEL_ID;
    resetConfig();
  });

  function createMockContext(message = 'the memory system is great'): SafeCommandContext {
    return {
      user: { id: '123456789012345678', username: 'testuser' },
      editReply: mockEditReply,
      interaction: {
        user: { id: '123456789012345678', username: 'testuser' },
        client: { channels: { fetch: mockChannelsFetch } },
        options: {
          getString: vi.fn().mockReturnValue(message),
        },
      },
    } as unknown as SafeCommandContext;
  }

  it('submits and confirms ephemeral success', async () => {
    stub.submitFeedback.mockResolvedValue(makeOk({ success: true, feedbackId: 'fb-1' }));

    await feedbackCommand.execute(createMockContext());

    expect(stub.submitFeedback).toHaveBeenCalledWith({
      content: 'the memory system is great',
    });
    const embed = mockEditReply.mock.calls[0][0].embeds[0];
    expect(embed.data.title).toContain('Feedback Sent');
  });

  it('renders gate rejections verbatim (the message names the limit)', async () => {
    stub.submitFeedback.mockResolvedValue(
      makeErr(400, "You're submitting feedback too quickly — try again in 42 seconds.")
    );

    await feedbackCommand.execute(createMockContext());

    expect(mockEditReply.mock.calls[0][0].content).toContain('42 seconds');
  });

  it('posts a silent embed to the owner channel when configured', async () => {
    process.env.FEEDBACK_CHANNEL_ID = CHANNEL_ID;
    resetConfig();
    stub.submitFeedback.mockResolvedValue(makeOk({ success: true, feedbackId: 'fb-1' }));

    await feedbackCommand.execute(createMockContext());

    expect(mockChannelsFetch).toHaveBeenCalledWith(CHANNEL_ID);
    const sendArgs = mockChannelSend.mock.calls[0][0];
    expect(sendArgs.allowedMentions).toEqual({ parse: [] });
    expect(sendArgs.embeds[0].data.description).toBe('the memory system is great');
    expect(sendArgs.embeds[0].data.footer.text).toContain('fb-1');
  });

  it('escapes markdown in the owner-channel embed (house rule for user content)', async () => {
    process.env.FEEDBACK_CHANNEL_ID = CHANNEL_ID;
    resetConfig();
    stub.submitFeedback.mockResolvedValue(makeOk({ success: true, feedbackId: 'fb-1' }));

    await feedbackCommand.execute(createMockContext('**bold** feedback'));

    const sendArgs = mockChannelSend.mock.calls[0][0];
    expect(sendArgs.embeds[0].data.description).toBe('\\*\\*bold\\*\\* feedback');
  });

  it('skips the owner post when the channel is unconfigured', async () => {
    stub.submitFeedback.mockResolvedValue(makeOk({ success: true, feedbackId: 'fb-1' }));

    await feedbackCommand.execute(createMockContext());

    expect(mockChannelsFetch).not.toHaveBeenCalled();
  });

  it('a failed owner post never breaks the user-facing success reply', async () => {
    process.env.FEEDBACK_CHANNEL_ID = CHANNEL_ID;
    resetConfig();
    stub.submitFeedback.mockResolvedValue(makeOk({ success: true, feedbackId: 'fb-1' }));
    mockChannelsFetch.mockRejectedValue(new Error('Missing Access'));

    await feedbackCommand.execute(createMockContext());

    const embed = mockEditReply.mock.calls[0][0].embeds[0];
    expect(embed.data.title).toContain('Feedback Sent');
  });
});
