/**
 * Backlog.md config gate
 *
 * Structural check on `backlog.config.yml`: four keys must hold specific
 * values or the tracker CLI's task-id allocator silently hands out an id
 * another branch already claimed.
 *
 * UNVERIFIED BEYOND THIS: read from the shipped backlog.md v1.50.1 native
 * binary's symbol names (no readable source in node_modules to confirm
 * against), so this is a hypothesis about that version's behavior, not a
 * pinned fact — `generateNextId` → `getActiveAndCompletedTaskIds` →
 * `loadTasksWithStableBranchSnapshot` in `src/core/backlog.ts` appears to
 * only consult other branches' task files when branch-awareness is on:
 * `computeActiveBranchSnapshot` returns an empty branch-tip set when
 * `!checkActiveBranches || filesystemOnly`, and `refreshRemoteRefsForTaskRead`
 * returns early when `checkActiveBranches === false || remoteOperations ===
 * false || filesystemOnly === true`. A future CLI version could change or
 * rename these symbols without this gate noticing.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const CONFIG_FILE = 'backlog.config.yml';

interface RequiredValue {
  readonly key: string;
  readonly value: boolean;
  /** Why this key must hold this value — one per key, because they differ. */
  readonly reason: string;
}

/** Shared by the three keys that gate the branch-awareness path. */
const BRANCH_AWARENESS_REASON = 'a wrong value re-issues a task id another branch already claimed';

/**
 * Three keys turn on the branch-awareness path described above; the fourth is
 * unrelated to it and carries its own reason, so the reasons are per-key
 * rather than one shared sentence.
 */
const REQUIRED_VALUES: readonly RequiredValue[] = [
  { key: 'filesystem_only', value: false, reason: BRANCH_AWARENESS_REASON },
  { key: 'check_active_branches', value: true, reason: BRANCH_AWARENESS_REASON },
  { key: 'remote_operations', value: true, reason: BRANCH_AWARENESS_REASON },
  {
    key: 'auto_commit',
    value: false,
    reason: "this repo's workflow owns its commits; the tracker CLI must not make them",
  },
];

/**
 * Structural problems in `backlog.config.yml`: missing file, unparseable
 * YAML, or one of the four required keys holding the wrong value.
 */
export function checkBacklogConfig(rootDir: string = process.cwd()): string[] {
  const configPath = join(rootDir, CONFIG_FILE);
  if (!existsSync(configPath)) {
    return [`${CONFIG_FILE} not found — the tracker CLI cannot run without it`];
  }

  // Read and parse are separate try blocks so the message names which one
  // failed: an unreadable file (permissions, a dangling symlink, a race with a
  // rewrite) and malformed YAML need different fixes, and one shared catch
  // reported both as a parse failure.
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch {
    return [`${CONFIG_FILE} could not be read`];
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    return [`${CONFIG_FILE} could not be parsed as YAML`];
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return [`${CONFIG_FILE} did not parse to a YAML mapping`];
  }
  const config = parsed as Record<string, unknown>;

  return REQUIRED_VALUES.filter(({ key, value }) => config[key] !== value).map(
    ({ key, value, reason }) =>
      `${CONFIG_FILE}: '${key}' must be ${String(value)} ` +
      `(currently ${JSON.stringify(config[key])}) — ${reason}`
  );
}
