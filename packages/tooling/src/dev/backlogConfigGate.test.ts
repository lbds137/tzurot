import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { checkBacklogConfig } from './backlogConfigGate.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const VALID_CONFIG = [
  'filesystem_only: false',
  'check_active_branches: true',
  'remote_operations: true',
  'auto_commit: false',
].join('\n');

function mockConfig(yaml: string | undefined): void {
  vi.mocked(existsSync).mockReturnValue(yaml !== undefined);
  vi.mocked(readFileSync).mockReturnValue(yaml ?? '');
}

describe('checkBacklogConfig', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports no problems when all four keys hold the required values', () => {
    mockConfig(VALID_CONFIG);
    expect(checkBacklogConfig('/repo')).toEqual([]);
  });

  it('flags filesystem_only when true, naming the key', () => {
    mockConfig(VALID_CONFIG.replace('filesystem_only: false', 'filesystem_only: true'));
    const problems = checkBacklogConfig('/repo');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('filesystem_only');
  });

  it('flags check_active_branches when false, naming the key', () => {
    mockConfig(VALID_CONFIG.replace('check_active_branches: true', 'check_active_branches: false'));
    const problems = checkBacklogConfig('/repo');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('check_active_branches');
  });

  it('flags remote_operations when false, naming the key', () => {
    mockConfig(VALID_CONFIG.replace('remote_operations: true', 'remote_operations: false'));
    const problems = checkBacklogConfig('/repo');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('remote_operations');
  });

  it('flags auto_commit when true, naming the key', () => {
    mockConfig(VALID_CONFIG.replace('auto_commit: false', 'auto_commit: true'));
    const problems = checkBacklogConfig('/repo');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('auto_commit');
  });

  it('reports exactly one problem naming the file when it is missing', () => {
    mockConfig(undefined);
    const problems = checkBacklogConfig('/repo');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('backlog.config.yml');
  });

  it('reports one problem instead of throwing on unparseable YAML', () => {
    mockConfig(':\n  - this is not: [valid yaml');
    expect(() => checkBacklogConfig('/repo')).not.toThrow();
    const problems = checkBacklogConfig('/repo');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('could not be parsed as YAML');
  });

  // The mapping guard is a two-clause disjunction and each clause has its own
  // reachable input, so one fixture leaves the other clause untested. A bare
  // YAML LIST reaches NEITHER: it parses to an array, which is a non-null
  // object, so it falls through to the per-key check instead.
  it('reports a mapping problem when the document is a scalar', () => {
    mockConfig('just a scalar');
    const problems = checkBacklogConfig('/repo');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('did not parse to a YAML mapping');
  });

  it('reports a mapping problem when the document is empty', () => {
    // An empty document parses to null, which is the guard's other clause —
    // and the file exists, so this is not the missing-file path.
    mockConfig('');
    const problems = checkBacklogConfig('/repo');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('did not parse to a YAML mapping');
  });

  it('distinguishes an unreadable file from an unparseable one', () => {
    // The file EXISTS — so this is not the missing-file path — but reading it
    // throws. Reported as a read failure, because that needs a different fix
    // than malformed YAML does.
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });
    const problems = checkBacklogConfig('/repo');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('could not be read');
    expect(problems[0]).not.toContain('parsed');
  });

  it('reports one problem per wrong key when several are wrong at once', () => {
    // The filter/map returns a list, and a single-key fixture cannot tell a
    // per-key report from one that stops at the first mismatch.
    mockConfig(
      VALID_CONFIG.replace('filesystem_only: false', 'filesystem_only: true').replace(
        'auto_commit: false',
        'auto_commit: true'
      )
    );
    const problems = checkBacklogConfig('/repo');
    expect(problems).toHaveLength(2);
    expect(problems.filter(p => p.includes('filesystem_only'))).toHaveLength(1);
    expect(problems.filter(p => p.includes('auto_commit'))).toHaveLength(1);
  });
});
