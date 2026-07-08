# ux:literals canary fixture — DO NOT FIX / DO NOT REMOVE

A fake repo root whose commands tree deliberately contains raw user-facing
literals (❌-prefixed strings + "please try again" invitations). The canary
test in `canary.test.ts` runs `ux:literals` against this root with a
zero-total baseline and asserts `status: 'fail'` with findings > 0 — proving
the ratchet actually detects what it claims to.
