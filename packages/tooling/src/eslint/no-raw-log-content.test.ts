import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './no-raw-log-content.js';

// Type-aware harness: the typescript-eslint project service builds a default
// program for a virtual fixture file (no file on disk, no extra dependency),
// so the rule's string-receiver check sees real types, as it does under the
// repo config's `projectService: true`.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = 'no-raw-log-content.fixture.ts';

const linter = new Linter({ configType: 'flat' });

const PRELUDE = [
  'declare const logger: { info(o: unknown, m?: string): void; warn(o: unknown, m?: string): void; error(o: unknown, m?: string): void; debug(o: unknown, m?: string): void };',
  'declare function contentPreview(t: string | undefined, n: number): string | undefined;',
  'declare function contentDigest(t: string): string;',
  'declare function idPrefix(id: string, n?: number): string;',
  'declare function urlPrefix(url: string, n: number): string;',
  'declare const text: string;',
  'declare const ids: string[];',
  'declare const LIMIT: number;',
  'declare const response: { status: number; text(): Promise<string> };',
  '',
].join('\n');

function lintTyped(code: string, options?: Record<string, unknown>): Linter.LintMessage[] {
  return linter.verify(
    PRELUDE + code,
    [
      {
        files: ['**/*.ts'],
        languageOptions: {
          parser: tseslint.parser as unknown as Linter.Parser,
          ecmaVersion: 2022,
          sourceType: 'module',
          parserOptions: {
            projectService: { allowDefaultProject: [FIXTURE] },
            tsconfigRootDir: HERE,
          },
        },
        plugins: { test: { rules: { 'no-raw-log-content': rule } } },
        rules: { 'test/no-raw-log-content': options === undefined ? 'error' : ['error', options] },
      },
    ],
    { filename: path.join(HERE, FIXTURE) }
  );
}

