# MinePanel PWA

MinePanel PWA is the hosted dashboard for self-hosted MinePanel backends, live at `https://app.minepanel.xyz` and deployed via Cloudflare Pages. It is a static React application and is distinct from:

- [`minepanel-backend`](https://github.com/MinePanelProject/minepanel-backend): the operator-owned NestJS API, PostgreSQL, Caddy, and Docker runtime.
- [`minepanel-site`](https://github.com/MinePanelProject/minepanel-site): the marketing site at `https://minepanel.xyz`.

## Direct browser-to-backend model

The dashboard connects the browser directly to an operator-selected backend. Cloudflare Pages serves only the static application; it does not proxy backend APIs, relay credentials, or host a centralized MinePanel API.

```text
app.minepanel.xyz ── HTTPS / WebSocket ──> operator-owned MinePanel backend
```

Saved panels are local IndexedDB records containing only a canonical origin, an optional operator label, and local timestamps. The registry never persists cookies, access or refresh tokens, 2FA pre-auth credentials, WebSocket tickets, backend server data, user profiles, or capability responses.

A backend must be configured with its exact frontend origin, for example `CORS_ORIGIN=https://app.minepanel.xyz`. Preview and local development origins are different origins; the backend intentionally does not support wildcard or list-based CORS configuration.

## Current status

This repository is a small discovery shell, **not a production-ready hosted dashboard**. It can:

- save multiple public HTTPS MinePanel backend origins;
- validate and probe the selected backend's public `GET /api/info` endpoint;
- show its public name/version in an instance shell;
- install as a PWA and cache only the same-origin application shell.

Hosted authentication is deliberately unavailable. MinePanel backend decision **D-1** remains unresolved: current cross-origin cookie behavior lacks the decided hosted-auth design, and the backend does not provide the approved PKCE fallback. Consequently this app has no login, token storage, refresh, 2FA, authenticated server-management, or authenticated WebSocket controls.

`name` and `version` from `/api/info` are display-only. They do not enable capabilities; explicit backend capability discovery will be introduced only after the backend publishes a stable contract.

## Supported connection path

Production accepts a canonical public HTTPS DNS origin such as `https://panel.example.com`. It rejects HTTP, paths, query strings, fragments, credentials, literal IP addresses, `localhost`, `.localhost`, and `.local` targets. Exact `localhost` is available only in development builds.

Direct connections to LAN/private-network endpoints such as `https://192.168.x.x` or `https://server.local` are not supported by the hosted v1 path. Browser certificate, mixed-content, CORS, Private Network Access, and local-network policies vary; this project does not provide insecure workarounds.

## Development

```bash
bun install --frozen-lockfile
bun dev
```

The Vite development server runs at `http://localhost:5173` by default. To use it with a local backend, configure that exact value as the backend's `CORS_ORIGIN`; do not use a wildcard.

| Command | Purpose |
| --- | --- |
| `bun dev` | Start Vite development server |
| `bun run build` | Type-check and create a production bundle |
| `bun run lint` | Run ESLint with zero warnings allowed |
| `bun run typecheck` | Run TypeScript project checks |
| `bun run test` | Run focused Vitest unit tests |
| `bun run preview` | Serve the production bundle locally |

## Structure

```text
src/
  api/          # fixed public backend probe, future auth boundary, safe errors
  app/          # React Router, Query client, providers
  components/   # shared application shell
  instances/    # strict origin validation and IndexedDB metadata registry
  pages/        # instance selector, add-panel flow, selected-panel shell
  pwa/          # service-worker registration and update prompt
public/
  _headers      # Cloudflare Pages CSP, security, and cache headers
  _redirects    # SPA fallback
  icons/        # local manifest icons
```

`src/api/generated/` is intentionally reserved for future versioned OpenAPI-derived DTOs. Backend Drizzle rows are never frontend contracts, and this project does not fetch arbitrary backend OpenAPI schemas at build time. The current backend has public Swagger UI but no committed OpenAPI export workflow suitable for this application.

## PWA and Cloudflare Pages

`vite-plugin-pwa` precaches only same-origin built application assets. It defines no API runtime caching, offline mutation queue, background synchronization, or WebSocket interception. Backend API and Socket.IO requests are always direct network requests. Offline users can open the interface but cannot reach a saved panel.

Cloudflare Pages deployment uses the static `_redirects` fallback (`/* /index.html 200`). `_headers` sets mutable HTML, manifest, and service-worker files to revalidate while Vite's hashed `/assets/*` remain immutable.

The CSP is intentionally strict for executable and rendered content: only same-origin scripts, styles, images, fonts, manifests, and workers are allowed. `connect-src 'self' https: wss:` is the narrow necessary exception for direct connections to user-selected HTTPS/WSS panel backends. It is not an API proxy permission and does not permit `http:`, `ws:`, remote scripts, or remote HTML.

## Security assumptions

- The backend remains authoritative for authentication, authorization, and lifecycle decisions.
- Browser-managed HttpOnly cookies are never inspected, copied, or stored by the app.
- Discovery uses `GET /api/info` with omitted credentials, `no-store`, no redirects, and no referrer.
- An unreachable backend may be a network, certificate, CORS, or availability failure; browser details are intentionally not exposed.
- Removing a saved panel only removes local metadata. It is not remote sign-out.

See the authoritative backend [`SPEC.md`](https://github.com/MinePanelProject/minepanel-backend/blob/master/SPEC.md) for current capability and hosted-auth status.
