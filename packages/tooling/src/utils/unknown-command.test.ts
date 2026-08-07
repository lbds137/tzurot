import { describe, it, expect } from 'vitest';
import { cac } from 'cac';
import { classifyNoMatch, unknownCommandMessage } from './unknown-command.js';

const state = (over: Partial<Parameters<typeof classifyNoMatch>[0]> = {}) => ({
  matchedCommand: undefined,
  args: [] as (string | number)[],
  options: {} as Record<string, unknown>,
  ...over,
});

describe('classifyNoMatch', () => {
  it('runs when a command matched', () => {
    expect(classifyNoMatch(state({ matchedCommand: {}, args: ['db:status'] }))).toEqual({
      kind: 'run',
    });
  });

  it('reports an unmatched name as unknown', () => {
    expect(classifyNoMatch(state({ args: ['no:such:command'] }))).toEqual({
      kind: 'unknown',
      name: 'no:such:command',
    });
  });

  it('shows help for a bare invocation rather than exiting silently', () => {
    expect(classifyNoMatch(state())).toEqual({ kind: 'help' });
  });

  it('leaves --help alone — cac already printed it and unset the match', () => {
    // Without this, `pnpm ops db:status --help` would print help and then
    // error out on the very command name it just documented.
    expect(classifyNoMatch(state({ args: ['db:status'], options: { help: true } }))).toEqual({
      kind: 'run',
    });
  });

  it('leaves --version alone for the same reason', () => {
    expect(classifyNoMatch(state({ options: { version: true } }))).toEqual({ kind: 'run' });
  });

  it('treats an empty first arg as no command given', () => {
    expect(classifyNoMatch(state({ args: [''] }))).toEqual({ kind: 'help' });
  });

  it('still reports a non-string first arg as unknown rather than showing help', () => {
    // cac gives us strings today, so this is defensive — but it has to fail
    // toward "unknown": routing a coerced positional to help would silently
    // restore the exit-0-on-a-typo bug this module removes.
    expect(classifyNoMatch(state({ args: [42] }))).toEqual({ kind: 'unknown', name: '42' });
  });
});

describe('classifyNoMatch against a real cac instance', () => {
  // The unit tests above hand-build the state object, which cannot catch a cac
  // upgrade changing the shape or semantics of .args/.options/.matchedCommand —
  // none of which are documented public API. This is the seam test for that.
  const build = () => {
    const cli = cac('test');
    cli.command('db:status', 'a registered command').action(() => {});
    cli.help();
    cli.version('1.0.0');
    return cli;
  };

  it('classifies a registered command as run', () => {
    const cli = build();
    cli.parse(['node', 'test', 'db:status'], { run: false });
    expect(classifyNoMatch(cli)).toEqual({ kind: 'run' });
  });

  it('classifies an unmatched name as unknown, carrying the name cac parsed', () => {
    const cli = build();
    cli.parse(['node', 'test', 'no:such:command'], { run: false });
    expect(classifyNoMatch(cli)).toEqual({ kind: 'unknown', name: 'no:such:command' });
  });

  it('keeps a digit-only positional a string — cac does not coerce positionals', () => {
    // Distinct from `--flag` VALUES, which mri does coerce (see cli-args.ts).
    const cli = build();
    cli.parse(['node', 'test', '123'], { run: false });
    expect(classifyNoMatch(cli)).toEqual({ kind: 'unknown', name: '123' });
  });

  it('classifies a bare invocation as help', () => {
    const cli = build();
    cli.parse(['node', 'test'], { run: false });
    expect(classifyNoMatch(cli)).toEqual({ kind: 'help' });
  });
});

describe('unknownCommandMessage', () => {
  it('names the command and points at --help', () => {
    const message = unknownCommandMessage('no:such:command');
    expect(message).toContain('no:such:command');
    expect(message).toContain('pnpm ops --help');
  });
});
