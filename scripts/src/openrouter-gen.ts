// Fetch OpenRouter's per-generation log to see what they think they returned to us.

const GEN_ID = process.env.GEN_ID ?? 'gen-1777093269-u0spcMQFFufj48uP1xsg';

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    console.error('OPENROUTER_API_KEY not set');
    process.exit(1);
  }

  const url = `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(GEN_ID)}`;
  console.log(`Fetching: ${url}\n`);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  console.log(`Status: ${res.status} ${res.statusText}`);
  console.log(`Content-Type: ${res.headers.get('content-type')}\n`);

  const body = (await res.json()) as Record<string, unknown>;
  console.log(JSON.stringify(body, null, 2));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
