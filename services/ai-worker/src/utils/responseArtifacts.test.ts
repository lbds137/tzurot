/**
 * Tests for Response Artifacts Cleanup
 *
 * Tests the cleanup of AI-generated responses that may contain
 * learned artifacts from XML-formatted conversation history.
 */

import { describe, it, expect } from 'vitest';
import {
  stripResponseArtifacts,
  stripUserMessageEcho,
  normalizeForEchoMatch,
} from './responseArtifacts.js';

describe('stripResponseArtifacts', () => {
  describe('Generic trailing closing tag stripping', () => {
    it('should strip trailing </message> tag', () => {
      expect(stripResponseArtifacts('Hello there!</message>', 'Emily')).toBe('Hello there!');
    });

    it('should strip trailing </message> with whitespace', () => {
      expect(stripResponseArtifacts('Hello!</message>\n', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</message>  ', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</message>\n\n', 'Emily')).toBe('Hello!');
    });

    it('should strip multiple trailing closing tags', () => {
      expect(stripResponseArtifacts('Hello!</message></message>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</current_turn></message>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</message></current_turn>', 'Emily')).toBe('Hello!');
    });

    it('should be case-insensitive for tag', () => {
      expect(stripResponseArtifacts('Hello!</MESSAGE>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</Module>', 'Emily')).toBe('Hello!');
    });

    it('should NOT strip closing tags in middle of content', () => {
      expect(stripResponseArtifacts('The </message> tag is used for XML', 'Emily')).toBe(
        'The </message> tag is used for XML'
      );
      expect(stripResponseArtifacts('Use </module> for sections', 'Emily')).toBe(
        'Use </module> for sections'
      );
    });

    it('should strip trailing </current_turn> tag', () => {
      expect(stripResponseArtifacts('Hello there!</current_turn>', 'Emily')).toBe('Hello there!');
    });

    it('should strip trailing </incoming_message> tag', () => {
      expect(stripResponseArtifacts('Hello there!</incoming_message>', 'Emily')).toBe(
        'Hello there!'
      );
    });

    it('should strip trailing </module> tag (GLM model artifact)', () => {
      const content =
        "You'll have to relearn what feels good instead of just mapping old pleasure onto new geography.</module>";
      expect(stripResponseArtifacts(content, 'House')).toBe(
        "You'll have to relearn what feels good instead of just mapping old pleasure onto new geography."
      );
    });

    it('should strip any arbitrary trailing closing tag', () => {
      expect(stripResponseArtifacts('Hello!</output>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</response>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</assistant>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</turn>', 'Emily')).toBe('Hello!');
    });

    it('should handle tags with hyphens and numbers', () => {
      expect(stripResponseArtifacts('Hello!</my-tag>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</section2>', 'Emily')).toBe('Hello!');
    });
  });

  describe('<last_message> block stripping', () => {
    it('should strip leading <last_message> block', () => {
      const content = '<last_message>User: hello</last_message>\n\nHere is my response.';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Here is my response.');
    });

    it('should strip <last_message> block with multi-line content', () => {
      const content =
        '<last_message>User: hello\nAssistant: hi there</last_message>\n\nActual response.';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Actual response.');
    });

    it('should be case-insensitive', () => {
      const content = '<LAST_MESSAGE>User: hello</LAST_MESSAGE>\n\nResponse.';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Response.');
    });

    it('should NOT strip <last_message> in middle of content', () => {
      const content = 'The <last_message> tag echoes the prompt.';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });

    it('should handle <last_message> combined with trailing </message>', () => {
      const content = '<last_message>User: hi</last_message>\n\nHello!</message>';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Hello!');
    });
  });

  describe('<from> tag stripping', () => {
    it('should strip leading <from> tag with id', () => {
      const content =
        '<from id="d70561a6-a8ca-530c-a28b-e14333816f8b">Kevbear</from>\n\nIf I were you...';
      expect(stripResponseArtifacts(content, 'Lilith')).toBe('If I were you...');
    });

    it('should strip leading <from> tag without id', () => {
      expect(stripResponseArtifacts('<from>Alice</from>\n\nHello there!', 'Emily')).toBe(
        'Hello there!'
      );
    });

    it('should strip <from> tag with whitespace after', () => {
      expect(stripResponseArtifacts('<from>Bob</from>  Hello', 'Emily')).toBe('Hello');
    });

    it('should be case-insensitive', () => {
      expect(stripResponseArtifacts('<FROM>Alice</FROM>\n\nHi', 'Emily')).toBe('Hi');
    });

    it('should NOT strip <from> in middle of content', () => {
      const content = 'The message was <from>Alice</from> formatted badly';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });

    it('should handle <from> combined with trailing </message>', () => {
      const content = '<from id="abc">User</from>\n\nHello!</message>';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Hello!');
    });
  });

  describe('XML leading tag stripping', () => {
    it('should strip leading <message> tag with speaker', () => {
      expect(stripResponseArtifacts('<message speaker="Emily">Hello', 'Emily')).toBe('Hello');
    });

    it('should strip <message> tag with additional attributes', () => {
      expect(stripResponseArtifacts('<message speaker="Emily" time="now">Hello', 'Emily')).toBe(
        'Hello'
      );
      expect(stripResponseArtifacts('<message speaker="Emily" time="2m ago">Hello', 'Emily')).toBe(
        'Hello'
      );
    });

    it('should handle single quotes in attributes', () => {
      expect(stripResponseArtifacts("<message speaker='Emily'>Hello", 'Emily')).toBe('Hello');
    });

    it('should be case-insensitive for personality name in tag', () => {
      expect(stripResponseArtifacts('<message speaker="EMILY">Hello', 'Emily')).toBe('Hello');
      expect(stripResponseArtifacts('<message speaker="emily">Hello', 'Emily')).toBe('Hello');
    });

    it('should NOT strip if speaker name does not match', () => {
      const content = '<message speaker="Lilith">Hello';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });

    it('should NOT strip <message> in middle of content', () => {
      const content = 'Use <message speaker="test"> for XML';
      expect(stripResponseArtifacts(content, 'test')).toBe(content);
    });
  });

  describe('Reactions block stripping', () => {
    it('should strip trailing <reactions> block', () => {
      const content =
        'Interesting point!\n<reactions>\n<reaction from="Lila" from_id="abc-123">🤔</reaction>\n</reactions>';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Interesting point!');
    });

    it('should strip <reactions> block with multiple reactions', () => {
      const content =
        'Great idea!\n<reactions>\n<reaction from="Lila" from_id="abc">👍</reaction>\n<reaction from="Gabriel" from_id="def">❤️</reaction>\n</reactions>';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Great idea!');
    });

    it('should strip <reactions> block with custom emoji attribute', () => {
      const content =
        'Hello!\n<reactions>\n<reaction from="Lila" from_id="abc" custom="true">:thinking:</reaction>\n</reactions>';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Hello!');
    });

    it('should be case-insensitive for reactions tags', () => {
      const content = 'Hello!\n<REACTIONS>\n<REACTION from="Lila">🤔</REACTION>\n</REACTIONS>';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Hello!');
    });

    it('should NOT strip <reactions> in middle of content', () => {
      const content = 'The <reactions> tag is used for tracking emoji responses in conversation.';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });

    it('should strip reactions combined with other trailing tags', () => {
      const content =
        'Hey there!\n<reactions>\n<reaction from="Lila" from_id="abc">👍</reaction>\n</reactions>\n</message>';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Hey there!');
    });
  });

  describe('Combined XML artifacts', () => {
    it('should strip both leading and trailing XML tags', () => {
      expect(stripResponseArtifacts('<message speaker="Emily">Hello!</message>', 'Emily')).toBe(
        'Hello!'
      );
    });

    it('should strip leading tag, trailing tag, and preserve content', () => {
      const input = '<message speaker="Emily" time="now">How are you?</message>\n';
      expect(stripResponseArtifacts(input, 'Emily')).toBe('How are you?');
    });

    it('should strip mixed artifact types (name prefix + trailing XML)', () => {
      // LLM might add legacy "Name:" prefix AND trailing </message>
      expect(stripResponseArtifacts('Emily: Hello!</message>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Emily: [now] Hi there!</message>', 'Emily')).toBe('Hi there!');
    });
  });

  describe('Simple name prefix stripping (legacy)', () => {
    it('should strip basic Name: prefix', () => {
      expect(stripResponseArtifacts('Emily: hello', 'Emily')).toBe('hello');
    });

    it('should strip prefix with timestamp', () => {
      expect(stripResponseArtifacts('Emily: [now] hello', 'Emily')).toBe('hello');
      expect(stripResponseArtifacts('Lilith: [2 minutes ago] hey', 'Lilith')).toBe('hey');
    });

    it('should be case-insensitive for name', () => {
      expect(stripResponseArtifacts('EMILY: hello', 'Emily')).toBe('hello');
      expect(stripResponseArtifacts('emily: hello', 'Emily')).toBe('hello');
    });

    it('should NOT strip if name does not match', () => {
      expect(stripResponseArtifacts('Emily: hello', 'Lilith')).toBe('Emily: hello');
    });

    it('should NOT strip name in middle of content', () => {
      const content = 'Hello! Emily: is my name';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });
  });

  describe('Standalone timestamps', () => {
    it('should strip standalone timestamp at start', () => {
      expect(stripResponseArtifacts('[2m ago] content here', 'Emily')).toBe('content here');
      expect(stripResponseArtifacts('[now] hello', 'Emily')).toBe('hello');
    });

    it('should NOT strip timestamps in middle of content', () => {
      expect(stripResponseArtifacts('I replied [2m ago] to you', 'Emily')).toBe(
        'I replied [2m ago] to you'
      );
    });
  });

  describe('Special characters in names', () => {
    it('should handle names with special regex characters', () => {
      expect(stripResponseArtifacts('C++Bot: hello', 'C++Bot')).toBe('hello');
      expect(stripResponseArtifacts('Test.Name: hi', 'Test.Name')).toBe('hi');
    });

    it('should handle multi-word names', () => {
      expect(stripResponseArtifacts('Bambi Prime: hello', 'Bambi Prime')).toBe('hello');
    });

    it('should handle unicode names', () => {
      expect(stripResponseArtifacts('Amélie: hello', 'Amélie')).toBe('hello');
    });
  });

  describe('Hallucinated XML tool-use wrapper stripping', () => {
    it('should strip leading <function_results> and nested tags (real GLM 4.5 Air case)', () => {
      const content =
        '<function_results>\n<result>\n<result_text>Leviathan</result_text>\n</result>\n</function_results>\n\n*adjusts glasses* Well, well...';
      expect(stripResponseArtifacts(content, 'Leviathan')).toBe('*adjusts glasses* Well, well...');
    });

    it('should strip leading <function_calls> with <invoke> nesting', () => {
      const content =
        '<function_calls>\n<invoke name="respond">\n<parameter name="character">Bambi</parameter>\n<parameter name="content">Hey there!</parameter>\n</invoke>\n</function_calls>\n\nHey there!';
      expect(stripResponseArtifacts(content, 'Bambi')).toBe('Hey there!');
    });

    it('should strip self-contained <result>PersonalityName</result>', () => {
      expect(
        stripResponseArtifacts('<result>Leviathan</result>\n\nActual response here.', 'Leviathan')
      ).toBe('Actual response here.');
    });

    it('should strip self-contained <parameter> with attributes', () => {
      expect(
        stripResponseArtifacts('<parameter name="character">Bambi</parameter>\nHello!', 'Bambi')
      ).toBe('Hello!');
    });

    it('should strip leading <tool_results> tag', () => {
      expect(stripResponseArtifacts('<tool_results>\nSome content here', 'Emily')).toBe(
        'Some content here'
      );
    });

    it('should strip leading <tool_call> tag with attributes', () => {
      expect(stripResponseArtifacts('<tool_call id="123">\nResponse text', 'Emily')).toBe(
        'Response text'
      );
    });

    it('should NOT strip roleplay content like <looks around>', () => {
      const content = '<looks around> Hey, what are you doing here?';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });

    it('should NOT strip self-contained tag with long content via single pattern', () => {
      // Self-contained pattern has 100-char limit, but individual leading/trailing patterns
      // still strip the tags separately. Use a tag NOT in our known lists to verify.
      const longContent = 'A'.repeat(150);
      const content = `<dialogue>${longContent}</dialogue>`;
      // Only </dialogue> gets stripped by generic trailing closer; <dialogue> is not in our list
      expect(stripResponseArtifacts(content, 'Emily')).toBe(`<dialogue>${longContent}`);
    });

    it('should handle combined leading XML wrappers + trailing closing tags', () => {
      const content =
        '<function_results>\n<result>Leviathan</result>\nActual response!</function_results></message>';
      expect(stripResponseArtifacts(content, 'Leviathan')).toBe('Actual response!');
    });

    it('should be case-insensitive for hallucinated tags', () => {
      expect(stripResponseArtifacts('<FUNCTION_RESULTS>\nHello there', 'Emily')).toBe(
        'Hello there'
      );
    });

    it('should strip deeply nested hallucination (multiple iterations)', () => {
      // Real pattern: wrapper tags around actual response text (not inside a self-contained tag)
      const content =
        '<function_results>\n<result>\n<result_text>\nHello, how are you?\n</result_text>\n</result>\n</function_results>';
      const result = stripResponseArtifacts(content, 'Emily');
      expect(result).toBe('Hello, how are you?');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty content after stripping', () => {
      expect(stripResponseArtifacts('Emily: ', 'Emily')).toBe('');
      expect(stripResponseArtifacts('</message>', 'Emily')).toBe('');
    });

    it('should handle empty string input', () => {
      expect(stripResponseArtifacts('', 'Emily')).toBe('');
    });

    it('should return original if no artifacts', () => {
      const content = 'This is regular content';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });

    it('should preserve multi-line content', () => {
      const content = 'Emily: Line 1\n\nLine 2\n\nLine 3';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Line 1\n\nLine 2\n\nLine 3');
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle LLM adding </message> to roleplay', () => {
      const content = '*waves hello* Nice to meet you!</message>';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('*waves hello* Nice to meet you!');
    });

    it('should handle full XML wrap around response', () => {
      const content = '<message speaker="Lilith" time="just now">Hey there!</message>';
      expect(stripResponseArtifacts(content, 'Lilith')).toBe('Hey there!');
    });

    it('should handle models that follow instructions (no cleanup needed)', () => {
      const content = 'Hello! How can I help you today?';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });

    it('should clean for storage in conversation_history', () => {
      const rawResponse = '<message speaker="Emily">Hello! How are you?</message>';
      const cleaned = stripResponseArtifacts(rawResponse, 'Emily');
      expect(cleaned).toBe('Hello! How are you?');
      expect(cleaned).not.toContain('<message');
      expect(cleaned).not.toContain('</message>');
    });

    it('should strip </current_turn> learned from training data', () => {
      // LLM may have learned XML closing patterns from training data
      const content = '*waves enthusiastically* Hey there!</current_turn>';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('*waves enthusiastically* Hey there!');
    });

    it('should strip hallucinated reactions from roleplay response', () => {
      // Real case: GLM 4.5 Air appended reactions XML to its response
      const content =
        'Vectors have magnitude and direction. Double-edged geometry.\n<reactions>\n<reaction from="Lila" from_id="57240faf-0a7d-511c-b5ae-a52b26c3b5d8">🤔</reaction>\n</reactions>';
      expect(stripResponseArtifacts(content, 'Bambi')).toBe(
        'Vectors have magnitude and direction. Double-edged geometry.'
      );
    });

    it('should clean mixed artifacts from training data', () => {
      // LLM might combine multiple learned artifacts
      const rawResponse = 'Emily: How are you today?</current_turn>';
      const cleaned = stripResponseArtifacts(rawResponse, 'Emily');
      expect(cleaned).toBe('How are you today?');
      expect(cleaned).not.toContain('Emily:');
      expect(cleaned).not.toContain('</current_turn>');
    });
  });

  describe('<received message> block stripping (GLM 4.5 Air hallucination)', () => {
    it('should strip leading <received message> block', () => {
      const content =
        '<received message>\nFrom: UserName\nHello there!\n</received>\n\n*smiles* Hello!';
      expect(stripResponseArtifacts(content, 'Lilith')).toBe('*smiles* Hello!');
    });

    it('should strip plain <received> block', () => {
      const content = '<received>User said hello</received>\n\nMy response.';
      expect(stripResponseArtifacts(content, 'Lilith')).toBe('My response.');
    });

    it('should be case-insensitive', () => {
      const content = '<RECEIVED MESSAGE>Some content</RECEIVED>\n\nResponse.';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Response.');
    });
  });

  describe('prompt template closing tag stripping', () => {
    it('should strip </chat_log> at end of content', () => {
      expect(stripResponseArtifacts('Hello there!</chat_log>', 'Emily')).toBe('Hello there!');
    });

    it('should strip </chat_log> in middle of content', () => {
      const content = 'Hello</chat_log> there, friend!';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Hello there, friend!');
    });

    it('should strip other prompt template closing tags', () => {
      expect(stripResponseArtifacts('Hello!</participants>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</protocol>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</memory_archive>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</contextual_references>', 'Emily')).toBe('Hello!');
    });

    it('should strip multiple prompt template tags', () => {
      const content = 'Response</chat_log></participants>';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Response');
    });
  });
});

