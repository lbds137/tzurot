import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  normalizePathToken,
  extractDeferredRefs,
  matchFiles,
  checkDeferredRefs,
} from './check-deferred-refs.js';

beforeEach(() => {
  vi.resetAllMocks();
});

const SAMPLE_MARKDOWN = [
  '## ⏸️ Deferred',
  '',
  '_Decided not to do yet._',
  '',
  '| Item | Why |',
  '| ---- | --- |',
  '| `satisfies` constraint on `PgvectorMemoryDocument` | Works via widening at `services/ai-worker/src/services/MemoryRetriever.ts:~221` today. **Promote when**: metadata gains a required field. |',
  '| Temporal-marker hook for `.py` files | **Start**: extend the filter; test against `services/voice-engine/*.py` for false positives. |',
  '| Smart per-user cache invalidation | Upgrade `LlmConfigService` and the mirror together. No file path here. |',
  '| Memory retrieval mystery | Trace `MemoryService.retrieveRelevant()` flow in `services/ai-worker/src/services/` and add structured logs. |',
].join('\n');

describe('normalizePathToken', () => {
  it('strips line-number suffixes from file tokens', () => {
    expect(normalizePathToken('services/api-gateway/src/routes/settings.ts:231-234')).toEqual({
      pathToken: 'services/api-gateway/src/routes/settings.ts',
      isPrefix: false,
    });
  });

  it('strips tilde-prefixed line refs', () => {
    expect(normalizePathToken('services/ai-worker/src/MemoryRetriever.ts:~221')).toEqual({
      pathToken: 'services/ai-worker/src/MemoryRetriever.ts',
      isPrefix: false,
    });
  });

  it('treats globs as prefixes', () => {
    expect(normalizePathToken('services/voice-engine/*.py')).toEqual({
      pathToken: 'services/voice-engine/',
      isPrefix: true,
    });
  });

  it('treats extension-less tokens as directory prefixes', () => {
    expect(normalizePathToken('services/ai-worker/src/services')).toEqual({
      pathToken: 'services/ai-worker/src/services/',
      isPrefix: true,
    });
  });

  it('rejects tokens that are too shallow to be real paths', () => {
    expect(normalizePathToken('services/ai-worker')).toBeNull();
  });

  it('strips trailing prose punctuation', () => {
    expect(normalizePathToken('packages/tooling/src/dev/thing.ts.')).toEqual({
      pathToken: 'packages/tooling/src/dev/thing.ts',
      isPrefix: false,
    });
  });

  it('accepts prisma/ paths (schema + migration entries reference them)', () => {
    expect(normalizePathToken('prisma/schema.prisma:26-27')).toEqual({
      pathToken: 'prisma/schema.prisma',
      isPrefix: false,
    });
  });
});

describe('extractDeferredRefs', () => {
  it('extracts file refs with entry titles and line numbers', () => {
    const refs = extractDeferredRefs(SAMPLE_MARKDOWN);

    const memoryRef = refs.find(
      r => r.pathToken === 'services/ai-worker/src/services/MemoryRetriever.ts'
    );
    expect(memoryRef).toBeDefined();
    expect(memoryRef?.title).toContain('satisfies');
    expect(memoryRef?.line).toBe(7);
    expect(memoryRef?.isPrefix).toBe(false);
  });

  it('extracts directory-prefix refs', () => {
    const refs = extractDeferredRefs(SAMPLE_MARKDOWN);
    const dirRef = refs.find(r => r.pathToken === 'services/ai-worker/src/services/');
    expect(dirRef).toBeDefined();
    expect(dirRef?.isPrefix).toBe(true);
  });

  it('skips entries with no path tokens', () => {
    const refs = extractDeferredRefs(SAMPLE_MARKDOWN);
    expect(refs.some(r => r.title.includes('Smart per-user'))).toBe(false);
  });

  it('skips the header and separator rows', () => {
    const refs = extractDeferredRefs(SAMPLE_MARKDOWN);
    expect(refs.some(r => r.title === 'Item' || r.title.startsWith('-'))).toBe(false);
  });
});

describe('matchFiles', () => {
  const refs = extractDeferredRefs(SAMPLE_MARKDOWN);

  it('matches exact file refs', () => {
    const matches = matchFiles(['services/ai-worker/src/services/MemoryRetriever.ts'], refs);
    expect(matches).toHaveLength(1);
    expect(matches[0].refs.some(r => r.title.includes('satisfies'))).toBe(true);
  });

  it('matches files under a directory-prefix ref', () => {
    const matches = matchFiles(['services/voice-engine/app/main.py'], refs);
    expect(matches).toHaveLength(1);
    expect(matches[0].refs[0].title).toContain('Temporal-marker');
  });

  it('returns no matches for unrelated files', () => {
    const matches = matchFiles(['services/bot-client/src/index.ts'], refs);
    expect(matches).toEqual([]);
  });

  it('a file under the prefix AND exactly referenced collects both refs', () => {
    const matches = matchFiles(['services/ai-worker/src/services/MemoryRetriever.ts'], refs);
    // exact ref from row 7 + directory prefix ref from row 10
    expect(matches[0].refs.length).toBeGreaterThanOrEqual(2);
  });
});

describe('checkDeferredRefs (CLI entry)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('prints matches for staged files and never throws', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(SAMPLE_MARKDOWN);
    vi.mocked(execFileSync).mockReturnValue(
      'services/ai-worker/src/services/MemoryRetriever.ts\nREADME.md\n'
    );

    await expect(checkDeferredRefs({ staged: true })).resolves.toBeUndefined();

    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Backlog follow-ups reference files');
    expect(output).toContain('MemoryRetriever.ts');
    expect(output).toContain('backlog/cold/follow-ups.md:7');
  });

  it('swallows git failures and logs to stderr (the never-blocks contract)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(SAMPLE_MARKDOWN);
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('not a git repository');
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(checkDeferredRefs({ staged: true })).resolves.toBeUndefined();

    expect(errSpy.mock.calls.flat().join('\n')).toContain('not a git repository');
    expect(logSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('prints nothing when no staged file matches', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(SAMPLE_MARKDOWN);
    vi.mocked(execFileSync).mockReturnValue('README.md\n');

    await checkDeferredRefs({ staged: true });

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('no-ops when follow-ups.md does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    await checkDeferredRefs({ staged: true });

    expect(readFileSync).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('no-ops with an empty or absent file list', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    await checkDeferredRefs({});
    await checkDeferredRefs({ files: [] });

    expect(readFileSync).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('accepts an explicit file list without touching git', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(SAMPLE_MARKDOWN);

    await checkDeferredRefs({ files: ['services/voice-engine/app/main.py'] });

    expect(execFileSync).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Temporal-marker');
  });
});
