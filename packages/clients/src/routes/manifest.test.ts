/**
 * Tests for the central route manifest registry.
 *
 * Per-audience invariants live in the audience-scoped test files
 * (internal.test.ts, admin.test.ts, user/index.test.ts). This file
 * asserts cross-audience invariants — disjointness, audience-feature
 * exclusivity, and global uniqueness.
 */

import { describe, it, expect } from 'vitest';
import { GATEWAY_TIMEOUTS } from '@tzurot/common-types/constants/discord';
import { ROUTE_MANIFEST, adminRoutes, internalRoutes, userRoutes } from './manifest.js';
import type { AnyRouteDef } from './types.js';

const entries = Object.entries(ROUTE_MANIFEST) as [string, AnyRouteDef][];

/**
 * Route IDs that deliberately use the tight AUTOCOMPLETE budget (2.5s).
 *
 * The transport read default is DEFERRED (10s) — safe for the common case where
 * a call is invoked post-defer. The AUTOCOMPLETE budget is the DANGEROUS tier:
 * it aborts a call that legitimately takes >2.5s under load (the class behind
 * the /inspect diagnostic timeout). A route may only opt into it by being
 * registered here, asserting "this call MUST fail fast at 2.5s."
 *
 * Currently only `resolveUserLlmConfig` — a fail-fast hot-path call that runs
 * BEFORE deferReply and must degrade (fall back to personality defaults) rather
 * than stall the message pipeline.
 *
 * Note: routes invoked from Discord autocomplete do NOT belong here despite the
 * tier's name. Discord bounds the autocomplete side at 3s client-side regardless
 * of the gateway budget, so they correctly sit on DEFERRED (and are typically
 * dual-called from deferred browse anyway).
 */
const AUTOCOMPLETE_TIER = new Set<string>(['resolveUserLlmConfig']);

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

  it('routes declaring externalCallBudgetMs give the client enough timeout to outwait it', () => {
    // The cross-layer timeout invariant. A route whose handler makes a synchronous
    // external-provider call (key validation, voice-provider list, shapes fetch)
    // declares that call's internal budget via externalCallBudgetMs. The CLIENT
    // timeout must exceed it by an overhead margin (auth + provisioning + DB +
    // network beyond the external call) — else the client aborts while the gateway
    // is still succeeding and the user sees a spurious failure. The canonical case:
    // a 30s provider validation probe behind a 10s client timeout.
    const OVERHEAD_MS = 3000;
    for (const [key, route] of entries) {
      if (route.externalCallBudgetMs === undefined) {
        continue;
      }
      expect(
        route.timeoutMs,
        `${key} declares externalCallBudgetMs but no timeoutMs`
      ).toBeDefined();
      expect(
        route.timeoutMs,
        `${key} timeoutMs (${String(route.timeoutMs)}) must be >= externalCallBudgetMs ` +
          `(${route.externalCallBudgetMs}) + ${OVERHEAD_MS}ms overhead so the client outwaits ` +
          `the handler's external call instead of aborting mid-success`
      ).toBeGreaterThanOrEqual(route.externalCallBudgetMs + OVERHEAD_MS);
    }
  });

  it('only AUTOCOMPLETE_TIER routes use the tight AUTOCOMPLETE budget', () => {
    // The read default is DEFERRED (10s, safe). The AUTOCOMPLETE budget (2.5s) is
    // the dangerous tier — it aborts a read that takes >2.5s under load (the
    // class behind the /inspect prod timeout). A route may only opt into it by
    // being registered in AUTOCOMPLETE_TIER above. Forgetting `timeoutMs` lands
    // on the safe DEFERRED default; declaring AUTOCOMPLETE without registering
    // fails here.
    for (const [key, route] of entries) {
      if (route.timeoutMs === GATEWAY_TIMEOUTS.AUTOCOMPLETE) {
        expect(
          AUTOCOMPLETE_TIER.has(key),
          `${key} declares timeoutMs: GATEWAY_TIMEOUTS.AUTOCOMPLETE (2.5s) but is not in ` +
            `AUTOCOMPLETE_TIER. The tight autocomplete budget aborts slow-but-fine reads — ` +
            `use GATEWAY_TIMEOUTS.DEFERRED unless this route is autocomplete-ONLY and a ` +
            `slower response is useless.`
        ).toBe(true);
      }
    }
  });

  it('AUTOCOMPLETE_TIER contains no stale entries (every id exists and declares AUTOCOMPLETE)', () => {
    const manifestIds = new Set(entries.map(([key]) => key));
    for (const id of AUTOCOMPLETE_TIER) {
      expect(
        manifestIds.has(id),
        `AUTOCOMPLETE_TIER lists "${id}" but it is not in the manifest`
      ).toBe(true);
      const route = ROUTE_MANIFEST[id as keyof typeof ROUTE_MANIFEST] as AnyRouteDef | undefined;
      expect(
        route?.timeoutMs,
        `AUTOCOMPLETE_TIER lists "${id}" but it does not declare timeoutMs: AUTOCOMPLETE`
      ).toBe(GATEWAY_TIMEOUTS.AUTOCOMPLETE);
    }
  });

  it('mutation routes allow at least the WRITE budget (20s) — no sub-floor writes', () => {
    // Pool acquisition alone can block up to DATABASE_POOL_CONN_TIMEOUT_MS (10s —
    // env-tunable, default in `@tzurot/common-types` poolConfig.ts), so a write
    // timeout below ~10s aborts client-side while the gateway is still acquiring a
    // connection — let alone executing. (Load-bearing assumption: if that pool
    // ceiling is ever raised toward WRITE (20s), this floor must rise with it.)
    // The method-aware default already gives mutations the WRITE budget (20s); the
    // failure mode is a route that EXPLICITLY overrides to a tighter read budget
    // (GATEWAY_RPC 5s, DEFERRED 10s) — a sub-floor write that aborts client-side
    // before the gateway finishes acquiring a connection.
    //
    // EXEMPTION: a POST that is semantically a READ (resolves/looks-up, never
    // mutates) may carry a tighter budget IF it is in AUTOCOMPLETE_TIER — those are
    // the deliberate tight-read routes (e.g. resolveUserLlmConfig, which fast-fails
    // to personality defaults on timeout). A genuine write is never in that set.
    //
    // Unlike the opt-in externalCallBudgetMs check, this covers EVERY route by
    // default: a new write cannot slip through simply by not declaring a field.
    const MUTATION_METHODS = new Set<string>(['post', 'put', 'patch', 'delete']);
    const violations: string[] = [];
    for (const [key, route] of entries) {
      if (!MUTATION_METHODS.has(route.method)) {
        continue; // GET = read; reads have their own DEFERRED/AUTOCOMPLETE budget
      }
      if (AUTOCOMPLETE_TIER.has(key)) {
        continue; // POST-shaped read, deliberately tight (registered + justified above)
      }
      const effective = route.timeoutMs ?? GATEWAY_TIMEOUTS.WRITE;
      if (effective < GATEWAY_TIMEOUTS.WRITE) {
        violations.push(`${key} (${route.method.toUpperCase()}): ${effective}ms`);
      }
    }
    expect(
      violations,
      `These mutation routes have an effective timeout below the ${GATEWAY_TIMEOUTS.WRITE}ms WRITE ` +
        `floor. A mutation must tolerate a transient pool-acquisition wait (up to 10s) plus the ` +
        `write itself. Fix: delete the explicit timeoutMs so each inherits the WRITE default — ` +
        `or, if a POST is truly a read, add it to AUTOCOMPLETE_TIER with a justification.\n  ` +
        violations.join('\n  ')
    ).toEqual([]);
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
