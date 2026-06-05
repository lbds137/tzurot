import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SYNC_LIMITS } from '@tzurot/common-types';

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
  isContextDualWriteEnabled,
  dualWritePersistAssistantMessage,
  dualWritePersistUserMessage,
  dualWriteConversationSync,
  getContextMode,
  persistAssistantMessageViaGateway,
  persistUserMessageViaGateway,
  syncConversationViaGateway,
} from './contextWritePath.js';

const ok = <T>(data: T): { ok: true; data: T } => ({ ok: true, data });
const err = (status: number): { ok: false; error: string; status: number } => ({
  ok: false,
  error: 'boom',
  status,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isContextDualWriteEnabled', () => {
  it('is enabled only by the exact string "true"', () => {
    expect(isContextDualWriteEnabled({ CONTEXT_DUAL_WRITE: 'true' } as NodeJS.ProcessEnv)).toBe(
      true
    );
    expect(isContextDualWriteEnabled({ CONTEXT_DUAL_WRITE: '1' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isContextDualWriteEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('dualWritePersistAssistantMessage', () => {
  const PARAMS = {
    channelId: 'chan-1',
    guildId: 'guild-1',
    personalityId: 'pers-1',
    personaId: 'persona-1',
    content: 'response text',
    chunkMessageIds: ['111111111111111111'],
    userMessageTime: new Date('2026-06-04T12:00:00.000Z'),
  };

  afterEach(() => {
    delete process.env.CONTEXT_DUAL_WRITE;
  });

  it('no-ops when the flag is off', async () => {
    await dualWritePersistAssistantMessage(PARAMS);
    expect(mockServiceClient.persistAssistantMessage).not.toHaveBeenCalled();
  });

  it('POSTs the payload with ISO userMessageTime when the flag is on', async () => {
    process.env.CONTEXT_DUAL_WRITE = 'true';
    mockServiceClient.persistAssistantMessage.mockResolvedValue(
      ok({ id: 'row-1', created: false, matched: true })
    );

    await dualWritePersistAssistantMessage(PARAMS);

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

  it('never throws on request failure or client error', async () => {
    process.env.CONTEXT_DUAL_WRITE = 'true';
    mockServiceClient.persistAssistantMessage.mockRejectedValue(new Error('network down'));

    await expect(dualWritePersistAssistantMessage(PARAMS)).resolves.toBeUndefined();

    mockServiceClient.persistAssistantMessage.mockResolvedValue(err(500));
    await expect(dualWritePersistAssistantMessage(PARAMS)).resolves.toBeUndefined();
  });
});

describe('dualWriteConversationSync', () => {
  const OBSERVED = [
    { id: '111111111111111111', content: 'hello', createdAt: new Date('2026-06-04T12:00:00Z') },
  ];

  afterEach(() => {
    delete process.env.CONTEXT_DUAL_WRITE;
  });

  it('no-ops when the flag is off', async () => {
    await dualWriteConversationSync('chan-1', 'pers-1', OBSERVED);
    expect(mockServiceClient.syncConversation).not.toHaveBeenCalled();
  });

  it('no-ops on an empty snapshot even with the flag on', async () => {
    process.env.CONTEXT_DUAL_WRITE = 'true';
    await dualWriteConversationSync('chan-1', 'pers-1', []);
    expect(mockServiceClient.syncConversation).not.toHaveBeenCalled();
  });

  it('POSTs the wire-shaped snapshot when the flag is on', async () => {
    process.env.CONTEXT_DUAL_WRITE = 'true';
    mockServiceClient.syncConversation.mockResolvedValue(ok({ updated: 0, deleted: 0 }));

    await dualWriteConversationSync('chan-1', 'pers-1', OBSERVED);

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

  it('never throws on request failure or client error', async () => {
    process.env.CONTEXT_DUAL_WRITE = 'true';
    mockServiceClient.syncConversation.mockRejectedValue(new Error('network down'));

    await expect(dualWriteConversationSync('chan-1', 'pers-1', OBSERVED)).resolves.toBeUndefined();

    mockServiceClient.syncConversation.mockResolvedValue(err(500));
    await expect(dualWriteConversationSync('chan-1', 'pers-1', OBSERVED)).resolves.toBeUndefined();
  });

  it('truncates oversized snapshots to the wire cap (slice is observable, not silent)', async () => {
    process.env.CONTEXT_DUAL_WRITE = 'true';
    mockServiceClient.syncConversation.mockResolvedValue(ok({ updated: 0, deleted: 0 }));

    const oversized = Array.from({ length: SYNC_LIMITS.MAX_DISCORD_ID_LOOKUP + 5 }, (_, i) => ({
      id: `${100000000000000000n + BigInt(i)}`,
      content: `msg ${i}`,
      createdAt: new Date('2026-06-04T12:00:00Z'),
    }));

    await dualWriteConversationSync('chan-1', 'pers-1', oversized);

    const sent = mockServiceClient.syncConversation.mock.calls[0][0].observedMessages;
    expect(sent).toHaveLength(SYNC_LIMITS.MAX_DISCORD_ID_LOOKUP);
  });
});

describe('getContextMode', () => {
  it('resolves "service" only for the exact string, legacy otherwise', () => {
    expect(getContextMode({ CONTEXT_MODE: 'service' } as NodeJS.ProcessEnv)).toBe('service');
    expect(getContextMode({ CONTEXT_MODE: 'Service' } as NodeJS.ProcessEnv)).toBe('legacy');
    expect(getContextMode({ CONTEXT_MODE: 'legacy' } as NodeJS.ProcessEnv)).toBe('legacy');
    expect(getContextMode({} as NodeJS.ProcessEnv)).toBe('legacy');
  });
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
    mockServiceClient.persistAssistantMessage.mockResolvedValue(err(503));

    await expect(persistAssistantMessageViaGateway(PARAMS)).rejects.toThrow(
      'Assistant-message persist failed via gateway: 503'
    );
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
    mockServiceClient.syncConversation.mockResolvedValue(err(503));
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
    mockServiceClient.persistUserMessage.mockResolvedValue(err(503));

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

describe('dualWritePersistUserMessage', () => {
  const PARAMS = {
    channelId: 'chan-1',
    guildId: null,
    personalityId: 'pers-1',
    personaId: 'persona-1',
    content: 'hi',
    discordMessageId: '111111111111111111',
    messageTime: new Date('2026-06-04T12:00:00.000Z'),
  };

  afterEach(() => {
    delete process.env.CONTEXT_DUAL_WRITE;
  });

  it('no-ops when the flag is off', async () => {
    await dualWritePersistUserMessage(PARAMS);
    expect(mockServiceClient.persistUserMessage).not.toHaveBeenCalled();
  });

  it('POSTs when the flag is on and never throws on errors', async () => {
    process.env.CONTEXT_DUAL_WRITE = 'true';
    mockServiceClient.persistUserMessage.mockResolvedValue(
      ok({ id: 'row-1', created: false, matched: true })
    );
    await dualWritePersistUserMessage(PARAMS);
    expect(mockServiceClient.persistUserMessage).toHaveBeenCalledTimes(1);

    mockServiceClient.persistUserMessage.mockRejectedValue(new Error('network down'));
    await expect(dualWritePersistUserMessage(PARAMS)).resolves.toBeUndefined();

    mockServiceClient.persistUserMessage.mockResolvedValue(err(500));
    await expect(dualWritePersistUserMessage(PARAMS)).resolves.toBeUndefined();
  });
});
