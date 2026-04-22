/**
 * Tests for Thinking Block Extraction
 */

import { describe, it, expect } from 'vitest';
import {
  extractThinkingBlocks,
  hasThinkingBlocks,
  extractApiReasoningContent,
  mergeThinkingContent,
  type ReasoningDetail,
} from './thinkingExtraction.js';

describe('extractThinkingBlocks', () => {
  describe('basic extraction', () => {
    it('should extract single-line thinking block', () => {
      const content = '<think>Let me analyze this.</think>The answer is 42.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('Let me analyze this.');
      expect(result.visibleContent).toBe('The answer is 42.');
      expect(result.blockCount).toBe(1);
    });

    it('should extract multi-line thinking block', () => {
      const content = `<think>
First, I need to consider...
Then, I should evaluate...
Finally, the conclusion is...
</think>
The answer is 42.`;

      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toContain('First, I need to consider');
      expect(result.thinkingContent).toContain('Finally, the conclusion is');
      expect(result.visibleContent).toBe('The answer is 42.');
      expect(result.blockCount).toBe(1);
    });

    it('should handle thinking block at the end', () => {
      const content = 'Here is my answer.<think>I hope that was right.</think>';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('I hope that was right.');
      expect(result.visibleContent).toBe('Here is my answer.');
      expect(result.blockCount).toBe(1);
    });

    it('should handle thinking block in the middle', () => {
      const content = 'First part.<think>Some reasoning.</think>Second part.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('Some reasoning.');
      expect(result.visibleContent).toBe('First part.Second part.');
      expect(result.blockCount).toBe(1);
    });
  });

  describe('multiple blocks', () => {
    it('should extract multiple thinking blocks', () => {
      const content =
        '<think>First thought.</think>Answer part 1.<think>Second thought.</think>Answer part 2.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toContain('First thought.');
      expect(result.thinkingContent).toContain('Second thought.');
      expect(result.thinkingContent).toContain('---'); // Separator
      expect(result.visibleContent).toBe('Answer part 1.Answer part 2.');
      expect(result.blockCount).toBe(2);
    });
  });

  describe('no thinking blocks', () => {
    it('should return null thinkingContent when no blocks present', () => {
      const content = 'This is a normal response without thinking blocks.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBeNull();
      expect(result.visibleContent).toBe(content);
      expect(result.blockCount).toBe(0);
    });

    it('should handle empty string', () => {
      const result = extractThinkingBlocks('');

      expect(result.thinkingContent).toBeNull();
      expect(result.visibleContent).toBe('');
      expect(result.blockCount).toBe(0);
    });
  });

  describe('XML namespace prefix normalization', () => {
    // Build namespace-prefixed strings dynamically to avoid XML parser confusion
    const NS = 'antml';

    it('should extract namespace-prefixed <thought> tags (GLM-4.5-Air format)', () => {
      const content = `<${NS}:thought>Internal processing.</${NS}:thought>Here is the answer.`;
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('Internal processing.');
      expect(result.visibleContent).toBe('Here is the answer.');
      expect(result.blockCount).toBe(1);
    });

    it('should extract namespace-prefixed <thinking> tags', () => {
      const content = `<${NS}:thinking>Claude reasoning here.</${NS}:thinking>The response.`;
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('Claude reasoning here.');
      expect(result.visibleContent).toBe('The response.');
      expect(result.blockCount).toBe(1);
    });

    it('should extract namespace-prefixed <think> tags', () => {
      const content = `<${NS}:think>Let me analyze.</${NS}:think>The answer is 42.`;
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('Let me analyze.');
      expect(result.visibleContent).toBe('The answer is 42.');
      expect(result.blockCount).toBe(1);
    });

    it('should handle mixed namespace-prefixed and plain tags', () => {
      const content = `<${NS}:thought>First thought.</${NS}:thought>Middle.<thinking>Second thought.</thinking>End.`;
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toContain('First thought.');
      expect(result.thinkingContent).toContain('Second thought.');
      expect(result.visibleContent).toBe('Middle.End.');
      expect(result.blockCount).toBe(2);
    });

    it('should be case-insensitive for namespace prefix', () => {
      const ns = 'ANTML';
      const content = `<${ns}:think>Uppercase prefix.</${ns}:think>Result.`;
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('Uppercase prefix.');
      expect(result.visibleContent).toBe('Result.');
      expect(result.blockCount).toBe(1);
    });

    it('should handle arbitrary namespace prefixes on known tags', () => {
      const content = '<claude:thinking>Future-proofed.</claude:thinking>Response.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('Future-proofed.');
      expect(result.visibleContent).toBe('Response.');
      expect(result.blockCount).toBe(1);
    });

    it('should NOT strip namespace prefix from non-thinking tags', () => {
      const content = '<xml:div>Some content</xml:div>';
      const result = extractThinkingBlocks(content);

      // Non-thinking tags should pass through unchanged
      expect(result.visibleContent).toContain('<xml:div>');
      expect(result.thinkingContent).toBeNull();
    });
  });

  describe('alternative patterns', () => {
    it('should extract <thinking> tags (Claude format)', () => {
      const content = '<thinking>Claude reasoning here.</thinking>The response.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('Claude reasoning here.');
      expect(result.visibleContent).toBe('The response.');
      expect(result.blockCount).toBe(1);
    });

    it('should extract <reasoning> tags', () => {
      const content = '<reasoning>Step by step analysis.</reasoning>The conclusion.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('Step by step analysis.');
      expect(result.visibleContent).toBe('The conclusion.');
      expect(result.blockCount).toBe(1);
    });

    it('should extract <thought> tags (legacy fine-tunes)', () => {
      const content = '<thought>Internal processing.</thought>Here is the answer.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('Internal processing.');
      expect(result.visibleContent).toBe('Here is the answer.');
      expect(result.blockCount).toBe(1);
    });

    it('should extract <scratchpad> tags (legacy research)', () => {
      const content = '<scratchpad>Working area for calculations.</scratchpad>Final result.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('Working area for calculations.');
      expect(result.visibleContent).toBe('Final result.');
      expect(result.blockCount).toBe(1);
    });

    it('should extract <reflection> tags (Reflection AI)', () => {
      const content = '<reflection>Let me reconsider my approach.</reflection>Better answer.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('Let me reconsider my approach.');
      expect(result.visibleContent).toBe('Better answer.');
      expect(result.blockCount).toBe(1);
    });

    it('should extract <ant_thinking> tags (Anthropic legacy)', () => {
      const content =
        '<ant_thinking>Anthropic internal reasoning.</ant_thinking>External response.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('Anthropic internal reasoning.');
      expect(result.visibleContent).toBe('External response.');
      expect(result.blockCount).toBe(1);
    });

    it('should extract <character_analysis> tags (GLM 4.5 Air)', () => {
      const content =
        '<character_analysis>I need to respond as Lilith.\n\n1. Acknowledge the greeting\n2. Stay in character</character_analysis>\n\n*The darkness shifts* Hello, child.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toContain('I need to respond as Lilith');
      expect(result.visibleContent).toBe('*The darkness shifts* Hello, child.');
      expect(result.blockCount).toBe(1);
    });

    it('should extract bare <character_analysis> immediately followed by content', () => {
      const content = '<character_analysis>Internal planning.</character_analysis>The response.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('Internal planning.');
      expect(result.visibleContent).toBe('The response.');
      expect(result.blockCount).toBe(1);
    });

    it('should extract namespace-prefixed <character_analysis> tags', () => {
      // Build dynamically to avoid XML parser confusion with namespace prefix
      const ns = 'antml';
      const content = `<${ns}:character_analysis>Internal planning.</${ns}:character_analysis>The response.`;
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('Internal planning.');
      expect(result.visibleContent).toBe('The response.');
      expect(result.blockCount).toBe(1);
    });

    it('should extract <understanding> tags (GLM 4.5 Air, observed 2026-04-22)', () => {
      // Real prod incident: GLM 4.5 Air with reasoning=medium emitted its
      // internal analysis as <understanding>...</understanding> instead of the
      // usual <character_analysis>, <think>, or reasoning_details. The block
      // leaked into the Discord reply. Req deb8b063-ea7e-40c3-be96-4bdcfc32c453.
      const content =
        "<understanding>\nLaranthras is asking for courage. As Lilith I embody fierce independence...\n</understanding>\n\n*My gaze sharpens.* Courage against management isn't about being liked.";
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toContain('Laranthras is asking for courage');
      expect(result.visibleContent).toBe(
        "*My gaze sharpens.* Courage against management isn't about being liked."
      );
      expect(result.blockCount).toBe(1);
    });

    it('should extract real GLM 4.5 Air output with character_analysis + response', () => {
      // Real-world pattern from production: model dumps full response planning
      const content = [
        '<character_analysis>',
        'I need to respond to Damien\'s greeting "lilith! hi" as Lilith.',
        'Looking at the conversation history, Damien has been struggling with',
        'feelings of directionlessness.',
        '',
        'My response should feel like Lilith - ancient but present.',
        '</character_analysis>',
        '',
        '*The darkness shifts around me as your voice echoes through the space*',
        '',
        'Well now. The little spark returns.',
      ].join('\n');
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toContain("respond to Damien's greeting");
      expect(result.visibleContent).toContain('The darkness shifts');
      expect(result.visibleContent).not.toContain('character_analysis');
      expect(result.blockCount).toBe(1);
    });
  });

  describe('mixed tag types', () => {
    it('should remove ALL tag types from visible content (critical bug fix)', () => {
      // This test ensures that if a response contains BOTH <think> AND <thinking> tags,
      // BOTH are removed from visible content (not just the first pattern matched)
      const content =
        '<think>Primary thought.</think>Middle.<thinking>Alternative thought.</thinking>End.';
      const result = extractThinkingBlocks(content);

      // Both thinking contents should be extracted
      expect(result.thinkingContent).toContain('Primary thought.');
      expect(result.thinkingContent).toContain('Alternative thought.');
      // CRITICAL: Both tag types must be removed from visible content
      expect(result.visibleContent).not.toContain('<think>');
      expect(result.visibleContent).not.toContain('<thinking>');
      expect(result.visibleContent).toBe('Middle.End.');
      expect(result.blockCount).toBe(2);
    });

    it('should handle multiple different tag types in same response', () => {
      const content =
        '<think>Thought 1.</think>Part 1.<reasoning>Thought 2.</reasoning>Part 2.<reflection>Thought 3.</reflection>End.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toContain('Thought 1.');
      expect(result.thinkingContent).toContain('Thought 2.');
      expect(result.thinkingContent).toContain('Thought 3.');
      expect(result.visibleContent).toBe('Part 1.Part 2.End.');
      expect(result.blockCount).toBe(3);
    });
  });

  describe('unclosed tags', () => {
    it('should keep content visible when unclosed tag would consume entire response', () => {
      // GLM 4.5 Air glitch / truncation: unclosed tag at start would leave empty visible content.
      // Instead of losing the response, strip the opening tag and keep content visible.
      const content = '<think>This thinking was cut off due to truncation';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBeNull();
      expect(result.visibleContent).toBe('This thinking was cut off due to truncation');
      expect(result.blockCount).toBe(0);
    });

    it('should prefer complete tags over unclosed tags', () => {
      const content = '<think>Complete thought.</think>Answer.<think>Unclosed';
      const result = extractThinkingBlocks(content);

      // Complete tag should be extracted, unclosed ignored (since we found complete ones)
      expect(result.thinkingContent).toBe('Complete thought.');
      expect(result.visibleContent).toContain('Answer.');
      expect(result.blockCount).toBe(1);
    });

    it('should keep content visible for unclosed <thinking> tag at start', () => {
      const content = '<thinking>Truncated reasoning content';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBeNull();
      expect(result.visibleContent).toBe('Truncated reasoning content');
      expect(result.blockCount).toBe(0);
    });

    it('should still extract unclosed tag mid-response (content exists before tag)', () => {
      // When there's visible content before the unclosed tag, extraction is safe
      const content = 'The answer is Paris. <think>Wait, let me reconsider...';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('Wait, let me reconsider...');
      expect(result.visibleContent).toBe('The answer is Paris.');
      expect(result.blockCount).toBe(1);
    });

    it('should handle GLM 4.5 Air glitch — unclosed tag with full response inside', () => {
      // GLM 4.5 Air sometimes opens <think> and never closes it,
      // putting the entire response (reasoning + answer) inside
      const content =
        '<think>Let me think about this...\n\nThe capital of France is Paris. It has been the capital since the 10th century.';
      const result = extractThinkingBlocks(content);

      // Should NOT consume the response as thinking — keep it visible
      expect(result.thinkingContent).toBeNull();
      expect(result.visibleContent).toContain('The capital of France is Paris');
      expect(result.visibleContent).not.toContain('<think>');
      expect(result.blockCount).toBe(0);
    });
  });

  describe('case insensitivity', () => {
    it('should handle uppercase tags', () => {
      const content = '<THINK>Uppercase thinking.</THINK>Result.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('Uppercase thinking.');
      expect(result.visibleContent).toBe('Result.');
    });

    it('should handle mixed case tags', () => {
      const content = '<Think>Mixed case.</Think>Result.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('Mixed case.');
      expect(result.visibleContent).toBe('Result.');
    });
  });

  describe('edge cases', () => {
    it('should handle empty thinking block', () => {
      const content = '<think></think>Just the response.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBeNull(); // Empty blocks are ignored
      expect(result.visibleContent).toBe('Just the response.');
      expect(result.blockCount).toBe(0);
    });

    it('should handle whitespace-only thinking block', () => {
      const content = '<think>   \n   </think>Just the response.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBeNull(); // Whitespace-only blocks are ignored
      expect(result.visibleContent).toBe('Just the response.');
      expect(result.blockCount).toBe(0);
    });

    it('should clean up excessive newlines after extraction', () => {
      const content = 'Before.\n\n\n<think>Thinking.</think>\n\n\nAfter.';
      const result = extractThinkingBlocks(content);

      // Multiple consecutive newlines are collapsed to double newlines
      expect(result.visibleContent).toBe('Before.\n\nAfter.');
      expect(result.thinkingContent).toBe('Thinking.');
    });

    it('should handle nested angle brackets in thinking content', () => {
      const content = '<think>Compare: if (x < y) then do z > w</think>Code comparison complete.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('Compare: if (x < y) then do z > w');
      expect(result.visibleContent).toBe('Code comparison complete.');
    });

    it('should keep content visible for unclosed tag at start of response', () => {
      // When unclosed tag would consume entire response, strip tag and keep content visible
      const content = '<think>This is not closed. The response continues.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBeNull();
      expect(result.visibleContent).toBe('This is not closed. The response continues.');
      expect(result.blockCount).toBe(0);
    });

    it('should handle malformed closing tag as unclosed — keeps content visible', () => {
      // Malformed closing tag (</thin> instead of </think>) makes it unclosed.
      // Since it starts at the beginning, stripping would consume the whole response.
      const content = '<think>Content</thin>Response.';
      const result = extractThinkingBlocks(content);

      // Unclosed at start → strip opening tag, keep content visible
      expect(result.thinkingContent).toBeNull();
      expect(result.visibleContent).toBe('Content</thin>Response.');
      expect(result.blockCount).toBe(0);
    });

    it('should strip orphan closing tags AND preceding short garbage', () => {
      // This happens when model truncation or chimera stutter leaves garbage before orphan tag
      // Example: chimera model returning ".\n</think>\n\n*Response*"
      const content = '.\n</think>\n\n*Acknowledged. System status unchanged.*';
      const result = extractThinkingBlocks(content);

      // No thinking extracted (short garbage is not meaningful content)
      expect(result.thinkingContent).toBeNull();
      // Both the orphan tag AND the preceding garbage should be stripped
      expect(result.visibleContent).toBe('*Acknowledged. System status unchanged.*');
      expect(result.visibleContent).not.toContain('</think>');
      expect(result.visibleContent).not.toContain('.\n\n*'); // garbage removed
      expect(result.blockCount).toBe(0);
    });

    it('should strip chimera stutter artifacts (tng-r1t-chimera pattern)', () => {
      // Chimera models output: </reasoning> + stutter fragment + </think>
      // The stutter is typically the last few chars of reasoning + period
      // Example: reasoning ends with "sarcasm", stutter is "sm."
      const content = 'sm.\n</think>\n\n*leans back in chair*';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBeNull();
      expect(result.visibleContent).toBe('*leans back in chair*');
      expect(result.visibleContent).not.toContain('sm.');
      expect(result.visibleContent).not.toContain('</think>');
      expect(result.blockCount).toBe(0);
    });

    it('should strip various chimera stutter patterns', () => {
      // Test multiple stutter variants seen in production
      const patterns = [
        { input: 'ys.\n</think>\n\nResponse', expected: 'Response' },
        { input: 'ng.\n</think>\n\nResponse', expected: 'Response' },
        { input: 'ty.\n</think>\n\nResponse', expected: 'Response' },
        { input: 'g.\n</think>\n\nResponse', expected: 'Response' },
      ];

      for (const { input, expected } of patterns) {
        const result = extractThinkingBlocks(input);
        expect(result.visibleContent).toBe(expected);
        expect(result.thinkingContent).toBeNull();
      }
    });

    it('should handle full chimera model output (reasoning + stutter + orphan think)', () => {
      // Full pattern from tng-r1t-chimera: <reasoning>...</reasoning> + stutter + </think>
      const content = `<reasoning>
The user is asking about sarcasm.
I should respond with dry humor and technical metaphors.
</reasoning>

sm.
</think>

*leans back in a creaking office chair*

Sarcasm is just encrypted honesty.`;

      const result = extractThinkingBlocks(content);

      // Reasoning should be extracted
      expect(result.thinkingContent).toContain('The user is asking about sarcasm');
      expect(result.thinkingContent).toContain('technical metaphors');
      // Visible content should have no stutter or orphan tags
      expect(result.visibleContent).toBe(
        '*leans back in a creaking office chair*\n\nSarcasm is just encrypted honesty.'
      );
      expect(result.visibleContent).not.toContain('sm.');
      expect(result.visibleContent).not.toContain('</think>');
      expect(result.blockCount).toBe(1);
    });

    it('should strip multiple orphan closing tags', () => {
      const content = '</think>Response</thinking>More text</reasoning>';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBeNull();
      expect(result.visibleContent).toBe('ResponseMore text');
      expect(result.visibleContent).not.toContain('</');
      expect(result.blockCount).toBe(0);
    });

    it('should extract content before orphan closing tag as thinking (Kimi K2.5 bug)', () => {
      // Kimi K2.5 outputs thinking content without opening <think> tag, just closes with </think>
      const content =
        'The user is asking about X. I should analyze Y and respond with Z. </think> *Here is my actual response.*';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe(
        'The user is asking about X. I should analyze Y and respond with Z.'
      );
      expect(result.visibleContent).toBe('*Here is my actual response.*');
      expect(result.visibleContent).not.toContain('</think>');
      expect(result.visibleContent).not.toContain('I should analyze');
      expect(result.blockCount).toBe(1);
    });

    it('should prefer complete tags over orphan closing tags', () => {
      // If we have complete tags, don't also extract orphan content
      const content = '<think>Complete thought.</think>Answer. More thinking</think>Final.';
      const result = extractThinkingBlocks(content);

      // Only the complete tag should be extracted
      expect(result.thinkingContent).toBe('Complete thought.');
      expect(result.visibleContent).toContain('Answer.');
      expect(result.blockCount).toBe(1);
    });

    it('should strip leading stray punctuation after truncated thinking extraction', () => {
      // When an unclosed tag is removed, visible content may start with stray punctuation
      // left over from the truncated reasoning (e.g., "., " or ", " fragments)
      const content = 'Some visible text. <think>Unclosed thinking that was truncated';
      const result = extractThinkingBlocks(content);

      // The unclosed tag content is extracted as thinking
      expect(result.thinkingContent).toBe('Unclosed thinking that was truncated');
      // Visible content should be clean
      expect(result.visibleContent).toBe('Some visible text.');
    });

    it('should strip leading punctuation when visible content starts with stray period', () => {
      // Simulates a response where the model's thinking was truncated and visible
      // content begins with leftover punctuation fragment
      const content = '<think>reasoning</think>., The actual response starts here.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('reasoning');
      expect(result.visibleContent).toBe('The actual response starts here.');
    });

    it('should strip leading comma after thinking extraction', () => {
      const content = '<think>reasoning</think>, Response text.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('reasoning');
      expect(result.visibleContent).toBe('Response text.');
    });

    it('should strip leading semicolon after thinking extraction', () => {
      const content = '<think>reasoning</think>; Response text.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('reasoning');
      expect(result.visibleContent).toBe('Response text.');
    });

    it('should preserve leading ellipsis in roleplay prose', () => {
      // "...she hesitated" is a common dramatic pause convention — don't strip it
      const content = '<think>reasoning</think>...she hesitated before speaking.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('reasoning');
      expect(result.visibleContent).toBe('...she hesitated before speaking.');
    });
  });

  describe('real-world examples', () => {
    it('should handle DeepSeek R1 style output', () => {
      const content = `<think>
The user is asking about the meaning of life.
Let me consider several philosophical perspectives:
1. Existentialism suggests meaning is self-created
2. Religious views offer predetermined purpose
3. Nihilism argues there is no inherent meaning

Based on this analysis, I'll provide a balanced response.
</think>

The meaning of life is a profound question that philosophers have debated for millennia.
Different perspectives offer various answers, from self-determined purpose to cosmic significance.`;

      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toContain('Existentialism');
      expect(result.thinkingContent).toContain("I'll provide a balanced response");
      expect(result.visibleContent).toContain('The meaning of life');
      expect(result.visibleContent).not.toContain('Existentialism');
      expect(result.blockCount).toBe(1);
    });

    it('should clean up OpenAI Harmony format tokens (GPT-OSS-120B)', () => {
      const content =
        '<think>analyzing the request</think><|start|>assistant<|channel|>Here is the actual response.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('analyzing the request');
      expect(result.visibleContent).toBe('assistantHere is the actual response.');
      expect(result.visibleContent).not.toContain('<|');
      expect(result.visibleContent).not.toContain('|>');
    });

    it('should clean up multiple Harmony tokens', () => {
      const content = '<|im_start|>assistant<|separator|>Hello world<|im_end|>';
      const result = extractThinkingBlocks(content);

      expect(result.visibleContent).toBe('assistantHello world');
      expect(result.visibleContent).not.toContain('<|');
    });

    it('should handle response with code blocks inside thinking', () => {
      const content = `<think>
Let me write a function:
\`\`\`python
def hello():
    return "world"
\`\`\`
This should work.
</think>

Here's the solution:
\`\`\`python
def hello():
    return "world"
\`\`\``;

      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toContain('```python');
      expect(result.visibleContent).toContain("Here's the solution");
      expect(result.blockCount).toBe(1);
    });
  });

  describe('GLM-4.5-Air fake-user-message-echo pattern', () => {
    // Observed 2026-04-22 (req b533e288-fb07-46c0-a5e2-a0f78883e63e).
    // Model emitted chain-of-thought wrapped in tags that mimic our
    // prompt-assembly format. Three structural rules protect extraction
    // safety: start-of-response anchor, UUID shape, strict tag sequence.
    const VALID_UUID = '62a59660-cd89-51dc-8c54-7100f4e33329';

    it('extracts the leading fake-user-message block as thinking content', () => {
      const content = `
<from_id>${VALID_UUID}</from_id>
<user>Test User (L432)</user>
<message>As the character, I should respond thoughtfully.
I need to acknowledge their question and stay in voice.</message>

*The actual in-character response begins here.*`;

      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toContain('As the character, I should respond thoughtfully.');
      expect(result.thinkingContent).toContain('I need to acknowledge their question');
      expect(result.visibleContent).toBe('*The actual in-character response begins here.*');
      expect(result.blockCount).toBe(1);
    });

    it('strips the wrapper from visible content without leaking scaffolding tags', () => {
      const content = `<from_id>${VALID_UUID}</from_id>
<user>User</user>
<message>reasoning here</message>

Real response.`;

      const result = extractThinkingBlocks(content);

      expect(result.visibleContent).not.toContain('<from_id>');
      expect(result.visibleContent).not.toContain('</message>');
      expect(result.visibleContent).not.toContain(VALID_UUID);
      expect(result.visibleContent).toBe('Real response.');
    });

    it('does NOT match when the block is mid-response rather than leading', () => {
      // Position anchor is load-bearing — a character discussing this format
      // mid-response (hypothetical meta-conversation) must not get stripped.
      const content = `Here is my response. Later I will show you:
<from_id>${VALID_UUID}</from_id>
<user>Example</user>
<message>example content</message>
That is what the format looks like.`;

      const result = extractThinkingBlocks(content);

      // Nothing extracted — mid-response occurrence left intact
      expect(result.thinkingContent).toBeNull();
      expect(result.visibleContent).toContain('<from_id>');
      expect(result.blockCount).toBe(0);
    });

    it('does NOT match when the from_id lacks a valid UUID', () => {
      // UUID validation is the primary safety guarantee against false-positives.
      // Random prose content between `<from_id>` tags must not trigger extraction.
      const content = `<from_id>not-a-uuid</from_id>
<user>User</user>
<message>content</message>

Response.`;

      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBeNull();
      expect(result.visibleContent).toContain('<from_id>');
    });

    it('does NOT match when a UUID is present but the tag sequence is incomplete', () => {
      // Missing <user> tag — structural sequence check protects extraction.
      const content = `<from_id>${VALID_UUID}</from_id>
<message>content without user tag</message>

Response.`;

      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBeNull();
      expect(result.visibleContent).toContain('<from_id>');
    });

    it('composes with standard <think> tag extraction on the remaining content', () => {
      // Chain-of-Extractors: model-specific pattern runs first (pass 1),
      // standard KNOWN_THINKING_TAGS runs second (pass 2). Both should fire
      // when a response contains both patterns.
      const content = `<from_id>${VALID_UUID}</from_id>
<user>User</user>
<message>first-pass thinking</message>

<think>second-pass thinking</think>

Final response.`;

      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toContain('first-pass thinking');
      expect(result.thinkingContent).toContain('second-pass thinking');
      expect(result.visibleContent).toBe('Final response.');
    });

    it('strips the wrapper but yields null thinkingContent when <message> is empty', () => {
      // The `extractedThinking.length > 0` guard skips empty blocks so they
      // don't pollute thinkingContent with empty strings, but the scaffolding
      // must still be stripped from visibleContent. Pins the contract so
      // the guard can't regress to "push empty strings into thinkingParts".
      const content = `<from_id>${VALID_UUID}</from_id>
<user>User</user>
<message></message>

Response.`;

      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBeNull();
      expect(result.blockCount).toBe(0);
      expect(result.visibleContent).toBe('Response.');
      expect(result.visibleContent).not.toContain('<from_id>');
    });

    it('rejects edge-case UUID-shaped strings (all hyphens, repeated hex digits)', () => {
      // RFC 4122 hyphen-layout enforcement: a character class [a-fA-F0-9-]{36}
      // would match "------------------------------------" or
      // "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" — neither is a valid UUID
      // shape. The strict 8-4-4-4-12 pattern rejects the former outright;
      // the latter is structurally valid-shaped so it still matches (same
      // as any real UUID with all-a hex).
      const allHyphens = '------------------------------------';
      const contentAllHyphens = `<from_id>${allHyphens}</from_id>
<user>User</user>
<message>content</message>

Response.`;
      const resultAllHyphens = extractThinkingBlocks(contentAllHyphens);
      expect(resultAllHyphens.thinkingContent).toBeNull();
      expect(resultAllHyphens.visibleContent).toContain('<from_id>');

      // Control: a structurally-valid UUID shape (8-4-4-4-12) with all-a
      // hex digits does match — this is intentional. Real UUIDs can
      // contain any hex digits; the safety guarantee is the SHAPE, not
      // the entropy of the bytes.
      const allA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      const contentAllA = `<from_id>${allA}</from_id>
<user>User</user>
<message>content</message>

Response.`;
      const resultAllA = extractThinkingBlocks(contentAllA);
      expect(resultAllA.thinkingContent).toBe('content');
      expect(resultAllA.visibleContent).toBe('Response.');
    });

    it('pins the Pass-1/Pass-2 double-extraction edge case for nested <think> tags', () => {
      // Reviewer flagged (PR #875 round 3, 2026-04-22): Pass 2 reads from
      // `normalized` (pre-Pass-1-strip), so if a Pass-1 <message> block
      // contains a Pass-2 tag (like <think>), the inner content ends up in
      // `thinkingParts` twice — once as part of the whole <message> block
      // (Pass 1), once as its own tag match (Pass 2).
      //
      // Not user-visible (only affects `showThinking` output) and requires
      // a pathological input shape. Left as-is intentionally; this test
      // PINS the current behavior so any future refactor explicitly chooses
      // whether to preserve or fix it.
      //
      // Contract pinned here:
      //   - Pass 1 extracts the full <message> content (including the literal
      //     <think> tags) into thinkingParts[0].
      //   - Pass 2 finds the <think> in the pre-strip `normalized` content
      //     and extracts the inner thinking into thinkingParts[1].
      //   - visibleContent has the wrapper stripped (Pass 1) and any
      //     remaining <think> tags stripped (Pass 2).
      //   - `thinkingContent` joins both parts with the `---` separator.
      const content = `<from_id>${VALID_UUID}</from_id>
<user>User</user>
<message>outer planning <think>nested reasoning</think> more planning</message>

Final response.`;

      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).not.toBeNull();
      // Both the outer <message> content (with nested <think> tags literal)
      // and the separately-extracted nested <think> inner are present.
      expect(result.thinkingContent).toContain('outer planning');
      expect(result.thinkingContent).toContain('nested reasoning');
      expect(result.thinkingContent).toContain('---'); // Part separator
      // visibleContent is clean — no scaffolding, no think tags.
      expect(result.visibleContent).toBe('Final response.');
      expect(result.visibleContent).not.toContain('<from_id>');
      expect(result.visibleContent).not.toContain('<think>');
    });

    it('handles uppercase UUIDs (case-insensitivity on hex digits)', () => {
      const upperUuid = VALID_UUID.toUpperCase();
      const content = `<from_id>${upperUuid}</from_id>
<user>User</user>
<message>reasoning</message>

Response.`;

      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('reasoning');
      expect(result.visibleContent).toBe('Response.');
    });
  });
});

