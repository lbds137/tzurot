/**
 * Tests for the retention route manifest split out of internal.ts.
 *
 * These assert the file's own stated invariants — the audience/serviceOnly
 * shape (mirroring internal.test.ts's structural checks, scoped to just this
 * file's entries), the merge into `internalRoutes`, and the leased routes'
 * schema-level `runId` requirement. Broader cross-manifest invariants (no
 * duplicate ids, no duplicate method+path, params match path placeholders,
 * etc.) are already covered by internal.test.ts iterating the merged
 * `internalRoutes`, since `internalRetentionRoutes` is spread into it.
 */

import { describe, it, expect } from 'vitest';
import { internalRetentionRoutes } from './internalRetention.js';
import { internalRoutes } from './internal.js';

const entries = Object.entries(internalRetentionRoutes);

// Verified against z.string().uuid() at write time (Zod's UUID check accepts
// any RFC 4122 version, including this v4-shaped literal).
const VALID_UUID = '8f14e45f-ceea-4e7a-9b1c-2a6f1d3e4b5c';

describe('internalRetentionRoutes', () => {
  it('every entry has audience "internal" and serviceOnly true', () => {
    for (const [key, route] of entries) {
      expect(route.audience, `${key} audience`).toBe('internal');
      expect(route.serviceOnly, `${key} serviceOnly`).toBe(true);
    }
  });

  it('every key is merged into internalRoutes as the SAME object', () => {
    for (const [key, route] of entries) {
      expect(internalRoutes, `${key} present in internalRoutes`).toHaveProperty(key);
      expect((internalRoutes as Record<string, unknown>)[key], `${key} merged by reference`).toBe(
        route
      );
    }
  });

  it("every entry's id matches its object key", () => {
    for (const [key, route] of entries) {
      expect(route.id, `${key} id`).toBe(key);
    }
  });

  describe('retentionPurge — runId required at the schema level', () => {
    it('rejects a body with no runId', () => {
      const result = internalRetentionRoutes.retentionPurge.input.safeParse({
        discordId: '123456789012345678',
      });
      expect(result.success).toBe(false);
    });

    it('accepts a body once a valid uuid runId is added', () => {
      const result = internalRetentionRoutes.retentionPurge.input.safeParse({
        discordId: '123456789012345678',
        runId: VALID_UUID,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('retentionNotify — runId required on a non-dry-run', () => {
    it('rejects an empty body (no dryRun, no runId)', () => {
      const result = internalRetentionRoutes.retentionNotify.input.safeParse({});
      expect(result.success).toBe(false);
    });

    it('accepts a dry run with no runId', () => {
      const result = internalRetentionRoutes.retentionNotify.input.safeParse({
        dryRun: true,
      });
      expect(result.success).toBe(true);
    });

    it('accepts a non-dry-run body carrying a valid uuid runId', () => {
      const result = internalRetentionRoutes.retentionNotify.input.safeParse({
        runId: VALID_UUID,
      });
      expect(result.success).toBe(true);
    });
  });

  it('retentionRunBegin is a POST to /retention/run/begin', () => {
    expect(internalRetentionRoutes.retentionRunBegin.method).toBe('post');
    expect(internalRetentionRoutes.retentionRunBegin.path).toBe('/retention/run/begin');
  });

  it('retentionRunEnd is a POST to /retention/run/end', () => {
    expect(internalRetentionRoutes.retentionRunEnd.method).toBe('post');
    expect(internalRetentionRoutes.retentionRunEnd.path).toBe('/retention/run/end');
  });
});
