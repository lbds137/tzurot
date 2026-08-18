import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './no-regex-tag-strip.js';

const linter = new Linter({ configType: 'flat' });

function lint(code: string): Linter.LintMessage[] {
  return linter.verify(code, [
    {
      languageOptions: {
        parser: tseslint.parser as unknown as Linter.Parser,
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      plugins: { test: { rules: { 'no-regex-tag-strip': rule } } },
      rules: { 'test/no-regex-tag-strip': 'error' },
    },
  ]);
}

describe('rule metadata', () => {
  it('is a problem rule with the regexTagStrip message', () => {
    expect(rule.meta?.type).toBe('problem');
    expect(rule.meta?.messages?.regexTagStrip).toBeDefined();
  });

  it('names the supported replacement in the message', () => {
    // The rule exists because prose naming the replacement was not enough;
    // a message that only says "don't" would repeat that failure.
    expect(rule.meta?.messages?.regexTagStrip).toContain('extractXmlTextContent');
  });
});

describe('invalid — regex tag stripping is banned', () => {
  it('flags the exact pattern CodeQL caught in production', () => {
    const messages = lint(`const untagged = result.replace(/<[^>]*>/g, '');`);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('regexTagStrip');
  });

  it('flags the + quantifier variant', () => {
    expect(lint(`const s = input.replace(/<[^>]+>/g, '');`)).toHaveLength(1);
  });

  it('flags the closing-tag variant', () => {
    expect(lint(`const s = input.replace(/<\\/[^>]*>/g, '');`)).toHaveLength(1);
  });

  it('flags it regardless of flags', () => {
    expect(lint(`const s = input.replace(/<[^>]*>/gi, '');`)).toHaveLength(1);
  });

  it('flags the shape outside .replace — the defect is the regex, not the caller', () => {
    // split/match over untrusted markup have the same incomplete-sanitization
    // problem, and a rule keyed on `.replace` would wave them through.
    expect(lint(`const parts = input.split(/<[^>]*>/g);`)).toHaveLength(1);
    expect(lint(`const TAGS = /<[^>]*>/g;`)).toHaveLength(1);
  });

  it('reports the offending pattern in the message data', () => {
    const messages = lint(`const s = input.replace(/<[^>]*>/g, '');`);
    expect(messages[0].message).toContain('/<[^>]*>/g');
  });

  describe('variants that are just as insecure', () => {
    // These are the forms a search result actually hands you. A rule that
    // caught only the greedy `[^>]*`/`[^>]+` form would read as though it
    // banned the class while leaving the likeliest paths open.
    it.each([
      ['lazy negated class', `const s = input.replace(/<[^>]*?>/g, '');`],
      ['lazy dot', `const s = input.replace(/<.*?>/g, '');`],
      ['greedy dot', `const s = input.replace(/<.*>/g, '');`],
      ['doubly-negated class', `const s = input.replace(/<[^<>]*>/g, '');`],
      ['bounded quantifier', `const s = input.replace(/<[^>]{1,}>/g, '');`],
      // One pattern matching BOTH an opening and a closing tag — the canonical
      // "strip all tags" idiom, and arguably more common than the
      // opening-tag-only form this rule was first built around.
      ['optional-slash open/close', `const s = input.replace(/<\\/?[^>]*>/g, '');`],
      ['optional-slash with lazy dot', `const s = input.replace(/<\\/?.*?>/g, '');`],
    ])('flags the %s form', (_label, code) => {
      expect(lint(code)).toHaveLength(1);
    });
  });

  describe('grouped atoms are the same pattern', () => {
    // What a search result hands you as often as the bare forms. Three review
    // rounds each found another spelling; normalizing group syntax away is
    // what stopped the enumeration.
    it.each([
      ['capturing group around a dot', `const s = input.replace(/<(.*?)>/g, '');`],
      ['capturing group around a class', `const s = input.replace(/<([^>]*)>/g, '');`],
      ['non-capturing group', `const s = input.replace(/<(?:[^>]*)>/g, '');`],
      ['named capture group', `const s = input.replace(/<(?<tag>[^>]*)>/g, '');`],
      ['named group around a dot', `const s = input.replace(/<(?<tag>.*?)>/g, '');`],
      ['jQuery-style trailing alternation', `const s = input.replace(/<\\/?[^>]+(>|$)/g, '');`],
    ])('flags the %s form', (_label, code) => {
      expect(lint(code)).toHaveLength(1);
    });

    it('still leaves a delimited structured matcher alone', () => {
      // Discord's mention pattern is delimited exactly like a tag but matches
      // ONE known structure — requiring a negated class or dot is what keeps
      // the rule off it. This is a real pattern in BotMentionProcessor.
      expect(lint(`const re = /<@!?\\d+>/;`)).toHaveLength(0);
    });
  });

  describe('leading disambiguators do not exempt it', () => {
    // What someone reaches for after being told the bare form over-matches
    // `a<b`. The unbounded [^>]* survives in front of the closing bracket, so
    // it is still the shape CodeQL flags.
    it.each([
      ['letter class', `const s = input.replace(/<[a-zA-Z][^>]*>/g, '');`],
      ['letter class with slash', `const s = input.replace(/<\\/?[a-zA-Z][^>]*>/g, '');`],
      ['quantified letter class', `const s = input.replace(/<[A-Za-z]+[^>]*>/g, '');`],
    ])('flags the %s form', (_label, code) => {
      expect(lint(code)).toHaveLength(1);
    });

    it("leaves Discord's own delimited patterns alone", () => {
      // Both are bracket-delimited like a tag but match ONE known structure,
      // with no unbounded negated-class run. Real patterns in this codebase.
      expect(lint(`const mention = /<@!?\\d+>/;`)).toHaveLength(0);
      expect(lint(`const emoji = /<a?:\\w+:\\d+>/;`)).toHaveLength(0);
    });
  });

  describe('the RegExp constructor is the same pattern', () => {
    it('flags new RegExp with an inlined string', () => {
      const messages = lint(`const re = new RegExp('<[^>]*>', 'g');`);
      expect(messages).toHaveLength(1);
      expect(messages[0].messageId).toBe('regexTagStrip');
    });

    it('flags RegExp called without new', () => {
      expect(lint(`const re = RegExp('<.*?>', 'g');`)).toHaveLength(1);
    });

    it('renders the constructor form in the message', () => {
      const messages = lint(`const re = new RegExp('<[^>]*>', 'g');`);
      expect(messages[0].message).toContain("new RegExp('<[^>]*>')");
    });

    it('does not flag an unrelated RegExp construction', () => {
      expect(lint(`const re = new RegExp('^foo$');`)).toHaveLength(0);
    });

    it('flags a zero-interpolation template literal argument', () => {
      // Backticks are already this codebase's habit for `new RegExp(...)`, and
      // a template literal with no interpolation is exactly as statically
      // readable as a quoted string — a different AST node, same defect.
      expect(lint('const re = new RegExp(`<[^>]*>`, "g");')).toHaveLength(1);
    });

    it('does not flag an interpolated template literal', () => {
      expect(lint('const re = new RegExp(`<${tag}[^>]*>`);')).toHaveLength(0);
    });

    it('does not flag a non-inlined argument it cannot see through', () => {
      // Deliberate limitation, not an oversight: resolving this needs type
      // flow the rule does not do. CodeQL remains the backstop.
      expect(lint(`const re = new RegExp(pattern);`)).toHaveLength(0);
    });
  });
});

describe('valid — patterns that are not tag stripping', () => {
  it('allows a regex with no negated-> class', () => {
    expect(lint(`const s = input.replace(/foo/g, 'bar');`)).toHaveLength(0);
  });

  it('allows a bare angle bracket without the negated class', () => {
    // Comparison-ish and arrow-ish patterns must not trip the rule.
    expect(lint(`const s = input.replace(/a<b/g, '');`)).toHaveLength(0);
    expect(lint(`const s = input.replace(/=>/g, '');`)).toHaveLength(0);
  });

  it('allows the character-class strip that is not multi-character', () => {
    // `[<>]` removes the delimiters only; it is not the multi-character
    // sanitization CodeQL flags, so banning it here would be overreach.
    expect(lint(`const s = input.replace(/[<>]/g, '');`)).toHaveLength(0);
  });

  it('allows a string literal that merely looks like the pattern', () => {
    expect(lint(`const s = '<[^>]*>';`)).toHaveLength(0);
  });

  it('allows the tag shape embedded in a larger structured pattern', () => {
    // Both of these are real BOT_FOOTER_PATTERNS entries. They embed
    // `\(<[^>]+>\)` to match a Discord markdown link's no-embed URL, matching
    // ONE known format rather than stripping arbitrary markup — CI caught the
    // unanchored version of this rule flagging them.
    expect(
      lint(
        `const MODEL = /(?:^|\\n)-# Model: (?:[^\\n[]*→ )?\\[[^\\]]+\\]\\(<[^>]+>\\)(?: \\([^()\\n]*\\))?(?: • [^\\n]+)?/g;`
      )
    ).toHaveLength(0);
    expect(
      lint(`const TRANSCRIBED = /(?:^|\\n)-# Transcribed by \\[[^\\]]+\\]\\(<[^>]+>\\)/g;`)
    ).toHaveLength(0);
  });
});
