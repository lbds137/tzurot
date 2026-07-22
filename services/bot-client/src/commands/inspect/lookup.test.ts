import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeErr } from '../../test/gatewayClientStubs.js';
import {
  parseIdentifier,
  lookupByMessageId,
  lookupByRequestId,
  resolveDiagnosticLog,
} from './lookup.js';
import type {
  DiagnosticLogResponse,
  DiagnosticLogsResponse,
} from '@tzurot/common-types/schemas/api/diagnostic';
import type { DiagnosticPayload } from '@tzurot/common-types/types/diagnostic';
import type { GatewayResult, UserClient } from '@tzurot/clients';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

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
      freshModeEnabled: false,
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
      allParams: {},
    },
    llmResponse: {
      rawContent: 'Hi there!',
      finishReason: 'stop',
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

/**
 * Minimal log shape returned by the diagnostic endpoints. The schema in
 * common-types requires `triggerMessageId: string | null` and `createdAt:
 * string | Date`, but the test stubs return whatever shape we want — the
 * client transport doesn't run Zod validation on the stub output (we're
 * bypassing it directly by mocking the client method itself).
 */
function makeLog(overrides: Partial<Record<string, unknown>> = {}): unknown {
  return {
    id: 'log-uuid',
    requestId: 'req-1',
    triggerMessageId: null,
    personalityId: 'personality-uuid',
    userId: '123456789',
    guildId: null,
    channelId: null,
    model: 'claude-3-5-sonnet',
    provider: 'anthropic',
    durationMs: 1500,
    createdAt: '2026-01-22T12:00:00Z',
    data: createMockDiagnosticPayload(),
    ...overrides,
  };
}

function ok<T>(data: T): GatewayResult<T> {
  return { ok: true, data };
}

interface StubClient {
  getDiagnosticByMessage: ReturnType<typeof vi.fn>;
  getDiagnosticByResponse: ReturnType<typeof vi.fn>;
  getDiagnosticByRequestId: ReturnType<typeof vi.fn>;
}

function createStubClient(): StubClient {
  return {
    getDiagnosticByMessage: vi.fn(),
    getDiagnosticByResponse: vi.fn(),
    getDiagnosticByRequestId: vi.fn(),
  };
}

function asUserClient(stub: StubClient): UserClient {
  return stub as unknown as UserClient;
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
  let stub: StubClient;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStubClient();
  });
  afterEach(() => vi.restoreAllMocks());

  it('should call userClient.getDiagnosticByMessage', async () => {
    stub.getDiagnosticByMessage.mockResolvedValue(
      ok<DiagnosticLogsResponse>({ logs: [makeLog()] as never, count: 1 })
    );

    const result = await lookupByMessageId('1234567890123456789', asUserClient(stub));

    expect(stub.getDiagnosticByMessage).toHaveBeenCalledWith('1234567890123456789');
    expect(stub.getDiagnosticByResponse).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('should fall back to /by-response on 404', async () => {
    stub.getDiagnosticByMessage.mockResolvedValue(makeErr(404));
    stub.getDiagnosticByResponse.mockResolvedValue(
      ok<DiagnosticLogResponse>({ log: makeLog() as never })
    );

    const result = await lookupByMessageId('1234567890123456789', asUserClient(stub));

    expect(stub.getDiagnosticByMessage).toHaveBeenCalledTimes(1);
    expect(stub.getDiagnosticByResponse).toHaveBeenCalledWith('1234567890123456789');
    expect(result.success).toBe(true);
  });

  it('should return error when both endpoints return 404', async () => {
    stub.getDiagnosticByMessage.mockResolvedValue(makeErr(404));
    stub.getDiagnosticByResponse.mockResolvedValue(makeErr(404));

    const result = await lookupByMessageId('1234567890123456789', asUserClient(stub));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('No diagnostic logs found');
      expect(result.errorMessage).toContain('24h retention');
    }
  });

  it('should report "by response" failure when fallback /by-response returns non-OK non-404', async () => {
    // Invariant: the error message must identify WHICH fetch failed. When
    // /by-message 404s and the /by-response fallback then errors, the
    // surfaced HTTP code is the fallback's (503 here), not the original 404.
    // Reusing a single response variable across both calls would shadow this.
    stub.getDiagnosticByMessage.mockResolvedValue(makeErr(404));
    stub.getDiagnosticByResponse.mockResolvedValue(makeErr(503));

    const result = await lookupByMessageId('1234567890123456789', asUserClient(stub));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('HTTP 503');
    }
  });

  it('should return error for empty logs array', async () => {
    stub.getDiagnosticByMessage.mockResolvedValue(
      ok<DiagnosticLogsResponse>({ logs: [], count: 0 })
    );

    const result = await lookupByMessageId('1234567890123456789', asUserClient(stub));
    expect(result.success).toBe(false);
  });

  it('should use most recent log when multiple exist', async () => {
    stub.getDiagnosticByMessage.mockResolvedValue(
      ok<DiagnosticLogsResponse>({
        logs: [makeLog({ requestId: 'newer-req' }), makeLog({ requestId: 'older-req' })] as never,
        count: 2,
      })
    );

    const result = await lookupByMessageId('1234567890123456789', asUserClient(stub));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.log.requestId).toBe('newer-req');
    }
  });

  it('should return error for HTTP 500', async () => {
    stub.getDiagnosticByMessage.mockResolvedValue(makeErr(500));

    const result = await lookupByMessageId('1234567890123456789', asUserClient(stub));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('HTTP 500');
    }
  });
});

