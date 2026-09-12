/**
 * Worktree Transfer
 *
 * Mechanizes the dispatch-transfer sequence documented in the
 * `tzurot-orchestration` skill (the "When the orchestrator reports"
 * paragraph): stage everything a worker left in its throwaway worktree,
 * apply it into the main tree as one patch, verify nothing was lost or
 * added outside that patch and nothing was committed against the worker's
 * no-commit contract, then remove the worktree and its branch.
 *
 * Checks run in a FIXED order, as an array of small named functions, and the
 * FIRST failure refuses — nothing after it runs. Every worktree-only check
 * (main tree cleanliness, worktree registration, base match, staging the
 * patch) runs before the main tree is ever touched; `apply` is the first
 * check that writes to the main tree, and only after all of those have
 * passed. This is what keeps a half-applied or half-verified transfer from
 * ever reaching the destructive removal step at the end: removal is reached
 * only once every safety check ahead of it has already passed (pinned by
 * each refusal test's `noRemovalCalled` assertion in
 * `worktree-transfer.test.ts`).
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { execErrorOutput } from '../utils/execErrorOutput.js';

/** A worker's throwaway branch always carries this prefix (see the harness's worktree spawn). */
const WORKTREE_AGENT_PREFIX = 'worktree-agent-';

/** A staged worktree status line the patch already accounts for: index status + a blank worktree column. */
const PATCH_STATUS_LINE = /^[MADRCT] /;

const PORCELAIN = '--porcelain';

/**
 * Bound on each git shell-out this command makes. Every call here — add,
 * diff, apply, status, log, worktree, branch — is local; no network call is
 * ever made, so a local-probe-scale bound is the right value (matching the
 * sibling workflow-sync guard's LOCAL bound, `WORKFLOW_SYNC_TIMEOUT_MS`).
 */
export const WORKTREE_TRANSFER_TIMEOUT_MS = 60_000;

/** Node's `execFileSync` default `maxBuffer` (1 MiB) is smaller than an ordinary multi-file `--binary` patch. */
export const WORKTREE_TRANSFER_MAX_BUFFER = 64 * 1024 * 1024;

type RunGit = (args: string[], cwd?: string) => string;

function defaultRunGit(args: string[], cwd?: string): string {
  return execFileSync('git', args, {
    encoding: 'utf-8',
    timeout: WORKTREE_TRANSFER_TIMEOUT_MS,
    maxBuffer: WORKTREE_TRANSFER_MAX_BUFFER,
    cwd,
  });
}

function defaultLog(line: string): void {
  console.log(line);
}

export interface TransferOptions {
  /** Path to the worker's worktree, relative or absolute. */
  worktreePath: string;
  /** Refuse unless the main tree's HEAD still equals this SHA. */
  base?: string;
  /** Command runner, injectable for tests. */
  runGit?: RunGit;
  /** Verdict/progress sink, injectable for tests. */
  log?: (line: string) => void;
}

export type CheckName =
  | 'main-tree-identity'
  | 'main-tree-clean'
  | 'worktree-registered'
  | 'base-unchanged'
  | 'empty-patch'
  | 'apply'
  | 'byte-identical'
  | 'nothing-outside-patch'
  | 'no-unpushed-remotes'
  | 'no-unpushed-base'
  | 'removal';

export type TransferResult =
  { ok: true; stat: string } | { ok: false; check: CheckName; reason: string };

/** Mutable state threaded through the check pipeline. @internal Exported for testing */
export interface TransferContext {
  runGit: RunGit;
  mainTreeRoot: string;
  worktreePath: string;
  base?: string;
  mainHead: string;
  branch: string;
  patch: string;
  /** The `git worktree list --porcelain` output fetched for the main-tree-identity check, reused by `checkWorktreeRegistered` instead of a second shell-out. */
  worktreeListing: string;
}

