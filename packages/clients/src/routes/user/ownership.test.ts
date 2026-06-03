/**
 * Tests for the user ownership sub-manifest.
 *
 * Asserts file-local invariants — every entry is a user-audience route on
 * a `/personality` or `/persona` URL, requires provisioning, and never
 * uses acceptsSubject (subject-vs-actor lives in diagnostics.ts only).
 */

import { describe, it, expect } from 'vitest';
import { userOwnershipRoutes } from './ownership.js';
import type { AnyRouteDef } from '../types.js';

const entries = Object.entries(userOwnershipRoutes) as [string, AnyRouteDef][];

describe('user ownership routes', () => {
  it('has at least one entry', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('every entry is on a /personality or /persona URL', () => {
    for (const [key, route] of entries) {
      const matches = route.path.startsWith('/personality') || route.path.startsWith('/persona');
      expect(matches, `${key} path ${route.path}`).toBe(true);
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
