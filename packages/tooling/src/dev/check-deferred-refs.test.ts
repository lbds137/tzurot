import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

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
  renderMatches,
  DEFERRED_REFS_TIMEOUT_MS,
} from './check-deferred-refs.js';
import type { TrackerTask } from './trackerTasks.js';
import type { DeferredMatch, DeferredRef } from './check-deferred-refs.js';

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

/** Minimal DeferredRef fixture for renderMatches tests. */
function fixtureRef(taskId: string, title: string, taskFile: string): DeferredRef {
  return { pathToken: 'irrelevant', isPrefix: false, title, taskId, taskFile };
}

/** Render a match's lines with chalk color codes stripped. */
function renderStripped(matches: DeferredMatch[], compact: boolean): string[] {
  return renderMatches(matches, compact).map(line => stripVTControlCharacters(line));
}

describe('renderMatches', () => {
  it('compact mode: one line per file, N tasks by distinct id count (1, 2, and 5+ collapse to "+N more")', () => {
    const matches: DeferredMatch[] = [
      { file: 'f1.ts', refs: [fixtureRef('TASK-10', 'title 10', 'tracker/tasks/task-10.md')] },
      {
        file: 'f2.ts',
        refs: [
          fixtureRef('TASK-20', 'title 20', 'tracker/tasks/task-20.md'),
          fixtureRef('TASK-21', 'title 21', 'tracker/tasks/task-21.md'),
        ],
      },
      {
        file: 'f3.ts',
        refs: [
          fixtureRef('TASK-30', 'title 30', 'tracker/tasks/task-30.md'),
          fixtureRef('TASK-31', 'title 31', 'tracker/tasks/task-31.md'),
          fixtureRef('TASK-32', 'title 32', 'tracker/tasks/task-32.md'),
          fixtureRef('TASK-33', 'title 33', 'tracker/tasks/task-33.md'),
          fixtureRef('TASK-34', 'title 34', 'tracker/tasks/task-34.md'),
        ],
      },
    ];

    const lines = renderStripped(matches, true);

    expect(lines).toContain('   f1.ts — 1 task: TASK-10');
    expect(lines).toContain('   f2.ts — 2 tasks: TASK-20, TASK-21');
    expect(lines).toContain('   f3.ts — 5 tasks: TASK-30, TASK-31, +3 more');
  });

  it('compact mode: the first count past COMPACT_IDS_SHOWN prints "+1 more" (n = 3)', () => {
    const matches: DeferredMatch[] = [
      {
        file: 'f3.ts',
        refs: [
          fixtureRef('TASK-30', 'title 30', 'tracker/tasks/task-30.md'),
          fixtureRef('TASK-31', 'title 31', 'tracker/tasks/task-31.md'),
          fixtureRef('TASK-32', 'title 32', 'tracker/tasks/task-32.md'),
        ],
      },
    ];

    const lines = renderStripped(matches, true);

    expect(lines).toContain('   f3.ts — 3 tasks: TASK-30, TASK-31, +1 more');
  });

  it('compact mode dedupes refs sharing the same task id before counting', () => {
    const matches: DeferredMatch[] = [
      {
        file: 'f.ts',
        refs: [
          fixtureRef('TASK-a', 'title a', 'tracker/tasks/task-a.md'),
          fixtureRef('TASK-a', 'title a', 'tracker/tasks/task-a.md'),
          fixtureRef('TASK-b', 'title b', 'tracker/tasks/task-b.md'),
        ],
      },
    ];

    const lines = renderStripped(matches, true);

    expect(lines).toContain('   f.ts — 2 tasks: TASK-a, TASK-b');
  });

  it('compact trailer caps the named files at 3 and appends "…" only past the cap', () => {
    const refs = [fixtureRef('TASK-1', 'title', 'tracker/tasks/task-1.md')];
    const fourFiles: DeferredMatch[] = ['f1', 'f2', 'f3', 'f4'].map(file => ({ file, refs }));
    const threeFiles: DeferredMatch[] = ['f1', 'f2', 'f3'].map(file => ({ file, refs }));

    const fourLines = renderStripped(fourFiles, true);
    const trailer = fourLines.find(line => line.includes('Reminder only'));
    expect(trailer).toBe(
      '   Reminder only — never blocks. Full list: pnpm ops dev:deferred-refs f1 f2 f3 …'
    );

    const threeLines = renderStripped(threeFiles, true);
    const threeTrailer = threeLines.find(line => line.includes('Reminder only'));
    expect(threeTrailer).toMatch(/f1 f2 f3$/);
    expect(threeTrailer).not.toContain('…');
  });

  it('full mode is pinned to the exact legacy output shape', () => {
    const matches: DeferredMatch[] = [
      {
        file: 'services/ai-worker/src/x.ts',
        refs: [
          fixtureRef('TASK-x', 'title x', 'tracker/tasks/x.md'),
          fixtureRef('TASK-y', 'title y', 'tracker/tasks/y.md'),
        ],
      },
    ];

    const lines = renderStripped(matches, false);

    expect(lines).toEqual([
      '',
      '📌 Backlog tasks reference files in this change:',
      '   services/ai-worker/src/x.ts',
      '     • TASK-x  title x (tracker/tasks/x.md)',
      '     • TASK-y  title y (tracker/tasks/y.md)',
      '   Reminder only — fold one in if it fits, or carry on. Never blocks.',
      '',
    ]);
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

  it('bounds the staged-file git read with DEFERRED_REFS_TIMEOUT_MS', async () => {
    mockStore(SAMPLE_TASKS);
    vi.mocked(execFileSync).mockReturnValue('README.md\n');

    await checkDeferredRefs({ staged: true });

    expect(execFileSync).toHaveBeenCalledWith(
      'git',
      ['diff', '--cached', '--name-only'],
      expect.objectContaining({ timeout: DEFERRED_REFS_TIMEOUT_MS })
    );
  });

  it('accepts an explicit file list without touching git', async () => {
    mockStore(SAMPLE_TASKS);

    await checkDeferredRefs({ files: ['services/voice-engine/app/main.py'] });

    expect(execFileSync).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Temporal-marker');
  });

  it('compact mode logs exactly header + one line per file + trailer + 2 blank lines (11 calls for 7 files)', async () => {
    const sevenFileTasks = Array.from({ length: 7 }, (_, i) =>
      task(
        `TASK-${100 + i}`,
        `Follow-up for file ${i}`,
        `See \`services/ai-worker/src/compact${i}.ts\` for details.`
      )
    );
    mockStore(sevenFileTasks);
    const files = Array.from({ length: 7 }, (_, i) => `services/ai-worker/src/compact${i}.ts`);

    await checkDeferredRefs({ compact: true, files });

    expect(logSpy).toHaveBeenCalledTimes(11);
  });

  it('compact mode: prefix-matched file shows the task count and no bullet lines', async () => {
    mockStore(SAMPLE_TASKS);

    await checkDeferredRefs({ compact: true, files: ['services/voice-engine/app/main.py'] });

    const output = stripVTControlCharacters(logSpy.mock.calls.flat().join('\n'));
    expect(output).toContain('— 1 task: TASK-2');
    expect(output.split('\n').some(line => line.includes('•'))).toBe(false);
  });
});

describe('husky hooks pass --compact', () => {
  it('pre-commit passes --staged --compact to dev:deferred-refs', async () => {
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const repoRoot = join(import.meta.dirname, '../../../..');
    const content = actualFs.readFileSync(join(repoRoot, '.husky/pre-commit'), 'utf-8');

    expect(content).toContain('pnpm ops dev:deferred-refs --staged --compact || true');
  });

  it('pre-push passes --compact $CHANGED_FILES to dev:deferred-refs', async () => {
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const repoRoot = join(import.meta.dirname, '../../../..');
    const content = actualFs.readFileSync(join(repoRoot, '.husky/pre-push'), 'utf-8');

    expect(content).toContain('pnpm ops dev:deferred-refs --compact $CHANGED_FILES || true');
  });
});
