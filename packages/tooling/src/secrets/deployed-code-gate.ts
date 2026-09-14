/**
 * The deploy-ordering gate for the staged shared-secret rotation.
 *
 * Stage 1 is only safe against an environment whose VERIFIER already runs code
 * that accepts `<NAME>_PREVIOUS`. Run against one that does not, stage 1 writes
 * the new primary and redeploys the verifier onto it while every presenter
 * still holds the old value — the FULL 401 window, now spanning stage 1 to
 * stage 2 rather than a single restart, which is strictly worse than the
 * unstaged rotation it replaces.
 *
 * There is deliberately NO override flag: an acknowledgement the operator can
 * type is a rubber stamp, and this check is cheap and real.
 */
import { execFileSync } from 'node:child_process';

import { getLiveDeploymentCommit, type RailwayEnv } from '../deployment/railway-api.js';

// Scoping the grep to source is load-bearing, not cosmetic: the tracker task
// describing this feature carries the literal `<NAME>_PREVIOUS` token and is
// committed on develop, so an unscoped repo-wide grep matches at every commit
// since that task file landed and the gate would pass vacuously. Pinned by the
// "a commit where only a tracker file carries the token does not pass" case.
//
// The trailing file segment is equally load-bearing. A git pathspec containing
// a wildcard is matched against the WHOLE path, and the wildcard spans "/", so
// a spec ending at the "src" segment matches only a path that ENDS there —
// i.e. no file at all, and the gate would then refuse every stage 1. Probed
// against this repo: grepping a known-present token under a spec ending at
// "src" exits 1, while the same grep under the specs below exits 0. Pinned by
// the "the configured pathspecs match a real source path" case.
//
// The leading `:/` magic is equally load-bearing: a git pathspec with no
// magic prefix is resolved relative to the CURRENT DIRECTORY, not the repo
// root, so this same grep only matches when run from the repo root. Probed
// against this repo: from `packages/tooling`, `'services/*/src/*'` (no
// prefix) exits 1 against a known-present token while `':/services/*/src/*'`
// exits 0; from the repo root both forms exit 0. `:/` anchors the pathspec to
// the top level regardless of the caller's cwd, which this command's callers
// cannot be assumed to be.
const SOURCE_PATHSPECS = [':/services/*/src/*', ':/packages/*/src/*'];

export interface DeployedCodeGateArgs {
  environmentId: string;
  serviceId: string;
  /** Operator-facing name of the verifier service, for the refusal message. */
  serviceName: string;
  /** The variable being rotated; the gate looks for `<name>_PREVIOUS`. */
  name: string;
  env: RailwayEnv;
}

export type DeployedCodeGateResult =
  { ok: true; commit: string } | { ok: false; commit?: string; reason: string };

function commitExistsLocally(commit: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// `-F` is load-bearing, not decorative: without it, git treats the token as a
// basic regular expression. `DUAL_ACCEPTANCE` is a registry designed to grow
// beyond its current single entry, and a future name containing a regex
// metacharacter (a `.`, a `+`) would change what this grep matches — silently
// changing the gate's answer for a name whose literal text was never the
// intent. `-F` selects git-grep's fixed-string mode, so escaping is delegated
// to git rather than hand-rolled here; pinned by the "passes a
// metacharacter-bearing token through to git verbatim" case.
function commitCarriesToken(commit: string, token: string): boolean {
  try {
    execFileSync('git', ['grep', '-q', '-F', token, commit, '--', ...SOURCE_PATHSPECS], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

export async function checkDeployedCodeAcceptsPrevious(
  args: DeployedCodeGateArgs
): Promise<DeployedCodeGateResult> {
  const token = `${args.name}_PREVIOUS`;

  let commit: string;
  try {
    commit = await getLiveDeploymentCommit({
      environmentId: args.environmentId,
      serviceId: args.serviceId,
      env: args.env,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason:
        `could not read the live deployment for "${args.serviceName}": ${message}. Check ` +
        'TZUROT_RAILWAY_API_TOKEN_<ENV> and that the service has a finished deploy.',
    };
  }

  if (!commitExistsLocally(commit)) {
    return {
      ok: false,
      commit,
      reason:
        `the commit "${args.serviceName}" is running (${commit}) is not in this clone — run ` +
        '`git fetch origin` and retry.',
    };
  }

  if (!commitCarriesToken(commit, token)) {
    return {
      ok: false,
      commit,
      reason:
        `the commit "${args.serviceName}" is running (${commit}) carries no "${token}" under ` +
        `${SOURCE_PATHSPECS.join(' or ')} — that deployment cannot accept the previous value, ` +
        'so stage 1 would open a window nothing closes. Deploy the dual-acceptance code to this ' +
        'environment first, then retry.',
    };
  }

  return { ok: true, commit };
}
