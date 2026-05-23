/**
 * Audit: middleware side-effect survey for api-gateway
 *
 * Statically scans every middleware-shaped function in the api-gateway and
 * reports operations that would be problematic if the middleware fires
 * twice for a single logical request (e.g., during the parallel-mount window
 * of the route-prefix refactor where the same handler is reachable via both
 * `/admin/*` and `/api/*` paths).
 *
 * Looks for:
 *
 *   - **Counter increments**: `prisma.*.update` with increment ops, `redis.incr` / `redis.incrby`
 *   - **External dispatches**: `fetch(`, `axios`, BullMQ `.add(`, webhook calls, push notifications
 *   - **One-time token writes**: `redis.set` with NX/EX flags, token consumption patterns
 *   - **Cache writes**: `cache.set`, `redis.setex`, `TTLCache.set`
 *
 * The human reads the output and classifies each finding as "safe to
 * duplicate-fire" (idempotent — re-running is a no-op or only mildly wasteful)
 * vs "must run exactly once" (would break invariants — e.g., consuming a
 * one-time token, sending a notification twice).
 *
 * Output: JSON to `reports/middleware-side-effects.json` (gitignored) + summary
 * table to stdout. The classification drives whether a middleware is safe to
 * be invoked twice during the parallel-mount window of the refactor.
 *
 * One-shot informational tool. Deleted alongside the route-prefix cutover that
 * mounts `/api/{internal,admin,user}/*` — the survey's classification is only
 * relevant while old and new prefixes coexist.
 *
 * Run: tsx scripts/audit-middleware-side-effects.ts
 */

import { Project, SyntaxKind } from 'ts-morph';
import type {
  ArrowFunction,
  CallExpression,
  FunctionDeclaration,
  FunctionExpression,
  Node,
  SourceFile,
} from 'ts-morph';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '..');
const SCAN_PATHS = [
  join(REPO_ROOT, 'services/api-gateway/src/middleware/**/*.ts'),
  join(REPO_ROOT, 'services/api-gateway/src/services/AuthMiddleware.ts'),
];
const OUTPUT_DIR = join(REPO_ROOT, 'reports');
const OUTPUT_JSON = join(OUTPUT_DIR, 'middleware-side-effects.json');

/** Patterns matched in call-expression text. Each tagged with effect kind. */
interface PatternRule {
  /** Substring matched in the call expression text (case-sensitive) */
  pattern: RegExp;
  /** Effect category */
  kind: 'counter' | 'dispatch' | 'one-time-token' | 'cache' | 'queue';
  /** Human-readable description */
  why: string;
}

