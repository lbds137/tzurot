import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('chalk', () => ({
  default: {
    cyan: (s: string) => s,
    dim: (s: string) => s,
    yellow: (s: string) => s,
  },
}));

const { mockExecFileSync, mockGetRailwayDatabaseUrl, mockGetRailwayEnvName } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  mockGetRailwayDatabaseUrl: vi.fn(),
  mockGetRailwayEnvName: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

vi.mock('../utils/env-runner.js', () => ({
  getRailwayDatabaseUrl: mockGetRailwayDatabaseUrl,
  getRailwayEnvName: mockGetRailwayEnvName,
  resolveDatabaseUrl: (env: string) => mockGetRailwayDatabaseUrl(env),
}));

import {
  comparePrefixes,
  sectionAtOffset,
  extractPromptRow,
  buildPairReports,
  renderDivergenceWindow,
  buildFetchScript,
  parsePayloadLine,
  runPrefixDiff,
  type PromptRow,
  type PromptSectionEntry,
} from './prefix-diff.js';

describe('comparePrefixes', () => {
  it('reports identical prompts', () => {
    const cmp = comparePrefixes('same bytes', 'same bytes');
    expect(cmp.identical).toBe(true);
    expect(cmp.commonPrefixChars).toBe(10);
  });

  it('finds the first divergent offset', () => {
    const cmp = comparePrefixes('stable-prefix OLD tail', 'stable-prefix NEW tail');
    expect(cmp.identical).toBe(false);
    expect(cmp.commonPrefixChars).toBe('stable-prefix '.length);
  });

  it('treats pure growth as non-identical with the shorter length as the common prefix', () => {
    const cmp = comparePrefixes('prefix', 'prefix plus more');
    expect(cmp.identical).toBe(false);
    expect(cmp.commonPrefixChars).toBe(6);
    expect(cmp.newerLength).toBe(16);
  });

  it('handles a zero-length common prefix', () => {
    expect(comparePrefixes('abc', 'xyz').commonPrefixChars).toBe(0);
  });
});

describe('sectionAtOffset', () => {
  const sections: PromptSectionEntry[] = [
    { id: 'system_identity', tier: 'S1', chars: 100, offset: 0 },
    // separator occupies offsets 100-101
    { id: 'context', tier: 'V', chars: 50, offset: 102 },
  ];

  it('names the section containing the offset', () => {
    expect(sectionAtOffset(50, sections)).toBe('S1 system_identity');
    expect(sectionAtOffset(102, sections)).toBe('V context');
    expect(sectionAtOffset(151, sections)).toBe('V context');
  });

  it('annotates separator offsets as the boundary before the next section', () => {
    expect(sectionAtOffset(100, sections)).toBe('boundary before V context');
    expect(sectionAtOffset(101, sections)).toBe('boundary before V context');
  });

  it('reports offsets past the last section neutrally (direction added by the pair report)', () => {
    expect(sectionAtOffset(152, sections)).toBe('past the last section');
  });

  it('degrades gracefully without a section map (pre-section-model rows)', () => {
    expect(sectionAtOffset(50, undefined)).toContain('no section map');
    expect(sectionAtOffset(50, [])).toContain('no section map');
  });
});

describe('extractPromptRow', () => {
  const baseRow = { requestId: 'req-1234', createdAt: '2026-08-02T10:00:00Z', model: 'glm-4.7' };

  it('extracts the system prompt and section map from a payload', () => {
    const row = extractPromptRow({
      ...baseRow,
      data: {
        assembledPrompt: {
          messages: [
            { role: 'system', content: 'the system prompt' },
            { role: 'user', content: 'hi' },
          ],
          systemPromptSections: [{ id: 'system_identity', tier: 'S1', chars: 17, offset: 0 }],
        },
      },
    });
    expect(row?.systemPrompt).toBe('the system prompt');
    expect(row?.sections).toHaveLength(1);
  });

  it('returns null for rows without an assembled prompt (error paths)', () => {
    expect(extractPromptRow({ ...baseRow, data: {} })).toBeNull();
    expect(extractPromptRow({ ...baseRow, data: null })).toBeNull();
    expect(
      extractPromptRow({
        ...baseRow,
        data: { assembledPrompt: { messages: [{ role: 'user', content: 'no system' }] } },
      })
    ).toBeNull();
  });

  it('normalizes Date createdAt to ISO string', () => {
    const row = extractPromptRow({
      requestId: 'r',
      createdAt: new Date('2026-08-02T10:00:00Z'),
      model: 'm',
      data: { assembledPrompt: { messages: [{ role: 'system', content: 's' }] } },
    });
    expect(row?.createdAt).toBe('2026-08-02T10:00:00.000Z');
  });
});

