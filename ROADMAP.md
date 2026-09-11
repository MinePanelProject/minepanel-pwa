# MinePanel PWA — Roadmap

## 1. Purpose, authority and scope

The canonical roadmap for the hosted dashboard repository: what the client ships today, what is
committed next, and what is only exploratory.

| Question | Authoritative source |
|----------|----------------------|
| What the client must do | [`SPEC.md`](./SPEC.md) |
| How the client is built | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| What is planned here | this file |
| How to build and validate | [`DEVELOPMENT.md`](./DEVELOPMENT.md) |
| Backend platform roadmap (it constrains this one) | [`minepanel-backend/ROADMAP.md`](https://github.com/MinePanelProject/minepanel-backend/blob/master/ROADMAP.md) |
| Machine-readable progress published to the website | [`roadmap.json`](./roadmap.json) |

**Scope:** the hosted dashboard only. Backend platform work is owned by `minepanel-backend`; the
public site is owned by `minepanel-site` and owns no roadmap content.

### 1.1 Relationship to `roadmap.json`

`roadmap.json` is the published projection of this file and is fetched server-side by
`minepanel-site` from the `master` branch. Progress items and their `done` flags live there;
rationale, dependencies and acceptance conditions live here. Both are updated in the same commit, and
existing `phases[].id` values are never renamed or repurposed.

### 1.2 Status vocabulary

This file describes **future and planned work** and is never evidence that functionality currently
exists: `Completed` records work that has shipped and been verified against the client source, every
other status lists intent only. Implemented behavior is evidenced by the client source, tests and
build configuration; required behavior is defined by [`SPEC.md`](./SPEC.md) §1.

`Completed` — shipped and verified. `Next` — immediate committed work. `Committed` — agreed, not
scheduled. `Conditional` — starts only if a dependency changes. `Exploratory` — not approved scope
and never a completion blocker.

No deadline, version or release name is implied anywhere in this file.

---

## 2. Where the client stands

| Phase (`roadmap.json` id) | Name | State |
|---------------------------|------|-------|
| `1` | Dashboard Shell | Completed — static installable PWA, multi-backend registry, strict origin validation, `/api/info` probe, Cloudflare Pages deployment with strict headers and SPA fallback, unit tests for origin validation, the registry and the backend client |
| `1.5` | Hosted Authentication | Completed — capability discovery, local auth with PENDING handling, session restore with single-flight refresh and cross-tab termination, TOTP challenge/enrolment/backup codes/disable, Google login and account linking, password change and session management, first-admin setup |
| `2` | Dashboard Management | Completed — server list and lifecycle controls, ADMIN host metrics over WebSocket, role-aware interface with per-server permissions, access requests and approvals with requestable discovery, admin user management, MOD permission grants |
| `3` | Operations | Committed — tracks the backend Phase 3 API |
| `future-identity-authentication` | Optional Follow-ons | Conditional — GitHub OAuth identity |

The client has no phase in progress. Every surface listed as Completed is reachable through
`/panel/:instanceId`; the exhaustive behavioural contract is [`SPEC.md`](./SPEC.md) §4.

---

## 3. Completed

### 3.1 Discovery shell

Static React PWA deployed to `app.minepanel.xyz`; IndexedDB panel registry holding metadata only;
strict origin validation rejecting HTTP, paths, credentials, literal IPs, `localhost` and `.local`;
public `GET /api/info` probe on add; installable PWA with same-origin app-shell caching; security
headers, strict CSP and SPA fallback; unit tests for origin validation, the registry and the backend
client.

### 3.2 Hosted authentication

Protocol-1 capability gate; local login, registration and PENDING handling; session restore with
single-flight brokered refresh and origin-scoped cross-tab termination; TOTP challenge, enrolment,
backup codes and disable; Google sign-in and authenticated account linking with a fresh single-use
backend challenge per attempt; password change and session revocation; first-admin setup with the
one-time setup token held in memory only.

### 3.3 Dashboard management

Server list and detail with create/start/stop/restart/delete and bounded lifecycle polling; ADMIN host
metrics over cookie-authenticated WebSocket with no HTTP fallback; role-aware interface reflecting
ADMIN/MOD/USER and per-server permissions; `OPEN`/`REQUEST`/`PRIVATE` access with request and approval
flows plus capability-gated requestable-server discovery; admin user management (status, role,
temporary-password reset, emergency 2FA removal); MOD permission grants, global and per-server.

---

## 4. Next

No dashboard work is committed ahead of the backend Phase 2A/3 milestones; the client's remaining
functional surface is blocked on backend contracts rather than on client work.

| Item | Blocked on | Acceptance condition |
|------|------------|----------------------|
| Google sign-in for TOTP-enabled accounts | Backend contract change: a constrained provider 2FA continuation. Today the backend returns `TwoFactorAuthenticationRequired` without a pre-auth challenge, so those accounts must use password sign-in | An account with TOTP enabled can complete a Google sign-in without weakening the 2FA requirement |
| WebSocket auth without cookie-only assumptions | Backend decision D-6 (cookie handshake vs one-time ticket). The client currently connects cookie-first and requires `websocketTicket === false` | The client authenticates the socket through the mechanism the backend designates primary, with a documented fallback for environments where cookies are unavailable |

---

## 5. Committed — Operations surface (phase `3`)

| Item | Tracks (backend) | Notes |
|------|------------------|-------|
| Real-time console and server event stream | Phase 3: RCON/console broker, server logs, player events | Extends the existing socket boundary; must keep display-only separation from authorization |
| Backups and scheduled tasks | Phase 3: backup/restore, scheduler, scheduled tasks | Depends on the backend write architecture (decision D-8) |
| File manager | Phase 3: filesystem-write architecture, file manager | Depends on D-8 and the backend path-safety algorithm |
| Plugin and mod management | Phase 3: plugin/mod management | Depends on D-8 and archive safety |
| Player management | Phase 3: player management, Minecraft/offline UUID linking | Depends on the deferred identity rules |
| Notifications | Phase 3: notifications | Depends on the Phase 2B notification consumers |

Each item starts only when its backend contract exists and is advertised; the client must not
implement speculative endpoints.

---

## 6. Conditional and exploratory

### 6.1 Optional identity

**GitHub OAuth** (phase `future-identity-authentication`) is optional and not a completion blocker.
Google sign-in plus password/TOTP sign-in is the complete hosted identity surface today.

### 6.2 Exploratory — not committed scope

* **Provider 2FA continuation** beyond the blocker in §4.
* **Mobile client and player portal.** A mobile/player surface does not exist in any repository and
  has no roadmap phase here. If it is ever built it will not be delivered through this static
  dashboard.
* **Hosted-browser expansion.** Serving browsers without partitioned cookies or Web Locks would
  require a different cross-origin session mechanism (a backend protocol change with PKCE if an
  authorization-code flow is ever adopted). No token-based hosted-auth fallback exists and none is
  planned; see [`SPEC.md`](./SPEC.md) §3.3.

---

## 7. Engineering backlog tracked outside the roadmap

Accepted internal improvements with no product commitment. Behavioural contracts for the surfaces
they touch are in [`SPEC.md`](./SPEC.md).

| ID | Item |
|----|------|
| PWA-B-1 | The Cloudflare Pages project settings (build command, output directory, runtime version) exist only in the Cloudflare dashboard, unlike `minepanel-site` which keeps `wrangler.jsonc` in the repository. There is no in-repo, reviewable deployment configuration |
| PWA-B-2 | Session revocation is server-side by design; the client cannot make another device drop its short-lived access cookie faster than that cookie's 15-minute expiry. Recorded so it is not mistaken for a client defect |

---

## 8. Documentation maintenance

| Document | Update when |
|----------|-------------|
| [`SPEC.md`](./SPEC.md) | Observable client behaviour, supported-environment claims or invariants change |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Module structure, session/query boundaries, or client/server flow changes |
| `ROADMAP.md` (this file) | Planned dashboard work changes state, scope or dependencies |
| [`roadmap.json`](./roadmap.json) | Progress items change — same commit as this file |
| [`DEVELOPMENT.md`](./DEVELOPMENT.md) | Tooling, commands, build inputs or validation gates change |
| [`README.md`](./README.md) | Orientation or quick start changes |
