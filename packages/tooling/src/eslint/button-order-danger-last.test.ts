import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import rule from './button-order-danger-last.js';

const linter = new Linter({ configType: 'flat' });

function lint(code: string): Linter.LintMessage[] {
  return linter.verify(code, [
    {
      languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
      plugins: { test: { rules: { 'button-order-danger-last': rule } } },
      rules: { 'test/button-order-danger-last': 'error' },
    },
  ]);
}

const DANGER =
  "new ButtonBuilder().setCustomId('d').setLabel('Delete').setStyle(ButtonStyle.Danger)";
const SAFE =
  "new ButtonBuilder().setCustomId('c').setLabel('Cancel').setStyle(ButtonStyle.Secondary)";

describe('rule metadata', () => {
  it('has problem type and the dangerBeforeSafe message', () => {
    expect(rule.meta?.type).toBe('problem');
    expect(rule.meta?.messages?.dangerBeforeSafe).toBeDefined();
  });
});

describe('violations', () => {
  it('flags Danger preceding a non-Danger sibling in addComponents', () => {
    const messages = lint(`row.addComponents(${DANGER}, ${SAFE});`);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('dangerBeforeSafe');
  });

  it('flags the array-argument call shape', () => {
    const messages = lint(`row.addComponents([${DANGER}, ${SAFE}]);`);
    expect(messages).toHaveLength(1);
  });

  it('flags setComponents too', () => {
    const messages = lint(`row.setComponents(${DANGER}, ${SAFE});`);
    expect(messages).toHaveLength(1);
  });

  it('detects the style through interleaved fluent methods', () => {
    const messages = lint(
      `row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Danger).setEmoji('🗑️').setLabel('Delete'), ${SAFE});`
    );
    expect(messages).toHaveLength(1);
  });

  it('reports each offending Danger button once', () => {
    const messages = lint(`row.addComponents(${DANGER}, ${DANGER}, ${SAFE});`);
    expect(messages).toHaveLength(2);
  });
});

describe('allowed shapes', () => {
  it('allows Danger last', () => {
    const messages = lint(`row.addComponents(${SAFE}, ${DANGER});`);
    expect(messages).toHaveLength(0);
  });

  it('allows a lone Danger button', () => {
    const messages = lint(`row.addComponents(${DANGER});`);
    expect(messages).toHaveLength(0);
  });

  it('allows consecutive Danger buttons with nothing after', () => {
    const messages = lint(`row.addComponents(${SAFE}, ${DANGER}, ${DANGER});`);
    expect(messages).toHaveLength(0);
  });

  it('does not flag when the later sibling style is not statically visible', () => {
    // Variables are invisible to the rule — documented limitation; the
    // factories own those shapes.
    const messages = lint(`row.addComponents(${DANGER}, cancelButton);`);
    expect(messages).toHaveLength(0);
  });

  it('does not flag variables preceding an inline Danger', () => {
    const messages = lint(`row.addComponents(confirmButton, ${DANGER});`);
    expect(messages).toHaveLength(0);
  });

  it('ignores unrelated addComponents calls (selects, inputs)', () => {
    const messages = lint("row.addComponents(new StringSelectMenuBuilder().setCustomId('s'));");
    expect(messages).toHaveLength(0);
  });

  it('ignores non-component method calls', () => {
    const messages = lint(`list.push(${DANGER}, ${SAFE});`);
    expect(messages).toHaveLength(0);
  });

  it('ignores buttons without a visible style', () => {
    const messages = lint(
      "row.addComponents(new ButtonBuilder().setCustomId('a'), new ButtonBuilder().setCustomId('b'));"
    );
    expect(messages).toHaveLength(0);
  });

  it('resolves a double setStyle to the LAST-executed call (runtime winner)', () => {
    // Danger then Secondary: the builder ends up Secondary — correctly ordered.
    const messages = lint(
      `row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Danger).setLabel('x').setStyle(ButtonStyle.Secondary), ${SAFE});`
    );
    expect(messages).toHaveLength(0);
  });
});

describe('double setStyle violation', () => {
  it('flags when the last-executed style is Danger and a safe sibling follows', () => {
    const messages = lint(
      `row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel('x').setStyle(ButtonStyle.Danger), ${SAFE});`
    );
    expect(messages).toHaveLength(1);
  });
});
