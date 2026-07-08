// UX-literals canary — DO NOT FIX / DO NOT REMOVE.
// Deliberate raw user-facing literals; the canary test asserts the ratchet
// detects them against a zero baseline. Migrating these onto ux/catalog
// would break the canary, not improve the codebase.
export const messages = [
  '❌ Failed to save the thing. Please try again.',
  '❌ Not found.',
  'Something went wrong — please try again later.',
];
