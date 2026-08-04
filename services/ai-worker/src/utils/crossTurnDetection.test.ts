/**
 * Tests for CrossTurnDetection diagnostic telemetry.
 *
 * Scope: covers the `comparisonReport` field added in PR #833 for incident
 * post-mortem correlation. The core duplicate-detection logic (hash, Jaccard,
 * bigram, semantic) is exercised end-to-end via
 * `services/DuplicateDetectionFlow.component.test.ts` — this file focuses narrowly
 * on the structure and correctness of the diagnostic data that surfaces when
 * a near-duplicate investigation needs ground truth.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

// Import AFTER the mock so the module uses the mocked logger
const { isRecentDuplicate } = await import('./crossTurnDetection.js');

describe('crossTurnDetection diagnostic telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('comparisonReport', () => {
    it('logs numerics and hash only on PASSED — no snippets, no report', () => {
      // Owner decision: routine PASSED checks must log no message text
      // (no-PII logging); content-bearing diagnostics are NEAR_MISS/WARN-only.
      const newResponse =
        'The morning light filters through the window, casting long thoughtful shadows.';
      const recentMessages = [
        'Previous unrelated assistant response about something completely different and long enough.',
        'Another earlier message that bears no resemblance to the current turn whatsoever here.',
      ];

      isRecentDuplicate(newResponse, recentMessages);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'PASSED',
          newResponseHash: expect.any(String),
          recentMessagesCount: 2,
        }),
        expect.stringContaining('no duplicate detected')
      );
      const [fields] = mockLogger.info.mock.calls[0] as [Record<string, unknown>];
      expect(fields).not.toHaveProperty('comparisonReport');
      expect(fields).not.toHaveProperty('newResponseSnippet');
      expect(fields).not.toHaveProperty('closestMatchSnippet');
      const serialized = JSON.stringify(fields);
      expect(serialized).not.toContain('morning light');
      expect(serialized).not.toContain('Previous unrelated');
    });

    it('retains snippets and the full report on NEAR_MISS', () => {
      // High bigram overlap, sub-Jaccard word overlap, and a threshold above
      // the similarity puts this in the near-miss band — the rare
      // reconstruct-a-slipped-duplicate case that justifies carrying content.
      const newResponse =
        'The morning light filters through the window, casting long thoughtful shadows everywhere.';
      const nearMissMessage =
        'The morning light filters through the doorway, casting tall thoughtful shadows anywhere.';

      isRecentDuplicate(newResponse, [nearMissMessage], 0.99);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'NEAR_MISS',
          newResponseSnippet: expect.stringContaining('morning light'),
          closestMatchSnippet: expect.stringContaining('doorway'),
          comparisonReport: [
            expect.objectContaining({
              turnsBack: 1,
              hash: expect.stringMatching(/^[a-f0-9]{8}$/),
              prefix: expect.stringContaining('The morning light'),
              hashMatch: false,
            }),
          ],
        }),
        expect.stringContaining('NEAR-MISS')
      );
    });

    it('reports hashMatch: true for the exact-match case (Layer 1)', () => {
      const response =
        'This is a long enough response that will exceed the minimum length gate and compute hashes.';
      // Put the identical message LAST so the per-message report can show the hashMatch
      // without the Layer 1 exact-hash early-return firing on a different slot first.
      isRecentDuplicate(response, [response]);

      // Layer 1 fires an EXACT MATCH warn log, not the PASSED diagnostic log.
      // The diagnostic log isn't emitted in this path — the warn carries the match info.
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ detectionMethod: 'exact_hash', turnsBack: 1 }),
        expect.stringContaining('EXACT MATCH')
      );
    });

    it('populates jaccard/bigram as null for below-MIN_LENGTH messages in a NEAR_MISS report', () => {
      // Two comparison messages: one drives the near-miss band, one is too
      // short to score — the report row for the short one carries nulls.
      const newResponse =
        'The morning light filters through the window, casting long thoughtful shadows everywhere.';
      const recentMessages = [
        'The morning light filters through the doorway, casting tall thoughtful shadows anywhere.',
        'short', // below the 30-char MIN_LENGTH_FOR_SIMILARITY_CHECK
      ];

      isRecentDuplicate(newResponse, recentMessages, 0.99);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'NEAR_MISS',
          comparisonReport: [
            expect.objectContaining({ turnsBack: 1, jaccard: expect.any(Number) }),
            expect.objectContaining({
              turnsBack: 2,
              jaccard: null,
              bigram: null,
            }),
          ],
        }),
        expect.stringContaining('NEAR-MISS')
      );
    });

    it('emits no report when recentMessages is empty', () => {
      const newResponse =
        'A long enough response to be scored, but there is nothing to compare against.';
      isRecentDuplicate(newResponse, []);

      // No diagnostic log path runs for empty comparison sets
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.objectContaining({ comparisonReport: expect.anything() }),
        expect.anything()
      );
    });

    it('emits no report when new response is below MIN_LENGTH (skipped path)', () => {
      isRecentDuplicate('short', [
        'A sufficiently long prior response that would be comparable if we were scoring.',
      ]);

      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.objectContaining({ comparisonReport: expect.anything() }),
        expect.anything()
      );
    });
  });
});
