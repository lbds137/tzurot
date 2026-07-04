/**
 * Audit: route-auth matrix for api-gateway
 *
 * Walks every `services/api-gateway/src/routes/**\/*.ts` (excluding tests) and
 * extracts every `router.METHOD(path, ...middleware, asyncHandler(handler))`
 * declaration. Determines:
 *
 *   - HTTP method + path (relative to the router)
 *   - Middleware applied (`requireUserAuth`, `requireOwnerAuth`, `requireServiceAuth`,
 *     `requireProvisionedUser`, etc.)
 *   - Mount prefix (`/admin`, `/user`, `/internal`, …) by cross-referencing
 *     `services/api-gateway/src/index.ts` for the router-factory's `app.use()` call
 *   - Whether the handler body reads `req.query.userId` (indicates `acceptsSubject` —
 *     an admin route where the owner inspects a different user's data)
 *
 * Output: JSON to `reports/route-auth-matrix.json` (gitignored) + summary table to
 * stdout. The JSON is the source of truth for declaring the route manifest in
 * `packages/common-types/src/routes/{admin,user,internal}.ts`.
 *
 * One-shot informational tool. Deleted alongside the route-prefix cutover that
 * mounts `/api/{internal,admin,user}/*` and removes the legacy `/admin /user
 * /internal` prefixes — the audit's job ends when the manifest is the source
 * of truth.
 *
 * Run: tsx scripts/audit-route-auth-matrix.ts
 */

import { Project, SyntaxKind } from 'ts-morph';
import type { CallExpression, Node, SourceFile } from 'ts-morph';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '..');
const INDEX_TS = join(REPO_ROOT, 'services/api-gateway/src/index.ts');
const OUTPUT_DIR = join(REPO_ROOT, 'reports');
const OUTPUT_JSON = join(OUTPUT_DIR, 'route-auth-matrix.json');

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'use']);

const KNOWN_MIDDLEWARE = new Set([
  'requireServiceAuth',
  'requireUserAuth',
  'requireOwnerAuth',
  'requireProvisionedUser',
  'asyncHandler',
  'rateLimiter',
  'rateLimit',
]);

interface RouteEntry {
  /** File the router.METHOD was declared in, repo-relative */
  file: string;
  /** The exported `createXxxRoutes` function that contains this declaration */
  routerFactory: string;
  /** HTTP method, lowercase */
  method: string;
  /** Path relative to the router (NOT including mount prefix) */
  routePath: string;
  /** Mount prefix from index.ts app.use('<prefix>', createXxxRoutes(...)) */
  mountPrefix: string | null;
  /** Audience: 'admin' | 'user' | 'internal' | 'ai' | 'health' | 'other' — derived from mountPrefix */
  audience: string;
  /** Middleware applied per-route, in declaration order */
  middleware: string[];
  /** Whether the handler body reads `req.query.userId` */
  acceptsSubjectQueryParam: boolean;
}

interface MountEntry {
  /** Mount prefix (e.g., '/admin', '/user') */
  prefix: string;
  /** Router factory name (e.g., 'createAdminRouter') */
  factory: string;
  /** Global middleware applied at mount-time, if any */
  globalMiddleware: string[];
}

/**
 * Extract the leaf string literal from an expression. Used to pull route paths
 * out of `router.get('/foo', ...)` calls.
 */
function extractStringArg(expr: CallExpression, index: number): string | null {
  const arg = expr.getArguments()[index];
  if (arg === undefined) return null;
  if (
    arg.getKind() === SyntaxKind.StringLiteral ||
    arg.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral
  ) {
    return arg.getText().slice(1, -1); // strip quotes
  }
  return null;
}

/**
 * Pull the called-function name out of a middleware expression. Handles
 * `requireUserAuth()`, `asyncHandler(...)`, etc.
 */
