import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cac } from 'cac';

import { registerImportConversationCommand } from './memory-import.js';
import { importConversation } from '../memory/import-conversation.js';

vi.mock('../memory/import-conversation.js', () => ({
  importConversation: vi.fn().mockResolvedValue(undefined),
}));

describe('memory:import-conversation --personality', () => {
  let cli: ReturnType<typeof cac>;
  let originalArgv: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    originalArgv = process.argv;
    cli = cac('test');
    registerImportConversationCommand(cli);
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  async function run(personalityArgs: string[]): Promise<void> {
    const args = [
      'memory:import-conversation',
      '--env',
      'dev',
      '--file',
      'conv.json',
      ...personalityArgs,
    ];
    // The action reads --personality from process.argv (cac would coerce an
    // all-digit value to a Number), so the raw argv has to carry it too.
    process.argv = ['node', 'ops', ...args];
    cli.parse(['node', 'test', ...args], { run: false });
    await (cli.runMatchedCommand() as Promise<void>);
  }

  it('passes an all-digit personality to importConversation as the raw string', async () => {
    await run(['--personality', '12345']);

    expect(importConversation).toHaveBeenCalledWith(
      expect.objectContaining({ personality: '12345' })
    );
  });

  it('preserves leading zeros that number coercion would drop', async () => {
    await run(['--personality', '007']);

    expect(importConversation).toHaveBeenCalledWith(
      expect.objectContaining({ personality: '007' })
    );
  });

  it('rejects a missing --personality without importing', async () => {
    await expect(run([])).rejects.toThrow('--personality is required');
    expect(importConversation).not.toHaveBeenCalled();
  });
});
