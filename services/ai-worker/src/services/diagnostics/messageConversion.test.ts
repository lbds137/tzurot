import { describe, it, expect } from 'vitest';
import { SystemMessage, HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { convertMessageToDiagnostic } from './messageConversion.js';

describe('convertMessageToDiagnostic', () => {
  it('maps LangChain message types to diagnostic roles', () => {
    expect(convertMessageToDiagnostic(new SystemMessage('s')).role).toBe('system');
    expect(convertMessageToDiagnostic(new HumanMessage('h')).role).toBe('user');
    expect(convertMessageToDiagnostic(new AIMessage('a')).role).toBe('assistant');
  });

  it('falls back to user for unrecognized message types', () => {
    const tool = new ToolMessage({ content: 't', tool_call_id: 'x' });
    expect(convertMessageToDiagnostic(tool).role).toBe('user');
  });

  it('passes string content through verbatim', () => {
    expect(convertMessageToDiagnostic(new HumanMessage('hello there')).content).toBe('hello there');
  });

  it('flattens content-parts arrays and marks non-text parts', () => {
    const msg = new HumanMessage({
      content: [
        { type: 'text', text: 'First' },
        { type: 'text', text: 'Second' },
        { type: 'image_url', image_url: { url: 'https://x/y.png' } },
      ],
    });
    const converted = convertMessageToDiagnostic(msg);
    expect(converted.content).toBe('FirstSecond[non-text content]');
  });
});
