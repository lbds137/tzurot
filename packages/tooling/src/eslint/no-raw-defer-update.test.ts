import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './no-raw-defer-update.js';

const linter = new Linter({ configType: 'flat' });

function lint(code: string): Linter.LintMessage[] {
  return linter.verify(code, [
    {
      languageOptions: {
        parser: tseslint.parser as unknown as Linter.Parser,
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      plugins: { test: { rules: { 'no-raw-defer-update': rule } } },
      rules: { 'test/no-raw-defer-update': 'error' },
    },
  ]);
}

describe('rule metadata', () => {
  it('is a problem rule with the rawDeferUpdate message', () => {
    expect(rule.meta?.type).toBe('problem');
    expect(rule.meta?.messages?.rawDeferUpdate).toBeDefined();
  });
});

describe('invalid — raw deferUpdate is banned', () => {
  it('flags interaction.deferUpdate()', () => {
    const messages = lint('async function h(i) { await i.deferUpdate(); }');
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('rawDeferUpdate');
  });

  it('flags it regardless of the receiver name', () => {
    expect(lint('async function h(btn) { await btn.deferUpdate(); }')).toHaveLength(1);
  });

  it('flags a deferUpdate inside a conditional guard', () => {
    expect(
      lint('async function h(i) { if (!i.deferred) { await i.deferUpdate(); } }')
    ).toHaveLength(1);
  });
});

describe('valid — the wrapper and unrelated calls', () => {
  it('allows ackUpdate(interaction)', () => {
    expect(lint('async function h(i) { await ackUpdate(i); }')).toHaveLength(0);
  });

  it('allows deferReply (a different ack, safe by default)', () => {
    expect(lint('async function h(i) { await i.deferReply(); }')).toHaveLength(0);
  });

  it('does not flag a computed member access', () => {
    // `x['deferUpdate']()` is not the plain-call shape we guard.
    expect(lint("async function h(i) { await i['deferUpdate'](); }")).toHaveLength(0);
  });
});