function refuse(check: CheckName, reason: string): TransferResult {
  return { ok: false, check, reason };
}

function checkMainTreeClean(ctx: TransferContext): TransferResult | null {
  const status = ctx.runGit(['status', PORCELAIN], ctx.mainTreeRoot);
  if (status.trim().length > 0) {
    return refuse(
      'main-tree-clean',
      'the main tree has uncommitted changes; applying into a dirty index mixes work'
    );
  }
  return null;
}

/** Locate the `git worktree list --porcelain` block for `worktreePath`, or null. @internal Exported for testing */
export function findWorktreeBlock(listing: string, worktreePath: string): string[] | null {
  const blocks = listing
    .split('\n\n')
    .map(block => block.split('\n').filter(line => line.length > 0));
  for (const block of blocks) {
    if (block[0] === `worktree ${worktreePath}`) {
      return block;
    }
  }
  return null;
}

/** The path named by the FIRST `worktree ` block of a `git worktree list --porcelain` listing — always the main working tree. @internal Exported for testing */
export function findFirstWorktreePath(listing: string): string | undefined {
  const firstLine = listing.split('\n').find(line => line.startsWith('worktree '));
  return firstLine?.slice('worktree '.length);
}

const WORKTREE_REGISTERED: CheckName = 'worktree-registered';

function checkWorktreeRegistered(ctx: TransferContext): TransferResult | null {
  const block = findWorktreeBlock(ctx.worktreeListing, ctx.worktreePath);
  if (block === null) {
    return refuse(WORKTREE_REGISTERED, `${ctx.worktreePath} is not a registered git worktree`);
  }
  const branchLine = block.find(line => line.startsWith('branch refs/heads/'));
  const branch = branchLine === undefined ? '' : branchLine.slice('branch refs/heads/'.length);
  if (!branch.startsWith(WORKTREE_AGENT_PREFIX)) {
    return refuse(
      WORKTREE_REGISTERED,
      `branch "${branch}" does not start with "${WORKTREE_AGENT_PREFIX}"; removal is sanctioned only for the harness's throwaway branch`
    );
  }
  ctx.branch = branch;
  return null;
}

const BASE_UNCHANGED: CheckName = 'base-unchanged';

function checkBaseUnchanged(ctx: TransferContext): TransferResult | null {
  if (ctx.base === undefined) {
    return null;
  }
  if (ctx.mainHead !== ctx.base) {
    return refuse(
      BASE_UNCHANGED,
      `main tree HEAD is ${ctx.mainHead}, not the dispatch base ${ctx.base}; the application target moved`
    );
  }
  return null;
}

function checkStagePatch(ctx: TransferContext): TransferResult | null {
  ctx.runGit(['add', '-A'], ctx.worktreePath);
  // A plain diff renders a binary change as a notice `git apply` cannot apply; --binary emits an applicable patch.
  const patch = ctx.runGit(['diff', '--cached', '--binary'], ctx.worktreePath);
  if (patch.trim().length === 0) {
    return refuse('empty-patch', 'nothing to transfer: the worktree has no staged changes');
  }
  ctx.patch = patch;
  return null;
}

