// Two structural invariants for post-action rendering:
//
// 1. `ENFORCED_FILES` (raw-components check): files listed here must route any
//    `components: []` through the shared helpers (`renderTerminalScreen` or
//    `renderPostActionScreen`). Opt out per-line with `// intentionally-raw:
//    <reason>` when the empty-components render is genuinely non-terminal
//    (e.g., recoverable error paths, cancel flows).
//
// 2. `POST_ACTION_ENFORCED_FILES`: files listed here must additionally
//    **mention** `renderPostActionScreen` somewhere — the signal that
//    destructive-action terminal handlers have been migrated to the hybrid
//    pattern. Catches silent regressions where someone replaces
//    `renderPostActionScreen` with a raw `editReply` that still carries
//    components (and thus slips past the #1 check).

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Files that may not have unguarded `components: []` (raw terminal renders).
const ENFORCED_FILES = [
  'services/bot-client/src/commands/preset/dashboardButtons.ts',
  'services/bot-client/src/commands/character/dashboardButtons.ts',
  'services/bot-client/src/commands/character/dashboardDeleteHandlers.ts',
  'services/bot-client/src/commands/persona/dashboard.ts',
  'services/bot-client/src/utils/dashboard/refreshHandler.ts',
  'services/bot-client/src/commands/deny/detail.ts',
  'services/bot-client/src/commands/deny/detailEdit.ts',
];

// Files that must route destructive-action outcomes through
// `renderPostActionScreen`. If someone deletes the call, this test fires
// even when no raw `components: []` is introduced — the failure mode we
// saw in the early `renderTerminalScreen` migration.
const POST_ACTION_ENFORCED_FILES = [
  'services/bot-client/src/commands/preset/dashboardButtons.ts',
  'services/bot-client/src/commands/character/dashboardDeleteHandlers.ts',
  'services/bot-client/src/commands/persona/dashboard.ts',
  'services/bot-client/src/commands/deny/detail.ts',
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

  it.each(POST_ACTION_ENFORCED_FILES)('%s uses renderPostActionScreen', file => {
    const abs = resolve(REPO_ROOT, file);
    expect(existsSync(abs), `POST_ACTION_ENFORCED_FILES entry not found at ${abs}`).toBe(true);
    const source = readFileSync(abs, 'utf8');

    const hint =
      `Expected \`${file}\` to reference \`renderPostActionScreen\` — destructive-action ` +
      `handlers should route through the shared helper so success → direct re-render of the ` +
      `browse list and error → terminal with Back-to-Browse both work uniformly across commands. ` +
      `If this file has legitimately moved off the post-action pattern, remove it from ` +
      `POST_ACTION_ENFORCED_FILES in terminalScreen.structure.test.ts.`;

    expect(source.includes('renderPostActionScreen'), hint).toBe(true);
  });
});
