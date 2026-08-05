/**
 * Tests for Unknown Wrapper-Tag Unwrapping
 */

import { describe, it, expect } from 'vitest';
import { ARTIFACT_TAG_NAMES } from './responseArtifacts.js';
import { KNOWN_THINKING_TAGS } from './thinkingExtraction.js';
import { unwrapUnknownWrapperTags, WRAPPER_UNWRAP_EXCLUDED_TAGS } from './wrapperTagUnwrap.js';

describe('unwrapUnknownWrapperTags', () => {
  describe('whole-message wrap', () => {
    it('unwraps a tag pair that wraps the entire message', () => {
      const result = unwrapUnknownWrapperTags('<action>He walks away.</action>');

      expect(result.content).toBe('He walks away.');
      expect(result.unwrappedTags).toEqual(['action']);
    });

    it('keeps multi-line inner text verbatim', () => {
      const result = unwrapUnknownWrapperTags(
        '<narration>\nThe door creaks open.\n\nNobody is there.\n</narration>'
      );

      expect(result.content).toBe('The door creaks open.\n\nNobody is there.');
      expect(result.unwrappedTags).toEqual(['narration']);
    });

    it('unwraps a tag carrying attributes', () => {
      const result = unwrapUnknownWrapperTags('<action type="move">She crosses the room.</action>');

      expect(result.content).toBe('She crosses the room.');
      expect(result.unwrappedTags).toEqual(['action']);
    });

    it('tolerates surrounding whitespace', () => {
      const result = unwrapUnknownWrapperTags('\n  <emote>grins</emote>\n');

      expect(result.content).toBe('grins');
      expect(result.unwrappedTags).toEqual(['emote']);
    });

    it('does NOT italicize, delete, or otherwise reformat the inner text', () => {
      const inner = '*She waves.*  Then—quietly—she leaves. 5 < 6, after all.';
      const result = unwrapUnknownWrapperTags(`<action>${inner}</action>`);

      expect(result.content).toBe(inner);
    });
  });

  describe('line-level wrap', () => {
    it('unwraps a wrapped line and leaves its neighbours byte-identical', () => {
      const content = '"Hello."\n<action>waves</action>\n"Bye."';
      const result = unwrapUnknownWrapperTags(content);

      expect(result.content).toBe('"Hello."\nwaves\n"Bye."');
      expect(result.unwrappedTags).toEqual(['action']);

      const lines = result.content.split('\n');
      expect(lines[0]).toBe('"Hello."');
      expect(lines[2]).toBe('"Bye."');
    });

    it('unwraps several wrapped lines in one pass', () => {
      const content = '<action>stands</action>\n"Enough."\n<action>leaves</action>';
      const result = unwrapUnknownWrapperTags(content);

      expect(result.content).toBe('stands\n"Enough."\nleaves');
      expect(result.unwrappedTags).toEqual(['action', 'action']);
    });

    it('preserves the indentation of an unwrapped line', () => {
      const content = 'Intro.\n    <action>waves</action>\nOutro.';
      const result = unwrapUnknownWrapperTags(content);

      expect(result.content).toBe('Intro.\n    waves\nOutro.');
    });
  });

  describe('line-span wrap', () => {
    it('unwraps a multi-line block embedded in a longer reply', () => {
      // The residual shape neither of the other modes reaches: the whole-message
      // mode declines because the content does not start with the tag, and the
      // line mode declines because the opener's line carries no closer.
      const content = [
        '"Dialogue here."',
        '',
        '<action>',
        'She walks to the window, pauses, and looks out at the rain falling',
        'gently on the street below.',
        '</action>',
        '',
        '"More dialogue."',
      ].join('\n');

      const result = unwrapUnknownWrapperTags(content);

      expect(result.content).toBe(
        [
          '"Dialogue here."',
          '',
          'She walks to the window, pauses, and looks out at the rain falling',
          'gently on the street below.',
          '',
          '"More dialogue."',
        ].join('\n')
      );
      expect(result.unwrappedTags).toEqual(['action']);

      // Every surviving line byte-identical to its original — only the two
      // delimiter lines are gone.
      const original = content.split('\n');
      const rewritten = result.content.split('\n');
      expect(rewritten).toEqual([
        ...original.slice(0, 2),
        ...original.slice(3, 5),
        ...original.slice(6),
      ]);
    });

    it('unwraps a span whose opener carries attributes', () => {
      const content = [
        '"Hi."',
        '<action type="move">',
        'She crosses the room.',
        '</action>',
        '"Bye."',
      ].join('\n');

      const result = unwrapUnknownWrapperTags(content);

      expect(result.content).toBe('"Hi."\nShe crosses the room.\n"Bye."');
      expect(result.unwrappedTags).toEqual(['action']);
    });

    it('preserves the indentation and blank lines of the inner block', () => {
      const content = [
        'Intro.',
        '<narration>',
        '    She waves,',
        '',
        '      then leaves.',
        '</narration>',
        'Outro.',
      ].join('\n');

      expect(unwrapUnknownWrapperTags(content).content).toBe(
        ['Intro.', '    She waves,', '', '      then leaves.', 'Outro.'].join('\n')
      );
    });

    it('leaves a span that never closes untouched', () => {
      const content = ['"Hi."', '<action>', 'She walks away.'].join('\n');

      expect(unwrapUnknownWrapperTags(content).content).toBe(content);
      expect(unwrapUnknownWrapperTags(content).unwrappedTags).toEqual([]);
    });

    it('leaves an empty span untouched', () => {
      const content = ['"Hi."', '<action>', '</action>', '"Bye."'].join('\n');

      expect(unwrapUnknownWrapperTags(content).content).toBe(content);
      expect(unwrapUnknownWrapperTags(content).unwrappedTags).toEqual([]);
    });

    it('leaves a closer-alone line with no earlier opener untouched', () => {
      // A genuinely orphan closer is `responseArtifacts.ts`'s business (its
      // opener-aware trailing strip), not this pass's — there is no pair here to
      // unwrap, so the conservative move is to hand it along unchanged.
      const content = ['"Hi."', '</action>', '"Bye."'].join('\n');

      expect(unwrapUnknownWrapperTags(content).content).toBe(content);
      expect(unwrapUnknownWrapperTags(content).unwrappedTags).toEqual([]);
    });

    it.each(WRAPPER_UNWRAP_EXCLUDED_TAGS)('does not unwrap <%s> as a line span', tag => {
      const content = [
        '"Hello."',
        `<${tag}>`,
        'Inner text that another pass owns.',
        `</${tag}>`,
        '"Bye."',
      ].join('\n');
      const result = unwrapUnknownWrapperTags(content);

      expect(result.content).toBe(content);
      expect(result.unwrappedTags).toEqual([]);
    });

    it('does not unwrap a span inside a fenced block', () => {
      const content = [
        'Here is the markup it kept emitting:',
        '',
        '```',
        '<action>',
        'She walks away.',
        '</action>',
        '```',
        '',
        'That is the bug.',
      ].join('\n');

      const result = unwrapUnknownWrapperTags(content);

      expect(result.content).toBe(content);
      expect(result.unwrappedTags).toEqual([]);
    });

    it('does not unwrap a span whose inner text carries a tag pair of another name', () => {
      const content = [
        '"Look."',
        '<action>',
        'She points at the <b>old</b> map.',
        '</action>',
        '"See?"',
      ].join('\n');

      expect(unwrapUnknownWrapperTags(content).content).toBe(content);
      expect(unwrapUnknownWrapperTags(content).unwrappedTags).toEqual([]);
    });

    it('counts only same-name tags ALONE on a line, so an inline mention survives verbatim', () => {
      // Span depth is counted over delimiter-shaped lines (`^<action>$`), never
      // over prose that happens to name the tag mid-line. An inline mention
      // must therefore neither open a nested level (which would leave the span
      // unclosed and the delimiters visible) nor be rewritten — it is the
      // character's own words about the markup.
      const content = [
        '"Hi."',
        '<action>',
        'She waves, then pauses.',
        '"Every time," she says, "she typed <action> at me and left it there."',
        'She looks away.',
        '</action>',
        '"Bye."',
      ].join('\n');

      const result = unwrapUnknownWrapperTags(content);

      expect(result.content).toBe(
        [
          '"Hi."',
          'She waves, then pauses.',
          '"Every time," she says, "she typed <action> at me and left it there."',
          'She looks away.',
          '"Bye."',
        ].join('\n')
      );
      expect(result.unwrappedTags).toEqual(['action']);

      // Only the two delimiter lines are gone; every body line byte-identical.
      const original = content.split('\n');
      expect(result.content.split('\n')).toEqual([
        original[0],
        ...original.slice(2, 5),
        original[6],
      ]);
    });

    it('resolves nested same-name spans within the pass bound', () => {
      const content = [
        '"Hi."',
        '<action>',
        '<action>',
        'She waves.',
        '</action>',
        '</action>',
        '"Bye."',
      ].join('\n');

      const result = unwrapUnknownWrapperTags(content);

      expect(result.content).toBe('"Hi."\nShe waves.\n"Bye."');
      expect(result.unwrappedTags).toEqual(['action', 'action']);
    });
  });

  describe('nesting', () => {
    it('resolves a nested double-wrap within the pass bound', () => {
      const result = unwrapUnknownWrapperTags('<action><action>He walks away.</action></action>');

      expect(result.content).toBe('He walks away.');
      expect(result.unwrappedTags).toEqual(['action', 'action']);
    });

    it('resolves a nested double-wrap on a single line', () => {
      const content = '"Hi."\n<action><action>waves</action></action>';
      const result = unwrapUnknownWrapperTags(content);

      expect(result.content).toBe('"Hi."\nwaves');
    });
  });

  describe('partial and inline wraps are left alone', () => {
    it('does not touch a tag pair sharing a line with other text', () => {
      const content = 'She said this <action>and did that</action> before leaving.';

      expect(unwrapUnknownWrapperTags(content).content).toBe(content);
      expect(unwrapUnknownWrapperTags(content).unwrappedTags).toEqual([]);
    });

    it('does not touch two tag pairs on one line', () => {
      // Depth-counted closer matching is what makes this decline: an
      // end-anchored regex would treat the LAST closer as the match and produce
      // a mangled `a</action> and <action>b` body.
      const content = '<action>a</action> and <action>b</action>';

      expect(unwrapUnknownWrapperTags(content).content).toBe(content);
    });

    it('does not touch an unclosed opening tag', () => {
      const content = '<action>She walks away.';

      expect(unwrapUnknownWrapperTags(content).content).toBe(content);
    });

    it('does not touch a bare closing tag', () => {
      const content = 'She walks away.</action>';

      expect(unwrapUnknownWrapperTags(content).content).toBe(content);
    });
  });

  describe('excluded tags', () => {
    it('excludes every known thinking tag', () => {
      for (const tag of KNOWN_THINKING_TAGS) {
        expect(WRAPPER_UNWRAP_EXCLUDED_TAGS).toContain(tag);
      }
    });

    it('excludes every artifact tag name', () => {
      // Trivially true while the exclusion set spreads `ARTIFACT_TAG_NAMES`.
      // The pin is for the future hand-edit that replaces the spread with a
      // literal list: the copy would drift from `responseArtifacts.ts` and
      // resurrect scaffolding echo silently, so this fails loudly instead.
      for (const tag of ARTIFACT_TAG_NAMES) {
        expect(WRAPPER_UNWRAP_EXCLUDED_TAGS).toContain(tag);
      }
    });

    it.each(WRAPPER_UNWRAP_EXCLUDED_TAGS)('does not unwrap <%s> as a whole message', tag => {
      const content = `<${tag}>Inner text that another pass owns.</${tag}>`;
      const result = unwrapUnknownWrapperTags(content);

      expect(result.content).toBe(content);
      expect(result.unwrappedTags).toEqual([]);
    });

    it.each(WRAPPER_UNWRAP_EXCLUDED_TAGS)('does not unwrap <%s> as a wrapped line', tag => {
      const content = `"Hello."\n<${tag}>Inner text that another pass owns.</${tag}>\n"Bye."`;
      const result = unwrapUnknownWrapperTags(content);

      expect(result.content).toBe(content);
      expect(result.unwrappedTags).toEqual([]);
    });
  });

  describe('code protection', () => {
    it('does not unwrap a tag pair inside a fenced block', () => {
      const content = [
        'Here is the markup it kept emitting:',
        '',
        '```',
        '<action>She walks away.</action>',
        '```',
        '',
        'That is the bug.',
      ].join('\n');

      const result = unwrapUnknownWrapperTags(content);

      expect(result.content).toBe(content);
      expect(result.unwrappedTags).toEqual([]);
    });

    it('does not unwrap a tag pair quoted in inline backticks', () => {
      // Declined by shape as well as by the code-span gate: the line starts
      // with a backtick, so it is not a whole-line wrap in the first place.
      // Pinned because either guard failing would corrupt the quotation.
      const content = 'It writes this:\n`<action>She walks away.</action>`\nEvery single time.';

      expect(unwrapUnknownWrapperTags(content).content).toBe(content);
    });

    it('does not unwrap a whole message that is one fenced example', () => {
      const content = '```\n<action>She walks away.</action>\n```';

      expect(unwrapUnknownWrapperTags(content).content).toBe(content);
    });
  });

  describe('XML-document guard', () => {
    it('does not unwrap a document whose inner text carries other tag pairs', () => {
      const content = '<root><child>x</child></root>';

      expect(unwrapUnknownWrapperTags(content).content).toBe(content);
      expect(unwrapUnknownWrapperTags(content).unwrappedTags).toEqual([]);
    });

    it('does not unwrap a whole-message wrap whose inner text contains a tag pair', () => {
      const content = '<action>She reads the <em>old</em> letter.</action>';

      expect(unwrapUnknownWrapperTags(content).content).toBe(content);
    });

    it('does not unwrap a wrapped line whose inner text contains a tag pair', () => {
      const content = '"Look."\n<action>She points at <b>that</b>.</action>\n"See?"';

      expect(unwrapUnknownWrapperTags(content).content).toBe(content);
    });

    it('still unwraps when the inner text has an orphan angle bracket', () => {
      const result = unwrapUnknownWrapperTags('<action>She holds up 3 fingers <3 always</action>');

      expect(result.content).toBe('She holds up 3 fingers <3 always');
      expect(result.unwrappedTags).toEqual(['action']);
    });
  });

  describe('quoted control syntax', () => {
    // This product hosts AI characters, so replies routinely DISCUSS markup —
    // a character complaining about the tags it emits produces the same bytes
    // as a model actually emitting them. Whole-unit-only matching is the
    // discriminator that covers the unfenced case, where code markup cannot.

    it('preserves a reply that discusses wrapper tags mid-sentence', () => {
      const reply = [
        '"It kept happening," she says, still annoyed. "Every third message it would',
        'stick <action>walks away</action> right into the middle of a sentence, like',
        'the tag was part of the prose."',
        '',
        'She shrugs. "Nobody asked it to do that."',
      ].join('\n');

      const result = unwrapUnknownWrapperTags(reply);

      expect(result.content).toBe(reply);
      expect(result.unwrappedTags).toEqual([]);
    });

    it('preserves a reply that names an opening and closing tag separately', () => {
      const reply = [
        'The pattern is simple enough: it opens with <action> and then, several',
        'words later, closes with </action>. Nothing between them is markup —',
        'it is just narration that the model decided to decorate.',
      ].join('\n');

      expect(unwrapUnknownWrapperTags(reply).content).toBe(reply);
    });

    it('preserves a reply explaining the tag inside code markup', () => {
      const reply = [
        'Think of `<action>` as a habit it picked up from training data.',
        '',
        '```',
        '<action>She walks away.</action>',
        '```',
        '',
        'It means nothing to Discord, which is why you see it raw.',
      ].join('\n');

      expect(unwrapUnknownWrapperTags(reply).content).toBe(reply);
    });

    it('KNOWN LIMIT: an unfenced quoted wrap on its own line is still unwrapped', () => {
      // Positionally and byte-identical to the production shape this pass
      // exists to fix, with no code markup to separate them. Unwrapping stays
      // the default when the only available signal is absent — and the cost is
      // one pair of angle brackets, not the text. Pinned so the boundary is
      // visible rather than discovered.
      const content = 'It writes lines like this one:\n<action>She walks away.</action>';
      const result = unwrapUnknownWrapperTags(content);

      expect(result.content).toBe('It writes lines like this one:\nShe walks away.');
    });
  });

  describe('tag-name shape', () => {
    it('KNOWN LIMIT: an uppercase tag is not unwrapped', () => {
      // Lowercase-only by design, matching the generic tag pattern in
      // `responseArtifacts.ts`. Angle-bracketed capitalized words are a
      // name-labelling convention in prose (`<Bob>`), and the observed model
      // output is lowercase, so the narrower rule is the safer one.
      const content = '<Action>She walks away.</Action>';

      expect(unwrapUnknownWrapperTags(content).content).toBe(content);
    });

    it('unwraps tags with digits, underscores, and hyphens', () => {
      expect(unwrapUnknownWrapperTags('<stage-direction>waves</stage-direction>').content).toBe(
        'waves'
      );
      expect(unwrapUnknownWrapperTags('<action_2>waves</action_2>').content).toBe('waves');
    });

    it('does not treat a longer tag as the excluded prefix tag', () => {
      // `think` is excluded; `thinker` is not, and must not inherit the
      // exclusion by prefix.
      const result = unwrapUnknownWrapperTags('<thinker>She ponders.</thinker>');

      expect(result.content).toBe('She ponders.');
    });
  });

  describe('empty and degenerate input', () => {
    it('leaves an empty-bodied tag pair untouched', () => {
      const content = '<action></action>';

      expect(unwrapUnknownWrapperTags(content).content).toBe(content);
      expect(unwrapUnknownWrapperTags(content).unwrappedTags).toEqual([]);
    });

    it('leaves a whitespace-only body untouched', () => {
      const content = '<action>   </action>';

      expect(unwrapUnknownWrapperTags(content).content).toBe(content);
      expect(unwrapUnknownWrapperTags(content).unwrappedTags).toEqual([]);
    });

    it('handles an empty string', () => {
      const result = unwrapUnknownWrapperTags('');

      expect(result.content).toBe('');
      expect(result.unwrappedTags).toEqual([]);
    });

    it('leaves ordinary prose byte-identical', () => {
      const content = '"Good morning," she says, pouring the coffee.\n\nIt is going to rain.';

      expect(unwrapUnknownWrapperTags(content).content).toBe(content);
      expect(unwrapUnknownWrapperTags(content).unwrappedTags).toEqual([]);
    });
  });
});
