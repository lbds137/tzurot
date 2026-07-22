/**
 * Security commands: enumerate open GitHub Dependabot advisories with the
 * direct/transitive split that decides whether Dependabot will auto-PR a fix
 * or a manual `pnpm.overrides` bump is needed. Implementation in
 * ../audits/advisories.ts.
 */

import type { CAC } from 'cac';

/** One lazy-import site so the module path literal exists exactly once. */
async function loadAdvisories(): Promise<typeof import('../audits/advisories.js')> {
  return import('../audits/advisories.js');
}

export function registerSecurityCommands(cli: CAC): void {
  cli
    .command(
      'security:advisories',
      'List open Dependabot advisories with fix versions + direct/transitive split'
    )
    .option('--json', 'Emit the advisory surface as JSON')
    .option(
      '--strict',
      'Exit nonzero when an actionable (fix-available) high/critical advisory is open'
    )
    .example('ops security:advisories')
    .example('ops security:advisories --json')
    .example('ops security:advisories --strict')
    .action((options: { json?: boolean; strict?: boolean }) => {
      return loadAdvisories().then(({ runAdvisoriesCommand }) => {
        runAdvisoriesCommand({ json: options.json, strict: options.strict });
      });
    });
}
