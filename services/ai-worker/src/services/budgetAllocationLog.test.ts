import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const infoSpy = vi.fn();
const debugSpy = vi.fn();

vi.mock('@tzurot/common-types/utils/logger', () => ({
  createLogger: () => ({ info: infoSpy, debug: debugSpy }),
}));

const { logBudgetAllocation } = await import('./budgetAllocationLog.js');

/** A complete field set; individual tests override only what they exercise. */
function fields(
  overrides: Partial<Parameters<typeof logBudgetAllocation>[0]> = {}
): Parameters<typeof logBudgetAllocation>[0] {
  return {
    contextWindowTokens: 8000,
    systemPromptBaseTokens: 500,
    currentMessageTokens: 120,
    memoryTokensUsed: 300,
    memoryTokensTotal: 900,
    historyBudget: 7000,
    historyTokensUsed: 1200,
    messagesDropped: 0,
    crossChannelMessagesIncluded: undefined,
    ...overrides,
  };
}

describe('logBudgetAllocation', () => {
  beforeEach(() => {
    infoSpy.mockClear();
    debugSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits the allocation summary with the accounting fields, message second', () => {
    logBudgetAllocation(fields({ crossChannelMessagesIncluded: 3 }));

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith(
      {
        contextWindowTokens: 8000,
        systemPromptBaseTokens: 500,
        currentMessageTokens: 120,
        memoryTokensUsed: 300,
        memoryTokensTotal: 900,
        historyBudget: 7000,
        historyTokensUsed: 1200,
        crossChannelMessagesIncluded: 3,
      },
      'Token allocation'
    );
  });

  it('keeps messagesDropped OUT of the summary line', () => {
    logBudgetAllocation(fields({ messagesDropped: 4 }));

    const [summary] = infoSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(summary).not.toHaveProperty('messagesDropped');
  });

  it('emits a separate debug line when history entries were dropped', () => {
    logBudgetAllocation(fields({ messagesDropped: 4 }));

    expect(debugSpy).toHaveBeenCalledWith(
      { messagesDropped: 4 },
      'Dropped history messages due to token budget'
    );
  });

  it('stays silent about drops when nothing was dropped', () => {
    logBudgetAllocation(fields({ messagesDropped: 0 }));

    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('preserves an undefined crossChannelMessagesIncluded as an explicit key', () => {
    // Disabled (undefined) and enabled-but-empty (0) must stay distinguishable
    // in the log — the 0 case is the silent-skip this field exists to surface.
    logBudgetAllocation(fields({ crossChannelMessagesIncluded: undefined }));
    const [summary] = infoSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(summary).toHaveProperty('crossChannelMessagesIncluded');
    expect(summary.crossChannelMessagesIncluded).toBeUndefined();

    infoSpy.mockClear();
    logBudgetAllocation(fields({ crossChannelMessagesIncluded: 0 }));
    const [zeroSummary] = infoSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(zeroSummary.crossChannelMessagesIncluded).toBe(0);
  });
});
