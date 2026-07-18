/**
 * Tests for the method-body builder.
 *
 * Each test constructs a synthetic RouteDef and asserts the generated
 * string contains the expected shape. We avoid full snapshot matching
 * — too brittle for formatting tweaks — and instead check the
 * structural pieces that matter for correctness.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { RouteDef } from '@tzurot/clients';
import { buildMethod, extractPathParams, pathPrefixForAudience } from './method-builder.js';

const baseRoute: RouteDef = {
  audience: 'user',
  method: 'get',
  path: '/foo',
  id: 'getFoo',
  output: z.object({ ok: z.boolean() }),
};

describe('extractPathParams', () => {
  it('returns [] for paths with no params', () => {
    expect(extractPathParams('/foo/bar')).toEqual([]);
  });

  it('extracts single param', () => {
    expect(extractPathParams('/foo/:id')).toEqual(['id']);
  });

  it('extracts multiple params in order', () => {
    expect(extractPathParams('/foo/:userId/personality/:slug')).toEqual(['userId', 'slug']);
  });
});

describe('pathPrefixForAudience', () => {
  it('maps audiences to URL prefixes', () => {
    expect(pathPrefixForAudience('internal')).toBe('/api/internal');
    expect(pathPrefixForAudience('admin')).toBe('/api/admin');
    expect(pathPrefixForAudience('user')).toBe('/api/user');
  });
});

describe('buildMethod — service flavor', () => {
  it('generates a simple GET method with no params', () => {
    const out = buildMethod(baseRoute, {
      flavor: 'service',
      pathPrefix: '/api/internal',
    });
    expect(out).toContain(
      `async getFoo(): Promise<GatewayResult<z.infer<typeof ROUTE_MANIFEST.getFoo.output>>>`
    );
    expect(out).toContain(`const fullPath = '/api/internal/foo';`);
    expect(out).toContain(`method: 'GET',`);
    expect(out).toContain(`outputSchema: ROUTE_MANIFEST.getFoo.output,`);
    expect(out).not.toContain(`'X-User-Id'`);
    expect(out).not.toContain(`body: input`);
  });

  it('emits encoded path interpolation for :params', () => {
    const route: RouteDef = {
      ...baseRoute,
      path: '/foo/:id',
      id: 'getFooById',
      params: { id: z.string() },
    };
    const out = buildMethod(route, { flavor: 'service', pathPrefix: '/api/internal' });
    expect(out).toContain(`getFooById(id: string)`);
    expect(out).toContain('${encodeURIComponent(id)}');
  });

  it('emits body line when route has input', () => {
    const route: RouteDef = {
      ...baseRoute,
      method: 'post',
      input: z.object({ name: z.string() }),
    };
    const out = buildMethod(route, { flavor: 'service', pathPrefix: '/api/internal' });
    // z.input (caller-side type): schema defaults stay optional at call sites.
    expect(out).toContain(`input: z.input<typeof ROUTE_MANIFEST.getFoo.input>`);
    expect(out).toContain(`body: input`);
    expect(out).toContain(`method: 'POST',`);
  });

  it('does NOT expose subject param even on acceptsSubject routes', () => {
    const route: RouteDef = {
      ...baseRoute,
      acceptsSubject: true,
    };
    const out = buildMethod(route, { flavor: 'service', pathPrefix: '/api/internal' });
    expect(out).not.toContain('subject');
  });

  it('emits no timeoutMs line when route.timeoutMs is omitted', () => {
    const out = buildMethod(baseRoute, { flavor: 'service', pathPrefix: '/api/internal' });
    expect(out).not.toContain('timeoutMs');
  });

  it('emits the timeoutMs line referencing the manifest when route.timeoutMs is set', () => {
    const route: RouteDef = { ...baseRoute, timeoutMs: 10_000 };
    const out = buildMethod(route, { flavor: 'service', pathPrefix: '/api/internal' });
    // The codegen references ROUTE_MANIFEST.<id>.timeoutMs rather than
    // hard-coding the numeric value — keeps the generated source
    // identifier-clean and survives manifest-value updates without regen.
    expect(out).toContain(`timeoutMs: ROUTE_MANIFEST.getFoo.timeoutMs`);
  });
});

describe('buildMethod — meta JSDoc emission', () => {
  it('omits the JSDoc block when no meta tags are set', () => {
    const out = buildMethod(baseRoute, { flavor: 'service', pathPrefix: '/api/internal' });
    expect(out).not.toMatch(/^\s*\/\*\*/);
    expect(out).not.toContain('@safeRead');
    expect(out).not.toContain('@idempotent');
  });

  it('emits @safeRead when meta.safeRead is true', () => {
    const route: RouteDef = { ...baseRoute, meta: { safeRead: true } };
    const out = buildMethod(route, { flavor: 'service', pathPrefix: '/api/internal' });
    expect(out).toContain('@safeRead');
    expect(out).toContain('safe to cache client-side');
  });

  it('emits @idempotent when meta.idempotent is true', () => {
    const route: RouteDef = { ...baseRoute, meta: { idempotent: true } };
    const out = buildMethod(route, { flavor: 'service', pathPrefix: '/api/internal' });
    expect(out).toContain('@idempotent');
    expect(out).toContain('safe to retry');
  });

  it('emits @softDeleteAware when meta.softDeleteAware is true', () => {
    const route: RouteDef = { ...baseRoute, meta: { softDeleteAware: true } };
    const out = buildMethod(route, { flavor: 'service', pathPrefix: '/api/internal' });
    expect(out).toContain('@softDeleteAware');
  });

  it('emits @atMostOnce when meta.atMostOnce is true', () => {
    const route: RouteDef = { ...baseRoute, meta: { atMostOnce: true } };
    const out = buildMethod(route, { flavor: 'service', pathPrefix: '/api/internal' });
    expect(out).toContain('@atMostOnce');
    expect(out).toContain('must NOT auto-retry');
  });

  it('emits all four meta tags when all four flags are true', () => {
    // Codegen-in-isolation test: this combination would fail the manifest
    // mutual-exclusivity invariants (safeRead+idempotent, safeRead+atMostOnce,
    // idempotent+atMostOnce are all banned on real routes) but the renderer
    // doesn't know or care — its job is to emit whatever tags the route
    // declares. The invariants live in manifest.test.ts, not here.
    const route: RouteDef = {
      ...baseRoute,
      meta: {
        safeRead: true,
        softDeleteAware: true,
        idempotent: true,
        atMostOnce: true,
      },
    };
    const out = buildMethod(route, { flavor: 'service', pathPrefix: '/api/internal' });
    expect(out).toContain('@safeRead');
    expect(out).toContain('@softDeleteAware');
    expect(out).toContain('@idempotent');
    expect(out).toContain('@atMostOnce');
  });

  it('places the JSDoc block immediately before the async declaration', () => {
    const route: RouteDef = { ...baseRoute, meta: { safeRead: true } };
    const out = buildMethod(route, { flavor: 'service', pathPrefix: '/api/internal' });
    // Block opens with /**, closes with */, then the method signature appears.
    const blockEndIdx = out.indexOf('*/');
    const asyncIdx = out.indexOf('async');
    expect(blockEndIdx).toBeGreaterThan(-1);
    expect(asyncIdx).toBeGreaterThan(blockEndIdx);
  });
});

