/**
 * LangChain message → diagnostic message conversion.
 *
 * Pure mapping used by DiagnosticCollector's assembled-prompt recording:
 * LangChain message types collapse to the diagnostic role vocabulary, and
 * content-parts arrays flatten to the text the /inspect views display.
 */

import type { BaseMessage } from '@langchain/core/messages';
import type { DiagnosticMessage } from '@tzurot/common-types/types/diagnostic';

/** Convert a LangChain message to the diagnostic {role, content} shape. */
export function convertMessageToDiagnostic(msg: BaseMessage): DiagnosticMessage {
  const msgType = msg._getType();
  let role: 'system' | 'user' | 'assistant';

  switch (msgType) {
    case 'system':
      role = 'system';
      break;
    case 'human':
      role = 'user';
      break;
    case 'ai':
      role = 'assistant';
      break;
    default:
      role = 'user'; // Default fallback
  }

  // Extract content - handle both string and array formats
  let content: string;
  if (typeof msg.content === 'string') {
    content = msg.content;
  } else if (Array.isArray(msg.content)) {
    content = msg.content
      .map(part => {
        if (typeof part === 'string') {
          return part;
        }
        if (typeof part === 'object' && 'text' in part) {
          return part.text;
        }
        return '[non-text content]';
      })
      .join('');
  } else {
    content = String(msg.content);
  }

  return { role, content };
}
