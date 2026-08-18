/**
 * ESLint Rule: no-regex-tag-strip
 *
 * Bans stripping XML/HTML tags with a regex — `input.replace(/<[^>]*>/g, '')`
 * and its variants. CodeQL flags the shape as "Incomplete multi-character
 * sanitization" (`js/incomplete-multi-char-sanitization`), and a second
 * `.replace(/[<>]/g, '')` pass does not clear it. `extractXmlTextContent`
 * (ai-worker's `utils/xmlTextExtractor.ts`, built on `fast-xml-parser`) is the
 * supported replacement.
 *
 * Why a plugin rule rather than a `no-restricted-syntax` entry: seven blocks in
 * `eslint.config.js` set `no-restricted-syntax`, and an override block replaces
 * that rule's array wholesale — so a cross-cutting ban added there silently
 * stops applying to every overridden glob. A distinct rule name cannot be
 * dropped that way; it stays on unless a block turns it off by name.
 *
 * `00-critical.md` § HTML/XML Tag Stripping already carried this ban in prose,
 * with the replacement named, and the pattern was still written and merged —
 * caught only by a release-PR CodeQL run, since the per-PR run missed it. This
 * rule is the authoring-time mechanism that prose alone did not provide.
 *
 * Scope: matches the tag-shaped regex by its source, not by what the caller
 * does with the result, so it fires on `.replace`, `.split`, `.match`, and a
 * bare literal alike. Deliberately broad — every use of this shape over
 * untrusted markup has the same defect, and the false-positive cost is one
 * suppression with a justification.
 */

import type { Rule } from 'eslint';
import type { Node } from 'estree';

/**
 * Strip group syntax before matching. Three rounds of review each found
 * another idiom the shape-matcher missed, and grouped atoms were the last
 * family: `<(.*?)>`, `<([^>]*)>`, `<(?:[^>]*)>` are what a search result
 * hands you as often as the bare forms. Normalizing the wrappers away means
 * the matcher below describes ONE shape instead of enumerating spellings.
 *
 * Handles capturing, non-capturing, and NAMED groups. Lookarounds
 * (`(?=`, `(?!`, `(?<=`, `(?<!`) are deliberately NOT stripped: they are
 * zero-width assertions, so removing one changes what the pattern means
 * rather than just unwrapping it. A lookaround-bearing tag-stripper is an
 * accepted gap with CodeQL as backstop, listed with the others below.
 *
 * Only group punctuation goes — the atom, quantifier, and delimiters are
 * untouched, so this cannot make a non-tag pattern look like a tag pattern.
 */
function stripGroupSyntax(source: string): string {
  return source.replace(/\((\?:|\?<[A-Za-z_$][\w$]*>)?/g, '').replace(/\)/g, '');
}

/**
 * The tag-stripper shape, built from named parts because four review rounds
 * each found another spelling and a single opaque literal stopped being
 * reviewable.
 *
 * Matched against the whole (group-normalized) pattern source, anchored:
 * an opening `<`, an optional escaped slash, an optional leading
 * DISAMBIGUATOR, an "anything but `>`" ATOM, a QUANTIFIER, and a closing `>`.
 *
 *   <[^>]*>  <[^>]+>  <[^>]*?>  <[^<>]*>  <[^>]{1,}>  <.*>  <.*?>
 *   <\/[^>]*>  <\/?[^>]*>  <(.*?)>  <([^>]*)>  <\/?[^>]+(>|$)
 *   <[a-zA-Z][^>]*>  <\/?[a-zA-Z][^>]*>
 *
 * The DISAMBIGUATOR is the subtle one: a positive class or literal placed
 * right after `<` to stop the bare form over-matching `a<b` or `=>`. It is
 * exactly what someone reaches for after being told the bare form is too
 * greedy — and because the unbounded `[^>]*` survives in front of the closing
 * bracket, it is still the incomplete-sanitization shape CodeQL flags.
 *
 * Requiring the negated class or dot AFTER any disambiguator is what keeps
 * this off Discord's own delimited patterns — `<@!?\d+>` (mentions,
 * BotMentionProcessor) and `<a?:\w+:\d+>` (custom emoji). Both are
 * bracket-delimited like a tag but match ONE known structure, and neither
 * carries an unbounded negated-class run.
 *
 * Anchored deliberately. The same shape appears INSIDE larger structured
 * patterns that are not sanitizers — this repo's Discord footer matchers
 * embed a markdown link's no-embed URL (`BOT_FOOTER_PATTERNS.MODEL`,
 * `.TRANSCRIBED`). An unanchored revision flagged both, which would have
 * trained contributors to suppress this rule.
 *
 * Gaps accepted rather than closed, because anchoring is what buys the
 * false-positive immunity above — CodeQL is the backstop for all of them:
 *   - a COMPOUND pattern mixing tag-stripping with other alternatives
 *     (`/<[^>]+>|&nbsp;/g`);
 *   - a purely positive allow-list class (`<[a-z]*>`) with no unbounded
 *     negated run, likelier a deliberate structured matcher;
 *   - a `RegExp` argument this rule cannot read statically: a variable, a
 *     tagged template, or a member-expression callee (`globalThis.RegExp`);
 *   - a lookaround-bearing pattern (`<(?=x)[^>]*>`), since normalizing a
 *     zero-width assertion away would change the pattern's meaning.
 */
