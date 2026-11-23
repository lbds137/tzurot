import { z } from 'zod';

/**
 * `meta` is a Railway GraphQL SCALAR (opaque JSON) rather than a selectable
 * object type, so it arrives whole and is parsed here. Only `commitHash` is
 * required; the other keys Railway carries (`branch`, `repo`, `commitAuthor`,
 * `commitMessage`) ride along unvalidated via `passthrough`.
 *
 * `commitHash` is regex-constrained to a hex string, not just `z.string()`:
 * this value is later passed as an argv element to `git cat-file` and `git
 * grep` as a revision. It is never shell-interpolated, so this is not an
 * injection risk, but a value beginning with `-` would be read by git as a
 * FLAG rather than a revision, producing a confusing failure in place of the
 * intended "commit not in this clone" message. The length range is 7-40
 * (short SHA through full SHA) rather than exactly 40, since both `git
 * cat-file` and `git grep` accept abbreviated SHAs.
 */
export const DeploymentMetaSchema = z
  .object({ commitHash: z.string().regex(/^[0-9a-f]{7,40}$/) })
  .passthrough();
