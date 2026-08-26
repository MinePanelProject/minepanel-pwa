import { Link, Outlet } from 'react-router';

/** Registry-level frame for the hosted dashboard home and add-panel routes. */
export const AppFrame = (): React.JSX.Element => (
  <div className="min-h-screen">
    <header className="border-b-4 border-line bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-5 py-4 sm:px-8">
        <Link className="flex items-center gap-3 no-underline" to="/" aria-label="MinePanel home">
          <img src="/icons/icon-512.png" alt="MinePanel" className="size-9" />
          <span>
            <span className="pixel-title block text-sm text-ink">MinePanel</span>
            <span className="block text-xs text-ink-muted">Hosted dashboard</span>
          </span>
        </Link>
        <Link
          className="border-2 border-accent bg-accent-strong px-3 py-2 text-sm font-bold text-accent-ink no-underline transition hover:bg-accent"
          to="/add"
        >
          Add panel
        </Link>
      </div>
    </header>
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <Outlet />
    </main>
  </div>
);