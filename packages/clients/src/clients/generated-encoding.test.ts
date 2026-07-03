/**
 * URL-encoding sweep over the generated client classes.
 *
 * Per `00-critical.md` SSRF rule: every dynamic URL path segment must
 * be passed through `encodeURIComponent`. The codegen template wraps
 * every `:param` automatically (see `method-builder.test.ts:70`), but
 * the codegen unit test only proves the TEMPLATE emits the wrap — it
 * doesn't prove the COMPILED clients actually encode at call time.
 *
 * This file closes that gap with a table-driven sweep: for every
 * path-param method on the three generated clients, invoke it with a
 * slash-containing input and assert the URL passed to fetch contains
 * the encoded form (`%2F`). A regression that drops `encodeURIComponent`
 * from the codegen output would fail here on every entry.
 *
 * Sweep is intentionally manual rather than reflection-driven: each row
 * locks in the EXACT method signature contract for one path-param
 * method, so a method-rename or signature-change surfaces here as a
 * test failure (TS won't compile) rather than silently being skipped.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asActor, asSubject, type ActorDiscordId } from '../routes/types.js';
import type { GatewayUser } from '@tzurot/common-types/types/gateway-context';
import { OwnerClient } from './_generated/owner-client.js';
import { ServiceClient } from './_generated/service-client.js';
import { UserClient } from './_generated/user-client.js';

const BASE_URL = 'https://example.test';
const SERVICE_SECRET = 'secret-xyz';
const ACTOR: ActorDiscordId = asActor('actor-discord-id');
const USER: GatewayUser = {
  discordId: 'actor-discord-id',
  username: 'alice',
  displayName: 'Alice',
  isBot: false,
};

/** Slash-containing input — `/` MUST be encoded as `%2F` in the path. */
const TRICKY = 'a/b/c';
const TRICKY_ENC = 'a%2Fb%2Fc';

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Pull the URL string fetch was called with. */
function urlFromFetchCall(): string {
  const call = fetchSpy.mock.calls[0] as [string | URL, RequestInit];
  return typeof call[0] === 'string' ? call[0] : call[0].toString();
}

function serviceClient(): ServiceClient {
  return new ServiceClient({ baseUrl: BASE_URL, serviceSecret: SERVICE_SECRET });
}

function ownerClient(): OwnerClient {
  return new OwnerClient({ baseUrl: BASE_URL, serviceSecret: SERVICE_SECRET, actor: ACTOR });
}

function userClient(): UserClient {
  return new UserClient({
    baseUrl: BASE_URL,
    serviceSecret: SERVICE_SECRET,
    actor: ACTOR,
    user: USER,
  });
}

describe('Generated client URL encoding — ServiceClient', () => {
  it('aiJobStatus encodes jobId', async () => {
    await serviceClient().aiJobStatus(TRICKY);
    expect(urlFromFetchCall()).toContain(TRICKY_ENC);
  });

  it('aiConfirmDelivery encodes jobId', async () => {
    await serviceClient().aiConfirmDelivery(TRICKY);
    expect(urlFromFetchCall()).toContain(TRICKY_ENC);
  });

  it('updateDiagnosticResponseIds encodes requestId', async () => {
    await serviceClient().updateDiagnosticResponseIds(TRICKY, { responseMessageIds: ['m1'] });
    expect(urlFromFetchCall()).toContain(TRICKY_ENC);
  });

  it('getChannelSettings encodes channelId', async () => {
    await serviceClient().getChannelSettings(TRICKY);
    expect(urlFromFetchCall()).toContain(TRICKY_ENC);
  });
});

