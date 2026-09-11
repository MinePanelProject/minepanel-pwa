# AGENTS.md — MinePanel PWA

## 1. Overview

MinePanel PWA is the hosted dashboard for self-hosted MinePanel backends
(`https://app.minepanel.xyz`). It is a static React 19 + Vite 7 + TypeScript application served by
Cloudflare Pages: the browser connects **directly** to an operator-selected backend, and this client
holds no credential, no proxy and no central API.

### 1.1 Authoritative context — read before changing behaviour

| Question | File |
|----------|------|
| What must the client do? Contracts, invariants, explicit non-support | [`SPEC.md`](./SPEC.md) |
| How is it built today? Module boundaries, session/query model | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| What is planned or blocked? | [`ROADMAP.md`](./ROADMAP.md) |
| What commands and validation gates apply? | [`DEVELOPMENT.md`](./DEVELOPMENT.md) |
| What must I not do? | §5 Red Lines in this file |
| Backend behaviour this client consumes | [`minepanel-backend/SPEC.md`](https://github.com/MinePanelProject/minepanel-backend/blob/master/SPEC.md) |

- Inspect the current code before changing behaviour. `SPEC.md` defines the **intended** client
  contracts and invariants; the client source, tests and build configuration define what is
  **currently implemented**. If they disagree, classify the discrepancy per `SPEC.md` §1 (client
  defect, intentional behaviour change needing a spec update, stale spec, or unresolved) instead of
  rewriting either side by default.
- Never document planned behaviour as implemented; use the status markers in `SPEC.md`.
- Read `ROADMAP.md` before assuming future scope.
- Update the canonical document that owns a change: behaviour → `SPEC.md`, structure →
  `ARCHITECTURE.md`, planning → `ROADMAP.md` **and** `roadmap.json`, workflow → `DEVELOPMENT.md`.
- Do not create new Markdown files when an existing canonical document can hold the content.
- Tests are behavioural evidence; comments and README prose are not.

## 2. Repository Structure

```text
src/
  api/         typed backend client, DTO types + runtime validators, error model, query-key factory
  app/         router, providers, QueryClient defaults
  auth/        session controller, Web-Locks refresh broker, panel session provider,
               cross-tab channel, Google Identity loader
  instances/   strict origin validation, IndexedDB registry, instance context
  realtime/    cookie-first Socket.IO host-metrics hook
  pages/       home, add-panel, compatibility, and the /panel/:instanceId tree
  components/  app frame, panel route/shell, metrics panel, Google link control, ui/ primitives
  pwa/         service-worker registration and update prompt
  styles/      semantic design tokens and global styles
public/        _headers (CSP/security/cache), _redirects (SPA fallback), icons, fonts
```

> **Repo-wide:** `api/` is the only place that performs HTTP. `auth/` is the only place that mutates
> session state. `instances/` is the only place that persists anything, and it persists metadata only.
> Feature pages consume `usePanelSession()`; only auth screens use the controller context.

## 3. Conventions

- TypeScript `strict`, `verbatimModuleSyntax`, `noEmit`; `@/*` maps to `src/*`. Use the alias for
  cross-directory imports; relative imports only within a directory.
- Components are function components returning `React.JSX.Element`; hooks are `useX`.
- Module-level constants are `UPPER_SNAKE_CASE`; exported constants use `camelCase` when they are
  values (for example `panelKeys`, `googleClientId`).
- Runtime validators are named `isX(value: unknown): value is X` and live with their type.
- Colocate suites as `<subject>.spec.ts` / `.spec.tsx` next to the subject.
- Comments explain non-obvious invariants and cite the contract they protect (for example a
  panel-identity remount or a refresh single-flight rule). Do not narrate obvious code, and do not
  leave `TODO`/`FIXME` or commented-out code.
- Formatting and lint are ESLint 9 flat config with `--max-warnings=0`; generate compliant code
  directly rather than relying on a fixer pass.

## 4. Commands

```bash
bun install --frozen-lockfile

bun run dev         # Vite dev server (http://localhost:5173)
bun run build       # tsc -b && vite build → dist/
bun run typecheck   # tsc -b --pretty false
bun run lint        # eslint . --max-warnings=0
bun run test        # vitest run (jsdom + fake-indexeddb)
bun run preview     # serve the production build
```

The pre-completion gate for any `src/**` change is
`bun run typecheck && bun run lint && bun run test && bun run build`.

## 5. Red Lines

- **Never persist a credential or profile.** No access/refresh token, pre-auth token, setup token,
  TOTP secret, backup code, temporary password, profile, backend server data or capability response
  may be written to `localStorage`, `sessionStorage`, IndexedDB, React Query persistence, the
  service-worker cache, a URL, or logs. The only JavaScript-visible credential in the product is the
  five-minute 2FA pre-auth token, held in memory for one login.
- **Never add a second HTTP layer.** All requests go through `BackendClient`; it owns origin rules,
  the credentials/cache/redirect/referrer policy, the 401 → single refresh → single replay
  coordination, and response validation.
- **Never call `POST /auth/refresh` outside the session controller**, and never bypass
  `refreshWithBroker`. Strict server-side rotation makes concurrent, uncoordinated refreshes
  destructive.
- **Never key panel-scoped state or queries without the full identity tuple.** Query keys start with
  the panel identity (record id + canonical origin) and user-visible keys include the profile id; the
  panel subtree stays keyed by identity so a panel switch cannot leak the previous panel's state.
- **Never rely on `gcTime` as the security cleanup.** Cancel and remove the panel query scope at every
  identity boundary.
- **Never cache or replay backend traffic in the service worker**, and never add a runtime caching
  rule, offline mutation queue or background sync for API, auth, admin or realtime traffic.
- **Never relax the origin validation** (HTTPS, public DNS host, no credentials/path/query/fragment,
  no literal IP or `localhost` outside development) or the capability gate
  (`protocolVersion === 1` and `partitionedCookies`).
- **Never branch on a version string for compatibility.** Use `GET /api/info` capability flags and
  degrade gracefully when a flag is absent.
- **Never widen CSP or add a remote origin** without documenting the resulting security surface; the
  only remote script/frame source today is Google Identity Services.
- **Never let socket telemetry become an authority.** Host metrics are display-only and have no HTTP
  fallback.
- **Never invent a backend endpoint.** If the backend does not implement or advertise it, it does not
  exist for this client.
- **Never document planned behaviour as implemented**, and never commit a `console.log`, `TODO` or
  `FIXME`.