describe('buildMethod — owner flavor', () => {
  it('injects X-User-Id from this.actor', () => {
    const out = buildMethod(baseRoute, { flavor: 'owner', pathPrefix: '/api/admin' });
    expect(out).toContain(`'X-User-Id': this.actor`);
    expect(out).not.toContain(`'X-User-Username'`);
  });

  it('adds subject option when route.acceptsSubject is true', () => {
    const route: RouteDef = {
      ...baseRoute,
      acceptsSubject: true,
    };
    const out = buildMethod(route, { flavor: 'owner', pathPrefix: '/api/admin' });
    expect(out).toContain(`options: { subject?: SubjectDiscordId } = {}`);
    expect(out).toContain(`['userId', options.subject]`);
    expect(out).toContain(`buildQueryString`);
  });
});

describe('buildMethod — user flavor', () => {
  it('injects user-context headers (id, username, displayName, is-bot)', () => {
    const out = buildMethod(baseRoute, { flavor: 'user', pathPrefix: '/api/user' });
    expect(out).toContain(`'X-User-Id': this.actor`);
    expect(out).toContain(`'X-User-Username': encodeURIComponent(this.user.username)`);
    expect(out).toContain(`'X-User-DisplayName': encodeURIComponent(this.user.displayName)`);
    expect(out).toContain(`'X-User-Is-Bot': String(this.user.isBot)`);
  });

  it('exposes query parameters in an options bag when route has queries', () => {
    const route: RouteDef = {
      ...baseRoute,
      query: { since: z.string().optional(), limit: z.string().optional() },
    };
    const out = buildMethod(route, { flavor: 'user', pathPrefix: '/api/user' });
    expect(out).toContain(`options: { since?: string; limit?: string } = {}`);
    expect(out).toContain(`['since', options.since]`);
    expect(out).toContain(`['limit', options.limit]`);
  });

  it('merges subject + query into a single options bag', () => {
    const route: RouteDef = {
      ...baseRoute,
      acceptsSubject: true,
      query: { personalityId: z.string() },
    };
    const out = buildMethod(route, { flavor: 'user', pathPrefix: '/api/user' });
    // personalityId is z.string() (required) so the options bag is required
    // and the field has no `?` marker. subject is always optional.
    expect(out).toContain(`options: { subject?: SubjectDiscordId; personalityId: string }`);
    expect(out).not.toContain('SubjectDiscordId; personalityId: string } = {}');
  });

  it('emits required field (no ?) when query schema is z.string()', () => {
    const route: RouteDef = {
      ...baseRoute,
      query: { channelId: z.string(), personaId: z.string().optional() },
    };
    const out = buildMethod(route, { flavor: 'user', pathPrefix: '/api/user' });
    expect(out).toContain(`options: { channelId: string; personaId?: string }`);
    // Required param → entire options bag is required (no `= {}` default)
    expect(out).not.toContain('personaId?: string } = {}');
  });

  it('emits optional field (with ?) and default {} when all params are optional', () => {
    const route: RouteDef = {
      ...baseRoute,
      query: { since: z.string().optional(), limit: z.string().optional() },
    };
    const out = buildMethod(route, { flavor: 'user', pathPrefix: '/api/user' });
    expect(out).toContain(`options: { since?: string; limit?: string } = {}`);
  });

  it('treats z.string().default(...) as optional', () => {
    const route: RouteDef = {
      ...baseRoute,
      query: { sort: z.string().default('asc') },
    };
    const out = buildMethod(route, { flavor: 'user', pathPrefix: '/api/user' });
    expect(out).toContain(`options: { sort?: string } = {}`);
  });

  it('treats z.string().nullable() as required (nullable ≠ optional for query strings)', () => {
    // Locks in the deliberate exclusion of `ZodNullable` from `isOptionalZod`.
    // A nullable query param can carry `null` as a sent value, but the caller
    // still has to pass the key — those aren't the same thing.
    const route: RouteDef = {
      ...baseRoute,
      query: { filter: z.string().nullable() },
    };
    const out = buildMethod(route, { flavor: 'user', pathPrefix: '/api/user' });
    expect(out).toContain(`options: { filter: string }`);
    expect(out).not.toContain('filter?: string');
    expect(out).not.toContain('filter: string } = {}');
  });

  it('accepts a ZodObject query schema (not just Record<string, ZodTypeAny>)', () => {
    // Shared/reusable query schemas (e.g., a pagination schema built with
    // z.object) are ZodObjects, not plain Records. Codegen must unwrap via resolveQueryShape
    // so the generated client signature is identical for both forms.
    const querySchema = z.object({
      limit: z.number().int().optional(),
      sort: z.enum(['createdAt', 'updatedAt']).optional(),
      personalityId: z.string(),
    });
    const route: RouteDef = {
      ...baseRoute,
      query: querySchema,
    };
    const out = buildMethod(route, { flavor: 'user', pathPrefix: '/api/user' });
    // Required `personalityId` forces the options bag to be required;
    // optional limit/sort get `?` markers.
    expect(out).toContain(`options: { limit?: string; sort?: string; personalityId: string }`);
    expect(out).toContain(`['limit', options.limit]`);
    expect(out).toContain(`['personalityId', options.personalityId]`);
  });
});
