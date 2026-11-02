/**
 * Guard: every code path that writes `memories.content` must be allowlisted.
 *
 * A stored `memories.assistant_summary` renders regardless of `summary_status`
 * or `summary_prompt_version` because `assistant_summary` is only written for
 * the current content and a content edit clears it (see
 * `docs/intent/memory-archive/memory-archive-design.md` § The render stamp).
 * If a new write path mutated `memories.content` without clearing the summary
 * columns in the same write, a stale summary would keep rendering against the
 * new content.
 *
 * Limit: SQL assembled from column lists at runtime, as in
 * `services/api-gateway/src/services/sync/SyncUpsertBuilder.ts`, is out of
 * reach of a static source scan; that sync path copies `content` and
 * `assistant_summary` together from the winning row. The guard scans only
 * `packages/*\/src` and `services/*\/src`, so `prisma/migrations/*.sql` and
 * `scripts/` are out of scope; and it cannot see a delegate held in another
 * variable (`const m = prisma.memory`, `const { memory } = prisma`), a relation
 * to `Memory` under a name other than `memories`, bracket access (`prisma['memory']`,
 * `prisma.memory['update']`), a nested write through a further relation level
 * (only a direct `memories` key on `data`/`update` is checked), SQL split by
 * string concatenation, a column name interpolated into SQL, or a comment
 * between the delegate and the method. The allowlist counts writers without
 * telling them apart, so a raw-SQL writer replacing the route's Prisma one
 * still counts; the MEM-ARCH-024 test named below catches that.
 *
 * Binary sync-check (like `guard:no-export-star`): no threshold, no WHY.md,
 * no `--summary`.
 */
import { type Dirent, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  type CallExpression,
  Node,
  type ObjectLiteralElementLike,
  type ObjectLiteralExpression,
  Project,
  type PropertyAssignment,
  type SourceFile,
} from 'ts-morph';

const ROOTS = ['packages', 'services'] as const;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'generated', '__mocks__', '.turbo', 'coverage']);
const SKIP_PATH_SEGMENT = /(?:^|\/)(?:generated|_generated|__mocks__|node_modules|dist)\//;
const WRITE_METHODS = new Set(['update', 'updateMany', 'updateManyAndReturn', 'upsert']);
/** Marks a finding the allowlist must not count, so its wording lives in one place. */
const CANNOT_BE_VERIFIED = 'cannot be verified';
const NESTED_MEMORIES_WRITE_KEYS = new Set(['update', 'updateMany', 'upsert']);

const UPDATE_MEMORIES_SET =
  /\bUPDATE\s+(?:ONLY\s+)?(?:(?:"public"|public)\.)?(?:"memories"|memories\b)(?:\s+(?:AS\s+)?\w+)?\s+SET\b/gi;
const INTO_MEMORIES = /\bINTO\s+(?:(?:"public"|public)\.)?(?:"memories"|memories\b)/gi;
const DO_OR_THEN_UPDATE_SET = /\b(?:DO|THEN)\s+UPDATE\s+SET\b/gi;
const SET_CLAUSE_BOUNDARY = /\b(?:FROM|WHERE|RETURNING)\b|;/i;
const CONTENT_COLUMN_ASSIGNMENT =
  /(?<![\w".])(?:"content"|content\b)\s*=(?!=)|\([^()]*(?<![\w".])(?:"content"|content\b)[^()]*\)\s*=/i;
const CANDIDATE_MEMORY_CALL =
  /\.memory\s*!?\??\.\s*(?:update(?:Many(?:AndReturn)?)?|upsert)\b|\bmemories\s*[:,}]/;
const CANDIDATE_MEMORIES_SQL =
  /\b(?:UPDATE(?:\s+ONLY)?|INTO)\s+(?:(?:\\?"public\\?"|public)\.)?(?:\\?"memories\\?"|memories\b)/i;

/**
 * Authorised `memories.content` write sites and their expected finding count.
 * This guard checks only that the site is known and counted; the clear itself
 * (`assistantSummary` and its companion summary columns in the same `data`
 * literal) is pinned by `MEM-ARCH-024: resets every summary column on a content edit`
 * in `services/api-gateway/src/routes/user/memorySingle.test.ts` (see also
 * `docs/intent/memory-archive/memory-archive-design.md` § The render stamp).
 */
export const ALLOWED_CONTENT_WRITERS: Readonly<Record<string, number>> = {
  'services/api-gateway/src/routes/user/memorySingle.ts': 1,
} as const;

export interface ContentWriterFinding {
  filePath: string;
  line: number;
  reason: string;
}

let sharedProject: Project | undefined;

