import { Link, Outlet } from 'react-router';

/** Registry-level frame for the hosted dashboard home and add-panel routes. */
export const AppFrame = (): React.JSX.Element => (
  <div className="min-h-screen">
    <header className="registry-header border-b-4 border-line bg-bg">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-5 py-4 sm:px-8">
        <Link className="flex items-center gap-3 no-underline" to="/" aria-label="MinePanel home">
          <img src="/icons/icon-512.png" alt="MinePanel" className="size-10" />
          <span>
            <span className="brand-wordmark block text-sm">
              <span className="text-accent">Mine</span><span className="text-warning">Panel</span>
            </span>
            <span className="block text-base text-ink-muted">Hosted dashboard</span>
          </span>
        </Link>
        <Link className="mp-button mp-button-primary inline-flex items-center px-4 py-2 no-underline" to="/add">
          Add panel
        </Link>
      </div>
    </header>
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <Outlet />
    </main>
  </div>
);