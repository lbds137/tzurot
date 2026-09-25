import { describe, it, expect, vi } from 'vitest';
import { ensureRef } from './git-ensure-ref.js';

describe('ensureRef', () => {
  it('calls only rev-parse --verify when the ref is present', () => {
    const runGit = vi.fn(() => 'abc123\n');

    ensureRef(runGit, 'main');

    expect(runGit).toHaveBeenCalledTimes(1);
    expect(runGit).toHaveBeenCalledWith(['rev-parse', '--verify', 'origin/main']);
  });

  it('fetches the ref when rev-parse throws, after the rev-parse attempt', () => {
    const calls: string[][] = [];
    const runGit = vi.fn((args: string[]) => {
      calls.push(args);
      if (args[0] === 'rev-parse') {
        throw new Error('unknown revision');
      }
      return '';
    });

    ensureRef(runGit, 'main');

    expect(calls).toEqual([
      ['rev-parse', '--verify', 'origin/main'],
      ['fetch', 'origin', 'main', '--depth=1'],
    ]);
  });
});
