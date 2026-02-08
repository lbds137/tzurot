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

/**
 * Find a route layer matching the given HTTP method and optional path.
 *
 * @param router - Express router instance
 * @param method - HTTP method (get, post, put, delete)
 * @param path - Optional route path to match (e.g., '/', '/:id')
 * @returns The matching layer, or undefined if not found
 */
export function findRoute(
  router: Router,
  method: string,
  path?: string
): ExpressRouteLayer | undefined {
  return getRouterStack(router).find(layer => {
    if (layer.route?.methods?.[method] !== true) {
      return false;
    }
    if (path !== undefined && layer.route.path !== path) {
      return false;
    }
    return true;
  });
}

/**
 * Get the last handler function for a route matching the given method and path.
 *
 * Express route stacks contain middleware followed by the actual handler.
 * This returns the last item in the stack, which is the route handler.
 *
 * @param router - Express router instance
 * @param method - HTTP method (get, post, put, delete)
 * @param path - Optional route path to match (e.g., '/', '/:id')
 * @returns The route handler function
 * @throws Error if no matching route is found
 */
export function getRouteHandler(
  router: Router,
  method: string,
  path?: string
): (...args: unknown[]) => unknown {
  const layer = findRoute(router, method, path);
  if (layer?.route === undefined) {
    throw new Error(`No route found for ${method.toUpperCase()} ${path ?? '(any path)'}`);
  }
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}
