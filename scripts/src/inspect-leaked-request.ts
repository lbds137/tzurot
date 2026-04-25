import { getPrismaClient, disconnectPrisma } from '@tzurot/common-types';

const prisma = getPrismaClient();

async function main() {
  const log = await prisma.llmDiagnosticLog.findUnique({
    where: { requestId: '30a5af6d-6c29-458d-a6ed-9f817f1f6364' },
  });

  if (log === null) {
    console.log('Not found.');
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = log.data as any;
  console.log('=== Diagnostic for leaked request ===\n');
  console.log('Model:', log.model);
  console.log('Provider:', log.provider);
  console.log('Created:', log.createdAt.toISOString());
  console.log('Duration:', log.durationMs, 'ms');
  console.log('');
  console.log('=== llmResponse.reasoningDebug (full) ===');
  console.log(JSON.stringify(data?.llmResponse?.reasoningDebug, null, 2));
  console.log('');
  console.log('=== llmResponse keys ===');
  console.log(Object.keys(data?.llmResponse ?? {}));
  console.log('');
  console.log('=== rawContent (first 500 chars) ===');
  console.log((data?.llmResponse?.rawContent ?? '').substring(0, 500));
  console.log('');
  console.log('=== finalContent (first 500 chars) ===');
  console.log((data?.postProcessing?.finalContent ?? '').substring(0, 500));
  console.log('');
  console.log('=== postProcessing keys ===');
  console.log(Object.keys(data?.postProcessing ?? {}));
  console.log('');
  console.log('=== postProcessing.transformsApplied ===');
  console.log(data?.postProcessing?.transformsApplied);
  console.log('');
  console.log('=== ALL llmResponse fields (full dump) ===');
  console.log(JSON.stringify(data?.llmResponse, null, 2).substring(0, 3000));
  console.log('');
  console.log('=== Top-level data keys ===');
  console.log(Object.keys(data ?? {}));
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => disconnectPrisma());
