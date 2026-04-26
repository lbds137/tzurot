## 🚨 Production Issues

_Active bugs observed in production. Fix before new features._

_None active. Cleared 2026-04-26 after beta.107 deploy — both prior entries resolved by structural fixes:_

- _LangChain reasoning extraction drop (~11% on GLM-4.7) → addressed by **#895** switching from transport-layer body mutation to `__includeRawResponse` post-parse, bypassing the LangChain `BaseMessage.content` round-trip where the injected tags were being dropped._
- _Preset autocomplete guest-mode trigger for logged-in users → addressed by **#906** flipping the wallet-API check from fail-closed to fail-open, so transient API blips no longer hide paid models from users with active keys._

_If either symptom recurs, treat as a regression and re-investigate from scratch._