function parseSource(sourceText: string): SourceFile {
  sharedProject ??= new Project({ useInMemoryFileSystem: true });
  return sharedProject.createSourceFile('__memory_content_writers__.ts', sourceText, {
    overwrite: true,
  });
}

/**
 * Whether `filePath` is a scanned production `.ts` file (skipping tests,
 * declarations, `generated/`, `__mocks__/`, `node_modules`, and `dist`).
 */
export function isScannedSourceFile(filePath: string): boolean {
  const normalized = filePath.replaceAll('\\', '/');
  if (!normalized.endsWith('.ts')) return false;
  if (
    normalized.endsWith('.test.ts') ||
    normalized.endsWith('.spec.ts') ||
    normalized.endsWith('.d.ts')
  ) {
    return false;
  }
  return !SKIP_PATH_SEGMENT.test(normalized);
}

function collectPackageSourceFiles(dir: string, rootDir: string, out: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectPackageSourceFiles(full, rootDir, out);
    } else if (isScannedSourceFile(relative(rootDir, full))) {
      out.push(full);
    }
  }
}

function getPropertyAssignmentKey(prop: PropertyAssignment): string | null {
  const nameNode = prop.getNameNode();
  if (Node.isComputedPropertyName(nameNode)) return null;
  return Node.isStringLiteral(nameNode) ? nameNode.getLiteralValue() : nameNode.getText();
}

function inspectDataProperty(
  prop: ObjectLiteralElementLike,
  calleeText: string,
  targetKey: string,
  filePath: string
): ContentWriterFinding | null {
  const line = prop.getStartLineNumber();
  if (Node.isSpreadAssignment(prop)) {
    return {
      filePath,
      line,
      reason: `${calleeText} write ${CANNOT_BE_VERIFIED} ('${targetKey}' has a spread assignment)`,
    };
  }
  if (Node.isShorthandPropertyAssignment(prop)) {
    return prop.getName() === 'content'
      ? { filePath, line, reason: `${calleeText} sets 'content' in '${targetKey}'` }
      : null;
  }
  if (Node.isPropertyAssignment(prop)) {
    const keyName = getPropertyAssignmentKey(prop);
    if (keyName === null) {
      return {
        filePath,
        line,
        reason: `${calleeText} write ${CANNOT_BE_VERIFIED} ('${targetKey}' has a computed key)`,
      };
    }
    return keyName === 'content'
      ? { filePath, line, reason: `${calleeText} sets 'content' in '${targetKey}'` }
      : null;
  }
  return {
    filePath,
    line,
    reason: `${calleeText} write ${CANNOT_BE_VERIFIED} ('${targetKey}' has a non-literal property)`,
  };
}

function inspectDataObject(
  dataObj: ObjectLiteralExpression,
  calleeText: string,
  targetKey: string,
  filePath: string
): ContentWriterFinding | null {
  for (const prop of dataObj.getProperties()) {
    const finding = inspectDataProperty(prop, calleeText, targetKey, filePath);
    if (finding !== null) return finding;
  }
  return null;
}

function unwrapExpression(node: Node | undefined): Node | undefined {
  let current = node;
  while (
    current !== undefined &&
    (Node.isAsExpression(current) ||
      Node.isSatisfiesExpression(current) ||
      Node.isParenthesizedExpression(current) ||
      Node.isNonNullExpression(current))
  ) {
    current = current.getExpression();
  }
  return current;
}

function inspectNestedMemoriesChildProperty(
  prop: ObjectLiteralElementLike,
  calleeText: string,
  filePath: string
): ContentWriterFinding | null {
  const line = prop.getStartLineNumber();
  if (Node.isSpreadAssignment(prop)) {
    return {
      filePath,
      line,
      reason: `${calleeText} nested write to 'memories' ${CANNOT_BE_VERIFIED} ('memories' has a spread assignment)`,
    };
  }
  if (Node.isShorthandPropertyAssignment(prop)) {
    const name = prop.getName();
    return NESTED_MEMORIES_WRITE_KEYS.has(name)
      ? {
          filePath,
          line,
          reason: `${calleeText} nested write to 'memories' ${CANNOT_BE_VERIFIED} ('memories.${name}' may write 'content')`,
        }
      : null;
  }
  if (Node.isPropertyAssignment(prop)) {
    const keyName = getPropertyAssignmentKey(prop);
    if (keyName === null) {
      return {
        filePath,
        line,
        reason: `${calleeText} nested write to 'memories' ${CANNOT_BE_VERIFIED} ('memories' has a computed key)`,
      };
    }
    return NESTED_MEMORIES_WRITE_KEYS.has(keyName)
      ? {
          filePath,
          line,
          reason: `${calleeText} nested write to 'memories' ${CANNOT_BE_VERIFIED} ('memories.${keyName}' may write 'content')`,
        }
      : null;
  }
  return {
    filePath,
    line,
    reason: `${calleeText} nested write to 'memories' ${CANNOT_BE_VERIFIED} ('memories' has a non-literal property)`,
  };
}

