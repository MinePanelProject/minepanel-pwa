# MinePanel PWA — Development Guide

How to work on the hosted dashboard: environment, commands, tests, build inputs and the validation
expected before claiming a change is done. This documents the **current** workflow and is updated when
the tooling or gates change.

Read first: [`SPEC.md`](./SPEC.md) for behaviour and invariants, [`ARCHITECTURE.md`](./ARCHITECTURE.md)
for the module boundaries, [`ROADMAP.md`](./ROADMAP.md) before assuming scope, and
[`AGENTS.md`](./AGENTS.md) for code rules.

---

## 1. Prerequisites

| Requirement | Version |
|-------------|---------|
| Bun | `>=1.3.14` (pinned by `packageManager`) — package manager and script runner |
| Node.js | 22.x, only if a tool insists on `node` (Vite/Vitest run under Bun) |
| A running MinePanel backend | For anything beyond the shell: unit tests mock nothing, but manual verification needs a real protocol-1 backend |

Install with `bun install --frozen-lockfile`; keep `bun.lock` synchronized when adding dependencies.

---

## 2. Commands

| Purpose | Command |
|---------|---------|
| Development server | `bun run dev` (Vite, `http://localhost:5173`) |
| Production build | `bun run build` (`tsc -b` then `vite build` → `dist/`) |
| Typecheck | `bun run typecheck` |
| Lint (zero warnings) | `bun run lint` |
| Unit tests | `bun run test` (Vitest, jsdom) |
| Preview the build | `bun run preview` |

CI (`.github/workflows/ci.yml`) runs `bun install --frozen-lockfile`, `typecheck`, `lint`, `test`,
`build` on pull requests and on `master` pushes. Documentation-only changes to `README.md`,
`SPEC.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `DEVELOPMENT.md`, `AGENTS.md`, `roadmap.json`, `LICENSE`
or `.github/FUNDING.yml` skip CI, so those changes need local validation instead of a green run.

---

## 3. Build inputs

| Variable | Required for | Effect when unset |
|----------|--------------|-------------------|
| `VITE_GOOGLE_CLIENT_ID` | Google sign-in | The Google button is not rendered, even when the backend advertises `googleOAuth` |

`.env.example` documents the variable; copy it to `.env` for local development and supply the same
value in the Cloudflare Pages build environment. It is a public OAuth client identifier compiled into
the bundle by design — never put a secret here.

Google sign-in additionally requires `GOOGLE_CLIENT_ID` on the backend side, with the dashboard origin
registered as an authorized JavaScript origin.

---

## 4. Local development against a backend

1. Start a backend (see
   [`minepanel-backend/DEVELOPMENT.md`](https://github.com/MinePanelProject/minepanel-backend/blob/master/DEVELOPMENT.md)).
2. Set that backend's `CORS_ORIGIN` to the **exact** Vite origin, e.g. `http://localhost:5173`. The
   backend accepts one exact origin: no wildcard, no list. A mismatch surfaces as
   `CsrfOriginForbidden` on mutations or a CORS failure — not as a generic network error.
3. Open `http://localhost:5173`, add the backend origin, and sign in.

Notes:

* `localhost` is the only non-HTTPS origin accepted, and only in development builds
  (`import.meta.env.DEV`). Production validation rejects it.
* A backend on a plain HTTP LAN address cannot be added from a production build of the dashboard,
  because a secure context and a browser-trusted HTTPS origin are required
  ([`SPEC.md`](./SPEC.md) §3.2).
* Web Locks and partitioned-cookie support are required for the session to work; a browser missing
  either produces an explicit incompatibility screen rather than a broken session.

---

## 5. Tests

`bun run test` runs Vitest in jsdom with `fake-indexeddb` installed by `src/test/setup.ts`. Suites are
colocated as `*.spec.ts` / `*.spec.tsx`.

| Area | What the suites pin |
|------|---------------------|
| `api/` | Origin validation, backend-client behaviour (including the 401 → single refresh → single replay path), query-key scoping, DTO validators |
| `auth/` | Session-controller state transitions, refresh-broker single-flight and lock refusal, session channel, Google identity |
| `instances/` | Registry CRUD and origin validation |
| `realtime/` | Host-metrics hook gating and payload handling |
| `pages/`, `components/` | Shell rendering per session state, page-level flows, requestable discovery gating |

When changing client behaviour, prefer extending the suite that already covers the surface. Assert
observable behaviour — rendered state, calls made, cache outcomes — not implementation structure.

---

## 6. What to run before claiming completion

| Change | Minimum validation |
|--------|--------------------|
| Documentation only | Internal link and path sanity; verify every `src/...` reference still exists |
| Any `src/**` change | `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build` |
| Session, refresh or query-scope change | Above + manual verification against a real backend: sign in, reload, switch panels, sign out, sign out all |
| Cache, service worker or header change | Above + inspect the built `dist/` and the emitted `_headers` behaviour |
| Capability-gated surface | Above + verification against a backend that does and does not advertise the flag |

For UI changes, verify against the actual running application rather than trusting type checks: start
`bun run dev` with a backend configured and exercise the changed surface.

---

## 7. Cross-repository compatibility

The client is a consumer of the backend contract; it must never invent one.

1. **Branch on capability flags, never on version strings** ([`SPEC.md`](./SPEC.md) §7). A new
   feature that needs new backend behaviour requires an advertised flag on the backend side; the
   client must degrade gracefully when the flag is absent.
2. **Keep `src/api/types.ts` and the runtime validators in step with the backend DTOs.** The client
   validates every response; a backend projection change surfaces as an "invalid response" screen
   rather than as silent corruption. When the backend changes a projection, update the type, the
   validator and the consuming page in one change.
3. **Never call `POST /auth/refresh` outside the session controller**, and never add a second HTTP
   layer: all requests go through `BackendClient`, which owns the origin rules, credentials policy,
   401 coordination and response validation.
4. **Update the other repositories in the same session** when a shared fact changes (panel origin,
   capability flag, backend route or error code): `minepanel-backend` (`SPEC.md`,
   `docs/*`), and `minepanel-site` when public copy or links change.
5. **Roadmap changes are two files in one commit**: [`ROADMAP.md`](./ROADMAP.md) plus
   [`roadmap.json`](./roadmap.json).

---

## 8. Deployment settings

Cloudflare Pages serves the repository as a static site connected to the `master` branch.

| Setting | Value |
|---------|-------|
| Build command | `bun run build` |
| Output directory | `dist` |
| SPA fallback | `public/_redirects` → `/* /index.html 200` |
| Headers | `public/_headers` (CSP, security, per-path cache policy) |

These settings live in the Cloudflare dashboard, not in the repository (see
[`ROADMAP.md`](./ROADMAP.md) §7, PWA-B-1). `public/_headers` and `public/_redirects` are the only
reviewable deployment artefacts in git; changing them changes production behaviour.

---

## 9. Documentation maintenance

| File | Update when |
|------|-------------|
| [`SPEC.md`](./SPEC.md) | Observable behaviour, supported-environment claims or invariants change |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Module boundaries, session/query model or client↔backend flows change |
| [`ROADMAP.md`](./ROADMAP.md) + [`roadmap.json`](./roadmap.json) | Planned work changes state, scope or dependencies |
| `DEVELOPMENT.md` (this file) | Commands, build inputs, test layout or validation gates change |
| [`README.md`](./README.md) | Orientation, links or quick start change |

Put durable detail in the document that owns it and link from `README.md` instead of duplicating it.
Do not add a new Markdown file when an existing canonical document can hold the content.