describe('Generated client URL encoding — OwnerClient', () => {
  it('updateGlobalPersonality encodes slug', async () => {
    // The full input shape isn't relevant to this test — we only care
    // about URL encoding. Cast keeps the focus on the URL assertion.
    await ownerClient().updateGlobalPersonality(TRICKY, {} as never);
    expect(urlFromFetchCall()).toContain(TRICKY_ENC);
  });

  it('getGlobalLlmConfig encodes id', async () => {
    await ownerClient().getGlobalLlmConfig(TRICKY);
    expect(urlFromFetchCall()).toContain(TRICKY_ENC);
  });

  it('removeDenylistEntry encodes all four path params', async () => {
    await ownerClient().removeDenylistEntry(TRICKY, 'd/id', 's/scope', 's/scope-id');
    const url = urlFromFetchCall();
    expect(url).toContain(TRICKY_ENC);
    expect(url).toContain('d%2Fid');
    expect(url).toContain('s%2Fscope');
    expect(url).toContain('s%2Fscope-id');
  });

  it('getAdminUsageStats URL-encodes the timeframe query param', async () => {
    // Regression guard: pins query-param encoding at the compiled-client level; a codegen refactor that breaks it fails here, not silently at runtime.
    await ownerClient().getAdminUsageStats({ timeframe: TRICKY });
    expect(urlFromFetchCall()).toContain(TRICKY_ENC);
  });
});

describe('Generated client URL encoding — UserClient', () => {
  it('getDiagnosticByMessage encodes messageId', async () => {
    await userClient().getDiagnosticByMessage(TRICKY);
    expect(urlFromFetchCall()).toContain(TRICKY_ENC);
  });

  it('getDiagnosticByResponse encodes messageId', async () => {
    await userClient().getDiagnosticByResponse(TRICKY);
    expect(urlFromFetchCall()).toContain(TRICKY_ENC);
  });

  it('getDiagnosticByRequestId encodes requestId', async () => {
    await userClient().getDiagnosticByRequestId(TRICKY);
    expect(urlFromFetchCall()).toContain(TRICKY_ENC);
  });

  it('getUserLlmConfig encodes id', async () => {
    await userClient().getUserLlmConfig(TRICKY);
    expect(urlFromFetchCall()).toContain(TRICKY_ENC);
  });

  it('updateUserTtsConfig encodes id', async () => {
    await userClient().updateUserTtsConfig(TRICKY, {} as never);
    expect(urlFromFetchCall()).toContain(TRICKY_ENC);
  });

  it('deleteTtsOverride encodes personalityId', async () => {
    await userClient().deleteTtsOverride(TRICKY);
    expect(urlFromFetchCall()).toContain(TRICKY_ENC);
  });

  it('getPersonality encodes slug', async () => {
    await userClient().getPersonality(TRICKY);
    expect(urlFromFetchCall()).toContain(TRICKY_ENC);
  });

  it('setPersonalityVisibility encodes slug (multi-segment path)', async () => {
    await userClient().setPersonalityVisibility(TRICKY, { isPublic: true });
    const url = urlFromFetchCall();
    expect(url).toContain(TRICKY_ENC);
    // The `/visibility` literal segment stays unencoded.
    expect(url).toContain('/visibility');
  });

  it('getPersona encodes id', async () => {
    await userClient().getPersona(TRICKY);
    expect(urlFromFetchCall()).toContain(TRICKY_ENC);
  });

  it('getPersonaOverride encodes personalitySlug', async () => {
    await userClient().getPersonaOverride(TRICKY);
    expect(urlFromFetchCall()).toContain(TRICKY_ENC);
  });

  it('getUserChannel encodes channelId', async () => {
    await userClient().getUserChannel(TRICKY);
    expect(urlFromFetchCall()).toContain(TRICKY_ENC);
  });

  it('removeWalletKey encodes provider', async () => {
    await userClient().removeWalletKey(TRICKY);
    expect(urlFromFetchCall()).toContain(TRICKY_ENC);
  });

  it('getMemory encodes id', async () => {
    await userClient().getMemory(TRICKY);
    expect(urlFromFetchCall()).toContain(TRICKY_ENC);
  });

  it('deleteVoice encodes both provider AND voiceId', async () => {
    await userClient().deleteVoice(TRICKY, 'v/id');
    const url = urlFromFetchCall();
    expect(url).toContain(TRICKY_ENC);
    expect(url).toContain('v%2Fid');
  });

  it('subject query param (acceptsSubject) is also URL-encoded', async () => {
    // Brand-checked subject — the codegen passes it through buildQueryString
    // which uses URLSearchParams.set, so it gets percent-encoded the same
    // way as path params.
    await userClient().getDiagnosticByRequestId(TRICKY, {
      subject: asSubject('s/u/b/j'),
    });
    const url = urlFromFetchCall();
    expect(url).toContain(TRICKY_ENC);
    expect(url).toContain('s%2Fu%2Fb%2Fj');
  });
});
