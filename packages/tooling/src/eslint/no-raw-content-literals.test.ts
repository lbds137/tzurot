import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './no-raw-content-literals.js';

// TS syntax needs the typescript-eslint parser; no type program required.
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
          test: { rules: { 'no-raw-content-literals': rule } },
        },
        rules: { 'test/no-raw-content-literals': 'error' },
      },
    ],
    filename
  );
}

// Relative filenames: the flat-config Linter only applies configs to files
// under its basePath (the cwd), so absolute fixture paths would match nothing.
// This path is deliberately NOT in the allowlist → budget 0 → every raw
// literal reports.
const UNLISTED = 'services/bot-client/src/commands/__fixture__/handler.ts';

describe('rule metadata', () => {
  it('has problem type and the rawContent message', () => {
    expect(rule.meta?.type).toBe('problem');
    expect(rule.meta?.messages?.rawContent).toBeDefined();
  });
});

describe('direct content positions', () => {
  it('flags a bare string literal argument to a messaging method', () => {
    const messages = lint("await interaction.editReply('Something went wrong.');", UNLISTED);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('rawContent');
  });

  it('flags a template literal argument', () => {
    const messages = lint('await context.editReply(`Failed to load ${name}.`);', UNLISTED);
    expect(messages).toHaveLength(1);
  });

  it('passes a pure-interpolation template (string coercion, no copy)', () => {
    const messages = lint('await context.editReply(`${rendered}`);', UNLISTED);
    expect(messages).toHaveLength(0);
  });

  it('flags a string literal content property in an options object', () => {
    const messages = lint(
      "await interaction.followUp({ content: 'Expired.', flags: 64 });",
      UNLISTED
    );
    expect(messages).toHaveLength(1);
  });

  it('covers reply, editReply, followUp, update, and send', () => {
    for (const method of ['reply', 'editReply', 'followUp', 'update', 'send']) {
      const messages = lint(`await thing.${method}('raw copy');`, UNLISTED);
      expect(messages, method).toHaveLength(1);
    }
  });

  it('ignores non-messaging methods and non-content properties', () => {
    const clean = lint(
      "await interaction.respond([{ name: 'Choice', value: 'v' }]);\n" +
        'await interaction.followUp({ embeds: [], flags: 64 });\n' +
        "logger.info('not user facing');",
      UNLISTED
    );
    expect(clean).toHaveLength(0);
  });
});

describe('the catalog path passes', () => {
  it('allows call results as content', () => {
    const messages = lint(
      "await context.editReply({ content: renderSpec(CATALOG.error.notFound('Memory')) });\n" +
        'await interaction.reply(renderSpec(spec));',
      UNLISTED
    );
    expect(messages).toHaveLength(0);
  });

  it('allows imported constants (cross-module provenance is out of reach)', () => {
    const messages = lint(
      "import { AUTOCOMPLETE_UNAVAILABLE_MESSAGE } from '../../utils/apiCheck.js';\n" +
        'await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });',
      UNLISTED
    );
    expect(messages).toHaveLength(0);
  });
});

describe('composite expressions at content positions', () => {
  it('flags each literal branch of a conditional', () => {
    const messages = lint("await interaction.reply(ok ? 'It worked.' : 'It failed.');", UNLISTED);
    expect(messages).toHaveLength(2);
  });

  it('flags the literal side of a nullish fallback but not the call side', () => {
    const messages = lint("await interaction.reply(errorContent ?? 'Not found.');", UNLISTED);
    expect(messages).toHaveLength(1);
  });

  it('flags literals inside a + concatenation', () => {
    const messages = lint("await interaction.reply('Failed: ' + reason);", UNLISTED);
    expect(messages).toHaveLength(1);
  });
});

describe('one-hop same-file const resolution', () => {
  it('flags a const raw literal referenced at a content position', () => {
    const messages = lint(
      "const PAGE_LOAD_FAILED = 'Could not load that page.';\n" +
        'await interaction.followUp({ content: PAGE_LOAD_FAILED });',
      UNLISTED
    );
    expect(messages).toHaveLength(1);
    // The report lands on the declaration's literal — the copy lives there.
    expect(messages[0].line).toBe(1);
  });

  it('reports a multi-site const once (distinct copy, not distinct sends)', () => {
    const messages = lint(
      "const MSG = 'Could not load.';\n" +
        'await a.followUp({ content: MSG });\n' +
        'await b.editReply({ content: MSG });',
      UNLISTED
    );
    expect(messages).toHaveLength(1);
  });

  it('passes a const holding a call result', () => {
    const messages = lint(
      "const FETCH_ERROR = renderSpec(CATALOG.error.transient('x'));\n" +
        'await context.editReply({ content: FETCH_ERROR });',
      UNLISTED
    );
    expect(messages).toHaveLength(0);
  });
});

describe('scope and budgets', () => {
  it('ignores files outside the commands tree', () => {
    const messages = lint(
      "await interaction.reply('raw');",
      'services/bot-client/src/utils/helper.ts'
    );
    expect(messages).toHaveLength(0);
  });

  it('ignores test files', () => {
    const messages = lint(
      "await interaction.reply('raw');",
      'services/bot-client/src/commands/memory/browse.test.ts'
    );
    expect(messages).toHaveLength(0);
  });

  it('stays silent at or under an allowlisted budget and reports all when over', () => {
    // admin/kick.ts has a grandfathered budget of 1 (see raw-content-allowlist).
    const listed = 'services/bot-client/src/commands/admin/kick.ts';
    expect(lint("await interaction.reply('one raw literal');", listed)).toHaveLength(0);
    const over = lint(
      "await interaction.reply('one');\nawait interaction.followUp('two');",
      listed
    );
    expect(over).toHaveLength(2);
    expect(over[0].message).toContain('budget of 1');
  });
});