/** Same rule with NO type program — the fail-closed receiver path. */
function lintUntyped(code: string): Linter.LintMessage[] {
  return linter.verify(code, [
    {
      languageOptions: {
        parser: tseslint.parser as unknown as Linter.Parser,
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      plugins: { test: { rules: { 'no-raw-log-content': rule } } },
      rules: { 'test/no-raw-log-content': 'error' },
    },
  ]);
}

/** messageIds, failing loudly on a parse error rather than reading it as "clean". */
function findings(code: string): (string | undefined)[] {
  const messages = lintTyped(code);
  const fatal = messages.find(m => m.fatal === true);
  if (fatal !== undefined) {
    throw new Error(`fixture failed to parse: ${fatal.message}`);
  }
  return messages.map(m => m.messageId);
}

const PRELUDE_LINES = PRELUDE.split('\n').length - 1;

describe('rule metadata', () => {
  it('is a problem rule with all four message ids', () => {
    expect(rule.meta?.type).toBe('problem');
    expect(Object.keys(rule.meta?.messages ?? {}).sort()).toEqual([
      'previewInError',
      'rawResponseBody',
      'rawTruncation',
      'rawTruncationInError',
    ]);
  });

  it('names the sanctioned helpers in the messages', () => {
    expect(rule.meta?.messages?.rawTruncation).toContain('contentPreview');
    expect(rule.meta?.messages?.rawTruncation).toContain('idPrefix');
    expect(rule.meta?.messages?.rawResponseBody).toContain('contentDigest');
    expect(rule.meta?.messages?.rawTruncationInError).toContain('contentDigest');
    expect(rule.meta?.messages?.rawTruncationInError).toContain('idPrefix');
    expect(rule.meta?.messages?.previewInError).toContain('contentDigest');
  });
});

describe('Pattern A — raw string truncation in a log call (invalid)', () => {
  it('flags the shapes-list shape: an inline .slice(0, n) in a logger field', () => {
    expect(findings(`logger.warn({ bodyPreview: text.slice(0, 200) }, 'failed');`)).toEqual([
      'rawTruncation',
    ]);
  });

  it('flags .substring(0, n) with a named-constant width', () => {
    expect(findings(`logger.info({ p: text.substring(0, LIMIT) }, 'm');`)).toEqual([
      'rawTruncation',
    ]);
  });

  it('flags a truncation nested in an inner object', () => {
    expect(findings(`logger.info({ meta: { p: text.slice(0, 5) } }, 'm');`)).toEqual([
      'rawTruncation',
    ]);
  });

  it('flags a truncation inside a template literal field', () => {
    expect(findings('logger.info({ t: `${text.slice(0, 5)}…` }, "m");')).toEqual(['rawTruncation']);
  });

  it('flags alongside a spread', () => {
    expect(
      findings(`declare const base: object; logger.info({ ...base, p: text.slice(0, 5) }, 'm');`)
    ).toEqual(['rawTruncation']);
  });

  it('flags any logger receiver name — child loggers and this.logger', () => {
    expect(
      findings(`declare const log: typeof logger; log.debug({ p: text.slice(0, 5) });`)
    ).toEqual(['rawTruncation']);
    expect(
      findings(
        `class S { logger = logger; run(): void { this.logger.error({ p: text.slice(0, 5) }); } }`
      )
    ).toEqual(['rawTruncation']);
  });

  it('flags an optional-chain receiver typed string | undefined', () => {
    expect(
      findings(
        `declare const snap: { content?: string }; logger.info({ c: snap.content?.substring(0, 50) });`
      )
    ).toEqual(['rawTruncation']);
  });

  it('flags a string (message-form) first argument', () => {
    expect(findings(`logger.debug('prompt: ' + text.substring(0, LIMIT));`)).toEqual([
      'rawTruncation',
    ]);
  });

  it('flags one hop through a same-file const, reported at the truncation', () => {
    const messages = lintTyped(
      `const qPreview = text.substring(0, 150);\nlogger.info({ queryPreview: qPreview }, 'Memory search query');`
    );
    expect(messages.map(m => m.messageId)).toEqual(['rawTruncation']);
    expect(messages[0].line).toBe(PRELUDE_LINES + 1);
  });

  it('flags one hop used inside a template literal', () => {
    expect(
      findings('const content = text.substring(0, 120);\nlogger.info({ p: `${content}...` });')
    ).toEqual(['rawTruncation']);
  });

  it('flags one hop through a const object spread into the fields', () => {
    expect(
      findings(`const fields = { p: text.slice(0, 5) };\nlogger.info({ ...fields }, 'm');`)
    ).toEqual(['rawTruncation']);
  });

  it('reports a const shared by two log calls once', () => {
    expect(
      findings(`const p = text.slice(0, 5);\nlogger.info({ p }, 'a');\nlogger.warn({ p }, 'b');`)
    ).toEqual(['rawTruncation']);
  });
});

describe('Pattern A — not flagged (valid)', () => {
  it('passes an array receiver — the type-aware check', () => {
    expect(findings(`logger.info({ first: ids.slice(0, 3) }, 'm');`)).toEqual([]);
  });

  it('passes a truncation wrapped in contentPreview', () => {
    expect(findings(`logger.info({ p: contentPreview(text.slice(0, 300), 200) }, 'm');`)).toEqual(
      []
    );
  });

  it('passes a truncation wrapped in contentDigest', () => {
    expect(findings(`logger.info({ d: contentDigest(text.slice(0, 100)) }, 'm');`)).toEqual([]);
  });

  it('passes the migrated id/token/URL helper shapes', () => {
    expect(
      findings(
        `declare const personaId: string; declare const token: string;\n` +
          'logger.info({ personaId: idPrefix(personaId), token: `${idPrefix(token, 12)}…`, u: urlPrefix(text, 50) });'
      )
    ).toEqual([]);
  });

  it('passes a .length read, even through a method chain and a hop', () => {
    expect(
      findings(
        `const firstPartRaw = text.substring(0, LIMIT);\n` +
          `logger.warn({ n: text.slice(0, 5).length, d: firstPartRaw.trimEnd().length, e: firstPartRaw.length });`
      )
    ).toEqual([]);
  });

  it('passes non-(0, n) slices', () => {
    expect(
      findings(`logger.info({ a: text.slice(1, 5), b: text.slice(-5), c: text.slice(0) });`)
    ).toEqual([]);
  });

  it('passes a non-log member call', () => {
    expect(
      findings(`declare const foo: { bar(o: unknown): void }; foo.bar({ x: text.slice(0, 5) });`)
    ).toEqual([]);
  });

  it('passes a truncation outside any log call', () => {
    expect(findings(`export const head = text.slice(0, 5);`)).toEqual([]);
  });
});

describe('Pattern B — raw .text() response body (invalid)', () => {
  it('flags the gatewayServiceCalls shape: a body interpolated into new Error', () => {
    expect(
      findings(
        `async function f(): Promise<void> {\n  const errorText = await response.text();\n` +
          '  throw new Error(`Transcription request failed: ${response.status} ${errorText}`);\n}'
      )
    ).toEqual(['rawResponseBody']);
  });

  it('flags the .text().catch(...) binding shape', () => {
    expect(
      findings(
        `async function f(): Promise<void> {\n  const body = await response.text().catch(() => '');\n` +
          `  throw new Error('failed: ' + body);\n}`
      )
    ).toEqual(['rawResponseBody']);
  });

  it('flags a custom *Error class', () => {
    expect(
      findings(
        `class GatewayError extends Error {}\nasync function f(): Promise<void> {\n` +
          `  const body = await response.text();\n  throw new GatewayError(body);\n}`
      )
    ).toEqual(['rawResponseBody']);
  });

  it('flags a body in a logger field, shorthand counted once', () => {
    expect(
      findings(
        `async function f(): Promise<void> {\n  const body = await response.text();\n` +
          `  logger.warn({ body, status: response.status }, 'failed');\n}`
      )
    ).toEqual(['rawResponseBody']);
  });

  it('flags the render-pilot shape: a sliced body one hop into an Error, once, as a truncation', () => {
    expect(
      findings(
        `async function f(): Promise<void> {\n  const bodyText = await response.text();\n` +
          '  const message = `returned ${String(response.status)}: ${bodyText.slice(0, 500)}`;\n' +
          `  throw new Error(message);\n}`
      )
    ).toEqual(['rawTruncationInError']);
  });

  it('flags a body passed through a prefix helper — idPrefix/urlPrefix are not exempt', () => {
    expect(
      findings(
        `async function f(): Promise<void> {\n  const body = await response.text();\n` +
          `  logger.warn({ p: urlPrefix(body, 200) }, 'failed');\n}`
      )
    ).toEqual(['rawResponseBody']);
  });

  it('reports a truncated body in a log field once, as a truncation', () => {
    expect(
      findings(
        `async function f(): Promise<void> {\n  const body = await response.text();\n` +
          `  logger.warn({ p: body.slice(0, 200) }, 'failed');\n}`
      )
    ).toEqual(['rawTruncation']);
  });
});

describe('Pattern B — not flagged (valid)', () => {
  it('passes status + length in the Error message (the gatewayServiceCalls fix)', () => {
    expect(
      findings(
        `async function f(): Promise<void> {\n  const errorText = await response.text();\n` +
          '  throw new Error(`Transcription request failed: ${response.status} (${errorText.length} chars)`);\n}'
      )
    ).toEqual([]);
  });

  it('passes a digest in the Error message and a gated preview in a log field', () => {
    expect(
      findings(
        `async function f(): Promise<void> {\n  const body = await response.text();\n` +
          `  logger.warn({ p: contentPreview(body, 200), d: contentDigest(body) }, 'failed');\n` +
          '  throw new Error(`failed (${contentDigest(body)})`);\n}'
      )
    ).toEqual([]);
  });

  it('passes a body handed to a non-Error constructor', () => {
    expect(
      findings(
        `async function f(): Promise<Map<string, string>> {\n  const body = await response.text();\n` +
          `  return new Map([['b', body]]);\n}`
      )
    ).toEqual([]);
  });
});

describe('Error sinks — truncation and contentPreview (invalid)', () => {
  it('flags a string .slice(0, n) inline in an Error constructor', () => {
    expect(findings(`throw new Error(text.slice(0, 50));`)).toEqual(['rawTruncationInError']);
  });

  it('flags a truncation in any argument of a custom *Error', () => {
    expect(
      findings(
        `class GatewayError extends Error { constructor(c: number, m: string) { super(m); } }\n` +
          `throw new GatewayError(500, text.substring(0, LIMIT));`
      )
    ).toEqual(['rawTruncationInError']);
  });

  it('flags one hop through a same-file const, reported at the truncation', () => {
    const messages = lintTyped(
      'const head = text.slice(0, 50);\nthrow new Error(`failed: ${head}`);'
    );
    expect(messages.map(m => m.messageId)).toEqual(['rawTruncationInError']);
    expect(messages[0].line).toBe(PRELUDE_LINES + 1);
  });

  it('flags contentPreview inside an Error message — only contentDigest is exempt there', () => {
    expect(findings(`throw new Error(contentPreview(text, 200));`)).toEqual(['previewInError']);
  });

  it('flags contentPreview of a .text() body in an Error once, as a preview', () => {
    expect(
      findings(
        `async function f(): Promise<void> {\n  const body = await response.text();\n` +
          '  throw new Error(`failed: ${contentPreview(body, 200)}`);\n}'
      )
    ).toEqual(['previewInError']);
  });

  it('flags a const preview that is exempt in a log field but reaches an Error', () => {
    expect(
      findings(
        `const p = contentPreview(text, 50);\nlogger.warn({ p }, 'x');\nthrow new Error(p ?? 'x');`
      )
    ).toEqual(['previewInError']);
  });
});

describe('Error sinks — not flagged (valid)', () => {
  it('passes a length in the Error message', () => {
    expect(
      findings(
        `async function f(): Promise<void> {\n  const body = await response.text();\n` +
          '  throw new Error(`failed: ${text.length} chars, body ${body.length} chars`);\n}'
      )
    ).toEqual([]);
  });

  it('passes an array receiver — the type-aware check', () => {
    expect(findings("throw new Error(`ids: ${ids.slice(0, 3).join(', ')}`);")).toEqual([]);
  });

  it('passes contentDigest in the Error message, even over a truncation', () => {
    expect(findings(`throw new Error(contentDigest(text));`)).toEqual([]);
    expect(findings(`throw new Error(contentDigest(text.slice(0, 100)));`)).toEqual([]);
  });

  it('keeps contentPreview exempt in a log field', () => {
    expect(findings(`logger.warn({ p: contentPreview(text, 50) }, 'x');`)).toEqual([]);
  });

  it('passes a truncation handed to a non-Error constructor', () => {
    expect(findings(`export const m = new Map([['b', text.slice(0, 5)]]);`)).toEqual([]);
  });
});

describe('errorSinks option', () => {
  // One log-sink truncation, then an Error carrying all three Error-sink shapes.
  const BOTH_SINKS =
    `async function f(): Promise<void> {\n  const body = await response.text();\n` +
    `  logger.warn({ p: text.slice(0, 5) }, 'x');\n` +
    '  throw new Error(`${text.slice(0, 50)} ${body} ${contentPreview(text, 9) ?? ""}`);\n}';

  function ids(options?: Record<string, unknown>): (string | undefined)[] {
    return lintTyped(BOTH_SINKS, options).map(m => m.messageId);
  }

  it('flags every Error-sink shape by default', () => {
    expect(ids()).toEqual([
      'rawTruncation',
      'rawTruncationInError',
      'rawResponseBody',
      'previewInError',
    ]);
  });

  it('treats an explicit errorSinks: true as the default', () => {
    expect(ids({ errorSinks: true })).toEqual(ids());
  });

  it('with errorSinks: false, skips the Error sink but still flags the log sink', () => {
    expect(ids({ errorSinks: false })).toEqual(['rawTruncation']);
  });

  it('with errorSinks: false, still flags a .text() body in a log field', () => {
    expect(
      lintTyped(
        `async function f(): Promise<void> {\n  const body = await response.text();\n` +
          `  logger.warn({ body }, 'x');\n}`,
        { errorSinks: false }
      ).map(m => m.messageId)
    ).toEqual(['rawResponseBody']);
  });

  it('rejects an unknown option key (schema additionalProperties: false)', () => {
    expect(() => lintTyped(`export {};`, { errorSink: false })).toThrow(/additional properties/);
  });
});

describe('documented blind spots (pinned so the doc comment stays true)', () => {
  it('cannot see cross-function flow: a helper returning a truncation', () => {
    expect(
      findings(
        `function head(s: string): string { return s.slice(0, 5); }\nlogger.info({ p: head(text) });`
      )
    ).toEqual([]);
  });

  it('cannot see a body passed as a parameter into another function', () => {
    expect(
      findings(
        `function fail(b: string): never { throw new Error(b); }\n` +
          `async function f(): Promise<void> { const body = await response.text(); fail(body); }`
      )
    ).toEqual([]);
  });

  it('cannot see a body assigned after declaration', () => {
    expect(
      findings(
        `async function f(): Promise<void> {\n  let b = '';\n  b = await response.text();\n` +
          `  throw new Error(b);\n}`
      )
    ).toEqual([]);
  });

  it('does not follow a let binding or a second hop', () => {
    expect(findings(`let q = text.slice(0, 5);\nq = q + '';\nlogger.info({ q });`)).toEqual([]);
    expect(findings(`const a = text.slice(0, 9);\nconst b = a;\nlogger.info({ b }, 'm');`)).toEqual(
      []
    );
  });

  it('does not inspect arguments after the first', () => {
    expect(findings(`logger.info({}, text.slice(0, 5));`)).toEqual([]);
  });

  it('cannot see truncation through another helper', () => {
    expect(
      findings(
        `declare function truncateText(s: string, n: number): string;\nlogger.info({ p: truncateText(text, 5) });`
      )
    ).toEqual([]);
  });
});

describe('no type program — fail closed', () => {
  it('treats every (0, n) receiver as a string, so an array slice is flagged', () => {
    const messages = lintUntyped(`logger.info({ first: ids.slice(0, 3) }, 'm');`);
    expect(messages.map(m => m.messageId)).toEqual(['rawTruncation']);
  });

  it('fails closed at an Error sink too', () => {
    const messages = lintUntyped(`throw new Error(ids.slice(0, 3).join(', '));`);
    expect(messages.map(m => m.messageId)).toEqual(['rawTruncationInError']);
  });
});
