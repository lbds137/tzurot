import { describe, it, expect } from 'vitest';
import { cac } from 'cac';
import {
  classifyNoMatch,
  unknownCommandMessage,
  unknownFlagsMessage,
  VALID_GLOBAL_FLAGS,
} from './unknown-command.js';

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

  it('reports an unrecognized long flag with no command name as unknown-flag', () => {
    // The `--` key is cac's own array of positionals-after-`--`, and it is
    // present even with no flags at all — probed across cac 7.0.0's parse
    // shapes, and pinned by the `--`-only case below. So a naive "any key
    // other than help/version" check would misfire on a bare `pnpm ops`,
    // which must still print help and exit 0.
    expect(classifyNoMatch(state({ options: { '--': [], bogusFlag: true } }))).toEqual({
      kind: 'unknown-flag',
      flags: ['--bogusFlag'],
    });
  });

  it('reports an unrecognized single-character flag as unknown-flag, dash-spelled', () => {
    expect(classifyNoMatch(state({ options: { '--': [], z: true } }))).toEqual({
      kind: 'unknown-flag',
      flags: ['-z'],
    });
  });

  it('reports every unrecognized flag, not just the first', () => {
    expect(classifyNoMatch(state({ options: { '--': [], bogusFlag: true, z: true } }))).toEqual({
      kind: 'unknown-flag',
      flags: ['--bogusFlag', '-z'],
    });
  });

  it('treats a bare invocation with only the `--` key as help, not unknown-flag', () => {
    expect(classifyNoMatch(state({ options: { '--': [] } }))).toEqual({ kind: 'help' });
  });

  it('only restores the --no- form for a BOOLEAN false, never the string "false"', () => {
    // Pins the cac behavior findUnknownFlags relies on to tell the two apart:
    // `--x false` and `--x=false` store the STRING, while only `--no-x` stores
    // the boolean. Without this the doc comment asserting it is the only record,
    // and a cac change would silently start naming a flag nobody typed.
    expect(classifyNoMatch(state({ options: { '--': [], bogusFlag: 'false' } }))).toEqual({
      kind: 'unknown-flag',
      flags: ['--bogusFlag'],
    });
    expect(classifyNoMatch(state({ options: { '--': [], bogusFlag: false } }))).toEqual({
      kind: 'unknown-flag',
      flags: ['--no-bogusFlag'],
    });
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

  it('classifies an unrecognized global flag with no command name as unknown-flag', () => {
    const cli = build();
    cli.parse(['node', 'test', '--bogus-flag'], { run: false });
    expect(classifyNoMatch(cli)).toEqual({ kind: 'unknown-flag', flags: ['--bogusFlag'] });
  });

  it('leaves --help alone against a real cac instance too', () => {
    const cli = build();
    cli.parse(['node', 'test', '--help'], { run: false });
    expect(classifyNoMatch(cli)).toEqual({ kind: 'run' });
  });

  it('leaves --version alone against a real cac instance too', () => {
    const cli = build();
    cli.parse(['node', 'test', '--version'], { run: false });
    expect(classifyNoMatch(cli)).toEqual({ kind: 'run' });
  });

  it('VALID_GLOBAL_FLAGS matches every name AND alias cli.help()/cli.version() register', () => {
    // The global-flag allowlist is a hand-written constant; this test is the
    // seam that fails if a future global flag is registered on the real cac
    // instance without also being added to VALID_GLOBAL_FLAGS.
    //
    // Read `names` (['h','help']), never `name` ('help'): cac writes EVERY
    // alias into the parsed options object, so an allowlist holding long names
    // alone leaves the alias key looking unrecognized. Asserting against `name`
    // passed while `--no-help` reported `Unknown option -h`.
    const cli = build();
    cli.parse(['node', 'test'], { run: false });
    const globalCommand = (cli as unknown as { globalCommand: { options: { names: string[] }[] } })
      .globalCommand;
    const registeredNames = new Set(
      globalCommand.options.flatMap(opt => opt.names).filter(name => name !== '--')
    );
    expect(registeredNames).toEqual(new Set(VALID_GLOBAL_FLAGS));
  });

  it('accepts --no-help without reporting its alias key as unknown', () => {
    // `--no-help` sets BOTH `help:false` and `h:false`, and the `=== true`
    // early return above deliberately does not catch it — so this lands in the
    // unknown-flag path, where the alias key must already be allowlisted.
    const cli = build();
    cli.parse(['node', 'test', '--no-help'], { run: false });
    expect(classifyNoMatch(cli)).toEqual({ kind: 'help' });
  });

  it('restores the --no- form when reporting a negated unknown flag', () => {
    const cli = build();
    cli.parse(['node', 'test', '--no-bogus-flag'], { run: false });
    expect(classifyNoMatch(cli)).toEqual({ kind: 'unknown-flag', flags: ['--no-bogusFlag'] });
  });

  it.each([['--bogus-flag=false'], ['--bogus-flag', 'false']])(
    'does not mistake an explicit false VALUE for negation: %s',
    (...argv: string[]) => {
      // The external-system half of the negation rule: findUnknownFlags treats a
      // boolean `false` as the --no- form, which is only sound while cac stores
      // an explicitly-passed "false" as a STRING. Asserted against a real cac
      // instance so a version bump that starts coercing it fails here rather
      // than silently renaming the flag in the operator-facing error.
      const cli = build();
      cli.parse(['node', 'test', ...argv], { run: false });
      expect(cli.options.bogusFlag).toBe('false');
      expect(classifyNoMatch(cli)).toEqual({ kind: 'unknown-flag', flags: ['--bogusFlag'] });
    }
  );
});

describe('unknownCommandMessage', () => {
  it('names the command and points at --help', () => {
    const message = unknownCommandMessage('no:such:command');
    expect(message).toContain('no:such:command');
    expect(message).toContain('pnpm ops --help');
  });
});

describe('unknownFlagsMessage', () => {
  it('names a single flag, singular wording, and points at --help', () => {
    const message = unknownFlagsMessage(['--bogusFlag']);
    expect(message).toContain('--bogusFlag');
    expect(message).toContain('Unknown option ');
    expect(message).not.toContain('options');
    expect(message).toContain('pnpm ops --help');
  });

  it('names every flag, plural wording, when more than one is given', () => {
    const message = unknownFlagsMessage(['--bogusFlag', '-z']);
    expect(message).toContain('--bogusFlag');
    expect(message).toContain('-z');
    expect(message).toContain('Unknown options ');
    expect(message).toContain('pnpm ops --help');
  });
});