function extractMiddlewareName(expr: CallExpression): string | null {
  const target = expr.getExpression();
  if (target.getKind() === SyntaxKind.Identifier) {
    return target.getText();
  }
  if (target.getKind() === SyntaxKind.PropertyAccessExpression) {
    return target.getText();
  }
  return null;
}

/**
 * If `arg` is a SpreadElement wrapping a CallExpression like
 * `...createGetHandler(prisma)`, resolve the called identifier to its actual
 * function declaration (following imports, NOT by-name match — multiple files
 * may export the same name), and extract its return-array elements.
 *
 * Returns the array literal's elements as call-expression names, or null if
 * the function can't be statically resolved.
 */
function resolveSpreadHandlerMiddleware(arg: Node): string[] | null {
  if (arg.getKind() !== SyntaxKind.SpreadElement) return null;
  const spread = arg.asKindOrThrow(SyntaxKind.SpreadElement);
  const innerExpr = spread.getExpression();
  if (innerExpr.getKind() !== SyntaxKind.CallExpression) return null;

  const callExpr = innerExpr.asKindOrThrow(SyntaxKind.CallExpression);
  const targetExpr = callExpr.getExpression();
  if (targetExpr.getKind() !== SyntaxKind.Identifier) return null;

  // Use ts-morph's symbol resolution to find the actual definition (follows
  // imports). This is the correct way to handle multiple functions with the
  // same name across the project.
  const identifier = targetExpr.asKindOrThrow(SyntaxKind.Identifier);
  const symbol = identifier.getSymbol();
  if (symbol === undefined) return null;

  // The symbol may resolve to an ImportSpecifier; we want the underlying
  // function declaration. getAliasedSymbol() unwraps the import.
  let resolvedSymbol = symbol;
  try {
    const aliased = symbol.getAliasedSymbol();
    if (aliased !== undefined) resolvedSymbol = aliased;
  } catch (e) {
    // Most common: symbol isn't an alias (already the declaration). But
    // ts-morph can also throw for .d.ts-only symbols or when the type checker
    // loses the declaration — those produce <unresolved-spread> downstream
    // without explanation. Uncomment to debug:
    // console.warn(`getAliasedSymbol failed for ${identifier.getText()}:`, e);
  }

  const declarations = resolvedSymbol.getDeclarations();
  for (const decl of declarations) {
    if (decl.getKind() !== SyntaxKind.FunctionDeclaration) continue;
    const fn = decl.asKindOrThrow(SyntaxKind.FunctionDeclaration);

    // Walk return statements; look for `return [mw1(), mw2(), handler]`
    const returns = fn.getDescendantsOfKind(SyntaxKind.ReturnStatement);
    for (const ret of returns) {
      const expr = ret.getExpression();
      if (expr === undefined) continue;
      if (expr.getKind() !== SyntaxKind.ArrayLiteralExpression) continue;

      const elements = expr.asKindOrThrow(SyntaxKind.ArrayLiteralExpression).getElements();
      const middleware: string[] = [];
      for (const el of elements) {
        if (el.getKind() !== SyntaxKind.CallExpression) continue;
        const name = extractMiddlewareName(el.asKindOrThrow(SyntaxKind.CallExpression));
        if (name !== null) middleware.push(name);
      }
      return middleware;
    }
  }
  return null; // function found but doesn't directly return an array literal
}

/**
 * Walk a route file and collect every router.METHOD(...) call site within
 * each exported function (covers both `createXxxRoutes(...): Router` factories
 * AND `addXxxRoutes(router, ...)` mutator helpers). Tracks router-level
 * middleware applied via `router.use(mw())` in document order so each
 * route's effective middleware list reflects what actually runs.
 */