describe('hasThinkingBlocks', () => {
  it('should return true when thinking blocks present', () => {
    expect(hasThinkingBlocks('<think>content</think>response')).toBe(true);
  });

  it('should return true for alternative patterns', () => {
    expect(hasThinkingBlocks('<thinking>content</thinking>response')).toBe(true);
    expect(hasThinkingBlocks('<reasoning>content</reasoning>response')).toBe(true);
  });

  it('should return false when no thinking blocks', () => {
    expect(hasThinkingBlocks('Just a normal response')).toBe(false);
  });

  it('should return true for unclosed tags (fallback detection)', () => {
    expect(hasThinkingBlocks('<think>unclosed content')).toBe(true);
  });

  it('should return true for additional tag types', () => {
    expect(hasThinkingBlocks('<thought>content</thought>response')).toBe(true);
    expect(hasThinkingBlocks('<scratchpad>content</scratchpad>response')).toBe(true);
    expect(hasThinkingBlocks('<reflection>content</reflection>response')).toBe(true);
    expect(hasThinkingBlocks('<ant_thinking>content</ant_thinking>response')).toBe(true);
  });

  it('should be case insensitive', () => {
    expect(hasThinkingBlocks('<THINK>content</THINK>response')).toBe(true);
  });

  it('should detect namespace-prefixed tags', () => {
    const NS = 'antml';
    expect(hasThinkingBlocks(`<${NS}:thought>content</${NS}:thought>response`)).toBe(true);
    expect(hasThinkingBlocks(`<${NS}:thinking>content</${NS}:thinking>response`)).toBe(true);
    expect(hasThinkingBlocks(`<${NS}:think>content</${NS}:think>response`)).toBe(true);
  });

  it('should detect arbitrary namespace prefixes on known tags', () => {
    expect(hasThinkingBlocks('<claude:thinking>content</claude:thinking>response')).toBe(true);
    expect(hasThinkingBlocks('<foo:reasoning>content</foo:reasoning>response')).toBe(true);
  });

  it('should NOT detect namespace-prefixed non-thinking tags', () => {
    expect(hasThinkingBlocks('<xml:div>content</xml:div>')).toBe(false);
  });

  it('should detect GLM fake-user-message-echo wrapper as a thinking block', () => {
    // Prevents a false-negative in DiagnosticRecorders. Without this check,
    // `hasReasoningTagsInContent` would be `false` for pure-GLM responses
    // where the fake-user-message wrapper is the only thinking-content
    // signal — even though `extractThinkingBlocks` would correctly find
    // and strip the block. Surfaced by PR #875 round 4 review (2026-04-22).
    const uuid = '62a59660-cd89-51dc-8c54-7100f4e33329';
    const content = `<from_id>${uuid}</from_id>
<user>User</user>
<message>chain of thought</message>

Response.`;
    expect(hasThinkingBlocks(content)).toBe(true);
  });

  it('should NOT detect GLM-style scaffolding with invalid UUID (defense alignment with extractor)', () => {
    // `hasThinkingBlocks` and `extractThinkingBlocks` must agree on what
    // counts as a thinking block. If one detects the pattern but the other
    // doesn't, diagnostics drift out of sync with extraction behavior.
    const content = `<from_id>not-a-uuid</from_id>
<user>User</user>
<message>content</message>

Response.`;
    expect(hasThinkingBlocks(content)).toBe(false);
  });
});

