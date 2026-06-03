/**
 * Tests for the user resources sub-manifest.
 *
 * The composed manifest in index.test.ts asserts global invariants;
 * this file asserts file-local invariants — every entry in resources.ts
 * is a user-audience route on a resource-shape URL. Diagnostic GETs
 * (acceptsSubject) live in diagnostics.ts and have their own tests.
 */

import { describe, it, expect } from 'vitest';
import { userResourceRoutes } from './resources.js';
import type { AnyRouteDef } from '../types.js';

const entries = Object.entries(userResourceRoutes) as [string, AnyRouteDef][];

describe('user resource routes', () => {
  it('has at least one entry', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('every entry is on a resource-shape URL', () => {
    const resourcePathPrefixes = [
      '/personality',
      '/persona',
      '/channel',
      '/wallet',
      '/voice-resolution',
      '/usage',
      '/nsfw',
      '/history',
      '/voices',
    ];
    for (const [key, route] of entries) {
      const matches = resourcePathPrefixes.some(prefix => route.path.startsWith(prefix));
      expect(matches, `${key} path ${route.path}`).toBe(true);
    }
  });

  it('no entry uses acceptsSubject (those live in diagnostics.ts)', () => {
    for (const [key, route] of entries) {
      expect(route.acceptsSubject, `${key} acceptsSubject`).toBeFalsy();
    }
  });

  it('every entry requires provisioning (operates on caller row)', () => {
    for (const [key, route] of entries) {
      expect(route.requiresProvisionedUser, `${key} requiresProvisionedUser`).toBe(true);
    }
  });
});
