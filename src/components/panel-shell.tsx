import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, matchPath, NavLink, Outlet, useLocation } from 'react-router';
import { getProbeErrorMessage } from '@/api/errors';
import { usePanelSession, type SessionProblem } from '@/auth/panel-session-context';
import { PasswordChangePage } from '@/pages/panel/password-change-page';
import { SignInPage } from '@/pages/panel/sign-in-page';
import { TwoFactorPage } from '@/pages/panel/two-factor-page';
import { Alert } from './ui/alert';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';

type PanelShellProps = { children?: ReactNode; panelLabel?: string };

type NavigationProps = { admin: boolean; onNavigate?: () => void };

const Navigation = ({ admin, onNavigate }: NavigationProps): React.JSX.Element => (
  <nav aria-label="Panel navigation" className="panel-navigation grid gap-2">
    <NavItem to="." onNavigate={onNavigate}>Overview</NavItem>
    <NavItem to="servers" onNavigate={onNavigate}>Servers</NavItem>
    <NavItem to="account" onNavigate={onNavigate}>Account</NavItem>
    {admin ? <NavItem to="administration" onNavigate={onNavigate}>Administration</NavItem> : null}
  </nav>
);

const NavItem = ({ to, onNavigate, children }: { to: string; onNavigate?: () => void; children: ReactNode }): React.JSX.Element => (
  <NavLink
    end={to === '.'}
    className={({ isActive }) => `panel-nav-item min-h-11 px-3 py-3 ${isActive ? 'is-active' : ''}`}
    to={to}
    onClick={onNavigate}
  >
    {children}
  </NavLink>
);

const BlockedScreen = ({ title, children, onReturn }: { title: string; children: ReactNode; onReturn: () => void }): React.JSX.Element => (
  <section className="mx-auto grid w-full max-w-md gap-5 panel-surface p-6" aria-labelledby="blocked-screen-title">
    <h1 id="blocked-screen-title" className="page-title">{title}</h1>
    <div className="text-sm leading-6 text-ink-muted">{children}</div>
    <Button onClick={onReturn}>Return to sign in</Button>
  </section>
);

const CompatibilityScreen = ({
  problem,
  onRetry,
}: {
  problem: Extract<SessionProblem, { kind: 'incompatible' }>;
  onRetry: () => void;
}): React.JSX.Element => {
  const copy = problem.subject === 'browser' && problem.reason === 'insecure-context'
    ? 'MinePanel hosted authentication requires a secure HTTPS browser context.'
    : problem.subject === 'browser'
      ? 'This browser does not provide the cross-tab locking MinePanel uses to keep session refreshes safe.'
      : problem.reason === 'unsupported-protocol'
        ? 'This panel reports a MinePanel protocol version that this dashboard does not support. Update the panel to a compatible backend version.'
        : 'This panel does not advertise the partitioned-cookie hosted authentication capability required by the hosted dashboard. Update or verify the backend deployment.';

  return (
    <main className="p-4 sm:p-8">
      <section className="mx-auto grid w-full max-w-md gap-5 panel-surface p-6" aria-labelledby="compatibility-screen-title">
        <h1 id="compatibility-screen-title" className="page-title">{problem.subject === 'browser' ? 'Browser not supported' : 'Panel not compatible'}</h1>
        <Alert kind="warning">{copy}</Alert>
        <div className="flex flex-wrap gap-3">
          <Link className="mp-button mp-button-secondary inline-flex items-center px-4 py-2 no-underline" to="/compatibility">Learn more</Link>
          <Button variant="secondary" onClick={onRetry}>Retry</Button>
          <Link className="mp-button mp-button-secondary inline-flex items-center px-4 py-2 no-underline" to="/">Back to panels</Link>
        </div>
      </section>
    </main>
  );
};

