// Canary file: deliberate complexity violation.
//
// This file MUST trip the lint:complexity-report tool. If the canary test
// ever runs against this file and finds 0 violations, the tool is broken
// (silently misconfigured, reading from the wrong path, threshold drift,
// or ESLint plugin removed the rule). DO NOT FIX this code. DO NOT REMOVE
// THIS FILE. It is intentional.
//
// Production lint skips `**/test-fixtures/**` (see eslint.config.js). The
// canary test invokes the tool with `--rule` overrides via runEslint,
// which force the complexity rule to apply to every file in `targetDirs`
// regardless of the resolved config's ignores. The custom `configPath`
// (sibling `eslint.config.mjs`) is needed to supply non-typed parserOptions
// — the root config uses typed-rules that can't parse .js files outside
// any tsconfig project. The function below has cyclomatic complexity = 25
// (well over the ESLint limit of 20).

export function knownComplex(a, b, c) {
  let result = 0;
  if (a > 0) result += 1;
  if (a > 1) result += 2;
  if (a > 2) result += 3;
  if (a > 3) result += 4;
  if (a > 4) result += 5;
  if (b > 0) result += 1;
  if (b > 1) result += 2;
  if (b > 2) result += 3;
  if (b > 3) result += 4;
  if (b > 4) result += 5;
  if (c > 0) result += 1;
  if (c > 1) result += 2;
  if (c > 2) result += 3;
  if (c > 3) result += 4;
  if (c > 4) result += 5;
  if (a + b > c) result += 1;
  if (b + c > a) result += 1;
  if (a + c > b) result += 1;
  if (a === b) result += 1;
  if (b === c) result += 1;
  if (a === c) result += 1;
  if (a !== 0) result += 1;
  if (b !== 0) result += 1;
  if (c !== 0) result += 1;
  return result;
}
