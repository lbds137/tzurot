/**
 * Tests for Thinking Block Extraction
 */

import { describe, it, expect } from 'vitest';
import { extractThinkingBlocks, hasThinkingBlocks } from './thinkingExtraction.js';

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
    it('should extract content from unclosed tag as fallback', () => {
      const content = '<think>This thinking was cut off due to truncation';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('This thinking was cut off due to truncation');
      expect(result.visibleContent).toBe('');
      expect(result.blockCount).toBe(1);
    });

    it('should prefer complete tags over unclosed tags', () => {
      const content = '<think>Complete thought.</think>Answer.<think>Unclosed';
      const result = extractThinkingBlocks(content);

      // Complete tag should be extracted, unclosed ignored (since we found complete ones)
      expect(result.thinkingContent).toBe('Complete thought.');
      expect(result.visibleContent).toContain('Answer.');
      expect(result.blockCount).toBe(1);
    });

    it('should handle unclosed <thinking> tag', () => {
      const content = '<thinking>Truncated reasoning content';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('Truncated reasoning content');
      expect(result.visibleContent).toBe('');
      expect(result.blockCount).toBe(1);
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

    it('should handle unclosed thinking tag (extracted as fallback)', () => {
      // Unclosed tags are now extracted as a fallback to handle truncated responses
      const content = '<think>This is not closed. The response continues.';
      const result = extractThinkingBlocks(content);

      expect(result.thinkingContent).toBe('This is not closed. The response continues.');
      expect(result.visibleContent).toBe('');
      expect(result.blockCount).toBe(1);
    });

    it('should handle malformed closing tag as unclosed', () => {
      // Malformed closing tag (</thin> instead of </think>) is treated as unclosed
      // The unclosed tag fallback extracts everything after the opening tag
      const content = '<think>Content</thin>Response.';
      const result = extractThinkingBlocks(content);

      // Treated as unclosed <think> tag - everything after it is extracted
      expect(result.thinkingContent).toBe('Content</thin>Response.');
      expect(result.visibleContent).toBe('');
      expect(result.blockCount).toBe(1);
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
});
