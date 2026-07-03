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
];
