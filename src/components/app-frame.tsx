import { Link, Outlet } from 'react-router';

export const AppFrame = (): React.JSX.Element => (
  <div className="min-h-screen">
    <header className="border-b-4 border-[#314d28] bg-[#1d241c]">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-5 py-4 sm:px-8">
        <Link className="flex items-center gap-3 no-underline" to="/" aria-label="MinePanel home">
          <span className="grid size-9 place-items-center border-2 border-[#7fc95b] bg-[#10130f] text-[#69f45a]">M</span>
          <span>
            <span className="pixel-title block text-sm text-[#f1f6ed]">MinePanel</span>
            <span className="block text-xs text-[#aab7a3]">Hosted dashboard</span>
          </span>
        </Link>
        <Link
          className="border-2 border-[#7fc95b] bg-[#5d9e3e] px-3 py-2 text-sm font-bold text-[#071006] no-underline transition hover:bg-[#69f45a]"
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
