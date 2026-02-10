import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseIdentifier,
  lookupByMessageId,
  lookupByRequestId,
  resolveDiagnosticLog,
} from './lookup.js';
import type { DiagnosticPayload } from '@tzurot/common-types';

// Mock logger and config
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    getConfig: () => ({
      GATEWAY_URL: 'http://localhost:3000',
      INTERNAL_SERVICE_SECRET: 'test-service-secret',
    }),
  };
});

// Mock fetch
global.fetch = vi.fn();

function createMockDiagnosticPayload(): DiagnosticPayload {
  return {
    meta: {
      requestId: 'test-req-123',
      personalityId: 'personality-uuid',
      personalityName: 'Test Personality',
      userId: '123456789',
      guildId: '987654321',
      channelId: '111222333',
      timestamp: '2026-01-22T12:00:00Z',
    },
    inputProcessing: {
      rawUserMessage: 'Hello',
      attachmentDescriptions: [],
      voiceTranscript: null,
      referencedMessageIds: [],
      referencedMessagesContent: [],
      searchQuery: 'hello',
    },
    memoryRetrieval: {
      memoriesFound: [
        { id: 'mem-1', score: 0.95, preview: 'Memory preview...', includedInPrompt: true },
      ],
      focusModeEnabled: false,
    },
    tokenBudget: {
      contextWindowSize: 128000,
      systemPromptTokens: 500,
      memoryTokensUsed: 1000,
      historyTokensUsed: 2000,
      memoriesDropped: 0,
      historyMessagesDropped: 0,
    },
    assembledPrompt: {
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ],
      totalTokenEstimate: 100,
    },
    llmConfig: {
      model: 'claude-3-5-sonnet',
      provider: 'anthropic',
      temperature: 0.8,
      stopSequences: [],
      allParams: {},
    },
    llmResponse: {
      rawContent: 'Hi there!',
      finishReason: 'stop',
      stopSequenceTriggered: null,
      promptTokens: 50,
      completionTokens: 10,
      modelUsed: 'claude-3-5-sonnet-20241022',
    },
    postProcessing: {
      transformsApplied: [],
      duplicateDetected: false,
      thinkingExtracted: false,
      thinkingContent: null,
      artifactsStripped: [],
      finalContent: 'Hi there!',
    },
    timing: {
      totalDurationMs: 1500,
      memoryRetrievalMs: 50,
      llmInvocationMs: 1400,
    },
  };
}

describe('parseIdentifier', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('should detect Discord message links (guild)', () => {
    const result = parseIdentifier(
      'https://discord.com/channels/111111111111111111/222222222222222222/1234567890123456789'
    );
    expect(result).toEqual({ type: 'messageId', value: '1234567890123456789' });
  });

  it('should detect Discord DM links (@me)', () => {
    const result = parseIdentifier(
      'https://discord.com/channels/@me/222222222222222222/9876543210987654321'
    );
    expect(result).toEqual({ type: 'messageId', value: '9876543210987654321' });
  });

  it('should detect UUIDs as request IDs', () => {
    const result = parseIdentifier('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(result).toEqual({ type: 'requestId', value: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' });
  });

  it('should detect snowflakes as message IDs', () => {
    const result = parseIdentifier('1234567890123456789');
    expect(result).toEqual({ type: 'messageId', value: '1234567890123456789' });
  });

  it('should default unknown formats to requestId', () => {
    const result = parseIdentifier('something-unknown');
    expect(result).toEqual({ type: 'requestId', value: 'something-unknown' });
  });
});