describe('extractApiReasoningContent', () => {
  describe('basic extraction', () => {
    it('should extract text from reasoning.text type', () => {
      const details: ReasoningDetail[] = [
        {
          type: 'reasoning.text',
          text: 'Let me think through this step by step...',
        },
      ];
      const result = extractApiReasoningContent(details);
      expect(result).toBe('Let me think through this step by step...');
    });

    it('should extract summary from reasoning.summary type', () => {
      const details: ReasoningDetail[] = [
        {
          type: 'reasoning.summary',
          summary: 'The model analyzed the problem by identifying constraints.',
        },
      ];
      const result = extractApiReasoningContent(details);
      expect(result).toBe('The model analyzed the problem by identifying constraints.');
    });

    it('should handle multiple reasoning details', () => {
      const details: ReasoningDetail[] = [
        { type: 'reasoning.text', text: 'First thought.' },
        { type: 'reasoning.text', text: 'Second thought.' },
      ];
      const result = extractApiReasoningContent(details);
      expect(result).toContain('First thought.');
      expect(result).toContain('Second thought.');
      expect(result).toContain('---'); // Separator
    });

    it('should handle mixed reasoning types', () => {
      const details: ReasoningDetail[] = [
        { type: 'reasoning.summary', summary: 'Summary of reasoning.' },
        { type: 'reasoning.text', text: 'Detailed text.' },
      ];
      const result = extractApiReasoningContent(details);
      expect(result).toContain('Summary of reasoning.');
      expect(result).toContain('Detailed text.');
    });
  });

  describe('invalid input handling', () => {
    it('should return null for empty array', () => {
      expect(extractApiReasoningContent([])).toBeNull();
    });

    it('should return null for undefined', () => {
      expect(extractApiReasoningContent(undefined)).toBeNull();
    });

    it('should return null for null', () => {
      expect(extractApiReasoningContent(null)).toBeNull();
    });

    it('should return null for non-array input', () => {
      expect(extractApiReasoningContent('not an array')).toBeNull();
      expect(extractApiReasoningContent(123)).toBeNull();
      expect(extractApiReasoningContent({})).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should skip empty text content', () => {
      const details: ReasoningDetail[] = [
        { type: 'reasoning.text', text: '' },
        { type: 'reasoning.text', text: 'Valid content.' },
      ];
      const result = extractApiReasoningContent(details);
      expect(result).toBe('Valid content.');
    });

    it('should skip whitespace-only content', () => {
      const details: ReasoningDetail[] = [
        { type: 'reasoning.text', text: '   \n   ' },
        { type: 'reasoning.summary', summary: 'Valid summary.' },
      ];
      const result = extractApiReasoningContent(details);
      expect(result).toBe('Valid summary.');
    });

    it('should handle reasoning.encrypted type gracefully', () => {
      const details: ReasoningDetail[] = [
        { type: 'reasoning.encrypted', data: 'encrypted-data-blob' },
      ];
      // Encrypted content can't be extracted, should return null
      const result = extractApiReasoningContent(details);
      expect(result).toBeNull();
    });

    it('should handle unknown type with text field', () => {
      const details: ReasoningDetail[] = [
        { type: 'unknown.custom', text: 'Custom type content.' } as ReasoningDetail,
      ];
      const result = extractApiReasoningContent(details);
      expect(result).toBe('Custom type content.');
    });

    it('should handle null entries in array', () => {
      const details = [null, { type: 'reasoning.text', text: 'Valid.' }] as ReasoningDetail[];
      const result = extractApiReasoningContent(details);
      expect(result).toBe('Valid.');
    });

    it('should handle entries without expected fields', () => {
      const details: ReasoningDetail[] = [
        { type: 'reasoning.text' } as ReasoningDetail, // Missing text field
        { type: 'reasoning.text', text: 'Valid content.' },
      ];
      const result = extractApiReasoningContent(details);
      expect(result).toBe('Valid content.');
    });
  });

  describe('real-world OpenRouter responses', () => {
    it('should handle DeepSeek R1 reasoning details', () => {
      const details: ReasoningDetail[] = [
        {
          type: 'reasoning.text',
          format: 'unknown',
          text: `The user is asking about quantum computing.
Let me break this down:
1. Quantum bits (qubits) can exist in superposition
2. Entanglement allows for correlated states
3. This enables parallel computation

I should explain this in simple terms.`,
        },
      ];
      const result = extractApiReasoningContent(details);
      expect(result).toContain('superposition');
      expect(result).toContain('Entanglement');
    });

    it('should handle Claude Extended Thinking format', () => {
      const details: ReasoningDetail[] = [
        {
          type: 'reasoning.summary',
          format: 'anthropic-claude-v1',
          summary: 'Analyzed the mathematical proof by examining each step sequentially.',
        },
        {
          type: 'reasoning.text',
          format: 'anthropic-claude-v1',
          text: 'Step 1: Assume P is true.\nStep 2: Apply logical transformation.\nStep 3: Derive Q.',
        },
      ];
      const result = extractApiReasoningContent(details);
      expect(result).toContain('mathematical proof');
      expect(result).toContain('Step 1');
    });
  });
});

