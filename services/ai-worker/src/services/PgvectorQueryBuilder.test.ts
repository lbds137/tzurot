import { describe, it, expect } from 'vitest';
import { Prisma } from '@tzurot/common-types';
import {
  buildWhereConditions,
  buildSimilaritySearchQuery,
  parseQueryOptions,
} from './PgvectorQueryBuilder.js';

describe('PgvectorQueryBuilder', () => {
  describe('buildWhereConditions', () => {
    it('always includes persona_id condition', () => {
      const conditions = buildWhereConditions({ personaId: 'persona-123' });

      expect(conditions.length).toBe(1);
      expect(conditions[0].strings[0]).toContain('persona_id');
    });

    it('adds personality_id condition when provided', () => {
      const conditions = buildWhereConditions({
        personaId: 'persona-123',
        personalityId: 'personality-456',
      });

      expect(conditions.length).toBe(2);
    });

    it('adds excludeNewerThan condition when provided', () => {
      const conditions = buildWhereConditions({
        personaId: 'persona-123',
        excludeNewerThan: 1704067200000, // 2024-01-01
      });

      expect(conditions.length).toBe(2);
    });

    it('adds excludeIds condition when provided', () => {
      const conditions = buildWhereConditions({
        personaId: 'persona-123',
        excludeIds: ['id1', 'id2'],
      });

      expect(conditions.length).toBe(2);
    });

    it('adds channelIds condition when provided', () => {
      const conditions = buildWhereConditions({
        personaId: 'persona-123',
        channelIds: ['channel-1', 'channel-2'],
      });

      expect(conditions.length).toBe(2);
    });

    it('combines all conditions', () => {
      const conditions = buildWhereConditions({
        personaId: 'persona-123',
        personalityId: 'personality-456',
        excludeNewerThan: 1704067200000,
        excludeIds: ['id1'],
        channelIds: ['channel-1'],
      });

      expect(conditions.length).toBe(5);
    });

    it('ignores invalid personalityId', () => {
      const conditions = buildWhereConditions({
        personaId: 'persona-123',
        personalityId: '',
      });

      expect(conditions.length).toBe(1);
    });

    it('ignores zero excludeNewerThan', () => {
      const conditions = buildWhereConditions({
        personaId: 'persona-123',
        excludeNewerThan: 0,
      });

      expect(conditions.length).toBe(1);
    });

    it('ignores empty excludeIds array', () => {
      const conditions = buildWhereConditions({
        personaId: 'persona-123',
        excludeIds: [],
      });

      expect(conditions.length).toBe(1);
    });

    it('ignores empty channelIds array', () => {
      const conditions = buildWhereConditions({
        personaId: 'persona-123',
        channelIds: [],
      });

      expect(conditions.length).toBe(1);
    });
  });

  describe('buildSimilaritySearchQuery', () => {
    it('builds a valid Prisma.Sql query', () => {
      const whereConditions = [Prisma.sql`m.persona_id = ${'persona-123'}::uuid`];
      const embeddingVector = '[0.1,0.2,0.3]';

      const result = buildSimilaritySearchQuery(embeddingVector, whereConditions, 0.15, 10);

      // Verify it returns a Prisma.Sql object (has strings and values arrays)
      expect(result).toHaveProperty('strings');
      expect(result).toHaveProperty('values');
    });

    it('includes SELECT clause with expected fields', () => {
      const whereConditions = [Prisma.sql`m.persona_id = ${'persona-123'}::uuid`];
      const embeddingVector = '[0.1,0.2,0.3]';

      const result = buildSimilaritySearchQuery(embeddingVector, whereConditions, 0.15, 10);

      // Check that SQL contains expected fields
      const sqlString = result.strings.join('');
      expect(sqlString).toContain('SELECT');
      expect(sqlString).toContain('m.id');
      expect(sqlString).toContain('m.content');
      expect(sqlString).toContain('distance');
      expect(sqlString).toContain('FROM memories');
    });

    it('includes embedding vector comparison', () => {
      const whereConditions = [Prisma.sql`m.persona_id = ${'persona-123'}::uuid`];
      const embeddingVector = '[0.1,0.2,0.3]';

      const result = buildSimilaritySearchQuery(embeddingVector, whereConditions, 0.15, 10);

      const sqlString = result.strings.join('');
      expect(sqlString).toContain('m.embedding <=>');
      expect(sqlString).toContain('::vector');
    });

    it('includes JOIN clauses for persona and personality names', () => {
      const whereConditions = [Prisma.sql`m.persona_id = ${'persona-123'}::uuid`];
      const embeddingVector = '[0.1,0.2,0.3]';

      const result = buildSimilaritySearchQuery(embeddingVector, whereConditions, 0.15, 10);

      const sqlString = result.strings.join('');
      expect(sqlString).toContain('JOIN personas');
      expect(sqlString).toContain('JOIN users');
      expect(sqlString).toContain('JOIN personalities');
    });

    it('includes ORDER BY and LIMIT', () => {
      const whereConditions = [Prisma.sql`m.persona_id = ${'persona-123'}::uuid`];
      const embeddingVector = '[0.1,0.2,0.3]';

      const result = buildSimilaritySearchQuery(embeddingVector, whereConditions, 0.15, 10);

      const sqlString = result.strings.join('');
      expect(sqlString).toContain('ORDER BY distance ASC');
      expect(sqlString).toContain('LIMIT');
    });

    it('joins multiple WHERE conditions with AND', () => {
      const whereConditions = [
        Prisma.sql`m.persona_id = ${'persona-123'}::uuid`,
        Prisma.sql`m.personality_id = ${'personality-456'}::uuid`,
      ];
      const embeddingVector = '[0.1,0.2,0.3]';

      const result = buildSimilaritySearchQuery(embeddingVector, whereConditions, 0.15, 10);

      const sqlString = result.strings.join('');
      expect(sqlString).toContain('WHERE');
      expect(sqlString).toContain('AND');
    });
  });

  describe('parseQueryOptions', () => {
    it('returns defaults when no options provided', () => {
      const result = parseQueryOptions({ personaId: 'persona-123' });

      expect(result.limit).toBe(10);
      expect(result.minSimilarity).toBe(0.85);
      expect(result.maxDistance).toBeCloseTo(0.15);
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

      expect(result.minSimilarity).toBe(0.85);
    });

    it('ignores null values', () => {
      const result = parseQueryOptions({
        personaId: 'persona-123',
        limit: null as unknown as number,
        scoreThreshold: null as unknown as number,
      });

      expect(result.limit).toBe(10);
      expect(result.minSimilarity).toBe(0.85);
    });
  });
});
