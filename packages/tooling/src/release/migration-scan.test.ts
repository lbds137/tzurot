import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('chalk', () => {
  const id = (s: string): string => s;
  const chalk = { yellow: id };
  return { default: chalk };
});

vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));

import { readFileSync } from 'node:fs';
import {
  APPLY_AFTER_DEPLOY_MARKER,
  hasApplyAfterDeployMarker,
  scanDestructive,
  scanMarked,
} from './migration-scan.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('hasApplyAfterDeployMarker', () => {
  it('recognizes the exported marker constant', () => {
    expect(hasApplyAfterDeployMarker(APPLY_AFTER_DEPLOY_MARKER)).toBe(true);
  });

  it('does not match a longer or shorter token', () => {
    expect(hasApplyAfterDeployMarker('-- tzurot:apply-after-deployX\n')).toBe(false);
    expect(hasApplyAfterDeployMarker("UPDATE t SET note = 'tzurot:apply-after-deploy';")).toBe(
      false
    );
  });
});

describe('scanDestructive', () => {
  it('flags a DROP COLUMN', () => {
    vi.mocked(readFileSync).mockReturnValue('ALTER TABLE "x" DROP COLUMN "legacy";');
    const hits = scanDestructive('/repo', ['migration.sql']);
    expect(hits).toEqual([{ file: 'migration.sql', label: 'DROP COLUMN' }]);
  });

  it('does not flag a purely additive migration', () => {
    vi.mocked(readFileSync).mockReturnValue('ALTER TABLE "x" ADD COLUMN "new" TEXT;');
    expect(scanDestructive('/repo', ['migration.sql'])).toEqual([]);
  });

  it('exempts a destructive statement on a table CREATEd earlier in the same file', () => {
    vi.mocked(readFileSync).mockReturnValue(
      'CREATE TABLE "t" (id UUID);\nALTER TABLE "t" DROP COLUMN "scratch";'
    );
    expect(scanDestructive('/repo', ['migration.sql'])).toEqual([]);
  });

  it('still flags DROP-then-reCREATE of the same table (order-aware exemption)', () => {
    vi.mocked(readFileSync).mockReturnValue('DROP TABLE "t";\nCREATE TABLE "t" (id UUID);');
    expect(scanDestructive('/repo', ['migration.sql'])).toEqual([
      { file: 'migration.sql', label: 'DROP TABLE' },
    ]);
  });

  it('warns and skips a file that is ENOENT, without flagging it', () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      const err = new Error('ENOENT: no such file') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });
    expect(scanDestructive('/repo', ['missing.sql'])).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('throws on a non-ENOENT read failure rather than silently skipping', () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    });
    expect(() => scanDestructive('/repo', ['unreadable.sql'])).toThrow(/unreadable\.sql.*EACCES/s);
  });

  it('throws on a code-less read failure too (fail closed, not just on EACCES)', () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error('EACCES');
    });
    expect(() => scanDestructive('/repo', ['unreadable.sql'])).toThrow(/unreadable\.sql/);
  });
});

describe('scanMarked', () => {
  it('collects a file carrying the exact marker', () => {
    vi.mocked(readFileSync).mockReturnValue(`${APPLY_AFTER_DEPLOY_MARKER}\nUPDATE t SET x = 1;`);
    expect(scanMarked('/repo', ['migration.sql'])).toEqual(['migration.sql']);
  });

  it('leaves an unmarked file out and warns on a near-miss phrase', () => {
    vi.mocked(readFileSync).mockReturnValue('-- this migration is safe to apply-after-deploy ok');
    expect(scanMarked('/repo', ['migration.sql'])).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('not in the recognized form')
    );
  });

  it('warns and skips an ENOENT file, without treating it as marked', () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      const err = new Error('ENOENT: no such file') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });
    expect(scanMarked('/repo', ['missing.sql'])).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('throws on a non-ENOENT read failure rather than silently treating it as unmarked', () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    });
    expect(() => scanMarked('/repo', ['unreadable.sql'])).toThrow(/unreadable\.sql.*EACCES/s);
  });
});
