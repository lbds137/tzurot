import { describe, it, expect } from 'vitest';
import { Prisma } from '@tzurot/common-types/services/prisma';
import {
  buildWhereConditions,
  buildHybridSearchQuery,
  buildFtsQueryText,
  parseQueryOptions,
  RRF_K,
  RRF_WEIGHTS,
  MIN_CANDIDATE_POOL,
} from './PgvectorQueryBuilder.js';
import { AI_DEFAULTS } from '@tzurot/common-types/constants/ai';

const hybridOptions = (
  overrides: Record<string, unknown> = {}
): Parameters<typeof buildHybridSearchQuery>[0] => ({
  embeddingVector: '[0.1,0.2,0.3]',
  rawQueryText: 'what was that thing',
  whereConditions: [Prisma.sql`m.persona_id = ${'persona-123'}::uuid`],
  maxDistance: 0.5,
  limit: 10,
  candidateLimit: 50,
  ...overrides,
});

describe('PgvectorQueryBuilder', () => {
  describe('buildWhereConditions', () => {
    it('always includes persona_id and visibility conditions', () => {
      const conditions = buildWhereConditions({ personaId: 'persona-123' });

      expect(conditions.length).toBe(2);
      expect(conditions[0].strings[0]).toContain('persona_id');
      // Soft-deleted/hidden/archived memories must never reach RAG retrieval.
      expect(conditions[1].strings.join('')).toContain("visibility = 'normal'");
    });

    it('adds personality_id condition when provided', () => {
      const conditions = buildWhereConditions({
        personaId: 'persona-123',
        personalityId: 'personality-456',
      });

      expect(conditions.length).toBe(3);
    });

    it('adds excludeNewerThan condition when provided', () => {
      const conditions = buildWhereConditions({
        personaId: 'persona-123',
        excludeNewerThan: 1704067200000, // 2024-01-01
      });

      expect(conditions.length).toBe(3);
    });

    it('adds excludeIds condition when provided', () => {
      const conditions = buildWhereConditions({
        personaId: 'persona-123',
        excludeIds: ['id1', 'id2'],
      });

      expect(conditions.length).toBe(3);
    });

    it('adds channelIds condition when provided', () => {
      const conditions = buildWhereConditions({
        personaId: 'persona-123',
        channelIds: ['channel-1', 'channel-2'],
      });

      expect(conditions.length).toBe(3);
    });

    it('combines all conditions', () => {
      const conditions = buildWhereConditions({
        personaId: 'persona-123',
        personalityId: 'personality-456',
        excludeNewerThan: 1704067200000,
        excludeIds: ['id1'],
        channelIds: ['channel-1'],
      });

      expect(conditions.length).toBe(6);
    });

    it('ignores invalid personalityId', () => {
      const conditions = buildWhereConditions({
        personaId: 'persona-123',
        personalityId: '',
      });

      expect(conditions.length).toBe(2);
    });

    it('ignores zero excludeNewerThan', () => {
      const conditions = buildWhereConditions({
        personaId: 'persona-123',
        excludeNewerThan: 0,
      });

      expect(conditions.length).toBe(2);
    });

    it('ignores empty excludeIds array', () => {
      const conditions = buildWhereConditions({
        personaId: 'persona-123',
        excludeIds: [],
      });

      expect(conditions.length).toBe(2);
    });

    it('ignores empty channelIds array', () => {
      const conditions = buildWhereConditions({
        personaId: 'persona-123',
        channelIds: [],
      });

      expect(conditions.length).toBe(2);
    });
  });

  describe('buildFtsQueryText', () => {
    it('joins terms with the websearch OR operator (AND semantics would let filler words veto rare-term matches)', () => {
      expect(buildFtsQueryText('spelunker stories')).toBe('spelunker OR stories');
      expect(buildFtsQueryText('  padded   query  ')).toBe('padded OR query');
      expect(buildFtsQueryText('single')).toBe('single');
    });
  });

  describe('buildHybridSearchQuery', () => {
    it('builds a valid Prisma.Sql query', () => {
      const result = buildHybridSearchQuery(hybridOptions());

      expect(result).toHaveProperty('strings');
      expect(result).toHaveProperty('values');
    });

    it('contains all three arms and the RRF fusion CTE', () => {
      const sqlString = buildHybridSearchQuery(hybridOptions()).strings.join('');

      expect(sqlString).toContain('WITH');
      expect(sqlString).toContain('dense AS');
      expect(sqlString).toContain('fts AS');
      expect(sqlString).toContain('recency AS');
      expect(sqlString).toContain('fused AS');
      expect(sqlString).toContain('FULL OUTER JOIN');
      expect(sqlString).toContain('rrf_score');
    });

    it('gates ONLY the dense arm with the distance threshold', () => {
      const sqlString = buildHybridSearchQuery(hybridOptions()).strings.join('');

      // Dense arm: distance ceiling present alongside the vector comparison.
      expect(sqlString).toContain('m.embedding <=>');
      expect(sqlString).toContain('::vector');
      // FTS arm: match predicate present, with no distance/similarity gate.
      const ftsArm = sqlString.slice(
        sqlString.indexOf('fts AS'),
        sqlString.indexOf('candidates AS')
      );
      expect(ftsArm).toContain('websearch_to_tsquery');
      expect(ftsArm).toContain('@@');
      expect(ftsArm).not.toContain('<=>');
    });

    it('passes the OR-ified query text and fusion constants as parameters', () => {
      const result = buildHybridSearchQuery(hybridOptions({ rawQueryText: 'velvet hammer' }));

      expect(result.values).toContain('velvet OR hammer');
      expect(result.values).toContain(RRF_K);
      expect(result.values).toContain(RRF_WEIGHTS.recency);
    });

    it('selects the explain components and joins the display tables', () => {
      const sqlString = buildHybridSearchQuery(hybridOptions()).strings.join('');

      expect(sqlString).toContain('dense_rank');
      expect(sqlString).toContain('fts_rank');
      expect(sqlString).toContain('recency_rank');
      expect(sqlString).toContain('JOIN personas');
      expect(sqlString).toContain('JOIN users');
      expect(sqlString).toContain('JOIN personalities');
      expect(sqlString).toContain('ORDER BY fused.rrf_score DESC');
      expect(sqlString).toContain('LIMIT');
    });

    it('joins multiple WHERE conditions with AND', () => {
      const result = buildHybridSearchQuery(
        hybridOptions({
          whereConditions: [
            Prisma.sql`m.persona_id = ${'persona-123'}::uuid`,
            Prisma.sql`m.personality_id = ${'personality-456'}::uuid`,
          ],
        })
      );

      const sqlString = result.strings.join('');
      expect(sqlString).toContain('WHERE');
      expect(sqlString).toContain('AND');
    });
  });

  describe('parseQueryOptions', () => {
    it('returns defaults when no options provided', () => {
      const result = parseQueryOptions({ personaId: 'persona-123' });

      expect(result.limit).toBe(10);
      expect(result.minSimilarity).toBe(AI_DEFAULTS.MEMORY_SCORE_THRESHOLD);
      expect(result.maxDistance).toBeCloseTo(1 - AI_DEFAULTS.MEMORY_SCORE_THRESHOLD);
      expect(result.candidateLimit).toBe(MIN_CANDIDATE_POOL);
    });

    it('scales the candidate pool with limit above the floor', () => {
      const result = parseQueryOptions({ personaId: 'persona-123', limit: 20 });

      expect(result.candidateLimit).toBe(100);
    });

    it('uses provided limit', () => {
      const result = parseQueryOptions({ personaId: 'persona-123', limit: 25 });

      expect(result.limit).toBe(25);
    });

    it('uses provided scoreThreshold', () => {
      const result = parseQueryOptions({ personaId: 'persona-123', scoreThreshold: 0.7 });

      expect(result.minSimilarity).toBe(0.7);
      expect(result.maxDistance).toBeCloseTo(0.3);
    });

    it('ignores zero limit', () => {
      const result = parseQueryOptions({ personaId: 'persona-123', limit: 0 });

      expect(result.limit).toBe(10);
    });

    it('ignores negative limit', () => {
      const result = parseQueryOptions({ personaId: 'persona-123', limit: -5 });

      expect(result.limit).toBe(10);
    });

    it('ignores zero scoreThreshold', () => {
      const result = parseQueryOptions({ personaId: 'persona-123', scoreThreshold: 0 });

      expect(result.minSimilarity).toBe(AI_DEFAULTS.MEMORY_SCORE_THRESHOLD);
    });

    it('ignores null values', () => {
      const result = parseQueryOptions({
        personaId: 'persona-123',
        limit: null as unknown as number,
        scoreThreshold: null as unknown as number,
      });

      expect(result.limit).toBe(10);
      expect(result.minSimilarity).toBe(AI_DEFAULTS.MEMORY_SCORE_THRESHOLD);
    });
  });
});