function checkApply(ctx: TransferContext): TransferResult | null {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-transfer-'));
  const patchFile = path.join(tmpDir, 'transfer.patch');
  try {
    fs.writeFileSync(patchFile, ctx.patch, 'utf-8');
    ctx.runGit(['apply', '--index', patchFile], ctx.mainTreeRoot);
    return null;
  } catch (error) {
    return refuse('apply', `git apply --index failed: ${execErrorOutput(error)}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function checkByteIdentical(ctx: TransferContext): TransferResult | null {
  // Must match the --binary flag used to produce ctx.patch, or a binary change diffs differently here.
  const staged = ctx.runGit(['diff', '--cached', '--binary'], ctx.mainTreeRoot);
  if (staged !== ctx.patch) {
    return refuse(
      'byte-identical',
      'the staged diff in the main tree does not match the worktree patch byte-for-byte; leaving the main tree staged for inspection'
    );
  }
  return null;
}

function checkNothingOutsidePatch(ctx: TransferContext): TransferResult | null {
  const status = ctx.runGit(['status', PORCELAIN], ctx.worktreePath);
  const lines = status.split('\n').filter(line => line.length > 0);
  const stray = lines.find(line => !PATCH_STATUS_LINE.test(line));
  if (stray !== undefined) {
    return refuse(
      'nothing-outside-patch',
      `worktree status has a line outside the staged patch: "${stray}"`
    );
  }
  return null;
}

function checkNoUnpushedRemotes(ctx: TransferContext): TransferResult | null {
  const out = ctx.runGit(['log', '--oneline', '--not', '--remotes'], ctx.worktreePath);
  if (out.trim().length > 0) {
    return refuse(
      'no-unpushed-remotes',
      'the worktree has commits not reachable from any remote branch'
    );
  }
  return null;
}

function checkNoUnpushedBase(ctx: TransferContext): TransferResult | null {
  const out = ctx.runGit(['log', '--oneline', `${ctx.mainHead}..HEAD`], ctx.worktreePath);
  if (out.trim().length > 0) {
    return refuse(
      'no-unpushed-base',
      `the worktree has commits ahead of the main tree's HEAD (${ctx.mainHead})`
    );
  }
  return null;
}

interface CheckEntry {
  name: CheckName;
  run: (ctx: TransferContext) => TransferResult | null;
}

const CHECKS: CheckEntry[] = [
  { name: 'main-tree-clean', run: checkMainTreeClean },
  { name: WORKTREE_REGISTERED, run: checkWorktreeRegistered },
  { name: 'base-unchanged', run: checkBaseUnchanged },
  { name: 'empty-patch', run: checkStagePatch },
  { name: 'nothing-outside-patch', run: checkNothingOutsidePatch },
  { name: 'no-unpushed-remotes', run: checkNoUnpushedRemotes },
  { name: 'no-unpushed-base', run: checkNoUnpushedBase },
  { name: 'apply', run: checkApply },
  { name: 'byte-identical', run: checkByteIdentical },
];

/**
 * Remove the worktree and, ONLY when its branch carries the harness's
 * throwaway prefix, delete that branch too. This re-checks the prefix at the
 * call site rather than trusting {@link checkWorktreeRegistered} alone, so a
 * future bug in that earlier check cannot turn this into a `branch -D` on an
 * arbitrary branch (pinned by "never calls branch -D for a branch lacking
 * the worktree-agent- prefix"). The two steps run in SEPARATE try/catch
 * blocks because they leave different states behind on failure: a
 * `worktree remove` failure means nothing was removed yet, so that refusal
 * names the whole worktree-plus-branch cleanup for the operator to do by
 * hand; a `branch -D` failure happens only AFTER the worktree is already
 * gone, so that refusal instead names just the one remaining
 * `git branch -D` for the operator to run. Either way the patch is already
 * applied and verified in the main tree, so a `removal` refusal never loses
 * the result — it leaves cleanup for manual completion.
 * @internal Exported for testing
 */
export function performRemoval(ctx: TransferContext): TransferResult | null {
  try {
    ctx.runGit(['worktree', 'unlock', ctx.worktreePath], ctx.mainTreeRoot);
  } catch {
    // Not locked is the normal case for a worktree the harness never locked.
  }
  try {
    ctx.runGit(['worktree', 'remove', '--force', ctx.worktreePath], ctx.mainTreeRoot);
  } catch (error) {
    return refuse(
      'removal',
      `the patch is applied and verified in the main tree; worktree removal failed: ${execErrorOutput(error)}; remove the worktree (and the ${ctx.branch} branch) by hand`
    );
  }
  if (ctx.branch.startsWith(WORKTREE_AGENT_PREFIX)) {
    try {
      ctx.runGit(['branch', '-D', ctx.branch], ctx.mainTreeRoot);
    } catch (error) {
      return refuse(
        'removal',
        `the patch is applied and verified in the main tree and the worktree is removed; deleting branch ${ctx.branch} failed: ${execErrorOutput(error)}; delete it by hand with git branch -D ${ctx.branch}`
      );
    }
  }
  return null;
}

