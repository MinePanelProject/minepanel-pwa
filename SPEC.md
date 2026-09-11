# MinePanel PWA — Specification

## 1. Purpose and authority

This file is the contract for the hosted MinePanel dashboard (`minepanel-pwa`, deployed at
`app.minepanel.xyz`): what it must do, what it must never do, and what it deliberately does not
support. It is a sibling of the backend specification, not a copy of it.

| Document | Owns |
|----------|------|
| `SPEC.md` (this file) | Client-observable behaviour, contracts, invariants, supported environment, explicit non-support |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | How the current client is built and where its boundaries are |
| [`ROADMAP.md`](./ROADMAP.md) | What is completed, next, committed or exploratory |
| [`DEVELOPMENT.md`](./DEVELOPMENT.md) | Setup, commands, test suites and validation expectations |
| [`README.md`](./README.md) | Short orientation and quick start |
| [`AGENTS.md`](./AGENTS.md) | Coding-agent working rules |

**Backend contract is external.** The server-side authority for endpoints, status codes, error codes,
cookie attributes, capability flags, authorization and lifecycle semantics is
[`minepanel-backend/SPEC.md`](https://github.com/MinePanelProject/minepanel-backend/blob/master/SPEC.md).
This document never redefines it. A change to the backend contract must be reflected here and in the
client in the same work session; when the client, its specification and the backend contract disagree,
that is a discrepancy to investigate and classify (using each repository's own rules), not something
to reconcile silently on one side.

**Implementation truth vs normative contract.** Within this repository the two are separate
authorities and neither silently overwrites the other:

* **Currently implemented client behavior** is evidenced by the client source, the automated tests,
  the build configuration and the deployed `public/_headers` / `_redirects` artifacts.
* **Intended client behavior, invariants and explicit non-support** are defined by this document.

When the client and this specification disagree, investigate and classify the discrepancy — a client
defect; an intentional behaviour change that requires a specification update; a stale specification;
or an unresolved discrepancy — rather than editing either side to match the other by default. Never
describe behavior as supported without implementation evidence, and never treat existing code as
correct merely because it ships.

Status markers used here: `[IMPLEMENTED]`, `[PARTIAL]`, `[PLANNED]`, `[EXPLORATORY]`, `[NOT SUPPORTED]`.

---

## 2. What this client is

The PWA is a **static client** that connects a browser directly to a MinePanel backend chosen by the
user. It is not a hosted service: Cloudflare Pages serves only the built assets, and there is no
central MinePanel API, proxy, relay, credential store, or account.

```text
browser at app.minepanel.xyz  ──── HTTPS / WSS (cookies, direct) ────►  operator's backend
```

Consequences that define the product:

* **Every backend is a first-class, independent origin.** A user can save several backends and switch
  between them; each is addressed by a canonical origin stored on that device.
* **The dashboard cannot see or hold credentials.** Session tokens live in HttpOnly cookies issued by
  the backend; the client never receives or persists them.
* **Backend authorization is the only authority.** Client-side role and status checks shape the
  interface and never replace backend guards.

---

## 3. Supported environment and explicit non-support

### 3.1 Required browser capabilities `[IMPLEMENTED]`

| Requirement | Why |
|-------------|-----|
| Secure context (`isSecureContext`) | The backend's production cookies are `Secure`; the client refuses to run an insecure session |
| Web Locks API | Cross-tab coordination of destructive refresh rotation |
| Partitioned (CHIPS) cookie support | The backend advertises `capabilities.auth.partitionedCookies`; the client trusts that advertisement |
| `BroadcastChannel` | Optional; when absent, cross-tab session termination is not propagated (the session still works) |

### 3.2 Panel origin requirements `[IMPLEMENTED]`

A hosted panel origin MUST be a browser-trusted public HTTPS DNS origin. `instances/origin-validation.ts`
rejects:

* non-`https:` schemes (except exact `localhost` in development builds),
* credentials in the URL, paths, query strings and fragments,
* literal IP addresses (IPv4 and bracketed/colon IPv6),
* `localhost`, any `*.localhost`, any `*.local`, and any trailing-dot hostname,
* surrounding whitespace and empty input.

### 3.3 Explicitly not supported `[NOT SUPPORTED]`

* Legacy or feature-incomplete browsers without partitioned cookies or Web Locks.
* Arbitrary embedded WebViews.
* Browser-untrusted HTTP endpoints, private/LAN origins and `.local` hostnames from the hosted app.
* A token-based hosted-auth fallback: there is no JavaScript-readable session token, no bearer
  session, and no PKCE authorization-code flow. `capabilities.auth.pkceAuthorizationCode` is
  advertised as `false` and the client treats it as unsupported.
* Offline mutations: no offline queue, no background sync, no WebSocket replay.
* Fetching a backend OpenAPI schema at build time; client contracts are explicit and hand-verified.

The `/compatibility` route states this contract to users
(`src/pages/compatibility-page.tsx`).

### 3.4 Panel compatibility gate `[IMPLEMENTED]`

A panel is usable only when:

1. `api.protocolVersion === 1`, and
2. `capabilities.auth.partitionedCookies === true`.

Otherwise the shell shows an incompatible-panel problem with the specific reason
(`unsupported-protocol` or `partitioned-auth-not-advertised`) and performs no authenticated request.
Browser-side failures (`insecure-context`, `web-locks-unavailable`) are reported as browser
incompatibility instead. `capabilities.servers` is optional on the wire: an older protocol-1 backend
stays fully usable with only requestable-server discovery disabled.

---

## 4. Functional contract

### 4.1 Panel registry `[IMPLEMENTED]`

* Saved panels are local records containing a canonical origin, an optional user label, and
  created/last-used timestamps. The origin is unique per record.
* The registry MUST NOT contain cookies, access or refresh tokens, pre-auth credentials, WebSocket
  data, backend server data, user profiles, setup tokens, TOTP material, or capability responses.
* Adding a panel probes the origin with the public, credential-free `GET /api/info` and rejects an
  address that does not answer with a supported protocol-1 panel.
* Removing a panel removes its cached query data; it does not and cannot revoke a session server-side.
* Settings that affect one panel MUST NOT leak into another: the panel-scoped tree is remounted on
  panel change (§5.2).

### 4.2 Authentication `[IMPLEMENTED]`

Supported flows:

| Flow | Behaviour |
|------|-----------|
| Register | Creates an account. `REQUIRE_ADMIN_APPROVAL=true` on the backend means the account starts PENDING and the client shows an approval state |
| Password sign-in | On success the backend sets HttpOnly cookies and returns the public user; the client then restores the profile |
| Password sign-in with TOTP | The backend returns a challenge; the client holds the five-minute pre-auth token **in memory only** and completes `POST /auth/2fa/verify` with a TOTP or backup code |
| Google sign-in | Google Identity Services credential → `POST /auth/oauth/google/login`. Rendered only when the panel advertises `googleOAuth` **and** a client ID is configured for the deployment |
| Google account linking | From the Security page, with a fresh single-use backend challenge per attempt; the Google credential is discarded immediately after use |
| Session restore | `GET /auth/profile`; on 401 the client attempts one brokered refresh, then either restores the profile or ends the session |
| Sign out / sign out all | `POST /auth/logout` / `logout-all`, then the panel scope is cleared |
| Forced recovery | A temporary-password session can only reach the password-change screen |

Invariants:

1. **No token ever reaches JavaScript.** Session tokens remain in HttpOnly cookies; the only
   JavaScript-visible credential in the whole product is the five-minute 2FA pre-auth token, which is
   held in memory for the duration of one login and is never persisted or logged.
2. **Exactly one refresh authority.** All refresh calls go through the session controller and the
   Web-Locks refresh broker. No feature code may call `POST /auth/refresh` directly, because strict
   backend rotation invalidates the losing concurrent request.
3. **Refresh is single-flight per origin.** Tabs of the same backend serialize on a per-origin lock;
   a second caller reuses the in-flight outcome.
4. **Google sign-in is not offered for TOTP accounts.** The backend returns
   `TwoFactorAuthenticationRequired` without a pre-auth challenge for provider logins on TOTP-enabled
   accounts, so the client directs those users to password sign-in. `[PARTIAL]` — a provider 2FA
   continuation would require a backend contract change.
5. **Anonymous `LinkConfirmationRequired` never calls the link endpoint.** When Google login matches
   an existing account the client shows guidance and instructs the user to sign in with that account
   first; the JWT-only link endpoint is never called from the anonymous state.
6. **The profile exposed to the shell is minimal** — id, username, role, and recovery state. The
   Account page therefore never fabricates or caches an email address; admins see emails through the
   backend's admin projection.

### 4.3 Server management `[IMPLEMENTED]`

* Server list with pagination, plus a detail view.
* Create (with provider, version, port, memory and gameplay settings), delete, start, stop, restart.
* Lifecycle actions are gated by backend authorization: ADMIN, or MOD holding the relevant grant.
  The client mirrors that gating for presentation only.
* Transitional states poll with a bounded budget and stop on their own (§6).
* Deletion is confirmed explicitly. The client states that world data is retained on the operator's
  host, consistent with the backend contract.
* Access visibility (`OPEN` / `REQUEST` / `PRIVATE`) is rendered from what the backend returns.
  `PRIVATE` servers are never enumerated by any client surface.

### 4.4 Access requests `[IMPLEMENTED]`

* Requestable-server discovery (`GET /api/servers/requestable`) is rendered only when the backend
  advertises `capabilities.servers.requestableDiscovery` **and** the caller is not an ADMIN (admins
  already see every server).
* The discovery summary is the pre-approval interface: `GET /api/servers/:id` is never fetched for a
  server the user has no approved access to.
* A user can submit a request and see their own request state. Admins see pending requests and can
  approve, reject or revoke.

### 4.5 Administration `[IMPLEMENTED]`

ADMIN-only surfaces: user list with status/role filters, status changes (approve, ban, unban), role
changes, temporary-password reset (the returned password is shown once and never cached), emergency
2FA removal, and MOD permission grants (global or per-server) with revocation.

### 4.6 Host metrics `[IMPLEMENTED]`

* ADMIN sockets only; the payload is display telemetry and is never used for authorization or
  lifecycle state.
* Connection is cookie-first (`withCredentials`, WebSocket transport only) with a bounded retry:
  exponential backoff from 1 s to 10 s with jitter and at most 6 attempts, after which the surface
  reports `unavailable` and exposes an explicit reconnect action. No bearer token or ticket is sent.
* The socket is opened only when the backend advertises protocol 1, partitioned cookies, and
  `capabilities.realtime.websocketTicket === false`; there is deliberately no HTTP fallback.
* Metrics are scoped to the authenticated profile and panel, so switching user or panel cannot show
  another identity's data.

### 4.7 First-admin setup `[IMPLEMENTED]`

When the backend reports `nextStep: 'register_admin'` the client offers the setup form. The one-time
`X-Setup-Token` is held in component memory only, never persisted, and is cleared after use. The
surface is available only on a protocol-1 panel that advertises partitioned cookies.

---

## 5. Cross-cutting invariants

### 5.1 Data and caching boundaries `[IMPLEMENTED]`

1. Every remote cache key is scoped by the immutable panel identity (record id + canonical origin);
   user-visible data also carries the authenticated profile id. Two identities can never read each
   other's cached rows through the same panel record.
2. The complete panel query scope is cancelled and removed on logout, terminal session failure, panel
   switch and unmount. The default garbage-collection window is never relied on as the security
   cleanup at an identity boundary.
3. Graph/registry metadata is the only persisted client state. No token, credential, profile, server
   data or capability response is written to `localStorage`, `sessionStorage`, IndexedDB, React Query
   persistence, the service-worker cache, a URL or logs.
4. HTTP behaviour: `credentials: 'include'` wherever cookie authentication is required,
   `cache: 'no-store'`, redirect refusal, and no referrer. The capability probe uses
   `credentials: 'omit'`.
5. Backend error bodies are never surfaced verbatim beyond the message the backend itself chose to
   send; the UI maps stable machine codes to copy.

### 5.2 Panel-identity isolation `[IMPLEMENTED]`

Navigating from `/panel/A/...` to `/panel/B/...` MUST tear down panel A's entire tree — session
controller, auth-local form state (including typed passwords, TOTP secrets, backup codes and admin
temporary passwords), panel-scoped queries and the WebSocket — before panel B renders anything. The
implementation keys the panel-scoped subtree by the immutable identity; this MUST be preserved.

### 5.3 Service worker boundary `[IMPLEMENTED]`

* The service worker precaches same-origin built application assets only (plus manifest, icons and
  self-hosted fonts).
* It MUST NOT define a runtime cache, offline mutation queue, background sync or WebSocket
  interception for backend, auth, admin or realtime traffic.
* `/api/**` and `/socket.io/**` are excluded from navigation fallback.
* Offline users can open the application shell and the saved-panel registry; every backend operation
  requires the network.
* Mutable HTML, manifest and service-worker files revalidate; hashed `/assets/*` are immutable.

### 5.4 Content security `[IMPLEMENTED]`

A strict CSP (`public/_headers`) allows same-origin assets and only Google Identity Services as a
remote script/frame source; `connect-src` permits `https:`/`wss:` so the browser can reach the
selected backends. QR enrolment renders locally to canvas. `frame-ancestors 'none'`,
`X-Frame-Options: DENY`, `nosniff`, `no-referrer` and a restrictive `Permissions-Policy` are set.

### 5.5 Cross-tab session advisory `[IMPLEMENTED]`

Server-wide session termination (sign-out-all, ban, forced recovery) is broadcast to other tabs of the
**same canonical origin** only. The channel name is origin-derived, messages contain no credentials or
profile data, and different origins can never clear each other.

---

## 6. Bounded polling contract `[IMPLEMENTED]`

Polling exists only to converge on a state the backend will resolve on its own. It is always bounded,
per-generation, and never persisted:

| Target | Interval | Maximum | Hard cap |
|--------|----------|---------|----------|
| Server `CREATING` / `STARTING` / `STOPPING` | 2 s | 30 polls | 60 s elapsed |
| Server `ERROR` | 10 s | 6 polls | 60 s elapsed |
| Own `PENDING` access request | 5 s | 12 polls | 60 s elapsed |

A generation is a returned status value; counters reset only when the status changes, and polling
stops when the status leaves the transitional set, the budget is exhausted, or the cap elapses. A
future feature MUST NOT introduce unbounded polling; it extends this contract or subscribes to a
backend event instead.

---

## 7. Capability negotiation contract

`GET /api/info` is the only supported compatibility mechanism. The client MUST branch on flags and
never on the panel version string.

| Flag | Client use |
|------|------------|
| `api.protocolVersion === 1` | Panel compatibility gate (§3.4) |
| `capabilities.auth.partitionedCookies` | Panel compatibility gate; realtime eligibility; setup availability |
| `capabilities.auth.googleOAuth` | Google sign-in button, together with a configured client ID |
| `capabilities.auth.pkceAuthorizationCode` | Parsed; currently always false and treated as unsupported |
| `capabilities.realtime.websocketTicket` | Realtime eligibility requires it to be false |
| `capabilities.servers.requestableDiscovery` | Requestable-server discovery surface |

Adding a feature that depends on new backend behaviour requires a new advertised flag on the backend
side; a client MUST degrade gracefully when a flag is absent.

---

## 8. Deployment contract `[IMPLEMENTED]`

* Hosted on Cloudflare Pages, connected to the `master` branch; output is the static Vite build.
* SPA fallback `/* /index.html 200`; there is no server runtime for the dashboard.
* The operator's backend MUST be configured with the exact frontend origin
  (`CORS_ORIGIN=https://app.minepanel.xyz` for the hosted deployment). Preview and development origins
  are different origins and are not supported by the backend's exact-origin CORS and CSRF checks.
* Google sign-in requires `VITE_GOOGLE_CLIENT_ID` at build time **and** `GOOGLE_CLIENT_ID` on the
  backend; either one missing hides Google sign-in.
* Same-origin deployment of backend and dashboard remains the broadest-compatibility option.
