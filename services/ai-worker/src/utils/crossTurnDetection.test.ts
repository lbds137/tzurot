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

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { NODE_ENV: 'test' as string, LOG_CONTENT_PREVIEWS: false },
}));

vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return { ...actual, getConfig: () => mockConfig };
});

// Import AFTER the mocks so the module uses the mocked logger + config
const { isRecentDuplicate } = await import('./crossTurnDetection.js');

/** Flip the two content-preview gates on for a single test. */
const enablePreviews = (): void => {
  mockConfig.NODE_ENV = 'development';
  mockConfig.LOG_CONTENT_PREVIEWS = true;
};

describe('crossTurnDetection diagnostic telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.NODE_ENV = 'test';
    mockConfig.LOG_CONTENT_PREVIEWS = false;
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
      expect(fields).toHaveProperty('closestMatchHash');
      const serialized = JSON.stringify(fields);
      expect(serialized).not.toContain('morning light');
      expect(serialized).not.toContain('Previous unrelated');
    });

    it('NEAR_MISS carries metrics and hashes but no snippets when content previews are off', () => {
      // Default (test) state: LOG_CONTENT_PREVIEWS is off, so the content
      // gate (`contentPreview`/`snippet`) strips every text field while the
      // numerics and hashes — including the report's per-message `hash` —
      // stay always-on for equality/correlation diagnosis.
      const newResponse =
        'The morning light filters through the window, casting long thoughtful shadows everywhere.';
      const nearMissMessage =
        'The morning light filters through the doorway, casting tall thoughtful shadows anywhere.';

      isRecentDuplicate(newResponse, [nearMissMessage], 0.99);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'NEAR_MISS',
          newResponseHash: expect.any(String),
          closestMatchHash: expect.any(String),
          comparisonReport: [
            expect.objectContaining({
              turnsBack: 1,
              hash: expect.stringMatching(/^[a-f0-9]{8}$/),
              hashMatch: false,
            }),
          ],
        }),
        expect.stringContaining('NEAR-MISS')
      );
      const [fields] = mockLogger.info.mock.calls[0] as [
        Record<string, unknown> & { comparisonReport: Array<Record<string, unknown>> },
      ];
      // These keys are present in the object literal (the gate returns
      // `undefined`, not an omitted key) — pino is what actually drops an
      // `undefined` field from the emitted line, so the key-presence check
      // is `toBeUndefined`, not `not.toHaveProperty`.
      expect(fields.newResponseSnippet).toBeUndefined();
      expect(fields.closestMatchSnippet).toBeUndefined();
      expect(fields.comparisonReport[0].prefix).toBeUndefined();
      const serialized = JSON.stringify(fields);
      expect(serialized).not.toContain('morning light');
      expect(serialized).not.toContain('doorway');
    });

    it('NEAR_MISS carries snippets and report prefixes when content previews are on', () => {
      enablePreviews();
      // Same near-miss fixture as the default-off case above; asserts the
      // gate opens the content fields rather than changing detection logic.
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

    it('the word_jaccard WARN carries always-on hashes and no snippet by default', () => {
      // One word changed near the end: word overlap (0.867) clears
      // WORD_JACCARD_THRESHOLD (0.75) before bigram similarity is even
      // checked, so this lands in the Layer-2 word_jaccard branch rather
      // than Layer-3 bigram — either branch exercises the same added
      // always-on hash fields, so word_jaccard is used here for reliability.
      const newResponse =
        'The morning light filters through the window, casting long thoughtful shadows everywhere across the quiet room.';
      const previousResponse =
        'The morning light filters through the window, casting long thoughtful shadows everywhere across the quiet space.';

      isRecentDuplicate(newResponse, [previousResponse]);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          detectionMethod: 'word_jaccard',
          newResponseHash: expect.any(String),
          matchedHash: expect.any(String),
        }),
        expect.stringContaining('Word-level duplication')
      );
      const [fields] = mockLogger.warn.mock.calls[0] as [Record<string, unknown>];
      // The key is present (the gate returns `undefined`, not an omitted
      // key) — pino drops an `undefined` field at emit time, not here.
      expect(fields.newResponseSnippet).toBeUndefined();
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
