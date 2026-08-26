import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, matchPath, Outlet, useLocation } from 'react-router';
import { getProbeErrorMessage } from '@/api/errors';
import { usePanelSession } from '@/auth/panel-session-context';
import { PasswordChangePage } from '@/pages/panel/password-change-page';
import { SignInPage } from '@/pages/panel/sign-in-page';
import { TwoFactorPage } from '@/pages/panel/two-factor-page';
import { Alert } from './ui/alert';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';

type PanelShellProps = { children?: ReactNode; panelLabel?: string };

type NavigationProps = { admin: boolean; onNavigate?: () => void };

const Navigation = ({ admin, onNavigate }: NavigationProps): React.JSX.Element => (
  <nav aria-label="Panel navigation" className="grid gap-2">
    <Link className="min-h-11 px-3 py-3 text-ink hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent" to="." onClick={onNavigate}>Overview</Link>
    <Link className="min-h-11 px-3 py-3 text-ink hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent" to="servers" onClick={onNavigate}>Servers</Link>
    <Link className="min-h-11 px-3 py-3 text-ink hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent" to="account" onClick={onNavigate}>Account</Link>
    {admin ? <Link className="min-h-11 px-3 py-3 text-ink hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent" to="administration" onClick={onNavigate}>Administration</Link> : null}
  </nav>
);

const BlockedScreen = ({ title, children, onReturn }: { title: string; children: ReactNode; onReturn: () => void }): React.JSX.Element => (
  <section className="mx-auto grid w-full max-w-md gap-5 panel-surface p-6"><h1 className="pixel-title">{title}</h1><div className="text-sm leading-6 text-ink-muted">{children}</div><Button onClick={onReturn}>Return to sign in</Button></section>
);

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
    const incompatible = state.reason === 'incompatible';
    const expired = state.reason === 'expired';
    return <main className="p-4 sm:p-8"><section className="mx-auto grid w-full max-w-md gap-5 panel-surface p-6"><h1 className="pixel-title">{incompatible ? 'Panel compatibility issue' : expired ? 'Session expired' : 'Panel unavailable'}</h1><Alert kind={incompatible ? 'warning' : 'error'}>{incompatible ? 'This panel or browser cannot safely use MinePanel hosted-cookie authentication. Check protocol, CHIPS, Web Locks, and exact panel origin configuration.' : expired ? 'Your browser session is no longer valid. Sign in again.' : getProbeErrorMessage(infoError)}</Alert><Button onClick={retryRestore}>{expired ? 'Try sign in again' : 'Retry connection'}</Button></section></main>;
  }

  const admin = state.profile.role === 'ADMIN';
  const label = panelLabel ?? panel?.id ?? 'Selected panel';
  return (
    <div className="min-h-screen bg-bg text-ink md:grid md:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="hidden min-h-screen border-r border-line bg-surface p-4 md:flex md:flex-col md:gap-6"><div className="flex items-center gap-3"><img src="/icons/icon-512.png" alt="MinePanel" className="size-9" /><div className="min-w-0"><p className="font-bold text-ink">MinePanel</p><p className="truncate text-xs text-ink-muted">{label}</p></div></div><p className="break-all text-xs text-ink-faint">{panel?.origin}</p><Navigation admin={admin} /><div className="mt-auto grid gap-3 border-t border-line pt-4"><div><p className="font-bold text-ink">{state.profile.username}</p><p className="text-sm text-ink-muted">{state.profile.role}</p></div><Button variant="secondary" onClick={() => void signOut()}>Sign out</Button><Link className="min-h-11 px-3 py-3 text-center text-sm text-ink-muted hover:text-ink focus:outline-none focus:ring-2 focus:ring-accent" to="/">Back to panels</Link></div></aside>
      <div className="min-w-0 pb-20 md:pb-0"><header className="flex min-h-16 items-center justify-between border-b border-line bg-surface px-4 md:hidden"><div className="flex min-w-0 items-center gap-2"><img src="/icons/icon-512.png" alt="MinePanel" className="size-8" /><span className="truncate font-bold">{label}</span></div><Button variant="secondary" onClick={() => setDrawerOpen(true)} aria-expanded={drawerOpen} aria-controls="panel-mobile-navigation">Menu</Button></header>{drawerOpen ? <div className="fixed inset-0 z-50 overflow-y-auto bg-bg/95 p-5 md:hidden" id="panel-mobile-navigation" role="dialog" aria-modal="true" aria-label="Panel navigation" onKeyDown={(event) => { if (event.key === 'Escape') setDrawerOpen(false); }}><div className="flex items-center justify-between"><p className="font-bold">{label}</p><Button variant="secondary" ref={drawerFocusRef} onClick={() => setDrawerOpen(false)}>Close menu</Button></div><p className="mt-2 break-all text-xs text-ink-faint">{panel?.origin}</p><div className="mt-6"><Navigation admin={admin} onNavigate={() => setDrawerOpen(false)} /></div><div className="mt-8 grid gap-3"><p className="text-sm text-ink-muted">{state.profile.username} · {state.profile.role}</p><Button variant="secondary" onClick={() => void signOut()}>Sign out</Button><Link to="/" className="min-h-11 px-3 py-3 text-center text-ink-muted" onClick={() => setDrawerOpen(false)}>Back to panels</Link></div></div> : null}<main className="min-w-0 p-4 sm:p-6 lg:p-8">{content}</main><nav className="fixed inset-x-0 bottom-0 z-40 flex min-h-16 justify-around border-t border-line bg-surface md:hidden" aria-label="Quick panel navigation"><Link className="min-h-11 px-3 py-4 text-sm text-ink" to=".">Overview</Link><Link className="min-h-11 px-3 py-4 text-sm text-ink" to="servers">Servers</Link><Link className="min-h-11 px-3 py-4 text-sm text-ink" to="account">Account</Link></nav></div>
    </div>
  );
};

