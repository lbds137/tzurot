import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/common-types',
  'services/ai-worker',
  'services/api-gateway',
  'services/bot-client',
]);
