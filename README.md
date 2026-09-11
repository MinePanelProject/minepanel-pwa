# MinePanel PWA

The hosted dashboard for self-hosted MinePanel backends, live at `https://app.minepanel.xyz` and
deployed as a static app on Cloudflare Pages.

Related repositories:

- [`minepanel-backend`](https://github.com/MinePanelProject/minepanel-backend) - the operator-owned
  NestJS API, PostgreSQL, Caddy and Docker runtime.
- [`minepanel-site`](https://github.com/MinePanelProject/minepanel-site) - the public site at
  `https://minepanel.xyz`.

## Direct browser-to-backend model

The dashboard connects your browser **directly** to a backend you choose. Cloudflare Pages serves only
the static application: it does not proxy backend APIs, relay credentials, or host a centralized
MinePanel API.

```text
app.minepanel.xyz -- HTTPS / WebSocket --> operator-owned MinePanel backend
```

Saved panels are local IndexedDB records containing only a canonical origin, an optional label and
local timestamps. The registry never persists cookies, session or pre-auth tokens, backend data, user
profiles, setup tokens, TOTP material, or capability responses. Backend authorization stays
authoritative: client-side role checks only shape the interface.

Because the dashboard and the backend are different origins, the backend must be configured with the
dashboard's **exact** origin (`CORS_ORIGIN=https://app.minepanel.xyz` for the hosted deployment).
Wildcard and list-based CORS are not supported; preview and local development origins are different
origins and are rejected by the backend's CSRF check.

## What it does today

A static installable PWA that manages multiple saved public HTTPS backends through capability
discovery: local sign-in with registration and approval states, Google sign-in and account linking,
TOTP with backup codes, password change, session revocation, first-admin setup; server lists, details,
creation, deletion and lifecycle actions; `OPEN`/`REQUEST`/`PRIVATE` access with requests, approvals
and requestable-server discovery; admin user management and MOD permission grants; and ADMIN host
metrics over cookie-authenticated WebSocket.

Hosted sign-in requires a secure browser context with Web Locks and a browser supporting the
backend's CHIPS `Partitioned` cookies. The dashboard refuses to run an unsafe session when those are
missing, and it cannot independently prove partitioned-cookie behaviour for every backend origin.

## Documentation

| Document | Contents |
|----------|----------|
| [`SPEC.md`](./SPEC.md) | Behavioural contract, invariants, supported environment, explicit non-support |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Module boundaries, session and query model, client↔backend flows |
| [`ROADMAP.md`](./ROADMAP.md) | Completed, next, committed and exploratory work with dependencies |
| [`DEVELOPMENT.md`](./DEVELOPMENT.md) | Setup, commands, build inputs, tests, validation gates, deployment settings |
| [`AGENTS.md`](./AGENTS.md) | Coding-agent working rules and red lines |
| [backend `SPEC.md`](https://github.com/MinePanelProject/minepanel-backend/blob/master/SPEC.md) | The server-side protocol and security contract this client consumes |

## Development

```bash
bun install --frozen-lockfile
bun run dev        # Vite dev server at http://localhost:5173
```

Set the backend's `CORS_ORIGIN` to the exact Vite origin to use a local backend; production builds only
accept browser-trusted public HTTPS origins.

| Command | Purpose |
|---------|---------|
| `bun run dev` | Start the Vite development server |
| `bun run build` | Type-check and build to `dist/` |
| `bun run typecheck` | TypeScript project checks |
| `bun run lint` | ESLint with zero warnings allowed |
| `bun run test` | Vitest suite |
| `bun run preview` | Serve the production build locally |

Full environment setup, build inputs (`VITE_GOOGLE_CLIENT_ID`), test layout and validation gates:
[`DEVELOPMENT.md`](./DEVELOPMENT.md). GitHub Actions runs frozen install, typecheck, lint, tests and
build on pull requests and on `master` pushes.

## PWA and caching

The service worker precaches same-origin application assets only. It defines no backend runtime
caching, offline mutation queue, background sync, or WebSocket interception; backend operations
require the network, while the application shell and the saved-panel registry load offline.

Cloudflare Pages uses the static SPA fallback (`public/_redirects`) and a strict CSP
(`public/_headers`) whose only remote script/frame exception is Google Identity Services.

## License

MIT - see [LICENSE](./LICENSE).
