// Test what GLM-4.7 actually returns for reasoning content,
// in both non-streaming and streaming modes.

const PROMPT =
  'You are an assistant. Think step by step before answering. Question: What is 17 * 23?';

async function nonStreamingTest(apiKey: string): Promise<void> {
  console.log('\n=== Non-streaming request to GLM-4.7 ===\n');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/lbds137/tzurot',
    },
    body: JSON.stringify({
      model: 'z-ai/glm-4.7',
      messages: [{ role: 'user', content: PROMPT }],
      stream: false,
      reasoning: { enabled: true, effort: 'medium', exclude: false },
    }),
  });

  console.log(`Status: ${res.status}`);
  console.log(`Content-Type: ${res.headers.get('content-type')}`);

  const body = (await res.json()) as Record<string, unknown>;
  const choices = (body.choices as Array<Record<string, unknown>>) ?? [];
  const message = choices[0]?.message as Record<string, unknown> | undefined;

  console.log('\nResponse top-level keys:', Object.keys(body));
  console.log('Message keys:', message ? Object.keys(message) : 'no message');
  console.log('hasReasoning (string):', typeof message?.reasoning === 'string');
  console.log(
    'reasoningLength:',
    typeof message?.reasoning === 'string' ? message.reasoning.length : 0
  );
  console.log('hasReasoningDetails:', Array.isArray(message?.reasoning_details));
  if (Array.isArray(message?.reasoning_details)) {
    console.log('reasoningDetailsCount:', message.reasoning_details.length);
  }
  if (typeof message?.reasoning === 'string' && message.reasoning.length > 0) {
    console.log('\nreasoning[:200]:', message.reasoning.substring(0, 200));
  }
  if (typeof message?.content === 'string') {
    console.log('\ncontent[:200]:', message.content.substring(0, 200));
  }
  console.log('\nusage:', JSON.stringify(body.usage));
}

async function streamingTest(apiKey: string): Promise<void> {
  console.log('\n=== Streaming request to GLM-4.7 ===\n');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/lbds137/tzurot',
    },
    body: JSON.stringify({
      model: 'z-ai/glm-4.7',
      messages: [{ role: 'user', content: PROMPT }],
      stream: true,
      reasoning: { enabled: true, effort: 'medium', exclude: false },
    }),
  });

  console.log(`Status: ${res.status}`);
  console.log(`Content-Type: ${res.headers.get('content-type')}`);

  // Read SSE chunks and extract delta keys per chunk
  const reader = res.body?.getReader();
  if (!reader) {
    console.log('No body reader.');
    return;
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let firstReasoningSeen = false;
  let reasoningChunks = 0;
  let contentChunks = 0;
  let totalReasoningChars = 0;
  let totalContentChars = 0;
  const deltaKeysSeen = new Set<string>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        const choice = (parsed.choices as Array<Record<string, unknown>>)?.[0];
        const delta = choice?.delta as Record<string, unknown> | undefined;
        if (delta) {
          for (const k of Object.keys(delta)) deltaKeysSeen.add(k);
          if (typeof delta.reasoning === 'string' && delta.reasoning.length > 0) {
            reasoningChunks += 1;
            totalReasoningChars += delta.reasoning.length;
            if (!firstReasoningSeen) {
              console.log(
                '\nFIRST reasoning delta sample:',
                JSON.stringify(delta.reasoning).substring(0, 200)
              );
              firstReasoningSeen = true;
            }
          }
          if (typeof delta.content === 'string' && delta.content.length > 0) {
            contentChunks += 1;
            totalContentChars += delta.content.length;
          }
        }
      } catch {
        // ignore parse errors on partial chunks
      }
    }
  }

  console.log('\nDelta keys seen across stream:', Array.from(deltaKeysSeen));
  console.log(`reasoning chunks: ${reasoningChunks} (${totalReasoningChars} chars total)`);
  console.log(`content chunks:   ${contentChunks} (${totalContentChars} chars total)`);
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    console.error('OPENROUTER_API_KEY not set');
    process.exit(1);
  }

  await nonStreamingTest(apiKey);
  await streamingTest(apiKey);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
