/**
 * Completeness gate for the conformance registry.
 *
 * Asserts an exact bijection between ROUTE_MANIFEST and
 * CONFORMANCE_REGISTRY: every manifest route has a conformance entry
 * (fixture or justified skip), and no registry entry points at a route
 * that no longer exists. This is the structural enforcement that makes
 * "handler drifted from its declared output schema" impossible to ship
 * silently for NEW routes — adding a manifest entry without a conformance
 * fixture fails the unit suite.
 */

import { describe, it, expect } from 'vitest';
import { ROUTE_MANIFEST } from '@tzurot/clients';

import { CONFORMANCE_REGISTRY } from './registry.js';
import { isSkip } from './types.js';

describe('conformance registry completeness', () => {
  it('covers every manifest route (fixture or justified skip)', () => {
    const manifestIds = Object.keys(ROUTE_MANIFEST).sort();
    const registryIds = Object.keys(CONFORMANCE_REGISTRY).sort();

    const missing = manifestIds.filter(id => !registryIds.includes(id));
    expect(
      missing,
      `Manifest routes without a conformance entry — add a fixture (or a ` +
        `justified skip) in src/routes/conformance/fixtures/: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('has no stale entries for routes no longer in the manifest', () => {
    const manifestIds = new Set(Object.keys(ROUTE_MANIFEST));
    const stale = Object.keys(CONFORMANCE_REGISTRY).filter(id => !manifestIds.has(id));
    expect(stale, `Registry entries with no matching manifest route: ${stale.join(', ')}`).toEqual(
      []
    );
  });

  it('every skip entry has a non-empty reason', () => {
    const offenders = Object.entries(CONFORMANCE_REGISTRY)
      .filter(([, entry]) => isSkip(entry) && entry.skip.trim().length === 0)
      .map(([id]) => id);
    expect(offenders).toEqual([]);
  });
});