function inspectNestedMemoriesProperty(
  memoriesProp: ObjectLiteralElementLike,
  calleeText: string,
  filePath: string
): ContentWriterFinding | null {
  const propLine = memoriesProp.getStartLineNumber();
  const memoriesInit = Node.isPropertyAssignment(memoriesProp)
    ? unwrapExpression(memoriesProp.getInitializer())
    : undefined;
  if (memoriesInit === undefined || !Node.isObjectLiteralExpression(memoriesInit)) {
    return {
      filePath,
      line: propLine,
      reason: `${calleeText} nested write to 'memories' ${CANNOT_BE_VERIFIED} ('memories' is not an object literal)`,
    };
  }
  for (const prop of memoriesInit.getProperties()) {
    const finding = inspectNestedMemoriesChildProperty(prop, calleeText, filePath);
    if (finding !== null) return finding;
  }
  return null;
}

function inspectNestedMemoriesCall(
  call: CallExpression,
  calleeText: string,
  method: string,
  filePath: string
): ContentWriterFinding | null {
  const firstArg = unwrapExpression(call.getArguments()[0]);
  if (firstArg === undefined || !Node.isObjectLiteralExpression(firstArg)) {
    return null;
  }

  const targetKey = method === 'upsert' ? 'update' : 'data';
  const targetProp = firstArg.getProperty(targetKey);
  if (targetProp === undefined || !Node.isPropertyAssignment(targetProp)) {
    return null;
  }

  const targetInit = unwrapExpression(targetProp.getInitializer());
  if (targetInit === undefined || !Node.isObjectLiteralExpression(targetInit)) {
    return null;
  }

  const memoriesProp = targetInit.getProperty('memories');
  if (memoriesProp === undefined) {
    return null;
  }

  return inspectNestedMemoriesProperty(memoriesProp, calleeText, filePath);
}

function inspectMemoryCall(call: CallExpression, filePath: string): ContentWriterFinding | null {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return null;
  const method = callee.getName();
  if (!WRITE_METHODS.has(method)) return null;

  const modelAccess = unwrapExpression(callee.getExpression());
  if (!Node.isPropertyAccessExpression(modelAccess)) {
    return null;
  }

  const calleeText = callee.getText();
  if (modelAccess.getName() !== 'memory') {
    return inspectNestedMemoriesCall(call, calleeText, method, filePath);
  }

  const firstArg = unwrapExpression(call.getArguments()[0]);
  if (firstArg === undefined || !Node.isObjectLiteralExpression(firstArg)) {
    return {
      filePath,
      line: call.getStartLineNumber(),
      reason: `${calleeText} write ${CANNOT_BE_VERIFIED} (first argument is not an object literal)`,
    };
  }

  const targetKey = method === 'upsert' ? 'update' : 'data';
  const targetProp = firstArg.getProperty(targetKey);
  if (targetProp === undefined || !Node.isPropertyAssignment(targetProp)) {
    return {
      filePath,
      line: call.getStartLineNumber(),
      reason: `${calleeText} write ${CANNOT_BE_VERIFIED} ('${targetKey}' is not an object literal)`,
    };
  }

  const targetInit = unwrapExpression(targetProp.getInitializer());
  if (targetInit === undefined || !Node.isObjectLiteralExpression(targetInit)) {
    return {
      filePath,
      line: targetProp.getStartLineNumber(),
      reason: `${calleeText} write ${CANNOT_BE_VERIFIED} ('${targetKey}' is not an object literal)`,
    };
  }

  return inspectDataObject(targetInit, calleeText, targetKey, filePath);
}

function setClauseAssignsContent(afterSet: string): boolean {
  const boundary = SET_CLAUSE_BOUNDARY.exec(afterSet);
  const setClause = boundary ? afterSet.slice(0, boundary.index) : afterSet;
  return CONTENT_COLUMN_ASSIGNMENT.test(setClause);
}

function rawSqlAssignsMemoryContent(sqlText: string): boolean {
  for (const match of sqlText.matchAll(UPDATE_MEMORIES_SET)) {
    const afterSet = sqlText.slice(match.index + match[0].length);
    if (setClauseAssignsContent(afterSet)) return true;
  }
  for (const intoMatch of sqlText.matchAll(INTO_MEMORIES)) {
    const tail = sqlText.slice(intoMatch.index + intoMatch[0].length);
    const semicolonIndex = tail.indexOf(';');
    const afterInto = semicolonIndex === -1 ? tail : tail.slice(0, semicolonIndex);
    for (const updateSetMatch of afterInto.matchAll(DO_OR_THEN_UPDATE_SET)) {
      const afterSet = afterInto.slice(updateSetMatch.index + updateSetMatch[0].length);
      if (setClauseAssignsContent(afterSet)) return true;
    }
  }
  return false;
}