const PATTERNS: PatternRule[] = [
  // Counter increments
  {
    pattern: /\.increment\b/,
    kind: 'counter',
    why: 'Prisma .increment — running twice double-counts',
  },
  {
    pattern: /redis\.(incr|incrby|hincrby)/,
    kind: 'counter',
    why: 'Redis counter — running twice double-counts',
  },
  {
    pattern: /\$queryRaw.*UPDATE.*SET.*\+\s*1/,
    kind: 'counter',
    why: 'Raw SQL increment — running twice double-counts',
  },

  // External dispatches
  {
    pattern: /\bfetch\s*\(/,
    kind: 'dispatch',
    why: 'fetch() — running twice sends duplicate requests',
  },
  { pattern: /\baxios\./, kind: 'dispatch', why: 'axios — running twice sends duplicate requests' },
  {
    // Excludes res.send / res.json (Express response methods are not external
    // dispatches — they end the response cycle and would throw on duplicate fire,
    // not double-send). Matches Discord channel/webhook send patterns.
    pattern: /\b(?:channel|webhook|client|bot|message|interaction)\.send\s*\(/,
    kind: 'dispatch',
    why: 'channel.send / webhook.send — running twice posts twice',
  },

  // Queues
  {
    pattern: /\.add\(['"`]/,
    kind: 'queue',
    why: 'BullMQ Queue.add — running twice enqueues duplicate job',
  },

  // One-time tokens
  {
    pattern: /redis\.set\(.*['"`](NX|EX|XX)['"`]/,
    kind: 'one-time-token',
    why: 'Redis SET with NX/EX/XX flag — likely a token/lock',
  },
  { pattern: /setnx\b/i, kind: 'one-time-token', why: 'Redis SETNX — likely a token/lock' },

  // Cache writes
  {
    pattern: /TTLCache\b.*\.set\(/,
    kind: 'cache',
    why: 'TTLCache.set — re-write is idempotent but logs extra noise',
  },
  {
    pattern: /redis\.set(ex|px)?\b/i,
    kind: 'cache',
    why: 'Redis SET — re-write is idempotent for caches',
  },
  { pattern: /cache\.set\(/i, kind: 'cache', why: 'cache.set — re-write is idempotent for caches' },
];

interface Finding {
  /** File the call expression lives in, repo-relative */
  file: string;
  /** Line number (1-indexed) */
  line: number;
  /** The matched call expression text (truncated) */
  callText: string;
  /** Effect category */
  kind: 'counter' | 'dispatch' | 'one-time-token' | 'cache' | 'queue';
  /** Why this pattern matters for duplicate-fire risk */
  why: string;
  /** Whether the call appears INSIDE a function with middleware shape */
  insideMiddleware: boolean;
  /** Name of the enclosing middleware-shaped function, if any */
  enclosingFunction: string | null;
}

type FunctionLike = FunctionDeclaration | ArrowFunction | FunctionExpression;

/**
 * Detect whether a function declaration looks like Express middleware:
 *   - Returns a function with signature (req, res, next) => void | Promise<void>
 *   - OR is itself such a function
 * We check param names since the project's middlewares consistently use those.
 */
function isMiddlewareShape(fn: FunctionLike): boolean {
  // First check direct shape
  const directParams = fn.getParameters();
  if (directParams.length === 3) {
    const firstName = directParams[0].getName();
    if (firstName.startsWith('req') || firstName === '_req') {
      return true;
    }
  }
  // Check returned arrow function (factory pattern: `export function requireX() { return (req, res, next) => ... }`)
  const returns = fn.getDescendantsOfKind(SyntaxKind.ReturnStatement);
  for (const ret of returns) {
    const expr = ret.getExpression();
    if (expr === undefined) continue;
    if (
      expr.getKind() === SyntaxKind.ArrowFunction ||
      expr.getKind() === SyntaxKind.FunctionExpression
    ) {
      const innerFn = expr as ArrowFunction | FunctionExpression;
      const params = innerFn.getParameters();
      if (params.length === 3) {
        const firstName = params[0].getName();
        if (firstName.startsWith('req') || firstName === '_req') {
          return true;
        }
      }
    }
  }
  return false;
}

function findEnclosingFunction(node: Node): { name: string; isMiddleware: boolean } | null {
  let cur: Node | undefined = node.getParent();
  while (cur !== undefined) {
    if (cur.getKind() === SyntaxKind.FunctionDeclaration) {
      const fn = cur.asKindOrThrow(SyntaxKind.FunctionDeclaration);
      const name = fn.getName() ?? '<anonymous>';
      return { name, isMiddleware: isMiddlewareShape(fn) };
    }
    if (
      cur.getKind() === SyntaxKind.ArrowFunction ||
      cur.getKind() === SyntaxKind.FunctionExpression
    ) {
      // Walk up further; the enclosing named function matters more
      cur = cur.getParent();
      continue;
    }
    cur = cur.getParent();
  }
  return null;
}

function scanFile(file: SourceFile): Finding[] {
  const findings: Finding[] = [];
  const filePath = relative(REPO_ROOT, file.getFilePath());
  if (filePath.endsWith('.test.ts')) return findings;

  const calls = file.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const call of calls) {
    const text = call.getText();
    // 600-char cap: Prisma .update({ where: ..., data: { counter: { increment: 1 } } })
    // exceeds 200 chars on any non-trivial where-clause; raising the cap avoids
    // false negatives on counter-increment patterns nested inside larger expressions.
    if (text.length > 600) continue;
    const truncated = text.length > 120 ? text.slice(0, 120) + '…' : text;

    for (const rule of PATTERNS) {
      if (!rule.pattern.test(text)) continue;

      const enclosing = findEnclosingFunction(call);
      findings.push({
        file: filePath,
        line: call.getStartLineNumber(),
        callText: truncated,
        kind: rule.kind,
        why: rule.why,
        insideMiddleware: enclosing?.isMiddleware ?? false,
        enclosingFunction: enclosing?.name ?? null,
      });
      break; // one rule match per call is enough
    }
  }

  return findings;
}

function main(): void {
  const project = new Project({
    tsConfigFilePath: join(REPO_ROOT, 'services/api-gateway/tsconfig.json'),
    skipAddingFilesFromTsConfig: false,
  });

  // Filter to just middleware + auth files
  const findings: Finding[] = [];
  for (const file of project.getSourceFiles()) {
    const path = file.getFilePath();
    const isMiddleware = path.includes('/services/api-gateway/src/middleware/');
    const isAuth = path.endsWith('/services/api-gateway/src/services/AuthMiddleware.ts');
    if (!isMiddleware && !isAuth) continue;
    findings.push(...scanFile(file));
  }

  // Sort by file, then line
  findings.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });

  // Output JSON
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(
    OUTPUT_JSON,
    JSON.stringify({ generatedAt: new Date().toISOString(), findings }, null, 2)
  );

  // Print summary grouped by kind
  const byKind = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byKind.get(f.kind) ?? [];
    list.push(f);
    byKind.set(f.kind, list);
  }

  console.log(`\n=== Middleware Side-Effect Survey — ${findings.length} findings ===\n`);

  if (findings.length === 0) {
    console.log('No middleware-side-effect patterns matched in the scanned files.');
    console.log('All middlewares are pure auth/validation/logging — safe to fire twice.');
  }

  for (const [kind, list] of [...byKind.entries()].sort()) {
    console.log(`\n--- ${kind.toUpperCase()} (${list.length}) ---`);
    for (const f of list) {
      const mwMark = f.insideMiddleware ? '⚠️  MIDDLEWARE' : '   non-middleware';
      const enc = f.enclosingFunction ?? '<top-level>';
      console.log(`  ${mwMark}  ${f.file}:${f.line}  in ${enc}`);
      console.log(`    ${f.callText}`);
      console.log(`    why: ${f.why}`);
    }
  }

  // Summary table
  const mwFindings = findings.filter(f => f.insideMiddleware);
  console.log(`\n=== Summary ===`);
  console.log(`  Total findings: ${findings.length}`);
  console.log(`  Inside middleware-shaped functions: ${mwFindings.length}`);
  console.log(`  Non-middleware (utility / helper): ${findings.length - mwFindings.length}`);
  console.log(`\nFull JSON written to: ${relative(REPO_ROOT, OUTPUT_JSON)}\n`);

  if (mwFindings.length > 0) {
    console.log(
      '⚠️  Findings INSIDE middleware functions need explicit duplicate-fire-safety classification before PR-2.'
    );
  }
}

main();
