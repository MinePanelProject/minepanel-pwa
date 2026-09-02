# MinePanel PWA

MinePanel PWA is the hosted dashboard for self-hosted MinePanel backends, live at `https://app.minepanel.xyz` and deployed via Cloudflare Pages. It is a static React application and is distinct from:

- [`minepanel-backend`](https://github.com/MinePanelProject/minepanel-backend): the operator-owned NestJS API, PostgreSQL, Caddy, and Docker runtime.
- [`minepanel-site`](https://github.com/MinePanelProject/minepanel-site): the marketing site at `https://minepanel.xyz`.

## Direct browser-to-backend model

The dashboard connects the browser directly to an operator-selected backend. Cloudflare Pages serves only the static application; it does not proxy backend APIs, relay credentials, or host a centralized MinePanel API.

```text
app.minepanel.xyz -- HTTPS / WebSocket --> operator-owned MinePanel backend
```

Saved panels are local IndexedDB records containing only a canonical origin, an optional operator label, and local timestamps. The registry never persists cookies, access or refresh tokens, pre-auth credentials, WebSocket data, backend server data, user profiles, setup tokens, TOTP material, or capability responses.

The backend must be configured with the exact frontend origin, normally `CORS_ORIGIN=https://app.minepanel.xyz`. Preview and local development origins are different origins; the backend intentionally does not support wildcard or list-based CORS configuration.

## Current status

The hosted dashboard supports the delivered protocol-1 management surface:

- multiple saved public HTTPS MinePanel backends and capability discovery;
- cookie-based local authentication, registration, session restore, logout, and logout-all;
- Google Identity Services sign-in, plus Google account linking from the Security page (every link attempt uses a fresh single-use backend challenge; the Google credential is discarded immediately after use);
- password-login two-factor verification with TOTP and one-time backup codes;
- password changes, TOTP enrollment/disable, and session revocation (revoking a session ends it server-side; it can no longer obtain new access tokens and signs out when its short-lived access token expires, up to 15 minutes);
- first-admin setup when the operator supplies the one-time setup token;
- server lists, details, creation, deletion, and start/stop/restart lifecycle actions;
- OPEN, REQUEST, and PRIVATE visibility states with request and approval workflows, including a dedicated requestable-server discovery surface (backend `GET /api/servers/requestable`, capability-gated by `capabilities.servers.requestableDiscovery`) that lists REQUEST servers users may request access to without revealing PRIVATE servers;
- administrator user status/role management, temporary password reset, emergency 2FA removal, and MOD permission grants/revocation;
- administrator-only host metrics over cookie-authenticated WebSocket telemetry.

Backend authorization remains authoritative. Client-side role and status checks only shape the interface and never replace backend guards.

Hosted cookie authentication requires a secure browser context with Web Locks and a browser that supports the backend's CHIPS `Partitioned` cookies. The PWA refuses unsafe refresh behavior when Web Locks are unavailable; it relies on the backend's capability advertisement and cannot independently prove HttpOnly partitioned-cookie behavior for every backend origin. This is the current supported hosted-auth contract; CHIPS and Web Locks are not universal across browsers. The backend must use exactly `CORS_ORIGIN=https://app.minepanel.xyz` for the hosted deployment. Same-origin deployment remains the broadest compatibility option. See the public [`/compatibility`](https://app.minepanel.xyz/compatibility) guide for the browser and hosted-auth boundary.
GitHub OAuth is optional future identity work and is not a Phase 1.5 completion blocker. No token-based hosted-auth fallback is implemented for unsupported browser environments.

Google sign-in for accounts with enabled TOTP is not supported by the current backend contract: provider login returns `TwoFactorAuthenticationRequired` without a pre-auth challenge. Use password sign-in for those accounts until the backend supplies a constrained provider 2FA continuation.

When Google sign-in matches an existing MinePanel account it returns `LinkConfirmationRequired` without a session; the PWA never calls the JWT-only link endpoint from that anonymous state — sign in with the existing account first and link Google from Security.

The authenticated session profile intentionally exposes only id, username, role, and recovery state. The Account page therefore does not fabricate or cache an email address. Administrator user views receive email through the backend's admin projection.

Host metrics are display telemetry only. They do not represent server lifecycle state and are not used for authorization. Socket connections are WebSocket-only, bounded-retry, cookie-first connections; no bearer token or ticket is sent by the browser.

## Connection and security model

Production accepts a canonical public HTTPS DNS origin such as `https://panel.example.com`. It rejects HTTP, paths, query strings, fragments, credentials, literal IP addresses, `localhost`, `.localhost`, and `.local` targets. Exact `localhost` is available only in development builds.

All backend requests use the selected origin, `credentials: 'include'` where cookie authentication is required, `cache: 'no-store'`, redirect refusal, and no referrer. No MinePanel or Google credential is written to localStorage, sessionStorage, IndexedDB, React Query persistence, service-worker cache, a URL, or logs.

React Query keys include the saved panel id, canonical origin, and authenticated profile id. Panel query scopes are cancelled and removed on logout, expiry, panel switch, and panel removal. The service worker precaches only same-origin application assets. It has no API, auth, admin, server, or WebSocket runtime cache and no offline mutation queue.

## Development

```bash
bun install --frozen-lockfile
bun run dev
```

Vite runs at `http://localhost:5173` by default. To use it with a local backend, configure that exact value as the backend's `CORS_ORIGIN`; do not use a wildcard.

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start the Vite development server |
| `bun run build` | Type-check and create the production bundle |
| `bun run lint` | Run ESLint with zero warnings allowed |
| `bun run typecheck` | Run TypeScript project checks |
| `bun run test` | Run the Vitest suite |
| `bun run preview` | Serve the production bundle locally |

GitHub Actions runs frozen install, typecheck, lint, tests, and build on pull requests and pushes to `master`.

## Structure

```text
src/
  api/          # typed backend client, errors, DTO validators, panel query keys
  app/          # React Router, Query client, providers
  auth/         # cookie-session controller, Web Locks refresh broker, auth flows
  components/   # registry and authenticated panel shells, shared UI primitives
  instances/    # strict origin validation and IndexedDB metadata registry
  pages/        # registry, auth/account, server, access, setup, and admin screens
  pwa/          # service-worker registration and update prompt
  realtime/     # cookie-first WebSocket host metrics
  styles/       # MinePanel semantic design tokens and global styles
public/
  _headers      # Cloudflare Pages CSP, security, and cache headers
  _redirects    # SPA fallback
  fonts/        # self-hosted Press Start 2P and VT323 subsets
  icons/        # canonical MinePanel PNG icons and maskable derivative
```

The PWA does not fetch arbitrary backend OpenAPI schemas at build time. Backend DTOs are maintained as explicit protocol-1 client contracts and verified against the backend source.

## PWA and Cloudflare Pages

`vite-plugin-pwa` precaches same-origin built application assets, including canonical icons and self-hosted fonts. It defines no backend API runtime caching, offline mutation queue, background synchronization, or WebSocket interception. Backend API and Socket.IO requests remain direct network requests. Offline users can load the application shell and saved panel registry, but backend operations require the network.

Cloudflare Pages deployment uses the static `_redirects` fallback (`/* /index.html 200`). `_headers` sets mutable HTML, manifest, and service-worker files to revalidate while Vite's hashed `/assets/*` remain immutable.

The CSP remains strict. Google Identity Services is the only remote-script/frame exception. `connect-src 'self' https: wss:` permits GIS calls and direct connections to selected HTTPS/WSS backends; no wildcard or unsafe-eval source was added. QR enrollment renders locally to canvas and does not use a `data:` URL or external QR service.

See the authoritative backend [`SPEC.md`](https://github.com/MinePanelProject/minepanel-backend/blob/master/SPEC.md) for the backend protocol and security contract.
