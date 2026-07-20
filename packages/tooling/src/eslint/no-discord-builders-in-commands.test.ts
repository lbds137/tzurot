import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './no-discord-builders-in-commands.js';

// import-type syntax needs the typescript-eslint parser; no type program required.
const linter = new Linter({ configType: 'flat' });

function lint(code: string, filename: string): Linter.LintMessage[] {
  return linter.verify(
    code,
    [
      {
        files: ['**/*.ts'],
        languageOptions: {
          parser: tseslint.parser as unknown as Linter.Parser,
          ecmaVersion: 2022,
          sourceType: 'module',
        },
        plugins: {
          test: { rules: { 'no-discord-builders-in-commands': rule } },
        },
        rules: { 'test/no-discord-builders-in-commands': 'error' },
      },
    ],
    filename
  );
}

// Relative filenames: the flat-config Linter only applies configs to files
// under its basePath (the cwd), so absolute fixture paths would match nothing.
const COMMANDS = 'services/bot-client/src/commands';

describe('rule metadata', () => {
  it('has problem type and the restrictedBuilder message', () => {
    expect(rule.meta?.type).toBe('problem');
    expect(rule.meta?.messages?.restrictedBuilder).toBeDefined();
  });
});

describe('flagging value imports in command files', () => {
  it('flags a restricted builder value import in a non-allowlisted file', () => {
    const messages = lint(
      "import { EmbedBuilder } from 'discord.js';",
      `${COMMANDS}/history/stats.ts`
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('restrictedBuilder');
  });

  it('flags only the restricted symbols in a mixed import', () => {
    const messages = lint(
      "import { ButtonBuilder, MessageFlags, ChatInputCommandInteraction } from 'discord.js';",
      `${COMMANDS}/history/stats.ts`
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain('ButtonBuilder');
  });

  it('flags a symbol NOT in the grandfathered set of an allowlisted file', () => {
    // admin/broadcast.ts is allowlisted for EmbedBuilder only.
    const messages = lint(
      "import { EmbedBuilder, ButtonBuilder } from 'discord.js';",
      `${COMMANDS}/admin/broadcast.ts`
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain('ButtonBuilder');
  });

  it('flags Components-V2 builders outside the pilot allowlist entry', () => {
    const messages = lint(
      "import { ContainerBuilder } from 'discord.js';",
      `${COMMANDS}/persona/view.ts`
    );
    expect(messages).toHaveLength(1);
  });
});

describe('allowed shapes', () => {
  it('allows a grandfathered (file, symbol) pair', () => {
    const messages = lint(
      "import { EmbedBuilder } from 'discord.js';",
      `${COMMANDS}/admin/broadcast.ts`
    );
    expect(messages).toHaveLength(0);
  });

  it('allows type-only import declarations', () => {
    const messages = lint(
      "import type { EmbedBuilder } from 'discord.js';",
      `${COMMANDS}/history/stats.ts`
    );
    expect(messages).toHaveLength(0);
  });

  it('allows inline type specifiers', () => {
    const messages = lint(
      "import { type EmbedBuilder, MessageFlags } from 'discord.js';",
      `${COMMANDS}/history/stats.ts`
    );
    expect(messages).toHaveLength(0);
  });

  it('allows SlashCommandBuilder — command definitions belong in command files', () => {
    const messages = lint(
      "import { SlashCommandBuilder, ContextMenuCommandBuilder } from 'discord.js';",
      `${COMMANDS}/history/index.ts`
    );
    expect(messages).toHaveLength(0);
  });

  it('ignores files outside the commands tree', () => {
    const messages = lint(
      "import { EmbedBuilder } from 'discord.js';",
      'services/bot-client/src/utils/browse/listEmbedBuilder.ts'
    );
    expect(messages).toHaveLength(0);
  });

  it('ignores imports from modules other than discord.js', () => {
    const messages = lint(
      "import { EmbedBuilder } from './localShim.js';",
      `${COMMANDS}/history/stats.ts`
    );
    expect(messages).toHaveLength(0);
  });
});