function collectRoutesFromFile(file: SourceFile): RouteEntry[] {
  const entries: RouteEntry[] = [];
  const filePath = relative(REPO_ROOT, file.getFilePath());

  for (const fn of file.getFunctions()) {
    if (!fn.isExported()) continue;
    const fnName = fn.getName();
    if (fnName === undefined) continue;

    // Track router-level middleware as we walk in source order. A
    // `router.use(mw())` call mutates this list, applying to all
    // subsequent route declarations in the same factory.
    const routerLevelMiddleware: string[] = [];

    // Walk descendants in source order so router-level middleware is
    // collected BEFORE the routes that inherit it.
    const calls = fn.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of calls) {
      const expr = call.getExpression();
      if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) continue;

      const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
      const objText = propAccess.getExpression().getText();
      if (objText !== 'router') continue;

      const methodName = propAccess.getName().toLowerCase();

      // router.use(middleware) without a path string is router-level middleware
      if (methodName === 'use') {
        const args = call.getArguments();
        // Skip router.use('/prefix', subrouter) — handled in resolveMountPrefixes
        if (args.length >= 1 && args[0].getKind() === SyntaxKind.StringLiteral) continue;
        // router.use(middleware()) — collect the middleware name
        for (const arg of args) {
          if (arg.getKind() !== SyntaxKind.CallExpression) continue;
          const name = extractMiddlewareName(arg.asKindOrThrow(SyntaxKind.CallExpression));
          if (name !== null) routerLevelMiddleware.push(name);
        }
        continue;
      }

      if (!HTTP_METHODS.has(methodName)) continue;
      if (methodName === 'all') continue; // skip catch-alls

      const args = call.getArguments();
      if (args.length < 2) continue;

      const routePath = extractStringArg(call, 0);
      if (routePath === null) continue;

      // Middleware = arguments[1..last]. Two patterns:
      // 1. `router.get('/path', mw1(), mw2(), asyncHandler(handler))` — inline middleware
      // 2. `router.get('/path', ...createGetHandler(prisma))` — spread of handler-factory result
      // The spread pattern hides middleware behind a function call; we chase the target
      // function and extract its return-array elements.
      const middleware: string[] = [];
      for (let i = 1; i < args.length; i++) {
        const arg = args[i];

        if (arg.getKind() === SyntaxKind.SpreadElement) {
          const resolved = resolveSpreadHandlerMiddleware(arg);
          if (resolved !== null) {
            middleware.push(...resolved);
          } else {
            middleware.push('<unresolved-spread>');
          }
          continue;
        }

        if (arg.getKind() === SyntaxKind.CallExpression) {
          const name = extractMiddlewareName(arg.asKindOrThrow(SyntaxKind.CallExpression));
          if (name !== null) middleware.push(name);
        }
      }

      // Walk handler body for `req.query.userId` references
      const handlerArg = args[args.length - 1];
      const acceptsSubject = handlerArg
        .getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
        .some(pa => pa.getText() === 'req.query.userId' || pa.getText().endsWith('.query.userId'));

      entries.push({
        file: filePath,
        routerFactory: fnName,
        method: methodName,
        routePath,
        mountPrefix: null, // filled in by cross-reference pass
        audience: 'unknown',
        // Router-level middleware (from `router.use(mw())`) runs before the
        // per-route middleware in Express's execution order. Prepend to
        // reflect runtime composition.
        middleware: [...routerLevelMiddleware, ...middleware],
        acceptsSubjectQueryParam: acceptsSubject,
      });
    }
  }

  return entries;
}

/**
 * Walk index.ts in source order. For each `app.use(...)` call:
 *   - `app.use(middleware())` (no prefix) → adds to GLOBAL middleware accumulator
 *     that applies to all subsequent mounts.
 *   - `app.use('/prefix', ..., router)` → mount with current accumulated
 *     global middleware captured.
 *
 * This captures Express's positional middleware ordering: any mount BEFORE
 * a global `app.use(requireServiceAuth())` does NOT have service auth; any
 * mount AFTER does. Critical for distinguishing public routes from
 * service-protected routes.
 */
