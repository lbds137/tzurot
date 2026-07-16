import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/common-types',
  'packages/config-resolver',
  'packages/identity',
  'packages/conversation-history',
  'packages/cache-invalidation',
  'packages/clients',
  'packages/test-factories',
  'services/ai-worker',
  'services/website',
  'services/api-gateway',
  'services/bot-client',
]);
