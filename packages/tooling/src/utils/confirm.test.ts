import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:readline', () => ({
  createInterface: vi.fn(),
}));

import { createInterface } from 'node:readline';
import { confirmPrompt } from './confirm.js';

const mockCreateInterface = vi.mocked(createInterface);

function fakeInterface(scriptedAnswer: string): {
  question: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  const close = vi.fn();
  const question = vi.fn((_prompt: string, cb: (answer: string) => void) => {
    cb(scriptedAnswer);
  });
  return { question, close };
}

describe('confirmPrompt', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['yes', true],
    ['YES', true],
    ['y', false],
    ['no', false],
    ['', false],
  ])('resolves %j to %s', async (answer, expected) => {
    const fake = fakeInterface(answer);
    mockCreateInterface.mockReturnValue(fake as unknown as ReturnType<typeof createInterface>);

    await expect(confirmPrompt('be careful')).resolves.toBe(expected);
    expect(fake.close).toHaveBeenCalledTimes(1);
  });

  it('prints the warning text via console.log', async () => {
    const fake = fakeInterface('yes');
    mockCreateInterface.mockReturnValue(fake as unknown as ReturnType<typeof createInterface>);

    await confirmPrompt('this will delete things');

    const printed = logSpy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n');
    expect(printed).toContain('this will delete things');
  });
});
