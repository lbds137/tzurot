/**
 * Tests for the user configs sub-manifest.
 *
 * The composed manifest in index.test.ts asserts global invariants;
 * this file asserts file-local invariants — every entry in configs.ts
 * is a user-audience route on a config-shape URL.
 */

import { describe, it, expect } from 'vitest';
import { userConfigRoutes } from './configs.js';
import type { AnyRouteDef } from '../types.js';

const entries = Object.entries(userConfigRoutes) as [string, AnyRouteDef][];

describe('user config routes', () => {
  it('has at least one entry', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('every entry is on a configuration-shape URL', () => {
    const configPathPrefixes = [
      '/timezone',
      '/notifications',
      '/llm-config',
      '/tts-config',
      '/tts-override',
      '/stt-override',
      '/model-override',
    ];
    for (const [key, route] of entries) {
      const matches = configPathPrefixes.some(prefix => route.path.startsWith(prefix));
      expect(matches, `${key} path ${route.path}`).toBe(true);
    }
  });

  it('every entry requires provisioning (config routes operate on caller row)', () => {
    for (const [key, route] of entries) {
      expect(route.requiresProvisionedUser, `${key} requiresProvisionedUser`).toBe(true);
    }
  });

  it('no entry accepts subject (configs are self-only)', () => {
    for (const [key, route] of entries) {
      expect(route.acceptsSubject, `${key} acceptsSubject`).toBeFalsy();
    }
  });
});
