import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { BackendClient } from '@/api/backend-client';
import { PanelSessionProvider } from '@/auth/panel-session-provider';
import { useInstanceRegistry } from '@/instances/use-instance-registry';
import { PanelShell } from './panel-shell';
import { Spinner } from './ui/spinner';

/**
 * Loads the saved panel record for :instanceId, constructs the panel-scoped
 * BackendClient, and wraps every nested route in the session provider so one
 * panel identity owns all session state and query data.
 */
export const PanelRoute = (): React.JSX.Element => {
  const { instanceId } = useParams();
  const registry = useInstanceRegistry();
  const instanceQuery = useQuery({
    queryKey: ['instances', instanceId],
    queryFn: () => registry.get(instanceId ?? ''),
    enabled: Boolean(instanceId),
  });
  const instance = instanceQuery.data;
  const origin = instance?.origin;
  const client = useMemo(() => (origin ? new BackendClient(origin) : null), [origin]);

  if (instanceQuery.isLoading) {
    return (
      <main className="grid min-h-64 place-items-center">
        <span className="flex items-center gap-3 text-ink-muted">
          <Spinner />Loading panel…
        </span>
      </main>
    );
  }

  if (!instance) {
    return (
      <main className="p-4 sm:p-8">
        <section className="panel-surface mx-auto max-w-xl p-7">
          <h1 className="text-xl font-bold text-ink">Panel not found</h1>
          <p className="mt-3 leading-7 text-ink-muted">
            This saved panel is no longer available on this device.
          </p>
          <Link className="mt-5 inline-block text-accent" to="/">
            Return to saved panels
          </Link>
        </section>
      </main>
    );
  }

  const identity = { id: instance.id, origin: instance.origin };

  // Hard remount contract (external-review Finding 2): React Router reuses the
  // same route component when /panel/A/<route> navigates to /panel/B/<route>,
  // so the provider + nested page subtrees MUST be keyed by the immutable
  // panel identity (saved id + canonical origin). A key change tears down the
  // entire panel-scoped tree — provider state, SessionController, auth-local
  // state (login/2FA/setup forms, Google credential refs), page-local state
  // (passwords, TOTP secrets, backup codes, admin temp passwords), queries and
  // the WebSocket — before Panel B renders anything.
  return (
    <PanelSessionProvider
      key={`${identity.id}:${identity.origin}`}
      panel={identity}
      client={client}
    >
      <PanelShell panelLabel={instance.label} />
    </PanelSessionProvider>
  );
};