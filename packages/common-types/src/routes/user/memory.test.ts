/**
 * Tests for the user memory sub-manifest.
 *
 * Asserts file-local invariants — every entry is a user-audience route on
 * a `/memory/*` URL with provisioning required and no acceptsSubject.
 */

import { describe, it, expect } from 'vitest';
import { userMemoryRoutes } from './memory.js';
import type { AnyRouteDef } from '../types.js';

const entries = Object.entries(userMemoryRoutes) as [string, AnyRouteDef][];

describe('user memory routes', () => {
  it('has at least one entry', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('every entry is on a /memory/* URL', () => {
    for (const [key, route] of entries) {
      expect(route.path.startsWith('/memory'), `${key} path ${route.path}`).toBe(true);
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
