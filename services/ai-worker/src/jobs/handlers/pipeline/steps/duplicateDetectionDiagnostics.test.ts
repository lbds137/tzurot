import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logDuplicateDetectionSetup } from './duplicateDetectionDiagnostics.js';

const { warnSpy, debugSpy } = vi.hoisted(() => ({
  warnSpy: vi.fn(),
  debugSpy: vi.fn(),
}));

vi.mock('@tzurot/common-types/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: debugSpy, warn: warnSpy, error: vi.fn() }),
}));

describe('logDuplicateDetectionSetup', () => {
  beforeEach(() => {
    warnSpy.mockClear();
    debugSpy.mockClear();
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
});
