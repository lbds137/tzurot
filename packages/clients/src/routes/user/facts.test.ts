/**
 * Tests for the user memory-fact sub-manifest.
 *
 * Asserts file-local invariants — every entry is a user-audience route on a
 * `/fact/*` URL with provisioning required and no acceptsSubject, and that the
 * mutating verbs (correct/forget) are NOT marked safeRead.
 */

import { describe, it, expect } from 'vitest';
import { userFactRoutes } from './facts.js';
import type { AnyRouteDef } from '../types.js';

const entries = Object.entries(userFactRoutes) as [string, AnyRouteDef][];

describe('user fact routes', () => {
  it('has the five correction-slice entries', () => {
    expect(Object.keys(userFactRoutes).sort()).toEqual([
      'correctFact',
      'forgetFact',
      'getFact',
      'listFacts',
      'setFactLock',
    ]);
  });

  it('every entry is on a /fact/* URL', () => {
    for (const [key, route] of entries) {
      expect(route.path.startsWith('/fact'), `${key} path ${route.path}`).toBe(true);
    }
  });

  it('every entry requires provisioning', () => {
    for (const [key, route] of entries) {
      expect(route.requiresProvisionedUser, `${key} requiresProvisionedUser`).toBe(true);
    }
  });

  it('no entry uses acceptsSubject', () => {
    for (const [key, route] of entries) {
      expect(route.acceptsSubject, `${key} acceptsSubject`).toBeFalsy();
    }
  });

  it('the mutating verbs are not marked safeRead', () => {
    for (const key of ['correctFact', 'forgetFact', 'setFactLock']) {
      const route = userFactRoutes[key as keyof typeof userFactRoutes] as AnyRouteDef;
      expect(route.meta?.safeRead, `${key} safeRead`).toBeFalsy();
    }
  });
});