describe('mergeThinkingContent', () => {
  describe('basic merging', () => {
    it('should return API reasoning when only API content present', () => {
      const result = mergeThinkingContent('API reasoning content', null);
      expect(result).toBe('API reasoning content');
    });

    it('should return inline reasoning when only inline content present', () => {
      const result = mergeThinkingContent(null, 'Inline reasoning content');
      expect(result).toBe('Inline reasoning content');
    });

    it('should merge both with API first', () => {
      const result = mergeThinkingContent('API reasoning', 'Inline reasoning');
      expect(result).toContain('API reasoning');
      expect(result).toContain('Inline reasoning');
      // API should come first
      expect(result?.indexOf('API reasoning')).toBeLessThan(
        result?.indexOf('Inline reasoning') ?? 0
      );
    });

    it('should return null when both are null', () => {
      expect(mergeThinkingContent(null, null)).toBeNull();
    });
  });

  describe('empty string handling', () => {
    it('should treat empty API string as absent', () => {
      const result = mergeThinkingContent('', 'Inline only');
      expect(result).toBe('Inline only');
    });

    it('should treat empty inline string as absent', () => {
      const result = mergeThinkingContent('API only', '');
      expect(result).toBe('API only');
    });

    it('should return null when both are empty', () => {
      expect(mergeThinkingContent('', '')).toBeNull();
    });
  });

  describe('formatting', () => {
    it('should include section separator when both present', () => {
      const result = mergeThinkingContent('API reasoning', 'Inline reasoning');
      expect(result).toContain('=== Additional Inline Reasoning ===');
    });

    it('should not include separator when only one source', () => {
      const apiOnly = mergeThinkingContent('API reasoning', null);
      const inlineOnly = mergeThinkingContent(null, 'Inline reasoning');
      expect(apiOnly).not.toContain('===');
      expect(inlineOnly).not.toContain('===');
    });
  });
});