describe('lookupByRequestId', () => {
  let stub: StubClient;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStubClient();
  });
  afterEach(() => vi.restoreAllMocks());

  it('should call userClient.getDiagnosticByRequestId', async () => {
    stub.getDiagnosticByRequestId.mockResolvedValue(
      ok<DiagnosticLogResponse>({ log: makeLog({ requestId: 'test-req' }) as never })
    );

    const result = await lookupByRequestId('test-req', asUserClient(stub));

    expect(stub.getDiagnosticByRequestId).toHaveBeenCalledWith('test-req');
    expect(stub.getDiagnosticByMessage).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('should return 404 error message', async () => {
    stub.getDiagnosticByRequestId.mockResolvedValue(makeErr(404));

    const result = await lookupByRequestId('expired-req', asUserClient(stub));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('Diagnostic log not found');
      expect(result.errorMessage).toContain('24h retention');
    }
  });

  it('should pass request ID to the client untouched', async () => {
    // The generated client handles URL encoding internally; the lookup
    // function just forwards the request ID string.
    stub.getDiagnosticByRequestId.mockResolvedValue(makeErr(404));

    await lookupByRequestId('req/with/slashes', asUserClient(stub));
    expect(stub.getDiagnosticByRequestId).toHaveBeenCalledWith('req/with/slashes');
  });

  it('should include HTTP status in error message', async () => {
    stub.getDiagnosticByRequestId.mockResolvedValue(makeErr(503));

    const result = await lookupByRequestId('test-req', asUserClient(stub));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('HTTP 503');
    }
  });
});

describe('resolveDiagnosticLog', () => {
  let stub: StubClient;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStubClient();
  });
  afterEach(() => vi.restoreAllMocks());

  it('should route UUIDs to lookupByRequestId', async () => {
    stub.getDiagnosticByRequestId.mockResolvedValue(makeErr(404));

    await resolveDiagnosticLog('a1b2c3d4-e5f6-7890-abcd-ef1234567890', asUserClient(stub));

    expect(stub.getDiagnosticByRequestId).toHaveBeenCalledWith(
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    );
    expect(stub.getDiagnosticByMessage).not.toHaveBeenCalled();
  });

  it('should route snowflakes to lookupByMessageId', async () => {
    stub.getDiagnosticByMessage.mockResolvedValue(
      ok<DiagnosticLogsResponse>({ logs: [], count: 0 })
    );

    await resolveDiagnosticLog('1234567890123456789', asUserClient(stub));

    expect(stub.getDiagnosticByMessage).toHaveBeenCalledWith('1234567890123456789');
    expect(stub.getDiagnosticByRequestId).not.toHaveBeenCalled();
  });

  it('should route message links to lookupByMessageId', async () => {
    stub.getDiagnosticByMessage.mockResolvedValue(
      ok<DiagnosticLogsResponse>({ logs: [], count: 0 })
    );

    await resolveDiagnosticLog(
      'https://discord.com/channels/111/222/9876543210987654321',
      asUserClient(stub)
    );

    expect(stub.getDiagnosticByMessage).toHaveBeenCalledWith('9876543210987654321');
  });
});
