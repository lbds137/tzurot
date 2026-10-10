import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { ESLint, Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './no-message-metadata-rmw.js';

const linter = new Linter({ configType: 'flat' });

function lint(code: string): Linter.LintMessage[] {
  return linter.verify(code, [
    {
      languageOptions: {
        parser: tseslint.parser as unknown as Linter.Parser,
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      plugins: { test: { rules: { 'no-message-metadata-rmw': rule } } },
      rules: { 'test/no-message-metadata-rmw': 'error' },
    },
  ]);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The rule's effective setting for a file, as ESLint resolves the real root config. */
async function resolvedRuleSetting(relativePath: string): Promise<unknown> {
  const eslint = new ESLint({ cwd: repoRoot });
  const config = await eslint.calculateConfigForFile(path.join(repoRoot, relativePath));
  const rules = (config as { rules?: Record<string, unknown> } | undefined)?.rules;
  return rules?.['@tzurot/no-message-metadata-rmw'];
}

// The rule only protects the column if the root config turns it on; the
// test-file block overrides the production rule set, so both paths are checked.
describe('repo enablement — resolved severity from the real root config', () => {
  it('is an error for a production source file', async () => {
    expect(await resolvedRuleSetting('services/bot-client/src/index.ts')).toEqual([2]);
  });

  it('is an error for a test file', async () => {
    const testPath = 'packages/tooling/src/eslint/no-message-metadata-rmw.test.ts';
    expect(await resolvedRuleSetting(testPath)).toEqual([2]);
  });
});

describe('rule metadata', () => {
  it('is a problem rule with the messageMetadataRmw message', () => {
    expect(rule.meta?.type).toBe('problem');
    expect(rule.meta?.messages?.messageMetadataRmw).toBeDefined();
  });

  it('names the sanctioned replacement and the reason in the message', () => {
    // The rule exists because the type system does not stop the write; a
    // message that only forbids would leave the author guessing at the fix.
    const message = rule.meta?.messages?.messageMetadataRmw ?? '';
    expect(message).toContain('mergeMessageMetadata');
    expect(message).toContain('messageMetadataMerge.ts');
    expect(message).toContain('replaces the whole JSON blob');
  });
});

describe('invalid — messageMetadata in an existing-row write', () => {
  it('flags update()', () => {
    const messages = lint(
      `prisma.conversationHistory.update({ where: { id }, data: { messageMetadata: {} } });`
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('messageMetadataRmw');
  });

  it('flags updateMany()', () => {
    expect(
      lint(`prisma.conversationHistory.updateMany({ where: {}, data: { messageMetadata: m } });`)
    ).toHaveLength(1);
  });

  it('flags updateManyAndReturn()', () => {
    const messages = lint(
      `prisma.conversationHistory.updateManyAndReturn({ where: {}, data: { messageMetadata: {} } });`
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('messageMetadataRmw');
  });

  it('flags the update branch of an upsert', () => {
    expect(
      lint(
        `prisma.conversationHistory.upsert({ where: { id }, create: { content }, update: { messageMetadata: m } });`
      )
    ).toHaveLength(1);
  });

  it('flags the shorthand property', () => {
    expect(
      lint(`prisma.conversationHistory.update({ where: { id }, data: { messageMetadata } });`)
    ).toHaveLength(1);
  });

  it('flags a string-literal key', () => {
    expect(
      lint(`prisma.conversationHistory.update({ where: { id }, data: { 'messageMetadata': m } });`)
    ).toHaveLength(1);
  });

  it('flags the nested { set } form — the key is what replaces the blob', () => {
    expect(
      lint(
        `prisma.conversationHistory.update({ where: { id }, data: { messageMetadata: { set: m } } });`
      )
    ).toHaveLength(1);
  });

  it('flags alongside legitimate fields', () => {
    expect(
      lint(
        `prisma.conversationHistory.update({ where: { id }, data: { content, tokenCount, messageMetadata: m } });`
      )
    ).toHaveLength(1);
  });

  it('flags any receiver chain ending in conversationHistory', () => {
    expect(
      lint(
        `this.prisma.conversationHistory.update({ where: { id }, data: { messageMetadata: m } });`
      )
    ).toHaveLength(1);
    expect(
      lint(`tx.conversationHistory.update({ where: { id }, data: { messageMetadata: m } });`)
    ).toHaveLength(1);
    expect(
      lint(`conversationHistory.update({ where: { id }, data: { messageMetadata: m } });`)
    ).toHaveLength(1);
  });

  it('flags through optional chaining and TypeScript wrappers', () => {
    expect(
      lint(`prisma?.conversationHistory.update({ where: { id }, data: { messageMetadata: m } });`)
    ).toHaveLength(1);
    expect(
      lint(
        `prisma.conversationHistory.update({ where: { id }, data: { messageMetadata: m } as never });`
      )
    ).toHaveLength(1);
    expect(
      lint(
        `prisma!.conversationHistory.update({ where: { id }, data: { messageMetadata: m } satisfies X });`
      )
    ).toHaveLength(1);
  });

  it('flags a TypeScript-wrapped update branch of an upsert', () => {
    expect(
      lint(
        `prisma.conversationHistory.upsert({ where: { id }, create: { content }, update: { messageMetadata: m } as X });`
      )
    ).toHaveLength(1);
  });

  it('flags an explicit key written beside a spread', () => {
    // The spread itself is an accepted gap; the literal key next to it is still readable.
    expect(
      lint(
        `prisma.conversationHistory.update({ where: { id }, data: { ...a, messageMetadata: m } });`
      )
    ).toHaveLength(1);
  });

  it('flags optional chaining on the method itself', () => {
    expect(
      lint(`prisma.conversationHistory?.update({ where: { id }, data: { messageMetadata: m } });`)
    ).toHaveLength(1);
  });

  it('flags a literal computed key', () => {
    // A computed key whose expression is a string literal is statically readable.
    const code = `prisma.conversationHistory.update({ where: { id }, data: { ['messageMetadata']: m } });`;
    expect(lint(code)).toHaveLength(1);
  });

  it('reports each offending call', () => {
    const messages = lint(`
      prisma.conversationHistory.update({ where: { id }, data: { messageMetadata: a } });
      prisma.conversationHistory.updateMany({ where: {}, data: { messageMetadata: b } });
      prisma.conversationHistory.updateManyAndReturn({ where: {}, data: { messageMetadata: c } });
    `);
    expect(messages).toHaveLength(3);
  });
});

describe('valid — creation and unrelated writes are never flagged', () => {
  it('allows update() of other columns', () => {
    expect(
      lint(`prisma.conversationHistory.update({ where: { id }, data: { content: 'x' } });`)
    ).toHaveLength(0);
  });

  it('allows updateMany() of other columns', () => {
    expect(
      lint(`prisma.conversationHistory.updateMany({ where: {}, data: { deletedAt: now } });`)
    ).toHaveLength(0);
  });

  it('allows create()', () => {
    expect(
      lint(`prisma.conversationHistory.create({ data: { content, messageMetadata: m } });`)
    ).toHaveLength(0);
  });

  it('allows createMany()', () => {
    expect(
      lint(`prisma.conversationHistory.createMany({ data: [{ content, messageMetadata: m }] });`)
    ).toHaveLength(0);
  });

  it('allows createManyAndReturn()', () => {
    expect(
      lint(
        `prisma.conversationHistory.createManyAndReturn({ data: [{ content, messageMetadata: m }] });`
      )
    ).toHaveLength(0);
  });

  it('allows updateManyAndReturn() of other columns', () => {
    expect(
      lint(`prisma.conversationHistory.updateManyAndReturn({ where: {}, data: { content: 'x' } });`)
    ).toHaveLength(0);
  });

  it('allows messageMetadata in the create branch of an upsert', () => {
    expect(
      lint(
        `prisma.conversationHistory.upsert({ where: { id }, create: { content, messageMetadata: m }, update: { content } });`
      )
    ).toHaveLength(0);
  });

  it('allows a read that selects the column', () => {
    expect(
      lint(`prisma.conversationHistory.findMany({ select: { messageMetadata: true } });`)
    ).toHaveLength(0);
  });

  it('ignores the same payload on a different model', () => {
    expect(
      lint(`prisma.someOtherModel.update({ where: { id }, data: { messageMetadata: m } });`)
    ).toHaveLength(0);
  });

  it('ignores a payload-less or variable-payload call it cannot read', () => {
    // Accepted gap: the rule is syntactic and cannot follow a variable.
    expect(lint(`prisma.conversationHistory.update(args);`)).toHaveLength(0);
    expect(
      lint(`prisma.conversationHistory.update({ where: { id }, data: payload });`)
    ).toHaveLength(0);
  });

  it('ignores an aliased receiver', () => {
    // Accepted gap: the rule does not track the alias back to the model.
    const alias = `const h = prisma.conversationHistory;`;
    const call = `h.update({ where: { id }, data: { messageMetadata: m } });`;
    expect(lint(`${alias} ${call}`)).toHaveLength(0);
  });

  it('ignores a nested relation write through another model', () => {
    // Accepted gap: the outer call is persona.update, so the receiver does not match.
    const inner = `{ update: { data: { messageMetadata: m } } }`;
    const code = `persona.update({ data: { conversationHistory: ${inner} } });`;
    expect(lint(code)).toHaveLength(0);
  });

  it('ignores a spread-only payload', () => {
    // Accepted gap: the spread's contents are not readable.
    const code = `prisma.conversationHistory.update({ where: { id }, data: { ...patch } });`;
    expect(lint(code)).toHaveLength(0);
  });

  it('ignores a dynamic computed key', () => {
    // Accepted gap: the key expression is not a literal.
    const code = `prisma.conversationHistory.update({ where: { id }, data: { [k]: m } });`;
    expect(lint(code)).toHaveLength(0);
  });

  it('ignores a plain object that merely contains the key', () => {
    expect(lint(`const row = { data: { messageMetadata: m } };`)).toHaveLength(0);
  });
});
