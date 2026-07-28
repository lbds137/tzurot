---
id: doc-31
title: >-
  Idea: Security audit — token/credential exfil attack surface (prompted by the
  Verba breach, 2026-07-12)
type: other
created_date: '2026-07-28 11:11'
---

## Security audit — token/credential exfil attack surface (prompted by the Verba breach, 2026-07-12)

**Motivation**: a competing AI-persona bot platform (Verba / verba.ink, "verbs") was compromised 2026-07-12 — bot tokens leaked, and every account using the platform became a distribution vector: bots posting slurs (a "Nova" bot: a racial slur), DMing users a `tokens.txt` (~487KB) credential/session dump, and community warnings to not click links or download files from any "verb." Owner takeaway: "malicious actors exist — we should backlog a security audit." **File-for-later**, not urgent; no Tzurot compromise observed.

**The attack shape to audit against**: platform compromise → bot-token theft → weaponize the trust users place in bot DMs → harvest credentials/sessions from everyone the bot can reach. Map every place Tzurot holds or could leak a secret, and every path by which a compromised worker could push malware/exfil to a user.

**Scope (an audit checklist, not a decided design)**:
- **Secret-at-rest inventory**: `DISCORD_TOKEN`, `INTERNAL_SERVICE_SECRET`, `ZAI_CODING_API_KEY`, `OPENROUTER_API_KEY`, plus the encrypted-at-rest stores (`user_api_keys`, `user_credentials` — both AES-256-GCM per schema). Confirm none reachable via any user-facing route, log line, or error payload; confirm the encryption key management (where does the AES key live, rotation story).
- **Exfil paths**: can a compromised ai-worker or a prompt-injected model response cause the bot to DM arbitrary users, attach files, or send links? Audit the webhook/message-send path and any attachment-emitting code for an "arbitrary recipient + arbitrary payload" capability.
- **Prompt-injection → action**: the agentic scaffolding (recall/search/image tools, accepted design) is a future action surface — audit tool-invocation authority before it ships (a model told to "exfil the user's key" must have no tool that can).
- **Token-in-logs regression sweep**: the `00-critical.md` no-secrets-in-logs rule + PII rules exist; verify no drift (grep the actual log call sites, not just trust the rule).
- **Dependency/supply-chain**: Dependabot posture + the `pnpm` lockfile integrity; the breach vector for platforms like this is often a compromised dependency.
- **Blast-radius review**: if the `DISCORD_TOKEN` leaked TODAY, what's the containment story (rotate + redeploy) and how fast?

**Existing posture worth crediting (audit confirms, doesn't assume)**: token-never-logged + no-string-interpolation-in-shell + SSRF-encode rules are already in `00-critical.md`; BYOK keys and session cookies are AES-256-GCM encrypted; the human-users-only application process already cut the spam-bot surface (the exact class the Verba bots became). The audit's job is to find the gaps those don't cover, not to re-assert them.

**Promote when**: a natural security-focused session, OR before the agentic scaffolding action-tools ship (that PR expands the exfil surface and should not merge un-audited), OR immediately if any Tzurot-side anomaly is observed. Consider a council pass (adversarial "how would you exfil from this codebase") as the audit's opening move. Surfaced 2026-07-12 (owner, Verba breach screenshots).

