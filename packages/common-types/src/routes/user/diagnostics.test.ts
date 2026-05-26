/**
 * Tests for the user diagnostics sub-manifest.
 *
 * Asserts file-local invariants — every diagnostic route is on a
 * `/diagnostic*` URL with `acceptsSubject: true` and (per the subject-vs-actor
 * model) does NOT require provisioning of the subject's row.
 */

import { describe, it, expect } from 'vitest';
import { userDiagnosticRoutes } from './diagnostics.js';
import type { AnyRouteDef } from '../types.js';

const entries = Object.entries(userDiagnosticRoutes) as [string, AnyRouteDef][];

describe('user diagnostic routes', () => {
  it('has at least one entry', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('every entry is on a /diagnostic* URL', () => {
    for (const [key, route] of entries) {
      expect(route.path.startsWith('/diagnostic'), `${key} path ${route.path}`).toBe(true);
    }
  });

  it('every entry has acceptsSubject: true', () => {
    for (const [key, route] of entries) {
      expect(route.acceptsSubject, `${key} acceptsSubject`).toBe(true);
    }
  });

  it('no entry requires provisioning (subject row may not exist)', () => {
    for (const [key, route] of entries) {
      expect(route.requiresProvisionedUser, `${key} requiresProvisionedUser`).toBeFalsy();
    }
  });
});
