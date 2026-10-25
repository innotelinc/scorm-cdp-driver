# scorm-cdp-driver in the Innotel Platform Stack

**Role: LearningOps** — Advance a SCORM player through a Chrome tab you already control.

Part of the [Innotel Platform Stack](https://github.com/innotelinc/innotel-platform-stack).
The canonical definition of the stack, its shared layers and their owners lives
there; this file records only what scorm-cdp-driver does inside it.

## Boundaries

### Owns

- the CDP client and frame resolution
- the narration gate
- the known progress gates
- the command-line interface

### Consumes

- a Chromium browser with the DevTools protocol open
- Cerulean Vault (only if the tool is deployed with a shared secret)

### Does not own

- the SCORM player or the course
- the learner's attestation
- identity or secrets (Cerulean)

## Service map

| Component | Technology | Job |
| --- | --- | --- |
| scorm-cdp-driver | Node.js / TypeScript | Advance a SCORM player through a Chrome tab you already control. |
| Identity | Cerulean Authentik | Sign-in and role claims, where the repo has a UI |
| Secrets | Cerulean Vault (KV v2) | Production credentials, referenced as `vault://` |
| Trust | Cerulean | DNS, TLS and the public hostname |
| Edge | NPM Edge | The public route in front of the service |

## In the ecosystem

- **Identity** comes from Cerulean Authentik; this repo holds no second account
  table and no password of its own.
- **Secrets** come from Cerulean Vault. `.env` is local only and is never
  committed; a `vault://` reference is resolved by the deployment.
- **Trust and edge** are Cerulean's and NPM Edge's. This repo does not write DNS
  records or call the NPM API directly.
- **Storage, billing and telephony** belong to ONYX, Magnate and Zeus
  respectively; scorm-cdp-driver consumes them only where the boundaries above say
  so.

## See also

- [README](../README.md)
- [Innotel Platform Stack](https://github.com/innotelinc/innotel-platform-stack)