function collectMountsFromIndex(file: SourceFile): MountEntry[] {
  const mounts: MountEntry[] = [];
  // Assumption: `getDescendantsOfKind` does DFS, which equals document order
  // for flat top-level `app.use()` calls (the current index.ts shape). If
  // `app.use()` ever moves into a conditional/IIFE/loop body, the
  // `accumulatedGlobalMiddleware` ordering would silently break — that
  // structural change is the trigger for revisiting this assumption.
  const calls = file.getDescendantsOfKind(SyntaxKind.CallExpression);
  const accumulatedGlobalMiddleware: string[] = [];

  for (const call of calls) {
    const expr = call.getExpression();
    if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) continue;

    const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    if (propAccess.getName() !== 'use') continue;
    const objText = propAccess.getExpression().getText();
    if (objText !== 'app') continue;

    const args = call.getArguments();
    if (args.length === 0) continue;

    const firstArg = args[0];

    // Bare app.use(middleware) — first arg is NOT a string literal — global middleware
    if (
      firstArg.getKind() !== SyntaxKind.StringLiteral &&
      firstArg.getKind() !== SyntaxKind.NoSubstitutionTemplateLiteral
    ) {
      // Collect any function-call middleware in the args
      for (const arg of args) {
        if (arg.getKind() !== SyntaxKind.CallExpression) continue;
        const name = extractMiddlewareName(arg.asKindOrThrow(SyntaxKind.CallExpression));
        if (name !== null && name !== 'createCorsMiddleware')
          accumulatedGlobalMiddleware.push(name);
      }
      continue;
    }

    // app.use('/prefix', ...) — mount with current global stack
    const prefix = extractStringArg(call, 0);
    if (prefix === null) continue;

    if (args.length < 2) continue; // app.use('/prefix') with no handler — unusual

    // Last arg: router factory call (createXxxRoutes(...)) OR a bare router var
    const routerArg = args[args.length - 1];
    let factory = '';
    if (routerArg.getKind() === SyntaxKind.CallExpression) {
      const factoryCall = routerArg.asKindOrThrow(SyntaxKind.CallExpression);
      const name = extractMiddlewareName(factoryCall);
      if (name !== null) factory = name;
    } else if (routerArg.getKind() === SyntaxKind.Identifier) {
      factory = routerArg.getText();
    }

    // Collect any intermediate per-mount middleware (args[1..last-1])
    const perMountMiddleware: string[] = [];
    for (let i = 1; i < args.length - 1; i++) {
      const arg = args[i];
      if (arg.getKind() !== SyntaxKind.CallExpression) {
        // could be an Identifier referencing a const middleware like `publicRateLimiter`
        if (arg.getKind() === SyntaxKind.Identifier) perMountMiddleware.push(arg.getText());
        continue;
      }
      const name = extractMiddlewareName(arg.asKindOrThrow(SyntaxKind.CallExpression));
      if (name !== null) perMountMiddleware.push(name);
    }

    mounts.push({
      prefix,
      factory,
      // GlobalMiddleware = accumulated from prior bare app.use() calls + per-mount middleware
      globalMiddleware: [...accumulatedGlobalMiddleware, ...perMountMiddleware],
    });
  }

  return mounts;
}

/**
 * Derive audience label from mount prefix.
 */
function audienceFor(prefix: string | null): string {
  if (prefix === null) return 'unknown';
  if (prefix.startsWith('/admin')) return 'admin';
  if (prefix.startsWith('/user')) return 'user';
  if (prefix.startsWith('/internal')) return 'internal';
  if (prefix.startsWith('/ai')) return 'ai';
  if (prefix.startsWith('/wallet')) return 'wallet';
  if (prefix.startsWith('/models')) return 'models';
  if (prefix.startsWith('/health')) return 'health';
  if (prefix === '/metrics' || prefix === '/dashboard') return 'observability';
  return 'other';
}

