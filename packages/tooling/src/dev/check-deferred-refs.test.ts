import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  normalizePathToken,
  extractDeferredRefs,
  matchFiles,
  checkDeferredRefs,
} from './check-deferred-refs.js';
import type { TrackerTask } from './trackerTasks.js';

beforeEach(() => {
  vi.resetAllMocks();
});

function task(id: string, title: string, body: string, status = 'To Do'): TrackerTask {
  return {
    id,
    title,
    status,
    createdDate: '2026-05-16',
    labels: [],
    priority: 'medium',
    body,
    file: `tracker/tasks/${id.toLowerCase()} - sample.md`,
  };
}

const SAMPLE_TASKS: TrackerTask[] = [
  task(
    'TASK-1',
    'satisfies constraint on PgvectorMemoryDocument',
    'Works via widening at `services/ai-worker/src/services/MemoryRetriever.ts:~221` today. **Promote when**: metadata gains a required field.'
  ),
  task(
    'TASK-2',
    'Temporal-marker hook for .py files',
    '**Start**: extend the filter; test against `services/voice-engine/*.py` for false positives.'
  ),
  task(
    'TASK-3',
    'Smart per-user cache invalidation',
    'Upgrade `LlmConfigService` and the mirror together. No file path here.'
  ),
  task(
    'TASK-4',
    'Memory retrieval mystery',
    'Trace `MemoryService.retrieveRelevant()` flow in `services/ai-worker/src/services/` and add structured logs.'
  ),
  task(
    'TASK-5',
    'Compose-base asymmetry',
    '`GenerationStep.ts` composes the log-only field from the outer error. **Promote when**: next touching it.'
  ),
  task(
    'TASK-6',
    'Both-forms row',
    'Fix `chat.ts` at `services/bot-client/src/commands/character/chat.ts:468`.'
  ),
];

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

  it('accepts prisma/ paths (schema + migration tasks reference them)', () => {
    expect(normalizePathToken('prisma/schema.prisma:26-27')).toEqual({
      pathToken: 'prisma/schema.prisma',
      isPrefix: false,
    });
  });
});

describe('extractDeferredRefs', () => {
  it('extracts file refs with task titles and ids', () => {
    const refs = extractDeferredRefs(SAMPLE_TASKS);

    const memoryRef = refs.find(
      r => r.pathToken === 'services/ai-worker/src/services/MemoryRetriever.ts'
    );
    expect(memoryRef).toBeDefined();
    expect(memoryRef?.title).toContain('satisfies');
    expect(memoryRef?.taskId).toBe('TASK-1');
    expect(memoryRef?.taskFile).toBe('tracker/tasks/task-1 - sample.md');
    expect(memoryRef?.isPrefix).toBe(false);
  });

  it('extracts directory-prefix refs', () => {
    const refs = extractDeferredRefs(SAMPLE_TASKS);
    const dirRef = refs.find(r => r.pathToken === 'services/ai-worker/src/services/');
    expect(dirRef).toBeDefined();
    expect(dirRef?.isPrefix).toBe(true);
  });

  it('produces no refs for tasks with no path tokens', () => {
    const refs = extractDeferredRefs(SAMPLE_TASKS);
    expect(refs.some(r => r.taskId === 'TASK-3')).toBe(false);
  });

  it('scans the title too, not just the body', () => {
    const refs = extractDeferredRefs([
      task('TASK-9', 'Tighten `services/api-gateway/src/queue.ts` retries', 'No path in body.'),
    ]);
    expect(refs.some(r => r.pathToken === 'services/api-gateway/src/queue.ts')).toBe(true);
  });
});

describe('extractDeferredRefs — bare basenames', () => {
  const refs = extractDeferredRefs(SAMPLE_TASKS);

  it('extracts a backticked bare filename as a basename ref', () => {
    const ref = refs.find(r => r.pathToken === 'GenerationStep.ts');
    expect(ref).toBeDefined();
    expect(ref?.isBasename).toBe(true);
    expect(ref?.taskId).toBe('TASK-5');
  });

  it('does NOT duplicate a basename when the same task carries the full path', () => {
    // The path form is stricter and wins; a second basename ref for chat.ts
    // from the same task would double-report.
    const bothFormsRefs = refs.filter(r => r.taskId === 'TASK-6');
    expect(bothFormsRefs).toHaveLength(1);
    expect(bothFormsRefs[0].pathToken).toBe('services/bot-client/src/commands/character/chat.ts');
  });

  it('excludes generic basenames from matching (signal-quality stoplist)', () => {
    const genericRefs = extractDeferredRefs([
      task('TASK-7', 'Generic row', 'Touch `index.ts` and `types.ts` someday.'),
    ]);
    expect(genericRefs.find(r => r.pathToken === 'index.ts')).toBeUndefined();
    expect(genericRefs.find(r => r.pathToken === 'types.ts')).toBeUndefined();
  });

  it('ignores bare identifiers without an extension (false-positive guard)', () => {
    // `MemoryService.retrieveRelevant()` and `PgvectorMemoryDocument` must not
    // become refs — only extension-bearing backticked tokens count.
    expect(refs.find(r => r.pathToken.startsWith('MemoryService'))).toBeUndefined();
    expect(refs.find(r => r.pathToken === 'PgvectorMemoryDocument')).toBeUndefined();
  });
});

