/**
 * Stryker ignorer plugin: skip mutants inside logger-call statements.
 *
 * Log statements are observability, not behavior — no test should assert on
 * pino payload shapes or message wording as a matter of course, so mutants in
 * `logger.info({...}, '...')` arguments are structurally unkillable noise. The
 * pilot measured them as ~2/3 of all surviving mutants while the logic-class
 * score sat at 97%+. Ignoring them (rather than excluding the ObjectLiteral/
 * StringLiteral mutators wholesale) keeps meaningful string/object mutants —
 * cache keys, result shapes, model names — in the measured population.
 *
 * Scope: an ExpressionStatement whose expression is a call to
 * `<something>logger.{trace|debug|info|warn|error|fatal}(...)` — covers both
 * module-level `logger.x()` and class-member `this.logger.x()`. Deliberate
 * warn-severity assertions (the resolver suites pin warn-vs-error contracts)
 * are unaffected: those tests assert via the mocked logger, and ignoring the
 * mutants only removes them from the SCORE, not the tests.
 */

import { PluginKind, declareValuePlugin } from '@stryker-mutator/api/plugin';

const LOG_METHODS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

/** Is this CallExpression node a `*logger.<level>(...)` call? */
function isLoggerCall(callNode) {
  const callee = callNode.callee;
  if (callee?.type !== 'MemberExpression') {
    return false;
  }
  const prop = callee.property;
  if (prop?.type !== 'Identifier' || !LOG_METHODS.has(prop.name)) {
    return false;
  }
  const obj = callee.object;
  // `logger.warn(...)` / `mockLogger.warn(...)`
  if (obj?.type === 'Identifier' && /logger$/i.test(obj.name)) {
    return true;
  }
  // `this.logger.warn(...)` / `foo.logger.warn(...)`
  if (
    obj?.type === 'MemberExpression' &&
    obj.property?.type === 'Identifier' &&
    /logger$/i.test(obj.property.name)
  ) {
    return true;
  }
  return false;
}

/**
 * Option-callback names whose entire bodies are observability payload
 * builders: `BaseCacheInvalidationService`'s `logOptions.getLogContext` /
 * `getEventDescription` exist ONLY to decorate log lines (their returns feed
 * `logger.info` and nothing else). Their definitions live one property away
 * from the logger call, and their consumption sites build intermediates one
 * statement before it — both invisible to the logger-call rule above, and
 * both measured as the dominant survivor class in this package (151/242 on
 * the first report-only run).
 */
const OBSERVABILITY_CALLBACK_NAMES = new Set(['getLogContext', 'getEventDescription']);

/** Is this path inside an object property named getLogContext/getEventDescription? */
function isInsideObservabilityCallback(path) {
  let current = path;
  while (current) {
    const node = current.node;
    if (
      (node?.type === 'ObjectProperty' || node?.type === 'ObjectMethod') &&
      node.key?.type === 'Identifier' &&
      OBSERVABILITY_CALLBACK_NAMES.has(node.key.name)
    ) {
      return true;
    }
    current = current.parentPath;
  }
  return false;
}

/** Does this expression subtree reference `logOptions` (the consumption sites)? */
function referencesLogOptions(node) {
  if (node === null || typeof node !== 'object') {
    return false;
  }
  if (node.type === 'Identifier' && node.name === 'logOptions') {
    return true;
  }
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') {
      continue;
    }
    const value = node[key];
    if (Array.isArray(value)) {
      if (value.some(referencesLogOptions)) {
        return true;
      }
    } else if (referencesLogOptions(value)) {
      return true;
    }
  }
  return false;
}

export const strykerPlugins = [
  declareValuePlugin(PluginKind.Ignore, 'logger-calls', {
    shouldIgnore(path) {
      if (
        path.isExpressionStatement() &&
        path.node.expression.type === 'CallExpression' &&
        isLoggerCall(path.node.expression)
      ) {
        return 'Logger-call statement: observability payloads are unkillable mutation noise.';
      }
      return undefined;
    },
  }),
  declareValuePlugin(PluginKind.Ignore, 'observability-options', {
    shouldIgnore(path) {
      if (isInsideObservabilityCallback(path)) {
        return 'Observability option callback (getLogContext/getEventDescription): log-decoration only.';
      }
      if (
        path.isVariableDeclarator() &&
        path.node.init !== null &&
        referencesLogOptions(path.node.init)
      ) {
        return 'logOptions consumption: builds log-line intermediates only.';
      }
      return undefined;
    },
  }),
];
