/**
 * Markdown helpers shared by the telemetry report renderers. Pure functions,
 * no DB or I/O access.
 */

/**
 * Personality names AND model strings are user-controlled (LlmConfig.model is
 * an unrestricted string and catalog validation is skippable when the model
 * cache is unavailable), so every string cell that can originate from user
 * input is escaped: a literal `|` or newline would break its row's cell
 * structure — or fabricate rows — in any markdown-rendering surface the
 * report gets pasted into.
 */
export function escapeTableCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll(/\r?\n/g, ' ');
}
