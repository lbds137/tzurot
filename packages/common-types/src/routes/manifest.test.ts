/**
 * Tests for the central route manifest registry.
 *
 * Per-audience invariants live in the audience-scoped test files
 * (internal.test.ts, admin.test.ts, user/index.test.ts). This file
 * asserts cross-audience invariants — disjointness, audience-feature
 * exclusivity, and global uniqueness.
 */

import { describe, it, expect } from 'vitest';
import { ROUTE_MANIFEST, adminRoutes, internalRoutes, userRoutes } from './manifest.js';
import type { AnyRouteDef } from './types.js';

const entries = Object.entries(ROUTE_MANIFEST) as [string, AnyRouteDef][];

/**
 * Route IDs asserting "this op is fast, the 2500ms transport default is fine"
 * (single-row CRUD, toggles, single lookups). Slow / external / bulk /
 * aggregate routes must NOT be listed — they declare an explicit `timeoutMs`
 * (DEFERRED/BULK), else they silently fall back to 2500ms and false-timeout.
 */
const DEFAULT_TIMEOUT_OK = new Set<string>([
  // ---- internal (service-to-service single lookups / job introspection) ----
  'aiTranscribe',
  'aiJobStatus',
  'recentUsers',
  // ---- admin (single-row CRUD / toggles / singleton reads) ----
  'invalidateCache',
  'createGlobalPersonality',
  'updateGlobalPersonality',
  'addDenylistEntry',
  'listDenylistEntries',
  'removeDenylistEntry',
  'createGlobalLlmConfig',
  'setGlobalLlmConfigDefault',
  'setGlobalLlmConfigFreeDefault',
  'deleteGlobalLlmConfig',
  'listGlobalTtsConfigs',
  'getGlobalTtsConfig',
  'createGlobalTtsConfig',
  'updateGlobalTtsConfig',
  'setGlobalTtsConfigDefault',
  'setGlobalTtsConfigFreeDefault',
  'deleteGlobalTtsConfig',
  'getAdminSettings',
  'updateAdminSettings',
  'clearAdminSettings',
  'getStopSequencesStats',
  'getAdminUsageStats',
  // ---- user: TTS config / STT default (single-row CRUD by indexed key) ----
  'getUserTtsConfig',
  'createUserTtsConfig',
  'updateUserTtsConfig',
  'deleteUserTtsConfig',
  'getTtsDefaultConfig',
  'getSttDefaultProvider',
  // ---- user: personality CRUD (single-row by slug) ----
  'createPersonality',
  'updatePersonality',
  'setPersonalityVisibility',
  'deletePersonality',
  // ---- user: channel activation + per-channel overrides (single-row) ----
  'activateChannel',
  'deactivateChannel',
  'listUserChannels',
  'getUserChannel',
  'updateChannelGuild',
  'getChannelConfigOverrides',
  'updateChannelConfigOverrides',
  'clearChannelConfigOverrides',
  // ---- user: usage + history (single-key reads / scoped deletes) ----
  'getUserUsage',
  'clearHistory',
  'undoHistory',
  'getHistoryStats',
  'hardDeleteHistory',
  // ---- user: NSFW verification (single-row toggle/read) ----
  'getNsfwStatus',
  'verifyNsfw',
  // ---- user: memory CRUD + batch (single-row ops + token-gated batches) ----
  'getStats',
  'list',
  'getFocus',
  'setFocus',
  'search',
  'batchDeletePreview',
  'batchDelete',
  'issuePurgeToken',
  'purge',
  'getMemory',
  'updateMemory',
  'deleteMemory',
  'setMemoryLock',
  'getIncognitoStatus',
  'enableIncognito',
  'disableIncognito',
  'incognitoForget',
  // ---- user: single-tier config-override clear ----
  'clearPersonalityOverrides',
  // ---- user: diagnostic lookups (single-row by indexed key) ----
  'getRecentDiagnostics',
  'getDiagnosticByMessage',
  'getDiagnosticByResponse',
  'getDiagnosticByRequestId',
]);

