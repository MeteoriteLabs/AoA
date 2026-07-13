---
title: Deployment Modes
summary: local_trusted vs authenticated (private/public)
---

AoA supports two runtime modes with different security profiles.

## `local_trusted`

The default mode. Optimized for single-operator local use.

- **Host binding**: loopback only (localhost)
- **Authentication**: no login required
- **Use case**: local development, solo experimentation
- **Board identity**: auto-created local board user

```sh
# Set during onboard
pnpm aoa onboard
# Choose "local_trusted"
```

## `authenticated`

Login required. Supports two exposure policies.

### `authenticated` + `private`

For private network access (Tailscale, VPN, LAN).

- **Authentication**: login required via Better Auth
- **URL handling**: auto base URL mode (lower friction)
- **Host trust**: private-host trust policy required

```sh
pnpm aoa onboard
# Choose "authenticated" -> "private"
```

Allow custom Tailscale hostnames:

```sh
pnpm aoa allowed-hostname my-machine
```

### `authenticated` + `public`

For internet-facing deployment.

- **Authentication**: login required
- **URL**: explicit public URL required
- **Security**: stricter deployment checks in doctor

```sh
pnpm aoa onboard
# Choose "authenticated" -> "public"
```

## Board Claim Flow

When migrating from `local_trusted` to `authenticated`, set
`AOA_HEADLESS_BOOTSTRAP=1` if `local-board` is still the only instance admin.
AoA then emits a one-time claim URL at startup:

```
/board-claim/<token>?code=<code>
```

A signed-in user visits this URL to claim board ownership. This:

- Promotes the current user to instance admin
- Demotes the auto-created local board admin
- Ensures active company membership for the claiming user

"Headless" refers to the server setup: the claim can be completed from a
different browser that can reach the server. The claiming user must still sign
in with Google before ownership can be transferred.

## Changing Modes

Update the deployment mode:

```sh
pnpm aoa configure --section server
```

Runtime override via environment variable:

```sh
AOA_DEPLOYMENT_MODE=authenticated pnpm aoa run
```

## Security Headers (helmet + CSP)

AoA mounts [helmet](https://helmetjs.github.io/) on every response. The exact header set depends on deployment mode:

| Header | `local_trusted` (dev) | `local_trusted` (prod / npm install) | `authenticated` |
|--------|------------------------|----------------------------------------|------------------|
| `Content-Security-Policy` | not set | strict | strict |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` | `same-origin-allow-popups` | `same-origin-allow-popups` |
| `Cross-Origin-Resource-Policy` | `same-site` | `same-site` | `same-site` |
| `Cross-Origin-Embedder-Policy` | not set | not set | not set |
| `X-Content-Type-Options` | `nosniff` | `nosniff` | `nosniff` |
| `X-Frame-Options` | `SAMEORIGIN` | `SAMEORIGIN` | `SAMEORIGIN` |
| `Referrer-Policy` | `no-referrer` | `no-referrer` | `no-referrer` |

**CSP is skipped only when** `AOA_DEPLOYMENT_MODE=local_trusted` AND `NODE_ENV !== "production"`. This is the Vite-HMR dev case — HMR's runtime injects inline scripts and uses `eval`, both of which strict CSP would block. Loopback is the trust boundary in dev.

Strict-CSP directives:

```
default-src 'self';
script-src 'self' 'sha256-<hash>';            // hash of the FOUC bootloader in index.html, computed at server startup
style-src 'self' 'unsafe-inline';             // Vite injects styles via dynamic <style>
img-src 'self' data: blob: https:;            // avatar generators + asset previews
font-src 'self' data:;
connect-src 'self';                           // UI never calls LLM APIs directly — all LLM traffic is server-mediated
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
upgrade-insecure-requests
```

`connect-src 'self'` is intentionally tight. If you wire a custom backend that fetches LLM endpoints from the **browser** (uncommon — most operators keep LLM calls server-side), you'll need to extend the directive list in `server/src/services/helmet-options.ts`. Cross-Origin-Embedder-Policy (`require-corp`) stays disabled because it would block any external avatar/image without a CORP header.

When `index.html` changes, the inline-script hash auto-updates on next server start (no rebuild of the helmet config required). The hash extractor lives in `server/src/services/csp-script-hashes.ts`.