export const PanelShell = ({ children, panelLabel }: PanelShellProps): React.JSX.Element => {
  const { panel, state, signOut, retryRestore, infoError } = usePanelSession();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerFocusRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();

  useEffect(() => {
    if (drawerOpen) {
      drawerFocusRef.current?.focus();
    }
  }, [drawerOpen]);
  const isSetupRoute = matchPath({ path: '/panel/:instanceId/setup' }, location.pathname) !== null;
  const content = children ?? <Outlet />;

  if (state.kind === 'loading') return <main className="grid min-h-64 place-items-center"><span className="flex items-center gap-3 text-ink-muted"><Spinner />Restoring panel session</span></main>;
  if (state.kind === 'anonymous') return <main className="p-4 sm:p-8">{isSetupRoute ? <Outlet /> : <SignInPage />}</main>;
  if (state.kind === 'two-factor-pending') return <main className="p-4 sm:p-8"><TwoFactorPage /></main>;
  if (state.kind === 'password-change-required') return <main className="p-4 sm:p-8"><PasswordChangePage /></main>;
  if (state.kind === 'account-pending') return <main className="p-4 sm:p-8"><BlockedScreen title="Approval required" onReturn={() => void signOut()}>Your account is awaiting administrator approval. Return to sign in after an administrator approves it.</BlockedScreen></main>;
  if (state.kind === 'account-banned') return <main className="p-4 sm:p-8"><BlockedScreen title="Account unavailable" onReturn={() => void signOut()}>This account cannot access the panel. Contact the panel administrator if you need help.</BlockedScreen></main>;
  if (state.kind === 'error') {
    if (state.problem.kind === 'incompatible') {
      return <CompatibilityScreen problem={state.problem} onRetry={retryRestore} />;
    }
    const expired = state.problem.kind === 'expired';
    const message = state.problem.kind === 'offline'
      ? getProbeErrorMessage(infoError)
      : expired
        ? 'Your browser session is no longer valid. Sign in again.'
        : state.problem.kind === 'hosted-origin-forbidden'
          ? 'This panel rejected the hosted dashboard origin. Verify its public HTTPS and CORS configuration.'
          : 'This saved panel did not return a compatible MinePanel response.';
    return <main className="p-4 sm:p-8"><section className="mx-auto grid w-full max-w-md gap-5 panel-surface p-6"><h1 className="page-title">{expired ? 'Session expired' : 'Panel unavailable'}</h1><Alert kind="error">{message}</Alert><Button onClick={retryRestore}>{expired ? 'Try sign in again' : 'Retry connection'}</Button></section></main>;
  }

  const admin = state.profile.role === 'ADMIN';
  const label = panelLabel?.trim() || (panel ? new URL(panel.origin).hostname : 'Selected panel');
  return (
    <div className="panel-app min-h-screen bg-bg text-ink md:grid md:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="panel-sidebar hidden min-h-screen border-r border-line bg-bg p-4 md:flex md:flex-col md:gap-6">
        <div className="flex items-center gap-3">
          <img src="/icons/icon-512.png" alt="MinePanel" className="size-10" />
          <div className="min-w-0">
            <p className="brand-wordmark font-pixel text-sm"><span className="text-accent">Mine</span><span className="text-warning">Panel</span></p>
            <p className="panel-label truncate text-base text-ink-muted">{label}</p>
          </div>
        </div>
        <p className="panel-origin break-all text-sm text-ink-faint">{panel?.origin}</p>
        <Navigation admin={admin} />
        <div className="mt-auto grid gap-3 border-t border-line pt-4">
          <div><p className="font-bold text-ink">{state.profile.username}</p><p className="text-base text-ink-muted">{state.profile.role}</p></div>
          <Button variant="secondary" onClick={() => void signOut()}>Sign out</Button>
          <Link className="panel-secondary-link min-h-11 px-3 py-3 text-center text-ink-muted" to="/">Back to panels</Link>
        </div>
      </aside>
      <div className="min-w-0 pb-20 md:pb-0">
        <header className="panel-mobile-header flex min-h-16 items-center justify-between border-b-3 border-line bg-bg px-4 md:hidden">
          <div className="flex min-w-0 items-center gap-2"><img src="/icons/icon-512.png" alt="MinePanel" className="size-8" /><span className="truncate font-bold">{label}</span></div>
          <Button variant="secondary" onClick={() => setDrawerOpen(true)} aria-expanded={drawerOpen} aria-controls="panel-mobile-navigation">Menu</Button>
        </header>
        {drawerOpen ? <div className="panel-mobile-drawer fixed inset-0 z-50 overflow-y-auto bg-bg p-5 md:hidden" id="panel-mobile-navigation" role="dialog" aria-modal="true" aria-label="Panel navigation" onKeyDown={(event) => { if (event.key === 'Escape') setDrawerOpen(false); }}>
          <div className="flex items-center justify-between"><p className="brand-wordmark font-pixel text-sm"><span className="text-accent">Mine</span><span className="text-warning">Panel</span></p><Button variant="secondary" ref={drawerFocusRef} onClick={() => setDrawerOpen(false)}>Close menu</Button></div>
          <p className="mt-2 break-all text-sm text-ink-faint">{panel?.origin}</p>
          <div className="mt-6"><Navigation admin={admin} onNavigate={() => setDrawerOpen(false)} /></div>
          <div className="mt-8 grid gap-3"><p className="text-base text-ink-muted">{state.profile.username} · {state.profile.role}</p><Button variant="secondary" onClick={() => void signOut()}>Sign out</Button><Link to="/" className="panel-secondary-link min-h-11 px-3 py-3 text-center text-ink-muted" onClick={() => setDrawerOpen(false)}>Back to panels</Link></div>
        </div> : null}
        <main className="min-w-0 p-4 sm:p-6 lg:p-8">{content}</main>
        <nav className="panel-bottom-nav fixed inset-x-0 bottom-0 z-40 flex min-h-16 justify-around border-t-3 border-line bg-bg pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Quick panel navigation">
          <NavLink end className={({ isActive }) => `panel-bottom-link min-h-11 px-3 py-4 ${isActive ? 'is-active' : ''}`} to=".">Overview</NavLink>
          <NavLink className={({ isActive }) => `panel-bottom-link min-h-11 px-3 py-4 ${isActive ? 'is-active' : ''}`} to="servers">Servers</NavLink>
          <NavLink className={({ isActive }) => `panel-bottom-link min-h-11 px-3 py-4 ${isActive ? 'is-active' : ''}`} to="account">Account</NavLink>
        </nav>
      </div>
    </div>
  );
};

