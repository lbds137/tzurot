import { describe, it, expect, vi } from 'vitest';
import { generateFromInvokeMock } from './invokeMockChatModel.js';

describe('generateFromInvokeMock', () => {
  it('wraps the resolved message in the LLMResult-shaped envelope', async () => {
    const invokeMock = vi.fn().mockResolvedValue('resolved message');
    const generate = generateFromInvokeMock(invokeMock);

    const result = await generate([{ role: 'user' }], { temperature: 0 });

    expect(result.generations[0][0].text).toBe('');
    expect(result.generations[0][0].message).toBe('resolved message');
  });

  it('forwards messages[0] and options to the inner mock verbatim', async () => {
    const invokeMock = vi.fn().mockResolvedValue('ok');
    const generate = generateFromInvokeMock(invokeMock);
    const firstMessage = { role: 'user', content: 'hi' };
    const options = { temperature: 0.5 };

    await generate([firstMessage, { role: 'system' }], options);

    expect(invokeMock).toHaveBeenCalledWith(firstMessage, options);
  });

  it('forwards undefined as the second argument when options is omitted', async () => {
    const invokeMock = vi.fn().mockResolvedValue('ok');
    const generate = generateFromInvokeMock(invokeMock);
    const firstMessage = { role: 'user', content: 'hi' };

    await generate([firstMessage]);

    expect(invokeMock).toHaveBeenCalledWith(firstMessage, undefined);
  });

  it('rejects through the adapter when the inner mock rejects', async () => {
    const invokeMock = vi.fn().mockRejectedValue(new Error('boom'));
    const generate = generateFromInvokeMock(invokeMock);

    await expect(generate([{ role: 'user' }])).rejects.toThrow('boom');
  });
});
