import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/common-types',
  'packages/config-resolver',
  'packages/clients',
  'packages/test-factories',
  'services/ai-worker',
  'services/api-gateway',
  'services/bot-client',
]);
