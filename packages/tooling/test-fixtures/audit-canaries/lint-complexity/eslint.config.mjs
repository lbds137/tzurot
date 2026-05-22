// Minimal ESLint config for the audit-canary fixture directory.
//
// This file exists ONLY to prevent ESLint from finding the project's root
// `eslint.config.js`, which loads the strict typed-rules preset and requires
// every file to be in a tsconfig project. The canary `.js` fixtures aren't
// in any tsconfig (by design — they're deliberately-bad input, not real
// source). Loading this minimal config instead bypasses the typed-rules.
//
// The actual rule thresholds (complexity, max-lines, etc.) used during the
// canary scan come from `buildRuleOverrides()` in `complexity-report.ts`,
// which passes them via `--rule=...` CLI flags. CLI flags override anything
// in this config file, so rules declared here would be dead — intentionally
// empty.

export default [{}];
