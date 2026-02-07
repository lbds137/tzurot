/**
 * Xray — JSON Formatter
 *
 * Simple JSON.stringify wrapper for piping to jq or other tools.
 */

import type { XrayReport } from '../types.js';

export function formatJson(report: XrayReport): string {
  return JSON.stringify(report, null, 2);
}
