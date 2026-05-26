/**
 * Tests for the user resources sub-manifest.
 *
 * The composed manifest in index.test.ts asserts global invariants;
 * this file asserts file-local invariants — every entry in resources.ts
 * is a user-audience route on a resource-shape URL, with diagnostic
 * GETs (acceptsSubject) being the only routes that skip provisioning.
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
      '/diagnostic',
      '/usage',
    ];
    for (const [key, route] of entries) {
      const matches = resourcePathPrefixes.some(prefix => route.path.startsWith(prefix));
      expect(matches, `${key} path ${route.path}`).toBe(true);
    }
  });

  it('acceptsSubject is set only on diagnostic routes', () => {
    for (const [key, route] of entries) {
      if (route.acceptsSubject === true) {
        expect(route.path.startsWith('/diagnostic'), `${key} acceptsSubject path`).toBe(true);
      }
    }
  });

  it('non-diagnostic routes require provisioning; diagnostic acceptsSubject routes do not', () => {
    for (const [key, route] of entries) {
      if (route.acceptsSubject === true) {
        expect(route.requiresProvisionedUser, `${key} requiresProvisionedUser`).toBeFalsy();
      } else {
        expect(route.requiresProvisionedUser, `${key} requiresProvisionedUser`).toBe(true);
      }
    }
  });
});
