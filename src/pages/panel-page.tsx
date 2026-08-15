import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { BackendClient, type PanelInfo } from '@/api/backend-client';
import { getProbeErrorMessage } from '@/api/errors';
import { useInstanceRegistry } from '@/instances/use-instance-registry';

type PanelInfoState =
  | { origin: string | null; status: 'idle' | 'loading' }
  | { origin: string; status: 'success'; info: PanelInfo }
  | { origin: string; status: 'error'; error: unknown };

export const PanelPage = (): React.JSX.Element => {
  const { instanceId } = useParams();
  const registry = useInstanceRegistry();
  const instanceQuery = useQuery({
    queryKey: ['instances', instanceId],
    queryFn: () => registry.get(instanceId ?? ''),
    enabled: Boolean(instanceId),
  });
  const instance = instanceQuery.data;
  const instanceOrigin = instance?.origin;
  const [infoState, setInfoState] = useState<PanelInfoState>({ origin: null, status: 'idle' });

  useEffect(() => {
    if (!instanceOrigin) {
      return;
    }

    const controller = new AbortController();
    const origin = instanceOrigin;
    setInfoState({ origin, status: 'loading' });

    void new BackendClient(origin).getInfo(controller.signal).then(
      (info) => {
        if (!controller.signal.aborted) {
          setInfoState({ origin, status: 'success', info });
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setInfoState({ origin, status: 'error', error });
        }
      },
    );

    return () => controller.abort();
  }, [instanceOrigin]);

  if (instanceQuery.isLoading) {
    return <p className="text-[#bdc9b7]">Loading panel…</p>;
  }

  if (!instance) {
    return (
      <section className="panel-surface max-w-xl p-7">
        <h1 className="text-xl font-bold text-[#f1f6ed]">Panel not found</h1>
        <p className="mt-3 leading-7 text-[#bdc9b7]">This saved panel is no longer available on this device.</p>
        <Link className="mt-5 inline-block text-[#69f45a]" to="/">
          Return to saved panels
        </Link>
      </section>
    );
  }

  const currentInfoState =
    infoState.origin === instance.origin ? infoState : { origin: instance.origin, status: 'loading' as const };
  const panelInfo = currentInfoState.status === 'success' ? currentInfoState.info : undefined;
  let connectionLabel = 'Checking public panel info';
  let connectionDetail = 'Connecting directly to the selected backend.';
  let connectionClass = 'bg-[#f5c451] shadow-[0_0_12px_rgba(245,196,81,0.65)]';

  if (currentInfoState.status === 'success') {
    connectionLabel = 'Public endpoint reachable';
    connectionDetail = 'The public /api/info endpoint responded. Backend health is not assessed by this shell.';
    connectionClass = 'bg-[#69f45a] shadow-[0_0_12px_rgba(105,244,90,0.65)]';
  }

  if (currentInfoState.status === 'error') {
    connectionLabel = 'Panel unavailable';
    connectionDetail = getProbeErrorMessage(currentInfoState.error);
    connectionClass = 'bg-[#e17878] shadow-[0_0_12px_rgba(225,120,120,0.65)]';
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[1.55fr_1fr]">
      <div className="panel-surface p-6 sm:p-8">
        <p className="pixel-title text-xs text-[#69f45a]">[ Selected backend ]</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-[#f1f6ed]">
          {panelInfo?.name || instance.label || 'MinePanel'}
        </h1>
        <p className="mt-2 break-all font-mono text-sm text-[#aab7a3]">{instance.origin}</p>

        <div className="mt-8 grid gap-4 border-t border-[#354332] pt-6 sm:grid-cols-2">
          <div>
            <p className="pixel-title text-xs text-[#aab7a3]">Version</p>
            <p className="mt-2 text-lg font-bold text-[#f1f6ed]">{panelInfo?.version || 'Unknown'}</p>
          </div>
          <div>
            <p className="pixel-title text-xs text-[#aab7a3]">Capabilities</p>
            <p className="mt-2 text-lg font-bold text-[#f1f6ed]">Unknown</p>
          </div>
        </div>

        <div className="mt-8 border-l-4 border-[#f5c451] bg-[#302a19] px-5 py-4 text-sm leading-6 text-[#f6e5a8]">
          Hosted authentication is not implemented. MinePanel decision D-1 must be resolved in the backend
          before this hosted dashboard can manage servers or connect to authenticated real-time features.
        </div>
      </div>

      <aside className="panel-surface h-fit p-6">
        <p className="pixel-title text-xs text-[#69f45a]">[ Connection ]</p>
        <div className="mt-5 flex gap-3">
          <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${connectionClass}`} aria-hidden="true" />
          <div>
            <p className="font-bold text-[#f1f6ed]">{connectionLabel}</p>
            <p className="mt-2 text-sm leading-6 text-[#bdc9b7]">{connectionDetail}</p>
          </div>
        </div>
        <p className="mt-7 border-t border-[#354332] pt-5 text-sm leading-6 text-[#aab7a3]">
          The MinePanel interface is available offline, but this panel cannot be reached while offline.
        </p>
      </aside>
    </section>
  );
};
