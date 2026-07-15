/**
 * Tests for the user account data-rights sub-manifest.
 *
 * File-local invariants — every entry is a user-audience route on an
 * `/account/*` URL with provisioning required and no acceptsSubject.
 */

import { describe, it, expect } from 'vitest';
import { userAccountRoutes } from './account.js';
import type { AnyRouteDef } from '../types.js';

const entries = Object.entries(userAccountRoutes) as [string, AnyRouteDef][];

describe('user account routes', () => {
  it('has at least one entry', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('every entry is on an /account/* URL', () => {
    for (const [key, route] of entries) {
      expect(route.path.startsWith('/account'), `${key} path ${route.path}`).toBe(true);
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
});
