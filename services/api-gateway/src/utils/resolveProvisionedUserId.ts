/**
 * Prefer the internal-UUID `userId` attached by `requireProvisionedUser`
 * middleware. Fall back to `getOrCreateUserShell` on shadow-mode fallthrough
 * (missing / malformed user-context headers, bot users, or rare
 * getOrCreateUser failures) to preserve UX during the bot-client rollout
 * window.
 *
 * Once `AuthMiddleware.requireProvisionedUser` is tightened to return 400 on
 * missing provisioning (planned follow-up), this helper collapses to a
 * passthrough read of `req.provisionedUserId` and the shell path can be
 * deleted. The canary log inside `getOrCreateUserShell` surfaces the
 * fallback rate for that cutover decision.
 */

import type { UserService } from '@tzurot/common-types';
import type { ProvisionedRequest } from '../types.js';

export async function resolveProvisionedUserId(
  req: ProvisionedRequest,
  userService: UserService
): Promise<string> {
  if (req.provisionedUserId !== undefined) {
    return req.provisionedUserId;
  }
  return userService.getOrCreateUserShell(req.userId);
}