describe('renderDivergenceWindow', () => {
  it('clamps the shared tail at the start of the prompt', () => {
    // The prompt must be LONGER than the context width for this to
    // discriminate: `slice()` reads a negative start as an offset from the END,
    // so an unclamped `offset - contextChars` here would start past `offset`
    // and yield an empty tail. A short prompt hides that — slice clamps a
    // negative start to 0 once its magnitude exceeds the length, so the naive
    // form passes on a 4-char fixture and the assertion proves nothing.
    const prompt = `${'a'.repeat(500)}X`;
    const window = renderDivergenceWindow(prompt, `${'a'.repeat(500)}Y`, 10, 100);
    // No ellipsis: the clamp means the tail IS the prompt's start, so nothing
    // was elided and claiming otherwise would be the tool misleading its reader.
    // Scoped to the TAIL line: the older/newer sides legitimately carry their
    // own trailing … here, since 500 chars of prompt run past the window.
    const tailLine = window.split('\n')[0];
    expect(tailLine).toBe(`  shared tail  ${'a'.repeat(10)}`);
    expect(tailLine).not.toContain('…');
  });

  it('marks the tail with … only when text was actually elided', () => {
    const prompt = `${'a'.repeat(500)}X`;
    const clamped = renderDivergenceWindow(prompt, `${'a'.repeat(500)}Y`, 400, 10);
    expect(clamped).toContain(`shared tail …${'a'.repeat(10)}\n`);
  });

  it('aligns all three content columns exactly', () => {
    // Whole-line equality, not toContain: alignment is a property of column
    // POSITION, and a substring assertion is blind to it — which is exactly how
    // a one-column drift shipped past an otherwise thorough suite. The
    // shared-tail line spends a column on the elision slot, so its label
    // padding is one shorter than the other two by construction.
    const unclamped = renderDivergenceWindow('abcdefXY', 'abcdefZW', 6, 6);
    expect(unclamped.split('\n')).toEqual([
      '  shared tail  abcdef',
      '  older        XY',
      '  newer        ZW',
    ]);

    // The elided case must land in the SAME columns — the … occupies the slot
    // the space held above, which is the entire reason the slot exists.
    const clamped = renderDivergenceWindow('abcdefXY', 'abcdefZW', 6, 3);
    expect(clamped.split('\n')).toEqual([
      '  shared tail …def',
      '  older        XY',
      '  newer        ZW',
    ]);
  });

  it('marks a differing side that runs past the window, on the right edge', () => {
    // The mirror of the shared tail's leading …. Without it the operator reads
    // a truncated window as the complete change — which for a long element is
    // exactly the wrong conclusion about what actually differs.
    const older = `head${'A'.repeat(50)}`;
    const newer = `head${'B'.repeat(50)}`;
    const window = renderDivergenceWindow(older, newer, 4, 10);
    expect(window).toContain(`older        ${'A'.repeat(10)}…`);
    expect(window).toContain(`newer        ${'B'.repeat(10)}…`);
  });

  it('leaves a side unmarked when it fits inside the window', () => {
    const window = renderDivergenceWindow('headAB', 'headCD', 4, 10);
    expect(window).toContain('older        AB\n');
    expect(window.endsWith('newer        CD')).toBe(true);
  });

  it('renders newlines as ⏎ so each side stays one line', () => {
    const window = renderDivergenceWindow('head\nOLD\nmore', 'head\nNEW\nmore', 5, 20);
    expect(window).toContain('older        OLD⏎more');
    expect(window).toContain('newer        NEW⏎more');
    // Three lines total: the label lines themselves, nothing wrapped.
    expect(window.split('\n')).toHaveLength(3);
  });

  it('neutralises carriage returns and escapes, which would garble the render', () => {
    // Verbatim prompt text includes user-authored bios and pasted messages, and
    // this goes straight to a terminal: a CR rewinds the cursor over the label
    // identifying which side is which, and an ESC opens an ANSI sequence.
    const window = renderDivergenceWindow('head\rOLD\u001b[31m', 'head\rNEW', 4, 20);
    expect(window).toContain('older        ·OLD·[31m');
    expect(window).toContain('newer        ·NEW');
    expect(window).not.toContain('\r');
    expect(window).not.toContain('\u001b');
  });

  it('renders an empty older side when the newer prompt merely grew', () => {
    const window = renderDivergenceWindow('prefix', 'prefix plus', 6, 20);
    expect(window).toContain('older        \n');
    expect(window).toContain('newer         plus');
  });
});