/**
 * Cross-reference: for each RouteEntry, look up its routerFactory in mounts
 * to find the prefix. Factories that aren't directly mounted (called by
 * higher-level factories) get propagated by walking ALL files for which
 * factories call which.
 */
function resolveMountPrefixes(routes: RouteEntry[], mounts: MountEntry[], project: Project): void {
  // factoryName → prefix map (direct mounts)
  const directMounts = new Map<string, string>();
  for (const m of mounts) {
    if (m.factory.length > 0) directMounts.set(m.factory, m.prefix);
  }

  // For factories not directly mounted, search the codebase for places where
  // they're called inside another factory that IS mounted. Build a chain:
  // createAdminRouter calls createAdminLlmConfigRoutes via subrouter.use('/llm-config', ...)
  // We need to walk this transitively.

  // Build "factory → (parentFactory, subPrefix)" relationships
  interface Edge {
    parent: string;
    subPrefix: string;
  }
  const edges = new Map<string, Edge[]>();

  for (const file of project.getSourceFiles()) {
    const filePath = file.getFilePath();
    if (!filePath.includes('/services/api-gateway/src/routes/')) continue;
    if (filePath.endsWith('.test.ts')) continue;

    for (const fn of file.getFunctions()) {
      if (!fn.isExported()) continue;
      const fnName = fn.getName();
      if (fnName === undefined) continue;

      // Find subrouter.use(prefix, createXxxRoutes(...)) inside fn
      // AND addXxxRoutes(router, ...) calls that mutate a passed-in router.
      const calls = fn.getDescendantsOfKind(SyntaxKind.CallExpression);
      for (const call of calls) {
        const expr = call.getExpression();

        // Pattern A: router.use('/prefix', createSomethingRoutes(...))
        if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
          const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
          if (propAccess.getName() !== 'use') continue;
          const objText = propAccess.getExpression().getText();
          if (objText !== 'router' && objText !== 'app') continue;
          // app.use was handled in collectMountsFromIndex; we want router.use here

          const args = call.getArguments();
          if (args.length < 2) continue;

          const subPrefix = extractStringArg(call, 0);
          if (subPrefix === null) continue;

          const routerArg = args[args.length - 1];
          let childFactory = '';
          if (routerArg.getKind() === SyntaxKind.CallExpression) {
            const name = extractMiddlewareName(routerArg.asKindOrThrow(SyntaxKind.CallExpression));
            if (name !== null) childFactory = name;
          } else if (routerArg.getKind() === SyntaxKind.Identifier) {
            childFactory = routerArg.getText();
          }
          if (childFactory.length === 0) continue;

          const list = edges.get(childFactory) ?? [];
          list.push({ parent: fnName, subPrefix });
          edges.set(childFactory, list);
          continue;
        }

        // Pattern B: addXxxRoutes(router, prisma, ...) — mutator helper that
        // adds routes to the parent's router directly (no sub-prefix).
        if (expr.getKind() === SyntaxKind.Identifier) {
          const childFactory = expr.getText();
          // Heuristic: name starts with "add" and ends with "Routes" — the
          // project's convention for router-mutator helpers.
          if (!childFactory.startsWith('add') || !childFactory.endsWith('Routes')) continue;
          // First arg should be `router` for this to be the pattern
          const args = call.getArguments();
          if (args.length === 0) continue;
          if (args[0].getText() !== 'router') continue;

          const list = edges.get(childFactory) ?? [];
          list.push({ parent: fnName, subPrefix: '' }); // no sub-prefix — same router
          edges.set(childFactory, list);
        }
      }
    }
  }

  // Resolve each route's mount prefix by walking up the factory chain
  function resolvePrefix(factory: string, visited: Set<string> = new Set()): string | null {
    if (visited.has(factory)) return null; // cycle
    visited.add(factory);

    const direct = directMounts.get(factory);
    if (direct !== undefined) return direct;

    const parents = edges.get(factory) ?? [];
    for (const edge of parents) {
      const parentPrefix = resolvePrefix(edge.parent, visited);
      if (parentPrefix !== null) {
        return parentPrefix + edge.subPrefix;
      }
    }
    return null;
  }

  for (const route of routes) {
    route.mountPrefix = resolvePrefix(route.routerFactory);
    route.audience = audienceFor(route.mountPrefix);
  }
}

