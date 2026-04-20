/**
 * Structural test — enforces that dashboard terminal handlers route through
 * {@link renderTerminalScreen} instead of assembling their own `editReply`
 * with `components: []`.
 *
 * Why this exists: we shipped back-to-browse bugs twice (preset delete, then
 * preset clone) because each terminal handler independently decided what
 * components to render. The fix (PR #836) centralised the pattern into
 * `renderTerminalScreen`, and this test enforces adoption for files added
 * to ENFORCED_FILES below.
 *
 * To migrate a new command's dashboard: add its handler file path to
 * ENFORCED_FILES, run the test, fix any flagged lines by routing through
 * `renderTerminalScreen`, and commit. The test will then keep it correct.
 *
 * Intentional opt-outs: prefix the line with a `// intentionally-raw:` comment
 * explaining why. The check is a line-level regex, not AST, so opt-outs are
 * simple string matches.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Files whose terminal (post-action) screens must use `renderTerminalScreen`.
 * Add a file here when you migrate its delete/archive/confirm handlers.
 */
const ENFORCED_FILES = ['services/bot-client/src/commands/preset/dashboardButtons.ts'];

const REPO_ROOT = resolve(__dirname, '../../../../..');

const RAW_COMPONENTS_RX = /components:\s*\[\s*\]/;
const OPT_OUT_MARKER = 'intentionally-raw:';

describe('dashboard terminal screen discipline', () => {
  it.each(ENFORCED_FILES)('%s routes post-action screens through renderTerminalScreen', file => {
    const abs = resolve(REPO_ROOT, file);
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
