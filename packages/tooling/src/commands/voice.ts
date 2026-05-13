/**
 * Voice-related CLI commands.
 *
 * Environment support: local / dev / prod (same pattern as db: commands).
 */

import type { CAC } from 'cac';
import type { Environment } from '../utils/env-runner.js';

export function registerVoiceCommands(cli: CAC): void {
  cli
    .command(
      'voice-refs:audit',
      'Audit Personality voice references against the Mistral TTS 30s reference-audio cap'
    )
    .option('--env <env>', 'Environment: local, dev, or prod', { default: 'local' })
    .option('--json', 'Output as JSON instead of a colored table')
    .action(async (options: { env?: Environment; json?: boolean }) => {
      const { auditReferences } = await import('../voice/audit-references.js');
      await auditReferences(options);
    });
}