function extractLiteralSqlText(node: Node): string | null {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  if (Node.isTemplateExpression(node)) {
    return (
      node.getHead().getLiteralText() +
      node
        .getTemplateSpans()
        .map(span => `__param__${span.getLiteral().getLiteralText()}`)
        .join('')
    );
  }
  return null;
}

/**
 * Pure AST scan of a single TypeScript source file for `memories.content`
 * writes (Prisma `.memory.update`/`updateMany`/`upsert`, fail-closed dynamic
 * arguments on those calls, and raw SQL `UPDATE [ONLY] memories` /
 * `INTO memories ... DO/THEN UPDATE SET` assigning `content`).
 */
export function findContentWriters(filePath: string, sourceText: string): ContentWriterFinding[] {
  if (!CANDIDATE_MEMORY_CALL.test(sourceText) && !CANDIDATE_MEMORIES_SQL.test(sourceText)) {
    return [];
  }
  const sourceFile = parseSource(sourceText);
  const findings: ContentWriterFinding[] = [];

  sourceFile.forEachDescendant(node => {
    if (Node.isCallExpression(node)) {
      const callFinding = inspectMemoryCall(node, filePath);
      if (callFinding !== null) {
        findings.push(callFinding);
      }
      return;
    }
    const sqlText = extractLiteralSqlText(node);
    if (sqlText !== null && rawSqlAssignsMemoryContent(sqlText)) {
      findings.push({
        filePath,
        line: node.getStartLineNumber(),
        reason: "raw SQL on 'memories' assigns 'content' in SET clause",
      });
    }
  });

  return findings;
}

function collectAllScannedFiles(rootDir: string): string[] {
  const files: string[] = [];
  for (const root of ROOTS) {
    const rootPath = join(rootDir, root);
    let packages: string[];
    try {
      packages = readdirSync(rootPath).sort();
    } catch {
      continue;
    }
    for (const pkg of packages) {
      collectPackageSourceFiles(join(rootPath, pkg, 'src'), rootDir, files);
    }
  }
  return files;
}

/**
 * Scan all `packages/*\/src` and `services/*\/src` production `.ts` files under
 * `rootDir` and compare findings against `ALLOWED_CONTENT_WRITERS`.
 */
export function findContentWriterViolations(rootDir: string): ContentWriterFinding[] {
  const violations: ContentWriterFinding[] = [];
  const allowlistedCounts = new Map<string, number>();

  for (const file of collectAllScannedFiles(rootDir)) {
    const relPath = relative(rootDir, file).replaceAll('\\', '/');
    const findings = findContentWriters(relPath, readFileSync(file, 'utf-8'));
    if (Object.hasOwn(ALLOWED_CONTENT_WRITERS, relPath)) {
      const unreadable = findings.filter(f => f.reason.includes(CANNOT_BE_VERIFIED));
      allowlistedCounts.set(relPath, findings.length - unreadable.length);
      violations.push(...unreadable);
    } else {
      violations.push(...findings);
    }
  }

  for (const [allowedPath, expectedCount] of Object.entries(ALLOWED_CONTENT_WRITERS)) {
    const actualCount = allowlistedCounts.get(allowedPath) ?? 0;
    if (actualCount !== expectedCount) {
      violations.push({
        filePath: allowedPath,
        line: 1,
        reason: `expected ${expectedCount} allowlisted content writer(s), found ${actualCount}`,
      });
    }
  }

  return violations;
}

export function checkMemoryContentWriters(): void {
  const rootDir = process.cwd();
  const violations = findContentWriterViolations(rootDir);

  if (violations.length === 0) {
    console.log('✓ All `memories.content` writers match ALLOWED_CONTENT_WRITERS.');
    return;
  }

  const suffix = violations.length === 1 ? '' : 's';
  console.error(`❌ ${violations.length} \`memories.content\` writer violation${suffix} found:`);
  for (const v of violations) {
    console.error(`  ${v.filePath}:${v.line}  ${v.reason}`);
  }
  console.error(
    '\nA new content writer must clear the stored summary in the same write ' +
      '(`assistantSummary: null` and companion summary columns), then join ' +
      'ALLOWED_CONTENT_WRITERS in packages/tooling/src/dev/check-memory-content-writers.ts. ' +
      'A finding on an object that is not the Prisma delegate needs a literal argument or a rename, not the allowlist.'
  );
  process.exitCode = 1;
}
