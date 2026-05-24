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
import type { RouteDef } from '@tzurot/common-types';
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
    expect(out).toContain(`input: z.infer<typeof ROUTE_MANIFEST.getFoo.input>`);
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
  it('injects user-context headers (id, username, displayName)', () => {
    const out = buildMethod(baseRoute, { flavor: 'user', pathPrefix: '/api/user' });
    expect(out).toContain(`'X-User-Id': this.actor`);
    expect(out).toContain(`'X-User-Username': encodeURIComponent(this.user.username)`);
    expect(out).toContain(`'X-User-DisplayName': encodeURIComponent(this.user.displayName)`);
  });

  it('exposes query parameters in an options bag when route has queries', () => {
    const route: RouteDef = {
      ...baseRoute,
      query: { since: z.string(), limit: z.string() },
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
    expect(out).toContain(`options: { subject?: SubjectDiscordId; personalityId?: string } = {}`);
  });
});
