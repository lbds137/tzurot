import { describe, it, expect } from 'vitest';
import { Router } from 'express';
import { findRoute, getRouteHandler, getAllRoutes } from './expressRouterUtils.js';

function createTestRouter(): Router {
  const router = Router();
  router.get('/', (_req, res) => res.json({ ok: true }));
  router.post('/items', (_req, res) => res.json({ created: true }));
  router.put('/items/:id', (_req, res) => res.json({ updated: true }));
  router.delete('/items/:id', (_req, res) => res.json({ deleted: true }));
  return router;
}

describe('expressRouterUtils', () => {
  describe('findRoute', () => {
    it('should find route by method and path', () => {
      const router = createTestRouter();
      expect(findRoute(router, 'get', '/')).toBeDefined();
      expect(findRoute(router, 'post', '/items')).toBeDefined();
      expect(findRoute(router, 'put', '/items/:id')).toBeDefined();
      expect(findRoute(router, 'delete', '/items/:id')).toBeDefined();
    });

    it('should find route by method only (no path filter)', () => {
      const router = createTestRouter();
      expect(findRoute(router, 'get')).toBeDefined();
    });

    it('should return undefined for non-existent method', () => {
      const router = createTestRouter();
      expect(findRoute(router, 'patch', '/')).toBeUndefined();
    });

    it('should return undefined for non-existent path', () => {
      const router = createTestRouter();
      expect(findRoute(router, 'get', '/nonexistent')).toBeUndefined();
    });

    it('should return undefined for wrong method on existing path', () => {
      const router = createTestRouter();
      expect(findRoute(router, 'delete', '/')).toBeUndefined();
    });
  });

  describe('getRouteHandler', () => {
    it('should return a callable handler function', () => {
      const router = createTestRouter();
      const handler = getRouteHandler(router, 'get', '/');
      expect(typeof handler).toBe('function');
    });

    it('should return handler for route matched by method only', () => {
      const router = createTestRouter();
      const handler = getRouteHandler(router, 'post');
      expect(typeof handler).toBe('function');
    });

    it('should throw for non-existent route', () => {
      const router = createTestRouter();
      expect(() => getRouteHandler(router, 'get', '/nonexistent')).toThrow(
        'No route found for GET /nonexistent'
      );
    });

    it('should throw with descriptive message when no path specified', () => {
      const router = createTestRouter();
      expect(() => getRouteHandler(router, 'patch')).toThrow('No route found for PATCH (any path)');
    });
  });

  describe('getAllRoutes', () => {
    it('returns one summary per registered route', () => {
      const router = createTestRouter();
      const routes = getAllRoutes(router);
      expect(routes).toHaveLength(4);
      const byPath = new Map(routes.map(r => [`${r.methods[0]} ${r.path}`, r]));
      expect(byPath.get('get /')).toBeDefined();
      expect(byPath.get('post /items')).toBeDefined();
      expect(byPath.get('put /items/:id')).toBeDefined();
      expect(byPath.get('delete /items/:id')).toBeDefined();
    });

    it('reports stackLength reflecting wrapped middleware', () => {
      const router = Router();
      const noMiddleware = (_req: unknown, _res: unknown): void => {};
      const oneMiddleware = (_req: unknown, _res: unknown, next: () => void): void => next();
      router.get('/bare', noMiddleware);
      router.get('/wrapped', oneMiddleware, noMiddleware);
      router.get('/double-wrapped', oneMiddleware, oneMiddleware, noMiddleware);
      const routes = getAllRoutes(router);
      const byPath = new Map(routes.map(r => [r.path, r.stackLength]));
      expect(byPath.get('/bare')).toBe(1);
      expect(byPath.get('/wrapped')).toBe(2);
      expect(byPath.get('/double-wrapped')).toBe(3);
    });

    it('returns an empty array for a router with no routes', () => {
      expect(getAllRoutes(Router())).toEqual([]);
    });
  });
});