describe('buildPairReports', () => {
  function promptRow(requestId: string, systemPrompt: string): PromptRow {
    return {
      requestId,
      createdAt: '2026-08-02T10:00:00Z',
      model: 'glm-4.7',
      systemPrompt,
      sections: [{ id: 'system_identity', tier: 'S1', chars: systemPrompt.length, offset: 0 }],
    };
  }

  it('reports IDENTICAL for byte-equal consecutive prompts', () => {
    const reports = buildPairReports([
      promptRow('aaaaaaaa', 'same'),
      promptRow('bbbbbbbb', 'same'),
    ]);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain('IDENTICAL');
  });

  it('reports the divergence offset with its section annotation', () => {
    const reports = buildPairReports([
      promptRow('aaaaaaaa', 'stable OLD'),
      promptRow('bbbbbbbb', 'stable NEW'),
    ]);
    expect(reports[0]).toContain('first divergence at offset 7');
    expect(reports[0]).toContain('S1 system_identity');
  });

  it('omits the divergence window unless asked for', () => {
    const reports = buildPairReports([
      promptRow('aaaaaaaa', 'stable OLD'),
      promptRow('bbbbbbbb', 'stable NEW'),
    ]);
    expect(reports[0]).not.toContain('shared tail');
  });

  it('prints both sides of the divergence when showDivergence is set', () => {
    const reports = buildPairReports(
      [promptRow('aaaaaaaa', 'stable OLD'), promptRow('bbbbbbbb', 'stable NEW')],
      { showDivergence: 10 }
    );
    expect(reports[0]).toContain('shared tail  stable ');
    expect(reports[0]).toContain('older        OLD');
    expect(reports[0]).toContain('newer        NEW');
  });

  it('treats a zero width as off rather than emitting an empty window', () => {
    const reports = buildPairReports(
      [promptRow('aaaaaaaa', 'stable OLD'), promptRow('bbbbbbbb', 'stable NEW')],
      { showDivergence: 0 }
    );
    expect(reports[0]).not.toContain('shared tail');
  });

  it('produces one report per consecutive pair', () => {
    const rows = [promptRow('a', '1'), promptRow('b', '2'), promptRow('c', '3')];
    expect(buildPairReports(rows)).toHaveLength(2);
  });

  it('annotates growth (newer longer) INSIDE the newer prompt sections, never past-end', () => {
    // A longer newer prompt always lands the divergence offset inside its own
    // section map — growth is legible from the section name + lengths.
    const reports = buildPairReports([
      promptRow('aaaaaaaa', 'prefix'),
      promptRow('bbbbbbbb', 'prefix plus more'),
    ]);
    expect(reports[0]).toContain('S1 system_identity');
    expect(reports[0]).not.toContain('shrink');
  });

  it('labels past-end divergence as SHRINK when the newer prompt is a truncated prefix', () => {
    // Fewer memories retrieved / truncated history: the newer prompt is a
    // strict prefix of the older one. Same offset condition as growth — the
    // direction is what the operator must be able to read.
    const reports = buildPairReports([
      promptRow('aaaaaaaa', 'AAAABBBBCCCC'),
      promptRow('bbbbbbbb', 'AAAABBBB'),
    ]);
    expect(reports[0]).toContain('shrink');
    expect(reports[0]).not.toContain('growth');
  });
});

