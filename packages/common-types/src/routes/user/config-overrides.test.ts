/**
 * Tests for the user config-overrides sub-manifest.
 *
 * Asserts file-local invariants — every entry is a user-audience route on
 * a `/config-overrides/*` URL with provisioning required and no acceptsSubject.
 */

import { describe, it, expect } from 'vitest';
import { userConfigOverrideRoutes } from './config-overrides.js';
import type { AnyRouteDef } from '../types.js';

const entries = Object.entries(userConfigOverrideRoutes) as [string, AnyRouteDef][];

describe('user config-overrides routes', () => {
  it('has at least one entry', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('every entry is on a /config-overrides/* URL', () => {
    for (const [key, route] of entries) {
      expect(route.path.startsWith('/config-overrides'), `${key} path ${route.path}`).toBe(true);
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
