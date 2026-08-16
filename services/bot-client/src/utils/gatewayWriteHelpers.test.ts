import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the ServiceClient factory so the helpers run without real config/network.
const mockServiceClient = {
  persistAssistantMessage: vi.fn(),
  persistUserMessage: vi.fn(),
  syncConversation: vi.fn(),
};

vi.mock('./gatewayClients.js', () => ({
  getServiceClient: () => mockServiceClient,
}));

import {
  persistAssistantMessageViaGateway,
  persistUserMessageViaGateway,
  syncConversationViaGateway,
} from './gatewayWriteHelpers.js';
import { makeErr } from '../test/gatewayClientStubs.js';

const ok = <T>(data: T): { ok: true; data: T } => ({ ok: true, data });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('persistAssistantMessageViaGateway', () => {
  const PARAMS = {
    channelId: 'chan-1',
    guildId: 'guild-1',
    personalityId: 'pers-1',
    personaId: 'persona-1',
    content: 'response text',
    chunkMessageIds: ['111111111111111111'],
    userMessageTime: new Date('2026-06-04T12:00:00.000Z'),
  };

  it('POSTs the payload and resolves on a created row', async () => {
    mockServiceClient.persistAssistantMessage.mockResolvedValue(ok({ id: 'row-1', created: true }));

    await persistAssistantMessageViaGateway(PARAMS);

    expect(mockServiceClient.persistAssistantMessage).toHaveBeenCalledWith({
      channelId: 'chan-1',
      guildId: 'guild-1',
      personalityId: 'pers-1',
      personaId: 'persona-1',
      content: 'response text',
      chunkMessageIds: ['111111111111111111'],
      userMessageTime: '2026-06-04T12:00:00.000Z',
    });
  });

  it('THROWS on a request failure (authoritative write, caller owns the catch)', async () => {
    vi.useFakeTimers();
    try {
      mockServiceClient.persistAssistantMessage.mockResolvedValue(makeErr(503, 'boom'));

      const promise = persistAssistantMessageViaGateway(PARAMS);
      const assertion = expect(promise).rejects.toThrow(
        'Assistant-message persist failed via gateway after 3 attempt(s): 503'
      );
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a 5xx and resolves once the retry lands (persist is replay-safe)', async () => {
    vi.useFakeTimers();
    try {
      mockServiceClient.persistAssistantMessage
        .mockResolvedValueOnce(makeErr(503, 'boom'))
        .mockResolvedValueOnce(ok({ id: 'row-1', created: true }));

      const promise = persistAssistantMessageViaGateway(PARAMS);
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBeUndefined();

      expect(mockServiceClient.persistAssistantMessage).toHaveBeenCalledTimes(2);
      // The retry re-sends the SAME payload — that identity is what makes the
      // gateway's deterministic row id resolve to one row instead of two turns.
      const [first, second] = mockServiceClient.persistAssistantMessage.mock.calls;
      expect(second[0]).toEqual(first[0]);
      expect(second[0]).toMatchObject({
        channelId: 'chan-1',
        chunkMessageIds: ['111111111111111111'],
        userMessageTime: '2026-06-04T12:00:00.000Z',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a 4xx (a rejected payload will be rejected again)', async () => {
    mockServiceClient.persistAssistantMessage.mockResolvedValue(makeErr(400, 'bad payload'));

    await expect(persistAssistantMessageViaGateway(PARAMS)).rejects.toThrow(
      'Assistant-message persist failed via gateway after 1 attempt(s): 400'
    );
    expect(mockServiceClient.persistAssistantMessage).toHaveBeenCalledTimes(1);
  });

  it('resolves (with a warn, not a throw) on an idempotent replay that diverged', async () => {
    mockServiceClient.persistAssistantMessage.mockResolvedValue(
      ok({ id: 'row-1', created: false, matched: false })
    );

    await expect(persistAssistantMessageViaGateway(PARAMS)).resolves.toBeUndefined();
  });
});

describe('syncConversationViaGateway', () => {
  const OBSERVED = [
    { id: '111111111111111111', content: 'hello', createdAt: new Date('2026-06-04T12:00:00Z') },
  ];

  it('returns the gateway sync result', async () => {
    mockServiceClient.syncConversation.mockResolvedValue(ok({ updated: 2, deleted: 1 }));

    const result = await syncConversationViaGateway('chan-1', 'pers-1', OBSERVED);

    expect(result).toEqual({ updated: 2, deleted: 1 });
    expect(mockServiceClient.syncConversation).toHaveBeenCalledWith({
      channelId: 'chan-1',
      personalityId: 'pers-1',
      observedMessages: [
        {
          discordMessageId: '111111111111111111',
          content: 'hello',
          createdAt: '2026-06-04T12:00:00.000Z',
        },
      ],
    });
  });

  it('returns zero counts without calling the gateway on an empty snapshot', async () => {
    const result = await syncConversationViaGateway('chan-1', 'pers-1', []);

    expect(result).toEqual({ updated: 0, deleted: 0 });
    expect(mockServiceClient.syncConversation).not.toHaveBeenCalled();
  });

  it('never throws: zero counts on request failure and on client error', async () => {
    mockServiceClient.syncConversation.mockResolvedValue(makeErr(503, 'boom'));
    await expect(syncConversationViaGateway('chan-1', 'pers-1', OBSERVED)).resolves.toEqual({
      updated: 0,
      deleted: 0,
    });

    mockServiceClient.syncConversation.mockRejectedValue(new Error('network down'));
    await expect(syncConversationViaGateway('chan-1', 'pers-1', OBSERVED)).resolves.toEqual({
      updated: 0,
      deleted: 0,
    });
  });
});

describe('persistUserMessageViaGateway', () => {
  const PARAMS = {
    channelId: 'chan-1',
    guildId: 'guild-1',
    personalityId: 'pers-1',
    personaId: 'persona-1',
    content: 'Hello bot!\n\n[Image: cat.png]',
    discordMessageId: '111111111111111111',
    messageMetadata: { isForwarded: true },
    messageTime: new Date('2026-06-04T12:00:00.000Z'),
  };

  it('POSTs the payload with ISO messageTime and metadata', async () => {
    mockServiceClient.persistUserMessage.mockResolvedValue(ok({ id: 'row-1', created: true }));

    await persistUserMessageViaGateway(PARAMS);

    expect(mockServiceClient.persistUserMessage).toHaveBeenCalledWith({
      channelId: 'chan-1',
      guildId: 'guild-1',
      personalityId: 'pers-1',
      personaId: 'persona-1',
      content: 'Hello bot!\n\n[Image: cat.png]',
      discordMessageId: '111111111111111111',
      messageMetadata: { isForwarded: true },
      messageTime: '2026-06-04T12:00:00.000Z',
    });
  });

  it('omits the messageMetadata key entirely when undefined', async () => {
    mockServiceClient.persistUserMessage.mockResolvedValue(ok({ id: 'row-1', created: true }));

    await persistUserMessageViaGateway({ ...PARAMS, messageMetadata: undefined });

    const sent = mockServiceClient.persistUserMessage.mock.calls[0][0];
    expect('messageMetadata' in sent).toBe(false);
  });

  it('THROWS on a request failure (authoritative write, caller owns the catch)', async () => {
    mockServiceClient.persistUserMessage.mockResolvedValue(makeErr(503, 'boom'));

    await expect(persistUserMessageViaGateway(PARAMS)).rejects.toThrow(
      'User-message persist failed via gateway: 503'
    );
  });

  it('resolves (warn, not throw) on an idempotent replay that diverged', async () => {
    mockServiceClient.persistUserMessage.mockResolvedValue(
      ok({ id: 'row-1', created: false, matched: false })
    );

    await expect(persistUserMessageViaGateway(PARAMS)).resolves.toBeUndefined();
  });

  it('resolves quietly on an idempotent replay that matched', async () => {
    mockServiceClient.persistUserMessage.mockResolvedValue(
      ok({ id: 'row-1', created: false, matched: true })
    );

    await expect(persistUserMessageViaGateway(PARAMS)).resolves.toBeUndefined();
  });
});
