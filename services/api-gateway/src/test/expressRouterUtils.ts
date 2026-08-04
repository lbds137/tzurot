/**
 * Express Router Test Utilities
 *
 * Provides typed access to Express router internals for testing.
 * Eliminates the need for `@typescript-eslint/no-explicit-any` suppressions
 * when extracting route handlers from router stacks in tests.
 *
 * Extracted from 11 test files that each had identical untyped access patterns.
 */

import type { Router } from 'express';

/** Internal Express layer structure (not part of Express public API). */
interface ExpressRouteLayer {
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
    stack: { handle: (...args: unknown[]) => unknown }[];
  };
}

/**
 * Get the internal route layers from an Express router.
 *
 * Express routers have a `stack` property that is not part of the public API.
 * This function provides typed access to it for testing purposes.
 */
function getRouterStack(router: Router): ExpressRouteLayer[] {
  return (router as unknown as { stack: ExpressRouteLayer[] }).stack;
}

/** Per-route summary used by structural middleware-composition tests. */
export interface RouteSummary {
  path: string;
  methods: string[];
  /**
   * Number of handlers in the route's stack. A route registered as
   * `router.METHOD(path, handler)` has length 1; one wrapped by a single
   * middleware (e.g., `requireOwnerAuth()`) has length 2.
   */
  stackLength: number;
}

/**
 * Summarize every route declared on `router`. Intended for structural tests
 * that assert middleware presence (e.g., "every admin route must have at
 * least 2 stack entries because `requireOwnerAuth()` wraps the handler").
 *
 * Sub-routers and middleware-only layers (no `.route`) are skipped.
 */
export function getAllRoutes(router: Router): RouteSummary[] {
  const summaries: RouteSummary[] = [];
  for (const layer of getRouterStack(router)) {
    if (layer.route === undefined) {
      continue;
    }
    const path = layer.route.path ?? '<unnamed>';
    const methods = Object.entries(layer.route.methods ?? {})
      .filter(([, enabled]) => enabled === true)
      .map(([m]) => m);
    summaries.push({ path, methods, stackLength: layer.route.stack.length });
  }
  return summaries;
}