function printVerdict(log: (line: string) => void, ctx: TransferContext, stat: string): void {
  log(stat);
  const checkNames = CHECKS.map(entry =>
    entry.name === BASE_UNCHANGED && ctx.base === undefined
      ? `${BASE_UNCHANGED} (skipped: no --base)`
      : entry.name
  );
  log(`checks passed: ${checkNames.join(', ')}`);
  log('worktree removed');
  log(`branch ${ctx.branch} deleted`);
  log('next step: run the gates, then commit');
}

/**
 * Run the full transfer pipeline. The main tree's root is resolved from
 * `git rev-parse --show-toplevel` in the CURRENT process cwd — this command
 * is meant to be invoked from the main tree, never from inside the worktree
 * being transferred.
 */
export function transferWorktree(opts: TransferOptions): TransferResult {
  const runGit = opts.runGit ?? defaultRunGit;
  const log = opts.log ?? defaultLog;

  const MAIN_TREE_IDENTITY: CheckName = 'main-tree-identity';

  let mainTreeRoot: string;
  let worktreeListing: string;
  let mainHead: string;
  try {
    mainTreeRoot = runGit(['rev-parse', '--show-toplevel']).trim();

    // Refuse before ANYTHING else — including reading the main tree's HEAD — if
    // the invoking checkout is not itself the main working tree (e.g. this was
    // run from inside a worktree). `git worktree list --porcelain` always lists
    // the main working tree first.
    worktreeListing = runGit(['worktree', 'list', PORCELAIN], mainTreeRoot);
    const firstWorktreePath = findFirstWorktreePath(worktreeListing);
    if (firstWorktreePath !== mainTreeRoot) {
      return refuse(
        MAIN_TREE_IDENTITY,
        `the invoking checkout ${mainTreeRoot} is not the main working tree ${String(firstWorktreePath)}; run worktree:transfer from the main checkout`
      );
    }

    mainHead = runGit(['rev-parse', 'HEAD'], mainTreeRoot).trim();
  } catch (error) {
    return refuse(
      MAIN_TREE_IDENTITY,
      `main-tree-identity: git command failed: ${execErrorOutput(error)}`
    );
  }

  const worktreePath = path.resolve(opts.worktreePath);

  // Defensive trim for library callers; the CLI already trims and validates the format.
  const rawBase = opts.base?.trim();
  let base: string | undefined;
  if (rawBase !== undefined) {
    try {
      base = runGit(['rev-parse', '--verify', `${rawBase}^{commit}`], mainTreeRoot).trim();
    } catch {
      return refuse(
        BASE_UNCHANGED,
        `--base ${rawBase} does not resolve to a commit in the main tree`
      );
    }
  }

  const ctx: TransferContext = {
    runGit,
    mainTreeRoot,
    worktreePath,
    base,
    mainHead,
    branch: '',
    patch: '',
    worktreeListing,
  };

  for (const entry of CHECKS) {
    let result: TransferResult | null;
    try {
      result = entry.run(ctx);
    } catch (error) {
      result = refuse(entry.name, `${entry.name}: git command failed: ${execErrorOutput(error)}`);
    }
    if (result !== null) {
      return result;
    }
  }

  const removalResult = performRemoval(ctx);
  if (removalResult !== null) {
    return removalResult;
  }

  const stat = runGit(['diff', '--cached', '--stat'], mainTreeRoot);
  printVerdict(log, ctx, stat);
  return { ok: true, stat };
}