function main(): void {
  // Load the api-gateway tsconfig so symbol resolution follows imports
  // correctly (multiple files export functions with the same name like
  // `createGetHandler`; we need to follow the actual import to find the
  // right one).
  const project = new Project({
    tsConfigFilePath: join(REPO_ROOT, 'services/api-gateway/tsconfig.json'),
    skipAddingFilesFromTsConfig: false,
  });

  // Collect routes
  const routes: RouteEntry[] = [];
  for (const file of project.getSourceFiles()) {
    const path = file.getFilePath();
    if (!path.includes('/services/api-gateway/src/routes/')) continue;
    if (path.endsWith('.test.ts')) continue; // `.component.test.ts` ends with `.test.ts`
    routes.push(...collectRoutesFromFile(file));
  }

  // Collect mounts from index.ts
  const indexFile = project.getSourceFile(INDEX_TS);
  if (indexFile === undefined) {
    throw new Error(`Could not load ${INDEX_TS}`);
  }
  const mounts = collectMountsFromIndex(indexFile);

  // Cross-reference to fill mountPrefix
  resolveMountPrefixes(routes, mounts, project);

  // Sort: audience → file → method → path
  routes.sort((a, b) => {
    if (a.audience !== b.audience) return a.audience.localeCompare(b.audience);
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.method !== b.method) return a.method.localeCompare(b.method);
    return a.routePath.localeCompare(b.routePath);
  });

  // Write JSON output
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(
    OUTPUT_JSON,
    JSON.stringify({ generatedAt: new Date().toISOString(), routes, mounts }, null, 2)
  );

  // Print summary table
  const byAudience = new Map<string, RouteEntry[]>();
  for (const r of routes) {
    const list = byAudience.get(r.audience) ?? [];
    list.push(r);
    byAudience.set(r.audience, list);
  }

  console.log(
    `\n=== Route Auth Matrix — ${routes.length} routes across ${byAudience.size} audiences ===\n`
  );
  for (const [audience, list] of [...byAudience.entries()].sort()) {
    console.log(`\n--- ${audience.toUpperCase()} (${list.length} routes) ---`);
    for (const r of list) {
      const fullPath = `${r.mountPrefix ?? '?'}${r.routePath}`;
      const mw = r.middleware.filter(m => KNOWN_MIDDLEWARE.has(m)).join(', ');
      const subj = r.acceptsSubjectQueryParam ? ' [subject?]' : '';
      console.log(`  ${r.method.toUpperCase().padEnd(6)} ${fullPath.padEnd(60)} ${mw}${subj}`);
    }
  }

  console.log(`\n=== Mounts in index.ts ===\n`);
  for (const m of mounts) {
    const gmw = m.globalMiddleware.join(', ');
    console.log(`  ${m.prefix.padEnd(20)} ${m.factory.padEnd(40)} ${gmw}`);
  }

  console.log(`\nFull JSON written to: ${relative(REPO_ROOT, OUTPUT_JSON)}\n`);

  // Sanity check: routes with no mountPrefix indicate a chain we couldn't resolve
  const unresolved = routes.filter(r => r.mountPrefix === null);
  if (unresolved.length > 0) {
    console.log(`⚠️  ${unresolved.length} routes have no resolved mount prefix:`);
    for (const r of unresolved) {
      console.log(
        `    ${r.file} :: ${r.routerFactory} :: ${r.method.toUpperCase()} ${r.routePath}`
      );
    }
  }
}

main();
