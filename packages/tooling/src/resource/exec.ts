/**
 * Resource-profile wrapper entry point:
 *
 *   tsx packages/tooling/src/resource/exec.ts <cmd> [args...]
 *
 * Resolves the profile (process env, key-scoped .env read, machine facts),
 * prints one line to stderr, and spawns `<cmd>` with the profile's env
 * additions (RESOURCE_PROFILE, VITEST_MAX_WORKERS, TURBO_CONCURRENCY,
 * NODE_OPTIONS heap cap) layered over the inherited environment. The child's
 * exit code is this process's exit code; a signal maps to 128 + signal number.
 *
 * WHY this is not a `pnpm ops` command: every ops invocation imports cli.ts,
 * which loads the WHOLE .env into process.env via loadEnv.ts. The scripts this
 * wrapper fronts are `pnpm lint` / `pnpm test` / `pnpm typecheck` — those
 * processes must see only the two profile keys, never the operator's other
 * .env values. Hence a standalone entry plus the key-scoped reader envFile.ts.
 */
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import * as os from 'node:os';
import { pathToFileURL } from 'node:url';

import { readEnvFileValues } from './envFile.js';
import { formatProfileLine, type ProfileInput } from './profile.js';
import { liveMachineFacts } from './machineFacts.js';
import { resolveProfileSpawnEnv } from './spawnEnv.js';

/** Spawn-level failure (ENOENT and friends) — mapped to exit 127 like a shell. */
export class SpawnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpawnError';
  }
}

export const USAGE_HINT = 'usage: tsx packages/tooling/src/resource/exec.ts <cmd> [args...]';

export interface RunWrappedIo {
  /** Where the profile line and errors go; default process.stderr. */
  stderr?: { write(chunk: string): unknown };
  /** Default 'inherit' (the wrapped command owns the terminal). 'pipe' routes
   * the child's streams through childStdout/childStderr — the seam tests use it. */
  stdio?: 'inherit' | 'pipe';
  childStdout?: { write(chunk: string): unknown };
  childStderr?: { write(chunk: string): unknown };
}

export async function runWrapped(
  cmd: readonly string[],
  inputs: ProfileInput,
  io: RunWrappedIo = {}
): Promise<number> {
  const target = io.stderr ?? process.stderr;
  const { resolved, env: childEnv } = resolveProfileSpawnEnv(inputs);
  target.write(`${formatProfileLine(resolved)}\n`);
  const file = cmd[0];
  if (file === undefined || file === '') {
    throw new SpawnError('no command to run');
  }
  return new Promise<number>((resolve, reject) => {
    const child = spawn(file, cmd.slice(1), {
      stdio: io.stdio ?? 'inherit',
      env: childEnv,
      shell: false,
    });
    // Forward termination signals so the wrapped command is not orphaned when
    // the wrapper itself is signalled; removed again once the child is done.
    const forwarded: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const handlers = forwarded.map(signal => {
      const handler = (): void => {
        child.kill(signal);
      };
      process.on(signal, handler);
      return { signal, handler };
    });
    const removeHandlers = (): void => {
      for (const { signal, handler } of handlers) {
        process.removeListener(signal, handler);
      }
    };
    child.on('error', (error: Error) => {
      removeHandlers();
      reject(new SpawnError(`spawn ${file} failed: ${error.message}`));
    });
    // 'close' (not 'exit'): it fires after the child's stdio pipes have
    // flushed, so a caller collecting piped child output can read it safely
    // as soon as the promise resolves.
    child.on('close', (code, signal) => {
      removeHandlers();
      if (signal !== null) {
        const signalNumber = os.constants.signals[signal] ?? 1;
        resolve(128 + signalNumber);
        return;
      }
      resolve(code ?? 1);
    });
    if (io.stdio === 'pipe') {
      child.stdout?.on('data', (chunk: Buffer) => io.childStdout?.write(chunk.toString()));
      child.stderr?.on('data', (chunk: Buffer) => io.childStderr?.write(chunk.toString()));
    }
  });
}

export interface MainIo extends RunWrappedIo {
  env?: Record<string, string | undefined>;
  cwd?: string;
}

export async function main(argv: readonly string[], io: MainIo = {}): Promise<number> {
  const target = io.stderr ?? process.stderr;
  const [cmd, ...args] = argv;
  if (cmd === undefined || cmd === '') {
    target.write(`${USAGE_HINT}\n`);
    return 2;
  }
  try {
    const inputs: ProfileInput = {
      env: io.env ?? process.env,
      envFileValues: readEnvFileValues(io.cwd ?? process.cwd()),
      ...liveMachineFacts(),
    };
    return await runWrapped([cmd, ...args], inputs, io);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    target.write(`exec: ${message}\n`);
    return error instanceof SpawnError ? 127 : 2;
  }
}

/**
 * True when `entry` (argv[1]) resolves to the module at `metaUrl`.
 * import.meta.url is realpath'd, argv[1] is not, so a symlinked entry path is
 * resolved through `realpath` first; a resolution failure reads as not-direct.
 */
export function isDirectRun(
  entry: string | undefined,
  metaUrl: string,
  realpath: (path: string) => string = realpathSync
): boolean {
  if (entry === undefined) return false;
  try {
    return pathToFileURL(realpath(entry)).href === metaUrl;
  } catch {
    return false;
  }
}

if (isDirectRun(process.argv[1], import.meta.url)) {
  const code = await main(process.argv.slice(2));
  process.exitCode = code;
}