describe('buildFetchScript', () => {
  it('interpolates validated channel + personality filters', () => {
    const script = buildFetchScript({
      channelId: '123456789012345678',
      personalityId: '01234567-89ab-cdef-0123-456789abcdef',
      rowLimit: 6,
    });
    expect(script).toContain("channelId: '123456789012345678'");
    expect(script).toContain("personalityId: '01234567-89ab-cdef-0123-456789abcdef'");
    expect(script).toContain('take: 6');
  });

  it('rejects a non-snowflake channelId (injection guard)', () => {
    expect(() => buildFetchScript({ channelId: "x' OR 1=1", rowLimit: 6 })).toThrow(/snowflake/);
  });

  it('rejects a non-UUID personalityId (injection guard)', () => {
    expect(() =>
      buildFetchScript({ channelId: '123456789012345678', personalityId: 'nope', rowLimit: 6 })
    ).toThrow(/UUID/);
  });

  it('omits the personality filter when not provided', () => {
    const script = buildFetchScript({ channelId: '123456789012345678', rowLimit: 6 });
    expect(script).not.toContain('personalityId');
  });

  it('rejects a non-integer rowLimit (interpolation guard)', () => {
    expect(() => buildFetchScript({ channelId: '123456789012345678', rowLimit: NaN })).toThrow(
      /positive integer/
    );
    expect(() => buildFetchScript({ channelId: '123456789012345678', rowLimit: 0 })).toThrow(
      /positive integer/
    );
  });
});

describe('parsePayloadLine', () => {
  it('parses the JSON array when it is the only output', () => {
    expect(
      parsePayloadLine('[{"requestId":"r","createdAt":"t","model":"m","data":{}}]\n')
    ).toHaveLength(1);
  });

  it('tolerates stray log lines BEFORE the payload (pino-on-stdout regression)', () => {
    // createPrismaClient logs NDJSON to stdout; the env silences it, but any
    // stray line must not break the parse — the payload is the LAST line.
    const stdout =
      '{"level":30,"msg":"Prisma client initialized with configured pg.Pool"}\n' +
      '{"level":30,"msg":"pg.Pool established a new connection"}\n' +
      '[]\n';
    expect(parsePayloadLine(stdout)).toEqual([]);
  });

  it('names the culprit line when the last line is not a JSON array', () => {
    expect(() => parsePayloadLine('[]\n{"level":30,"msg":"disconnected"}\n')).toThrow(
      /not a JSON row array.*disconnected/s
    );
  });

  it('fails loudly on empty output', () => {
    expect(() => parsePayloadLine('')).toThrow(/no output/);
  });
});

