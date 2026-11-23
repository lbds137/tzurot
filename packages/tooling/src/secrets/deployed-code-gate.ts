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
 * The same gate shape also serves BYOK stage 1 (byok-prepare-stage.ts): stage 1
 * stages NEXT and redeploys each service reusing its running image, so it must
 * refuse unless that image's decrypt defines `getNextEncryptionKey`, the NEXT-aware
 * decrypt fallback (`checkDeployedCodeDecryptsWithNext`).
 *
 * There is deliberately NO override flag: an acknowledgement the operator can
 * type is a rubber stamp, and this check is cheap and real.
 */
import { execFileSync } from 'node:child_process';

import { getLiveDeployment, type RailwayEnv } from '../deployment/railway-api.js';

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

/**
 * `deploymentId` is the id of the latest deployment the gate read. It is set
 * whenever that read succeeded, so a caller can confirm WHICH deployment it
 * checked, not only the commit it ran.
 */
export type DeployedCodeGateResult =
  | { ok: true; commit: string; deploymentId: string }
  | { ok: false; commit?: string; deploymentId?: string; reason: string };

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
function commitCarriesToken(commit: string, token: string, pathspecs: readonly string[]): boolean {
  try {
    execFileSync('git', ['grep', '-q', '-F', token, commit, '--', ...pathspecs], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * `getNextEncryptionKey` is the NEXT-aware decrypt fallback in common-types
 * encryption.ts (it is in `decryptApiKey`'s fallback list). It first appeared in
 * the commit that introduced NEXT. The match is PRESENCE-ONLY: a grep for the
 * name cannot tell whether the fallback is still wired into decrypt. A refactor
 * that keeps the name but drops the wiring passes this gate, and the real-git
 * HEAD test (deployed-code-gate.git.test.ts) is what catches a rename or removal.
 * The path is scoped to that one file because tooling (byok-stage-helpers.ts)
 * also names NEXT but is not in any service image, so an unscoped grep would
 * pass on tooling alone.
 */
export const BYOK_NEXT_TOKEN = 'getNextEncryptionKey';
export const BYOK_DECRYPT_PATHSPECS: readonly string[] = [
  ':/packages/common-types/src/utils/encryption.ts',
];

interface CarriesTokenArgs {
  environmentId: string;
  serviceId: string;
  serviceName: string;
  env: RailwayEnv;
  token: string;
  pathspecs: readonly string[];
  missingReason: (commit: string) => string;
}

/** Read the live commit, check it is local, then check it carries `token` under `pathspecs`. */
async function checkDeployedCodeCarriesToken(
  args: CarriesTokenArgs
): Promise<DeployedCodeGateResult> {
  let deployment: { id: string; commit: string };
  try {
    deployment = await getLiveDeployment({
      environmentId: args.environmentId,
      serviceId: args.serviceId,
      serviceName: args.serviceName,
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
  const { id: deploymentId, commit } = deployment;

  if (!commitExistsLocally(commit)) {
    return {
      ok: false,
      commit,
      deploymentId,
      reason:
        `the commit "${args.serviceName}" is running (${commit}) is not in this clone — run ` +
        '`git fetch origin` and retry.',
    };
  }

  if (!commitCarriesToken(commit, args.token, args.pathspecs)) {
    return { ok: false, commit, deploymentId, reason: args.missingReason(commit) };
  }

  return { ok: true, commit, deploymentId };
}

export async function checkDeployedCodeAcceptsPrevious(
  args: DeployedCodeGateArgs
): Promise<DeployedCodeGateResult> {
  const token = `${args.name}_PREVIOUS`;
  return checkDeployedCodeCarriesToken({
    environmentId: args.environmentId,
    serviceId: args.serviceId,
    serviceName: args.serviceName,
    env: args.env,
    token,
    pathspecs: SOURCE_PATHSPECS,
    missingReason: commit =>
      `the commit "${args.serviceName}" is running (${commit}) carries no "${token}" under ` +
      `${SOURCE_PATHSPECS.join(' or ')} — that deployment cannot accept the previous value, ` +
      'so stage 1 would open a window nothing closes. Deploy the dual-acceptance code to this ' +
      'environment first, then retry.',
  });
}

export interface DeployedDecryptGateArgs {
  environmentId: string;
  serviceId: string;
  /** Operator-facing name of the service, for the refusal message. */
  serviceName: string;
  env: RailwayEnv;
}

/**
 * BYOK stage 1 gate: the running image must decrypt with a staged NEXT key.
 * Stage 1 redeploys each service reusing that image, so an image whose decrypt
 * ignores NEXT would encrypt-swap into a state it cannot read.
 */
export async function checkDeployedCodeDecryptsWithNext(
  args: DeployedDecryptGateArgs
): Promise<DeployedCodeGateResult> {
  return checkDeployedCodeCarriesToken({
    environmentId: args.environmentId,
    serviceId: args.serviceId,
    serviceName: args.serviceName,
    env: args.env,
    token: BYOK_NEXT_TOKEN,
    pathspecs: BYOK_DECRYPT_PATHSPECS,
    missingReason: commit =>
      `the commit "${args.serviceName}" is running (${commit}) does not define ${BYOK_NEXT_TOKEN} ` +
      `in ${BYOK_DECRYPT_PATHSPECS.map(spec => spec.replace(/^:\//, '')).join(' or ')} — that ` +
      "image's decrypt ignores a staged NEXT key, so the stage-1 swap would reopen the " +
      'cross-service decrypt race. Deploy code containing the NEXT-aware decrypt to this ' +
      'environment first, then retry.',
  });
}
