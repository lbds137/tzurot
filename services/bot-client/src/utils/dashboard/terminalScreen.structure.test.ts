// Enforces renderTerminalScreen usage in files listed in ENFORCED_FILES — add a file to migrate it; opt out per-line with `// intentionally-raw: <reason>`.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Add a file here when you migrate its delete/archive/confirm handlers.
const ENFORCED_FILES = [
  'services/bot-client/src/commands/preset/dashboardButtons.ts',
  'services/bot-client/src/commands/character/dashboardButtons.ts',
  'services/bot-client/src/commands/character/dashboardDeleteHandlers.ts',
  'services/bot-client/src/commands/persona/dashboard.ts',
  'services/bot-client/src/utils/dashboard/refreshHandler.ts',
];

const REPO_ROOT = resolve(__dirname, '../../../../..');

const RAW_COMPONENTS_RX = /components:\s*\[\s*\]/;
const OPT_OUT_MARKER = 'intentionally-raw:';

describe('dashboard terminal screen discipline', () => {
  it.each(ENFORCED_FILES)('%s routes post-action screens through renderTerminalScreen', file => {
    const abs = resolve(REPO_ROOT, file);
    // Hard-fail if the file moved — a vacuous pass on a missing file would
    // silently let the invariant rot.
    expect(existsSync(abs), `ENFORCED_FILES entry not found at ${abs}`).toBe(true);
    const source = readFileSync(abs, 'utf8');
    const lines = source.split('\n');

    const violations: Array<{ line: number; text: string }> = [];
    lines.forEach((line, idx) => {
      if (!RAW_COMPONENTS_RX.test(line)) return;

      // Opt-out: same line or within the preceding 3 lines.
      const context = lines.slice(Math.max(0, idx - 3), idx + 1).join('\n');
      if (context.includes(OPT_OUT_MARKER)) return;

      violations.push({ line: idx + 1, text: line.trim() });
    });

    const hint =
      `Raw \`components: []\` in a terminal handler — route the call through \`renderTerminalScreen\` ` +
      `(services/bot-client/src/utils/dashboard/terminalScreen.ts) so dashboards opened from /browse ` +
      `always offer a Back-to-Browse affordance. If intentional, prefix the line with a ` +
      `\`// intentionally-raw: <reason>\` comment.`;

    expect(
      violations,
      `${file}: ${hint}\nOffenders:\n${JSON.stringify(violations, null, 2)}`
    ).toEqual([]);
  });
});
