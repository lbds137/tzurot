/**
 * `memory:import-conversation` registration.
 *
 * Lives beside `memory.ts` (which is at its line budget) and is wired in from
 * `registerMemoryCommands`.
 */

import type { CAC } from 'cac';
import type { Environment } from '../utils/env-runner.js';
import { rawOptionValue } from '../utils/cli-args.js';
import { UsageError } from '../utils/errors.js';

interface ImportConversationCliOptions {
  env?: Environment;
  file?: string;
  apply?: boolean;
  verify?: boolean;
  force?: boolean;
}

export function registerImportConversationCommand(cli: CAC): void {
  cli
    .command(
      'memory:import-conversation',
      'Import an exported conversation (JSON turns) as memories for one personality (dry run unless --apply)'
    )
    .option('--env <env>', 'Environment: local, dev, or prod', { default: 'dev' })
    .option(
      '--file <path>',
      'Conversation JSON file: array of { role, text, timestamp } (required)'
    )
    .option('--personality <slug>', 'Personality slug the memories belong to (required)')
    .option(
      '--apply',
      'Write the memories (default is a dry run); re-running the same unedited file writes nothing, but an edited file that inserts or removes turns before the end writes new rows for the shifted tail (ids derive from pair position and prompt time)'
    )
    .option(
      '--verify',
      "Read back and check count, content, created_at and target (read-only); extras are tagged rows in this file's prompt range, so an overlapping import for the same character shows up as extras"
    )
    .option('--force', 'Skip production confirmation prompt')
    .action(async (options: ImportConversationCliOptions) => {
      if (options.file === undefined) {
        throw new UsageError('--file is required');
      }
      // A slug can be all digits, and cac number-coerces such a value at
      // tokenize time (a leading-zero slug would lose its zeros), so read it
      // from raw argv (see utils/cli-args.ts).
      const personality = rawOptionValue(process.argv, '--personality');
      if (personality === undefined) {
        throw new UsageError('--personality is required');
      }
      const { importConversation } = await import('../memory/import-conversation.js');
      await importConversation({
        env: options.env ?? 'dev',
        file: options.file,
        personality,
        apply: options.apply,
        verify: options.verify,
        force: options.force,
      });
    });
}
