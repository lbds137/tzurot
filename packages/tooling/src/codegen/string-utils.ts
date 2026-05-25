/**
 * String utilities shared by the codegen modules.
 *
 * Lightweight by design — keep this file small and dependency-free so
 * any codegen module can import it without circular-import risk.
 */

/**
 * Capitalize the first character. For the manifest's camelCase route ids
 * this is the equivalent of camelCase → PascalCase
 * (`getRecentDiagnostics` → `GetRecentDiagnostics`). Does NOT handle
 * kebab-case or snake_case input — `get-timezone` would yield
 * `Get-timezone`, not `GetTimezone`. The manifest's per-audience invariant
 * tests in `routes/*.test.ts` enforce camelCase ids; non-camelCase input
 * would surface as a missing handler at codegen time.
 */
export function capitalizeFirst(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}
