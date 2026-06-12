/**
 * BaseMessage content extraction
 *
 * LangChain's `BaseMessage.content` is `string | MessageContentComplex[]`.
 * Token-counting call sites used to cast it with `as string`, which silently
 * produces a wrong count if a message ever carries array-form content blocks
 * (the array's `.toString()` is not its text). This helper extracts the text
 * deterministically for both shapes.
 */

import type { BaseMessage } from '@langchain/core/messages';

/**
 * Extract the text of a message's content for token counting.
 *
 * String content passes through unchanged. Array-form content yields the
 * concatenated text parts; non-text parts (image blocks, etc.) contribute
 * nothing — a text tokenizer can't price them anyway.
 */
export function contentToText(content: BaseMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  return (
    content
      .map(part => {
        if (typeof part === 'string') {
          return part;
        }
        if ('text' in part && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .filter(text => text.length > 0)
      // '\n' join slightly over-counts vs the wire shape — safe (conservative)
      // for budgeting, but NOT a lossless round-trip of the original content
      .join('\n')
  );
}