describe('matchFiles — basename refs', () => {
  const refs = extractDeferredRefs(SAMPLE_TASKS);

  it('matches a changed file by basename anywhere in the tree', () => {
    const matches = matchFiles(
      ['services/ai-worker/src/jobs/handlers/pipeline/steps/GenerationStep.ts'],
      refs
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].refs.some(r => r.pathToken === 'GenerationStep.ts')).toBe(true);
  });

  it('does not match a different basename', () => {
    const matches = matchFiles(['services/ai-worker/src/GenerationStepHelpers.ts'], refs);
    expect(matches.every(m => !m.refs.some(r => r.pathToken === 'GenerationStep.ts'))).toBe(true);
  });
});

describe('matchFiles', () => {
  const refs = extractDeferredRefs(SAMPLE_TASKS);

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
    // exact ref from TASK-1 + directory prefix ref from TASK-4
    expect(matches[0].refs.length).toBeGreaterThanOrEqual(2);
  });
});

/** Render a TrackerTask back into on-disk task-file shape for the fs mocks. */
function taskFileContent(t: TrackerTask): string {
  return [
    '---',
    `id: ${t.id}`,
    `title: '${t.title.replaceAll("'", "''")}'`,
    `status: ${t.status}`,
    `created_date: '${t.createdDate} 00:00'`,
    'labels: []',
    '---',
    t.body,
  ].join('\n');
}

/** Point the mocked fs at a set of tasks as tracker/tasks/*.md files. */
function mockStore(tasks: TrackerTask[]): void {
  const byName = new Map(tasks.map(t => [t.file.split('/').at(-1) as string, taskFileContent(t)]));
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readdirSync).mockReturnValue([...byName.keys()] as never);
  vi.mocked(readFileSync).mockImplementation(path => {
    const name = String(path).split('/').at(-1) as string;
    const content = byName.get(name);
    if (content === undefined) {
      throw new Error(`unexpected read: ${String(path)}`);
    }
    return content;
  });
}

describe('checkDeferredRefs (CLI entry)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('prints matches for staged files with task ids and never throws', async () => {
    mockStore(SAMPLE_TASKS);
    vi.mocked(execFileSync).mockReturnValue(
      'services/ai-worker/src/services/MemoryRetriever.ts\nREADME.md\n'
    );

    await expect(checkDeferredRefs({ staged: true })).resolves.toBeUndefined();

    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Backlog tasks reference files');
    expect(output).toContain('MemoryRetriever.ts');
    expect(output).toContain('TASK-1');
    expect(output).toContain('tracker/tasks/task-1 - sample.md');
  });

  it('excludes Done tasks from the reminder surface', async () => {
    mockStore([
      task('TASK-8', 'Already shipped', 'Touch `services/voice-engine/*.py` again.', 'Done'),
    ]);
    vi.mocked(execFileSync).mockReturnValue('services/voice-engine/app/main.py\n');

    await checkDeferredRefs({ staged: true });

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('swallows git failures and logs to stderr (the never-blocks contract)', async () => {
    mockStore(SAMPLE_TASKS);
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
    mockStore(SAMPLE_TASKS);
    vi.mocked(execFileSync).mockReturnValue('README.md\n');

    await checkDeferredRefs({ staged: true });

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('stays silent when the tracker store does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(execFileSync).mockReturnValue('README.md\nservices/bot-client/src/index.ts\n');

    await expect(checkDeferredRefs({ staged: true })).resolves.toBeUndefined();

    expect(readdirSync).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('no-ops with an empty or absent file list', async () => {
    await checkDeferredRefs({});
    await checkDeferredRefs({ files: [] });

    expect(readdirSync).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('accepts an explicit file list without touching git', async () => {
    mockStore(SAMPLE_TASKS);

    await checkDeferredRefs({ files: ['services/voice-engine/app/main.py'] });

    expect(execFileSync).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Temporal-marker');
  });
});