describe('runPrefixDiff (orchestration seam)', () => {
  const CHANNEL = '123456789012345678';

  function payloadRow(requestId: string, systemPrompt: string | null): Record<string, unknown> {
    return {
      requestId,
      createdAt: `2026-08-02T10:0${requestId.length % 10}:00Z`,
      model: 'glm-4.7',
      data:
        systemPrompt !== null
          ? {
              assembledPrompt: {
                messages: [{ role: 'system', content: systemPrompt }],
                systemPromptSections: [
                  { id: 'system_identity', tier: 'S1', chars: systemPrompt.length, offset: 0 },
                ],
              },
            }
          : {},
    };
  }

  let logLines: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    logLines = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      logLines.push(String(line));
    });
    mockGetRailwayDatabaseUrl.mockReturnValue('postgres://railway/dev');
    mockGetRailwayEnvName.mockReturnValue('development');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('injects the resolved Railway DB URL into the tsx subprocess env', async () => {
    // Rows are fetched newest-first; the two prompts are identical so ordering
    // is irrelevant to the assertion.
    mockExecFileSync.mockReturnValue(
      JSON.stringify([payloadRow('bbbbbbbb', 'same'), payloadRow('aaaaaaaa', 'same')])
    );

    await runPrefixDiff({ env: 'dev', channelId: CHANNEL, limit: 5 });

    expect(mockGetRailwayDatabaseUrl).toHaveBeenCalledWith('dev');
    const [cmd, args, opts] = mockExecFileSync.mock.calls[0] as [
      string,
      string[],
      { env: Record<string, string> },
    ];
    expect(cmd).toBe('tsx');
    expect(args[0]).toBe('-e');
    expect(opts.env.DATABASE_URL).toBe('postgres://railway/dev');
    // The subprocess logger MUST run silenced — createPrismaClient logs pino
    // NDJSON to stdout, the same fd the JSON payload uses.
    expect(opts.env.LOG_LEVEL).toBe('fatal');
  });

  it('reverses newest-first rows so pairs compare oldest→newest', async () => {
    // DB returns newest first: NEW then OLD. A correct reverse makes the pair
    // "OLD → NEW"; a missing reverse would report "NEW → OLD".
    mockExecFileSync.mockReturnValue(
      JSON.stringify([payloadRow('newnewne', 'prefix NEW'), payloadRow('oldoldol', 'prefix OLD')])
    );

    await runPrefixDiff({ env: 'dev', channelId: CHANNEL, limit: 5 });

    const pairLine = logLines.find(line => line.includes('→'));
    expect(pairLine).toContain('oldoldol → newnewne');
  });

  it('counts and reports rows without an assembled prompt, and still diffs the rest', async () => {
    mockExecFileSync.mockReturnValue(
      JSON.stringify([
        payloadRow('cccccccc', 'same'),
        payloadRow('errorrow', null),
        payloadRow('aaaaaaaa', 'same'),
      ])
    );

    await runPrefixDiff({ env: 'dev', channelId: CHANNEL, limit: 5 });

    expect(logLines.some(line => line.includes('1 row(s) had no assembled prompt'))).toBe(true);
    expect(logLines.some(line => line.includes('IDENTICAL'))).toBe(true);
  });

  it('explains when fewer than 2 usable rows exist instead of diffing', async () => {
    mockExecFileSync.mockReturnValue(JSON.stringify([payloadRow('aaaaaaaa', 'only one')]));

    await runPrefixDiff({ env: 'dev', channelId: CHANNEL, limit: 5 });

    expect(logLines.some(line => line.includes('Need at least 2 rows'))).toBe(true);
    expect(logLines.some(line => line.includes('→'))).toBe(false);
  });

  it('reports how many rows predate the section map (unannotated offsets)', async () => {
    const sectioned = payloadRow('bbbbbbbb', 'prompt NEW');
    const unsectioned = payloadRow('aaaaaaaa', 'prompt OLD');
    (
      (unsectioned.data as Record<string, unknown>).assembledPrompt as Record<string, unknown>
    ).systemPromptSections = undefined;
    mockExecFileSync.mockReturnValue(JSON.stringify([sectioned, unsectioned]));

    await runPrefixDiff({ env: 'dev', channelId: CHANNEL, limit: 5 });

    expect(logLines.some(line => line.includes('1 row(s) predate the section map'))).toBe(true);
  });

  it('fetches limit+1 rows so limit means PAIRS', async () => {
    mockExecFileSync.mockReturnValue(JSON.stringify([]));

    await runPrefixDiff({ env: 'dev', channelId: CHANNEL, limit: 5 });

    const script = (mockExecFileSync.mock.calls[0] as [string, string[]])[1][1];
    expect(script).toContain('take: 6');
  });
});