const QUANTIFIER = String.raw`(?:[*+]|\{\d+(?:,\d*)?\})`;
/** A positive class or literal placed right after `<` to narrow the match. */
const DISAMBIGUATOR = String.raw`(?:\[(?!\^)[^\]]+\]|\\?[A-Za-z@:!])(?:[*+?]|\{\d+(?:,\d*)?\})?`;
/** "Anything but the closing bracket" — a negated class or a bare dot. */
const ATOM = String.raw`(?:\[\^[^\]]+\]|\.)`;
/** `>`, or the jQuery-style `(>|$)` alternation once groups are normalized. */
const CLOSER = String.raw`(?:>|>\|\$|\$\|>)`;

const TAG_STRIP_PATTERN = new RegExp(
  String.raw`^<\\?\/?\??(?:${DISAMBIGUATOR})?${ATOM}${QUANTIFIER}\??${CLOSER}$`
);

/** Whether a regex source is a bare tag-stripper, ignoring group wrappers. */
function isTagStrip(source: string): boolean {
  return TAG_STRIP_PATTERN.test(stripGroupSyntax(source));
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow regex-based XML/HTML tag stripping; use extractXmlTextContent (fast-xml-parser) instead',
      recommended: true,
    },
    messages: {
      regexTagStrip:
        'Do not strip XML/HTML tags with a regex ({{pattern}}) — CodeQL flags it as incomplete multi-character sanitization, and a follow-up .replace(/[<>]/g, "") does not clear it. Parse instead: extractXmlTextContent (fast-xml-parser) lives in services/ai-worker/src/utils/xmlTextExtractor.ts — from ai-worker import it directly; from another service lift it into common-types first, since cross-service imports are a dependency-cruiser error. See .claude/rules/00-critical.md § HTML/XML Tag Stripping.',
    },
    schema: [],
  },

  create(context) {
    /**
     * `new RegExp('<[^>]*>')` compiles to the same thing as the literal and is
     * equally invisible to a `.regex`-only check — the string argument is a
     * plain Literal with no `regex` property. Covering the constructor closes
     * the obvious way to write the banned pattern without writing a regex
     * literal.
     *
     * A zero-interpolation TEMPLATE literal counts too: it is a different AST
     * node but exactly as statically readable, and backticks are already this
     * codebase's habit for `new RegExp(...)`. A variable argument is the only
     * genuine limitation — that would need type flow this rule does not do.
     */
    function staticStringArg(node: Node & { arguments?: Node[] }): string | undefined {
      const first = node.arguments?.[0];
      if (first === undefined) {
        return undefined;
      }
      if (first.type === 'Literal' && typeof first.value === 'string') {
        return first.value;
      }
      if (first.type === 'TemplateLiteral' && first.expressions.length === 0) {
        return first.quasis[0]?.value.cooked ?? undefined;
      }
      return undefined;
    }

    function checkRegExpConstructor(node: Node & { callee?: Node; arguments?: Node[] }): void {
      const callee = node.callee;
      if (callee?.type !== 'Identifier' || callee.name !== 'RegExp') {
        return;
      }
      const source = staticStringArg(node);
      if (source === undefined || !isTagStrip(source)) {
        return;
      }
      context.report({
        node,
        messageId: 'regexTagStrip',
        data: { pattern: `new RegExp('${source}')` },
      });
    }

    return {
      NewExpression: checkRegExpConstructor,
      // `RegExp('<[^>]*>')` without `new` is the same constructor.
      CallExpression: checkRegExpConstructor,
      Literal(node) {
        const literal = node as Node & { regex?: { pattern: string; flags: string } };
        const regex = literal.regex;
        if (regex === undefined) {
          return;
        }
        if (!isTagStrip(regex.pattern)) {
          return;
        }
        context.report({
          node,
          messageId: 'regexTagStrip',
          data: { pattern: `/${regex.pattern}/${regex.flags}` },
        });
      },
    };
  },
};

export default rule;