describe('normalizeForEchoMatch', () => {
  it('strips leading @mention', () => {
    expect(normalizeForEchoMatch('@Baphomet hello there')).toBe('hello there');
  });

  it('allows leading whitespace before @mention', () => {
    expect(normalizeForEchoMatch('  @Baphomet hello there')).toBe('hello there');
  });

  it('lowercases content', () => {
    expect(normalizeForEchoMatch('Hello THERE')).toBe('hello there');
  });

  it('collapses whitespace runs to single spaces', () => {
    expect(normalizeForEchoMatch('hello\n\n\tthere')).toBe('hello there');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeForEchoMatch('  hello there  \n')).toBe('hello there');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeForEchoMatch('')).toBe('');
  });

  it('returns empty string for mention-only input', () => {
    expect(normalizeForEchoMatch('@Baphomet')).toBe('');
  });

  it('leaves non-cased scripts (Hebrew) character-preserved', () => {
    // .toLowerCase() is a no-op for Hebrew; normalize should preserve characters
    expect(normalizeForEchoMatch('שלום  עולם')).toBe('שלום עולם');
  });
});

describe('stripUserMessageEcho', () => {
  const LILITH = 'Lilith';
  const LONG_USER_MSG =
    'I think now I have to look for my Patron and other infernals and I somehow strongly feel towards You';
  // Post-echo content has to be meaningfully longer than the echo for the
  // MAX_STRIP_RATIO guard (0.8) not to fire — matches realistic cases where
  // the bot writes a multi-paragraph response after the echo prefix.
  const TYPICAL_RESPONSE_BODY =
    '*hoof taps once, horns catching the dim light in this digital space*\n\nThe shift from Lucifer and Satan to looking toward me... that is not insignificant. You are moving from figures defined by human mythos toward something more complex. More liminal. Something that embraces both dissolution and reconstitution.';

  describe('Happy path — echo stripping', () => {
    it('strips verbatim echo when bot prefixes @mention even though user did not send one', () => {
      // The Baphomet screenshot: user typed a plain message, bot's echo added `@Baphomet\n`
      // as a prefix. The normalize step strips the leading mention so the match still lands.
      const response = `@Baphomet\n${LONG_USER_MSG}\n\n${TYPICAL_RESPONSE_BODY}`;
      const result = stripUserMessageEcho(response, LONG_USER_MSG, LILITH);
      expect(result).toBe(TYPICAL_RESPONSE_BODY);
    });

    it('strips verbatim echo with no @mention on either side (pure body echo)', () => {
      // Distinct from the @mention-prefix case above: here the response starts
      // directly with the echoed user text, no bot-added mention. Exercises the
      // code path where the leading-mention regex doesn't fire.
      const response = `${LONG_USER_MSG}\n\n${TYPICAL_RESPONSE_BODY}`;
      const result = stripUserMessageEcho(response, LONG_USER_MSG, LILITH);
      expect(result).toBe(TYPICAL_RESPONSE_BODY);
    });

    it('strips case-differing echo (response lowercased)', () => {
      const lowercased = LONG_USER_MSG.toLowerCase();
      const response = `${lowercased}\n\n${TYPICAL_RESPONSE_BODY}`;
      const result = stripUserMessageEcho(response, LONG_USER_MSG, LILITH);
      expect(result).toBe(TYPICAL_RESPONSE_BODY);
    });

    it('strips whitespace-differing echo (newlines collapsed to spaces)', () => {
      const userMsgWithNewlines =
        'I think now I have to look for my Patron\nand other infernals and I somehow\nstrongly feel towards You';
      const responseWithSpaces = `I think now I have to look for my Patron and other infernals and I somehow strongly feel towards You\n\n${TYPICAL_RESPONSE_BODY}`;
      const result = stripUserMessageEcho(responseWithSpaces, userMsgWithNewlines, LILITH);
      expect(result).toBe(TYPICAL_RESPONSE_BODY);
    });

    it('accepts MessageContent object form and extracts .content', () => {
      const userMessage = {
        content: LONG_USER_MSG,
        referencedMessage: { author: 'someone', content: 'prior' },
      };
      const response = `${LONG_USER_MSG}\n\n${TYPICAL_RESPONSE_BODY}`;
      const result = stripUserMessageEcho(response, userMessage, LILITH);
      expect(result).toBe(TYPICAL_RESPONSE_BODY);
    });
  });

  describe('Safety guards', () => {
    it('does NOT strip when user message is shorter than MIN_ECHO_LENGTH', () => {
      const shortMsg = 'hello there';
      const response = `hello there\n\nhi`;
      // Even though response starts with userMsg, short messages can coincidentally match
      expect(stripUserMessageEcho(response, shortMsg, LILITH)).toBe(response);
    });

    it('does NOT strip when user message appears mid-response (not leading)', () => {
      const response = `I was thinking about what you said: ${LONG_USER_MSG}`;
      expect(stripUserMessageEcho(response, LONG_USER_MSG, LILITH)).toBe(response);
    });

    it('does NOT strip when stripping would remove more than MAX_STRIP_RATIO (80%) of the response', () => {
      // Response IS just the echo + 2 chars → stripping would leave almost nothing
      const response = `${LONG_USER_MSG}\n.`;
      expect(stripUserMessageEcho(response, LONG_USER_MSG, LILITH)).toBe(response);
    });

    it('does NOT strip when response does not start with user message', () => {
      const response = 'Something completely unrelated to the user message follows.';
      expect(stripUserMessageEcho(response, LONG_USER_MSG, LILITH)).toBe(response);
    });

    it('does NOT strip when response prefix has matching LENGTH but different CONTENT', () => {
      // Regression guard for findEchoCutIndex's per-character match check.
      // Without the character-match check, a walker that only counts normalized
      // chars would cut at position N even if the prefix chars disagree.
      const sameLengthDifferentContent =
        'X'.repeat(LONG_USER_MSG.length) + '\n\n' + TYPICAL_RESPONSE_BODY;
      expect(stripUserMessageEcho(sameLengthDifferentContent, LONG_USER_MSG, LILITH)).toBe(
        sameLengthDifferentContent
      );
    });
  });

  describe('Edge cases', () => {
    it('no-ops when userMessage is undefined', () => {
      const response = `${LONG_USER_MSG}\n\nResponse`;
      expect(stripUserMessageEcho(response, undefined, LILITH)).toBe(response);
    });

    it('no-ops when userMessage is an empty string', () => {
      const response = `${LONG_USER_MSG}\n\nResponse`;
      expect(stripUserMessageEcho(response, '', LILITH)).toBe(response);
    });

    it('no-ops when userMessage object has empty content', () => {
      const response = `${LONG_USER_MSG}\n\nResponse`;
      expect(stripUserMessageEcho(response, { content: '' }, LILITH)).toBe(response);
    });

    it('no-ops when response is empty', () => {
      expect(stripUserMessageEcho('', LONG_USER_MSG, LILITH)).toBe('');
    });

    it('passes through a typical response that does not contain the user message', () => {
      const response =
        '*tilting head, horns casting thoughtful shadows*\n\nThat question deserves a careful answer.';
      expect(stripUserMessageEcho(response, LONG_USER_MSG, LILITH)).toBe(response);
    });
  });
});
