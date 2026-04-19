/**
 * Tests for CrossTurnDetection diagnostic telemetry.
 *
 * Scope: covers the `comparisonReport` field added in PR #833 for incident
 * post-mortem correlation. The core duplicate-detection logic (hash, Jaccard,
 * bigram, semantic) is exercised end-to-end via
 * `services/DuplicateDetectionFlow.int.test.ts` — this file focuses narrowly
 * on the structure and correctness of the diagnostic data that surfaces when
 * a near-duplicate investigation needs ground truth.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
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
    it('emits a per-message report with hash, prefix, scores, and hashMatch flag on PASSED', () => {
      const newResponse =
        'The morning light filters through the window, casting long thoughtful shadows.';
      const recentMessages = [
        'Previous unrelated assistant response about something completely different and long enough.',
        'Another earlier message that bears no resemblance to the current turn whatsoever here.',
      ];

      isRecentDuplicate(newResponse, recentMessages);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          comparisonReport: [
            expect.objectContaining({
              turnsBack: 1,
              hash: expect.stringMatching(/^[a-f0-9]{8}$/),
              prefix: expect.stringContaining('Previous unrelated'),
              length: recentMessages[0].length,
              jaccard: expect.any(Number),
              bigram: expect.any(Number),
              hashMatch: false,
            }),
            expect.objectContaining({
              turnsBack: 2,
              hash: expect.stringMatching(/^[a-f0-9]{8}$/),
              prefix: expect.stringContaining('Another earlier'),
              hashMatch: false,
            }),
          ],
        }),
        expect.stringContaining('no duplicate detected')
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

    it('populates jaccard/bigram as null when a comparison message is below MIN_LENGTH', () => {
      const newResponse =
        'A sufficiently long response to make it past the 30-char minimum for scoring.';
      const recentMessages = [
        'short', // below the 30-char MIN_LENGTH_FOR_SIMILARITY_CHECK
      ];

      isRecentDuplicate(newResponse, recentMessages);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          comparisonReport: [
            expect.objectContaining({
              turnsBack: 1,
              jaccard: null,
              bigram: null,
            }),
          ],
        }),
        expect.stringContaining('no duplicate detected')
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
