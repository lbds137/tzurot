/**
 * Golden-value regression suite for the sha256Hex migration (TASK-676).
 *
 * Every value below was computed against the PRE-migration call shapes
 * (`createHash('sha256').update(...).digest('hex')`, sliced/encoded exactly
 * as each site did) for the fixed input `'tzurot-golden-input'`. Pinning
 * them here proves the migrated `sha256Hex` call at every site reproduces
 * byte-identical output to the code it replaced.
 */

import { describe, it, expect, vi } from 'vitest';
import { v5 as uuidv5 } from 'uuid';
import { sha256Hex } from './sha256Hex.js';
import {
  DNS_NAMESPACE,
  generateMemoryChunkGroupUuid,
  generatePendingMemoryUuid,
  generateMemoryFactUuid,
} from './deterministicUuid.js';
import { normalizeSlugForUser } from './slugUtils.js';

vi.mock('./ownerMiddleware.js', () => ({
  isBotOwner: vi.fn().mockReturnValue(true),
}));

const GOLDEN_INPUT = 'tzurot-golden-input';
const FULL = '81a9e0f66dc8e9668e3edb518e836c0a1ec6470bfbcd6c5f55f5b0c6c470c746';
const LEN_32 = '81a9e0f66dc8e9668e3edb518e836c0a';
const LEN_16 = '81a9e0f66dc8e966';
const LEN_12 = '81a9e0f66dc8';
const LEN_6 = '81a9e0';

interface GoldenCase {
  site: string;
  opts?: { length?: number; encoding?: BufferEncoding };
  expected: string;
}

/** One row per migrated call site (TASK-676's 20-site enumeration). */
const CASES: GoldenCase[] = [
  { site: 'common-types/attachmentCacheKey.ts:43', expected: FULL },
  { site: 'common-types/characterCardChecksum.ts:97', expected: FULL },
  { site: 'common-types/feedbackNormalization.ts:23', expected: FULL },
  { site: 'tooling/db/check-migration-drift.ts:74', expected: FULL },
  { site: 'tooling/db/fix-migration-drift.ts:74', expected: FULL },
  { site: 'ai-worker/archiveSummaryFeedback.ts:14', expected: FULL },
  { site: 'bot-client/ErrorChannelReporter.ts:227', expected: FULL },
  { site: 'bot-client/commandRegistrationGate.ts:42', expected: FULL },
  { site: 'tooling/db/create-safe-migration.ts:227', opts: { encoding: 'utf-8' }, expected: FULL },
  { site: 'common-types/constants/memory.ts:25', opts: { length: 32 }, expected: LEN_32 },
  { site: 'common-types/deterministicUuid.ts:287', opts: { length: 32 }, expected: LEN_32 },
  { site: 'common-types/deterministicUuid.ts:352', opts: { length: 32 }, expected: LEN_32 },
  { site: 'common-types/deterministicUuid.ts:368', opts: { length: 32 }, expected: LEN_32 },
  { site: 'embeddings/LocalEmbeddingService.ts:320', opts: { length: 16 }, expected: LEN_16 },
  { site: 'ai-worker/duplicateDetection.ts:278', opts: { length: 16 }, expected: LEN_16 },
  { site: 'api-gateway/RedisDeduplicationCache.ts:251', opts: { length: 16 }, expected: LEN_16 },
  { site: 'tooling/audits/baseline-meta.ts:123', opts: { length: 12 }, expected: LEN_12 },
  { site: 'common-types/logContentPreview.ts:63', opts: { length: 12 }, expected: LEN_12 },
  { site: 'common-types/slugUtils.ts:51', opts: { length: 6 }, expected: LEN_6 },
  {
    site: 'ai-worker/cacheObservability.ts:39',
    opts: { length: 12, encoding: 'utf8' },
    expected: LEN_12,
  },
];

describe('sha256Hex golden values — per-migrated-site call shapes', () => {
  it.each(CASES)('$site', ({ opts, expected }) => {
    expect(sha256Hex(GOLDEN_INPUT, opts)).toBe(expected);
  });

  it('utf8 and utf-8 encodings both reproduce the full digest (ASCII input)', () => {
    expect(sha256Hex(GOLDEN_INPUT, { encoding: 'utf8' })).toBe(FULL);
    expect(sha256Hex(GOLDEN_INPUT, { encoding: 'utf-8' })).toBe(FULL);
  });

  it('utf8-encoded length:12 reproduces the same 12-char prefix as the default', () => {
    expect(sha256Hex(GOLDEN_INPUT, { length: 12, encoding: 'utf8' })).toBe(LEN_12);
    expect(sha256Hex(GOLDEN_INPUT, { length: 12 })).toBe(LEN_12);
  });
});

describe('deterministicUuid content-hash call-through (golden)', () => {
  // Each of these functions truncates a SHA-256 digest to 32 hex chars and
  // folds it into a uuidv5 seed. The expected value is built from the SAME
  // formula with the golden 32-char hash as a hard-coded literal — NOT by
  // calling sha256Hex — so this test independently confirms the migrated
  // function still embeds the identical hash the pre-migration code did.
  it('generateMemoryChunkGroupUuid embeds the pinned 32-char hash', () => {
    const expected = uuidv5(`memory_chunk_group:persona-1:personality-1:${LEN_32}`, DNS_NAMESPACE);
    expect(generateMemoryChunkGroupUuid('persona-1', 'personality-1', GOLDEN_INPUT)).toBe(expected);
  });

  it('generatePendingMemoryUuid embeds the pinned 32-char hash', () => {
    const expected = uuidv5(`pending_memory:persona-1:personality-1:${LEN_32}`, DNS_NAMESPACE);
    expect(generatePendingMemoryUuid('persona-1', 'personality-1', GOLDEN_INPUT)).toBe(expected);
  });

  it('generateMemoryFactUuid embeds the pinned 32-char hash', () => {
    const expected = uuidv5(`memory_fact:personality-1:persona-1:${LEN_32}`, DNS_NAMESPACE);
    expect(generateMemoryFactUuid('personality-1', 'persona-1', GOLDEN_INPUT)).toBe(expected);
  });
});

describe('slugUtils tail-hash call-through (golden)', () => {
  it('the truncated-tail hash matches the pinned 6-char prefix', () => {
    // Bot-owner path (mocked true above) => fitSlugToMaxLength(slug, '', 50).
    // baseBudget = 50 - 0 - (SLUG_TAIL_HASH_LENGTH + 1) = 43, so a 43-char
    // kept prefix followed by exactly GOLDEN_INPUT as the removed tail
    // isolates the tail-hash formula: base.slice(43) === GOLDEN_INPUT.
    const kept = 'a'.repeat(43);
    const base = kept + GOLDEN_INPUT;
    const result = normalizeSlugForUser(base, 'owner-id', 'irrelevant-for-owner');
    expect(result).toBe(`${kept}-${LEN_6}`);
  });
});
