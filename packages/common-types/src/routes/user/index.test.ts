/**
 * Tests for the user route manifest (composed).
 *
 * Structural invariants — every user route has audience: 'user',
 * serviceOnly is forbidden, acceptsSubject is allowed only on the
 * lifted diagnostic GETs, requiresProvisionedUser is required on
 * everything else.
 */

import { describe, it, expect } from 'vitest';
import { userRoutes, userConfigRoutes, userResourceRoutes } from './index.js';
import type { AnyRouteDef } from '../types.js';

const entries = Object.entries(userRoutes) as [string, AnyRouteDef][];

describe('user route manifest', () => {
  it('has at least one entry', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('every entry has audience: "user"', () => {
    for (const [key, route] of entries) {
      expect(route.audience, `${key} audience`).toBe('user');
    }
  });

  it('no entry has serviceOnly: true (user routes have a human actor)', () => {
    for (const [key, route] of entries) {
      expect(route.serviceOnly, `${key} serviceOnly`).toBeFalsy();
    }
  });

  it('object key matches the route.id', () => {
    for (const [key, route] of entries) {
      expect(route.id).toBe(key);
    }
  });

  it('no duplicate IDs', () => {
    const ids = entries.map(([, r]) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no duplicate (method, path) pairs', () => {
    const pairs = entries.map(([, r]) => `${r.method} ${r.path}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('every entry has an output schema', () => {
    for (const [key, route] of entries) {
      expect(route.output, `${key} output`).toBeDefined();
    }
  });

  it('every path starts with "/"', () => {
    for (const [key, route] of entries) {
      expect(route.path.startsWith('/'), `${key} path "${route.path}"`).toBe(true);
    }
  });

  it('declared params keys match the :name placeholders in path', () => {
    for (const [key, route] of entries) {
      const pathParams = [...route.path.matchAll(/:(\w+)/g)].map(m => m[1]);
      const declaredParams = Object.keys(route.params ?? {});
      expect(declaredParams.sort(), `${key} params vs path`).toEqual(pathParams.sort());
    }
  });

  it('acceptsSubject is set only on diagnostic routes', () => {
    for (const [key, route] of entries) {
      if (route.acceptsSubject === true) {
        expect(route.path.startsWith('/diagnostic'), `${key} acceptsSubject path`).toBe(true);
      }
    }
  });

  it('acceptsSubject routes do NOT require provisioning', () => {
    for (const [key, route] of entries) {
      if (route.acceptsSubject === true) {
        expect(route.requiresProvisionedUser, `${key} requiresProvisionedUser`).toBeFalsy();
      }
    }
  });

  it('non-acceptsSubject routes set requiresProvisionedUser: true', () => {
    for (const [key, route] of entries) {
      if (route.acceptsSubject !== true) {
        expect(route.requiresProvisionedUser, `${key} requiresProvisionedUser`).toBe(true);
      }
    }
  });

  it('configs and resources are disjoint (no id collisions on merge)', () => {
    const configKeys = Object.keys(userConfigRoutes);
    const resourceKeys = Object.keys(userResourceRoutes);
    const intersection = configKeys.filter(k => resourceKeys.includes(k));
    expect(intersection).toEqual([]);
  });

  it('merged manifest equals the size of its inputs combined', () => {
    expect(entries.length).toBe(
      Object.keys(userConfigRoutes).length + Object.keys(userResourceRoutes).length
    );
  });
});