describe('lookupByMessageId', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('should use /by-message endpoint', async () => {
    const mockPayload = createMockDiagnosticPayload();
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          logs: [{ id: 'log-uuid', requestId: 'req-1', data: mockPayload }],
          count: 1,
        }),
        { status: 200 }
      )
    );

    const result = await lookupByMessageId('1234567890123456789');

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/diagnostic/by-message/1234567890123456789'),
      expect.any(Object)
    );
    expect(result.success).toBe(true);
  });

  it('should fall back to /by-response on 404', async () => {
    const mockPayload = createMockDiagnosticPayload();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('Not found', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ log: { id: 'log-uuid', requestId: 'req-1', data: mockPayload } }),
          { status: 200 }
        )
      );

    const result = await lookupByMessageId('1234567890123456789');

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/by-message/'),
      expect.any(Object)
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/by-response/'),
      expect.any(Object)
    );
    expect(result.success).toBe(true);
  });

  it('should return error when both endpoints return 404', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('Not found', { status: 404 }))
      .mockResolvedValueOnce(new Response('Not found', { status: 404 }));

    const result = await lookupByMessageId('1234567890123456789');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('No diagnostic logs found');
      expect(result.errorMessage).toContain('24h retention');
    }
  });

  it('should return error for empty logs array', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ logs: [], count: 0 }), { status: 200 })
    );

    const result = await lookupByMessageId('1234567890123456789');
    expect(result.success).toBe(false);
  });

  it('should use most recent log when multiple exist', async () => {
    const mockPayload = createMockDiagnosticPayload();
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          logs: [
            { id: 'log-2', requestId: 'newer-req', data: mockPayload },
            { id: 'log-1', requestId: 'older-req', data: mockPayload },
          ],
          count: 2,
        }),
        { status: 200 }
      )
    );

    const result = await lookupByMessageId('1234567890123456789');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.log.requestId).toBe('newer-req');
    }
  });

  it('should return error for HTTP 500', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Internal Server Error', { status: 500 }));

    const result = await lookupByMessageId('1234567890123456789');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('HTTP 500');
    }
  });
});

describe('lookupByRequestId', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('should call the direct endpoint', async () => {
    const mockPayload = createMockDiagnosticPayload();
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ log: { id: 'log-uuid', requestId: 'test-req', data: mockPayload } }),
        { status: 200 }
      )
    );

    const result = await lookupByRequestId('test-req');

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/diagnostic/test-req'),
      expect.any(Object)
    );
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/by-message/'),
      expect.any(Object)
    );
    expect(result.success).toBe(true);
  });

  it('should return 404 error message', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Not found', { status: 404 }));

    const result = await lookupByRequestId('expired-req');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('Diagnostic log not found');
      expect(result.errorMessage).toContain('24h retention');
    }
  });

  it('should URL-encode the request ID', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Not found', { status: 404 }));

    await lookupByRequestId('req/with/slashes');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/diagnostic/req%2Fwith%2Fslashes'),
      expect.any(Object)
    );
  });

  it('should include service auth header', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Not found', { status: 404 }));

    await lookupByRequestId('test-req');
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Service-Auth': 'test-service-secret',
        }),
      })
    );
  });

  it('should include HTTP status in error message', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Service Unavailable', { status: 503 }));

    const result = await lookupByRequestId('test-req');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('HTTP 503');
    }
  });
});

describe('resolveDiagnosticLog', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('should route UUIDs to lookupByRequestId', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Not found', { status: 404 }));

    await resolveDiagnosticLog('a1b2c3d4-e5f6-7890-abcd-ef1234567890');

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/diagnostic/a1b2c3d4-e5f6-7890-abcd-ef1234567890'),
      expect.any(Object)
    );
  });

  it('should route snowflakes to lookupByMessageId', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ logs: [], count: 0 }), { status: 200 })
    );

    await resolveDiagnosticLog('1234567890123456789');

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/by-message/1234567890123456789'),
      expect.any(Object)
    );
  });

  it('should route message links to lookupByMessageId', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ logs: [], count: 0 }), { status: 200 })
    );

    await resolveDiagnosticLog('https://discord.com/channels/111/222/9876543210987654321');

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/by-message/9876543210987654321'),
      expect.any(Object)
    );
  });
});