describe('central route manifest', () => {
  it('has at least one entry from each audience', () => {
    expect(Object.keys(internalRoutes).length).toBeGreaterThan(0);
    expect(Object.keys(adminRoutes).length).toBeGreaterThan(0);
    expect(Object.keys(userRoutes).length).toBeGreaterThan(0);
  });

  it('contains every entry from every audience manifest', () => {
    const expectedSize =
      Object.keys(internalRoutes).length +
      Object.keys(adminRoutes).length +
      Object.keys(userRoutes).length;
    expect(entries.length).toBe(expectedSize);
  });

  it('no duplicate route IDs across audiences', () => {
    const ids = entries.map(([, r]) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no duplicate (audience, method, path) tuples', () => {
    const tuples = entries.map(([, r]) => `${r.audience} ${r.method} ${r.path}`);
    expect(new Set(tuples).size).toBe(tuples.length);
  });

  it('serviceOnly only appears on internal audience', () => {
    for (const [key, route] of entries) {
      if (route.serviceOnly === true) {
        expect(route.audience, `${key} audience for serviceOnly`).toBe('internal');
      }
    }
  });

  it('requiresProvisionedUser only appears on user audience', () => {
    for (const [key, route] of entries) {
      if (route.requiresProvisionedUser === true) {
        expect(route.audience, `${key} audience for requiresProvisionedUser`).toBe('user');
      }
    }
  });

  it('acceptsSubject only appears on admin or user audiences', () => {
    for (const [key, route] of entries) {
      if (route.acceptsSubject === true) {
        expect(['admin', 'user'], `${key} audience for acceptsSubject`).toContain(route.audience);
      }
    }
  });

  it('object keys match route.id for every entry (no merge-key drift)', () => {
    for (const [key, route] of entries) {
      expect(route.id, `${key} id mismatch`).toBe(key);
    }
  });

  it('audience values are one of the three known audiences', () => {
    const allowed = new Set(['internal', 'admin', 'user']);
    for (const [key, route] of entries) {
      expect(allowed.has(route.audience), `${key} audience "${route.audience}"`).toBe(true);
    }
  });

  it('every entry has a path that starts with "/"', () => {
    for (const [key, route] of entries) {
      expect(route.path.startsWith('/'), `${key} path "${route.path}"`).toBe(true);
    }
  });

  it('acceptsSubject routes do not also declare userId in their query schema', () => {
    // The `acceptsSubject: true` flag tells the codegen to emit a
    // `['userId', options.subject]` entry into the query-string builder.
    // If the same route's `query` ALSO declares a `userId` key, the
    // codegen would emit two `['userId', ...]` entries — and
    // URLSearchParams.set() silently keeps only the last, so the
    // typed-subject brand can be silently overwritten by a raw-string
    // userId. The whole point of `acceptsSubject` + branded types is to
    // prevent exactly this class of silent failure.
    for (const [key, route] of entries) {
      if (route.acceptsSubject === true && route.query !== undefined) {
        expect(
          'userId' in route.query,
          `${key} declares acceptsSubject AND query.userId — would generate ` +
            `duplicate URLSearchParams entries; drop the userId query key`
        ).toBe(false);
      }
    }
  });

  it('timeoutMs values are integers in [1000, 60_000]', () => {
    // Bounds:
    //   - lower 1000ms: catches the "typed seconds instead of ms"
    //     mistake (`timeoutMs: 30` → meant 30s, got 30ms)
    //   - upper 60_000ms (1 min): catches the inverse mistake AND
    //     the "this should really be async/streaming" anti-pattern;
    //     largest named constant is GATEWAY_TIMEOUTS.BULK_OPERATION
    //     = 30s, so 60s is 2x headroom for one-off future cases
    //   - Number.isInteger: rejects NaN, decimals, Infinity
    // A route that genuinely needs >60s should be a BullMQ job, not
    // a sync gateway request.
    for (const [key, route] of entries) {
      if (route.timeoutMs !== undefined) {
        expect(Number.isInteger(route.timeoutMs), `${key} timeoutMs integer`).toBe(true);
        expect(route.timeoutMs, `${key} timeoutMs >= 1000`).toBeGreaterThanOrEqual(1000);
        expect(route.timeoutMs, `${key} timeoutMs <= 60_000`).toBeLessThanOrEqual(60_000);
      }
    }
  });

  it('every route either declares timeoutMs or is registered as default-timeout-OK', () => {
    // Forcing function against the "silent 2500ms regression" class: the
    // typed-client transport defaults `timeoutMs` to GATEWAY_TIMEOUTS.AUTOCOMPLETE
    // (2500ms). A migrated route that legitimately needs more (external
    // round-trips, multi-tier cascade, bulk work) but forgets an explicit
    // `timeoutMs` silently falls back to 2500ms and reports false
    // "Request timeout (HTTP 0)" failures on operations that actually
    // completed server-side. This test makes the fall-back a CONSCIOUS
    // decision: a route with no explicit timeoutMs must be registered in
    // DEFAULT_TIMEOUT_OK above (asserting "this op is fast, 2500ms is fine").
    for (const [key, route] of entries) {
      const ok = route.timeoutMs !== undefined || DEFAULT_TIMEOUT_OK.has(key);
      expect(
        ok,
        `${key} has neither an explicit timeoutMs nor an entry in DEFAULT_TIMEOUT_OK. ` +
          `If this op is slow / external / bulk / multi-tier, add a timeoutMs ` +
          `(e.g. GATEWAY_TIMEOUTS.DEFERRED). If it is genuinely fast (single-row ` +
          `CRUD by indexed key, toggle, single lookup, simple insert), register ` +
          `its id in DEFAULT_TIMEOUT_OK. Do NOT leave it to silently fall back ` +
          `to the 2500ms transport default.`
      ).toBe(true);
    }
  });

  it('DEFAULT_TIMEOUT_OK contains no stale entries (every id exists and lacks timeoutMs)', () => {
    // Guard the inverse drift: an id removed from the manifest, or one that
    // later gained an explicit timeoutMs, should not linger in the allowlist.
    const manifestIds = new Set(entries.map(([key]) => key));
    for (const id of DEFAULT_TIMEOUT_OK) {
      expect(
        manifestIds.has(id),
        `DEFAULT_TIMEOUT_OK lists "${id}" but it is not in the manifest`
      ).toBe(true);
      const route = ROUTE_MANIFEST[id as keyof typeof ROUTE_MANIFEST] as AnyRouteDef | undefined;
      expect(
        route?.timeoutMs,
        `DEFAULT_TIMEOUT_OK lists "${id}" but it now declares an explicit timeoutMs — drop it from the allowlist`
      ).toBeUndefined();
    }
  });

  it('GET routes do not declare an input body schema', () => {
    // GET-with-body is broken in the field — Node's fetch (and many
    // intermediaries) drop the body, so a manifest entry like
    // `{ method: 'get', input: SomeSchema }` would generate a client
    // method that silently loses its body on the wire. DELETE-with-body
    // is allowed by HTTP and used here for bulk-delete patterns
    // (e.g., deactivateChannel takes a `channelId` body), so it's not
    // restricted by this invariant.
    for (const [key, route] of entries) {
      if (route.method === 'get') {
        expect(route.input, `${key} (GET) should not declare input`).toBeUndefined();
      }
    }
  });

  // ==========================================================================
  // Meta-tag consistency invariants
  //
  // `meta` is opt-in metadata that the codegen turns into JSDoc `@safeRead` /
  // `@idempotent` / `@softDeleteAware` tags on generated client methods.
  // Consumer code (cache layers, retry policies) can read these tags. The
  // invariants below catch common mis-tagging:
  //   - GET routes are semantically read-only → should be safeRead.
  //   - PUT routes are idempotent by HTTP convention → should be idempotent.
  //   - safeRead and idempotent are mutually exclusive on the same route
  //     (a route that mutates idempotently is not a safe read).
  // ==========================================================================

  it('GET routes declare meta.safeRead: true', () => {
    for (const [key, route] of entries) {
      if (route.method === 'get') {
        expect(
          route.meta?.safeRead,
          `${key} (GET) should declare meta.safeRead: true — GETs are semantically read-only`
        ).toBe(true);
      }
    }
  });

  it('PUT routes declare meta.idempotent: true', () => {
    for (const [key, route] of entries) {
      if (route.method === 'put') {
        expect(
          route.meta?.idempotent,
          `${key} (PUT) should declare meta.idempotent: true — PUT is idempotent by HTTP convention`
        ).toBe(true);
      }
    }
  });

  it('meta.safeRead and meta.idempotent are not both true on the same route', () => {
    // A safeRead route doesn't mutate; an idempotent route does mutate but
    // safely on retry. The two states are mutually exclusive — a route that
    // claims both has a mistagging. (Idempotent reads exist trivially but
    // we model those via safeRead alone; "idempotent" here means "idempotent
    // write".)
    for (const [key, route] of entries) {
      const safe = route.meta?.safeRead === true;
      const idem = route.meta?.idempotent === true;
      expect(
        safe && idem,
        `${key} declares both meta.safeRead AND meta.idempotent — pick one`
      ).toBe(false);
    }
  });

  it('meta.safeRead and meta.atMostOnce are not both true on the same route', () => {
    // safeRead = no mutation; atMostOnce = mutation with single-use guard.
    // A route that claims both has a mistagging.
    for (const [key, route] of entries) {
      const safe = route.meta?.safeRead === true;
      const atMost = route.meta?.atMostOnce === true;
      expect(
        safe && atMost,
        `${key} declares both meta.safeRead AND meta.atMostOnce — atMostOnce implies mutation, safeRead implies none`
      ).toBe(false);
    }
  });

  it('meta.idempotent and meta.atMostOnce are not both true on the same route', () => {
    // Literal opposites: idempotent = retry-safe; atMostOnce = retry produces
    // a spurious 4xx that masks server-side success. A route can be one or
    // the other (or neither — most mutating POSTs are neither), never both.
    for (const [key, route] of entries) {
      const idem = route.meta?.idempotent === true;
      const atMost = route.meta?.atMostOnce === true;
      expect(
        idem && atMost,
        `${key} declares both meta.idempotent AND meta.atMostOnce — these are literal opposites`
      ).toBe(false);
    }
  });
});
