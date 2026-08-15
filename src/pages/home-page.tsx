import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { useInstanceRegistry } from '@/instances/use-instance-registry';

export const HomePage = (): React.JSX.Element => {
  const registry = useInstanceRegistry();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: instances = [], isLoading } = useQuery({
    queryKey: ['instances'],
    queryFn: () => registry.list(),
  });

  const removeInstance = async (id: string): Promise<void> => {
    await registry.remove(id);
    await queryClient.invalidateQueries({ queryKey: ['instances'] });
  };

  const openInstance = async (id: string): Promise<void> => {
    await registry.markUsed(id);
    await queryClient.invalidateQueries({ queryKey: ['instances'] });
    await navigate(`/panel/${id}`);
  };

  return (
    <section className="grid gap-8 lg:grid-cols-[1.1fr_1.9fr]">
      <div className="panel-surface self-start p-6 sm:p-8">
        <p className="pixel-title text-xs text-[#69f45a]">[ Direct connection ]</p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-[#f1f6ed] sm:text-4xl">
          Your panels. Your infrastructure.
        </h1>
        <p className="mt-4 leading-7 text-[#bdc9b7]">
          MinePanel connects your browser directly to each self-hosted backend. Connection metadata
          stays on this device; this hosted app does not relay panel traffic.
        </p>
        <Link
          className="mt-7 inline-flex border-2 border-[#7fc95b] bg-[#5d9e3e] px-4 py-3 font-bold text-[#071006] no-underline transition hover:bg-[#69f45a]"
          to="/add"
        >
          Add a MinePanel backend
        </Link>
      </div>

      <div>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="pixel-title text-xs text-[#69f45a]">[ Saved panels ]</p>
            <h2 className="mt-2 text-xl font-bold text-[#f1f6ed]">Choose a backend</h2>
          </div>
          {!isLoading && <span className="text-sm text-[#aab7a3]">{instances.length} saved</span>}
        </div>

        {isLoading ? (
          <div className="panel-surface p-6 text-[#bdc9b7]">Loading saved panels…</div>
        ) : instances.length === 0 ? (
          <div className="panel-surface p-8 text-center">
            <h3 className="text-lg font-bold text-[#f1f6ed]">No panels configured</h3>
            <p className="mx-auto mt-3 max-w-md leading-7 text-[#bdc9b7]">
              Add the public HTTPS origin for a self-hosted MinePanel backend to begin discovery.
            </p>
          </div>
        ) : (
          <ul className="grid gap-3" aria-label="Saved MinePanel backends">
            {instances.map((instance) => (
              <li className="panel-surface flex flex-col gap-4 p-5 sm:flex-row sm:items-center" key={instance.id}>
                <button
                  className="min-w-0 flex-1 cursor-pointer bg-transparent text-left"
                  type="button"
                  onClick={() => void openInstance(instance.id)}
                >
                  <span className="block truncate font-bold text-[#f1f6ed]">
                    {instance.label || instance.origin}
                  </span>
                  <span className="mt-1 block truncate font-mono text-sm text-[#aab7a3]">
                    {instance.origin}
                  </span>
                </button>
                <button
                  className="cursor-pointer self-start border border-[#53604e] px-3 py-2 text-sm text-[#bdc9b7] hover:border-[#e17878] hover:text-[#ffb1b1]"
                  type="button"
                  onClick={() => void removeInstance(instance.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};
