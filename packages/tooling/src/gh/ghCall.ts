import { execFileSync } from 'node:child_process';

/** Thrown when `gh api` fails, so the loop can report it instead of swallowing it. */
export class GhApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GhApiError';
  }
}

/**
 * Run one bounded `gh` call, shaping failures the way `fetchRuns` does: name
 * the kill signal when there is one, keep the detail non-empty either way,
 * and surface everything as GhApiError so callers own the loudness decision.
 */
export function ghCall(args: string[], timeoutMs: number): string {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });
  } catch (error) {
    const { stderr, signal } = error as { stderr?: string; signal?: string | null };
    const reported = (stderr ?? '') || (error as Error).message || '';
    const first = reported.trim().split('\n')[0] ?? '';
    const killed = signal !== undefined && signal !== null ? `killed by ${signal}` : '';
    const detail = [first, killed].filter(part => part !== '').join(' — ');
    throw new GhApiError(detail === '' ? 'gh failed with no output' : detail);
  }
}
