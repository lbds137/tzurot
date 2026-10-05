/**
 * `memory:import-conversation` registration.
 *
 * Lives beside `memory.ts` (which is at its line budget) and is wired in from
 * `registerMemoryCommands`.
 */

import type { CAC } from 'cac';
import type { Environment } from '../utils/env-runner.js';
import { UsageError } from '../utils/errors.js';

interface ImportConversationCliOptions {
  env?: Environment;
  file?: string;
  personality?: string;
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
    .option('--apply', 'Write the memories (default is a dry run)')
    .option('--verify', 'Read back and check count, content, created_at and target (read-only)')
    .option('--force', 'Skip production confirmation prompt')
    .action(async (options: ImportConversationCliOptions) => {
      if (options.file === undefined) {
        throw new UsageError('--file is required');
      }
      if (options.personality === undefined) {
        throw new UsageError('--personality is required');
      }
      const { importConversation } = await import('../memory/import-conversation.js');
      await importConversation({
        env: options.env ?? 'dev',
        file: options.file,
        personality: options.personality,
        apply: options.apply,
        verify: options.verify,
        force: options.force,
      });
    });
}
