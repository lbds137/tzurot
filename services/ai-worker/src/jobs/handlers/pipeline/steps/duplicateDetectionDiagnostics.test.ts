import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logDuplicateDetectionSetup } from './duplicateDetectionDiagnostics.js';

const { warnSpy, debugSpy } = vi.hoisted(() => ({
  warnSpy: vi.fn(),
  debugSpy: vi.fn(),
}));

vi.mock('@tzurot/common-types/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: debugSpy, warn: warnSpy, error: vi.fn() }),
}));

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { NODE_ENV: 'test' as string, LOG_CONTENT_PREVIEWS: false },
}));
vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return { ...actual, getConfig: () => mockConfig };
});

describe('logDuplicateDetectionSetup', () => {
  beforeEach(() => {
    warnSpy.mockClear();
    debugSpy.mockClear();
    mockConfig.NODE_ENV = 'test';
    mockConfig.LOG_CONTENT_PREVIEWS = false;
  });

  it('WARNS on the anomaly: non-empty history with zero assistant messages', () => {
    logDuplicateDetectionSetup({
      jobId: 'job-1',
      rawConversationHistory: [{ role: 'user' }, { role: 'user' }],
      recentAssistantMessages: [],
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        historyLength: 2,
        roleDistribution: { user: 2 },
      }),
      expect.stringContaining('ANOMALY')
    );
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('logs debug (not warn) when assistant messages were extracted', () => {
    logDuplicateDetectionSetup({
      jobId: 'job-1',
      rawConversationHistory: [{ role: 'user' }, { role: 'assistant' }],
      recentAssistantMessages: ['a previous reply'],
    });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalled();
  });

  it('treats missing/empty history as the normal path (no anomaly warn)', () => {
    logDuplicateDetectionSetup({ jobId: undefined, recentAssistantMessages: [] });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalled();
  });

  describe('Duplicate detection ready logging', () => {
    const recentAssistantMessages = ['a distinctive previous assistant reply'];

    it('carries the always-on digest but omits the preview array by default', () => {
      logDuplicateDetectionSetup({
        jobId: 'job-1',
        rawConversationHistory: [{ role: 'user' }, { role: 'assistant' }],
        recentAssistantMessages,
      });

      const fields = debugSpy.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(fields.recentMessagesPreview).toBeUndefined();
      expect(fields.recentMessageDigests).toEqual(expect.any(Array));
      expect((fields.recentMessageDigests as unknown[])[0]).not.toBe(recentAssistantMessages[0]);
      expect(JSON.stringify(debugSpy.mock.calls)).not.toContain(recentAssistantMessages[0]);
    });

    it('includes the preview array when content previews are enabled', () => {
      mockConfig.NODE_ENV = 'development';
      mockConfig.LOG_CONTENT_PREVIEWS = true;

      logDuplicateDetectionSetup({
        jobId: 'job-1',
        rawConversationHistory: [{ role: 'user' }, { role: 'assistant' }],
        recentAssistantMessages,
      });

      const fields = debugSpy.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(fields.recentMessagesPreview).toEqual([recentAssistantMessages[0]]);
    });
  });
});
