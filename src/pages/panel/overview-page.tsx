import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { getProbeErrorMessage } from '@/api/errors';
import { panelKeys } from '@/api/query-keys';
import { usePanelSession } from '@/auth/panel-session-context';
import type { ShellSession } from '@/auth/panel-session-context';
import { Alert } from '@/components/ui/alert';
import { SystemMetricsPanel } from '@/components/system-metrics-panel';

export const OverviewPage = (): React.JSX.Element => {
  const session = usePanelSession();
  const panel = session.panel;
  const client = session.client;
  const infoQuery = useQuery({
    queryKey: panel ? panelKeys.info(panel) : ['panel-info', 'unavailable'],
    queryFn: () => {
      if (!client) {
        throw new Error('A selected panel is required to load its public information.');
      }

      return client.getInfo();
    },
    enabled: panel !== null && client !== null,
    initialData: session.info ?? undefined,
    staleTime: 5 * 60 * 1_000,
    gcTime: 30 * 60 * 1_000,
    retry: false,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const info = infoQuery.data ?? session.info;
  const admin = session.state.kind === 'authenticated' && session.state.profile.role === 'ADMIN';

  if (!panel) {
    return (
      <Alert kind="warning" title="No panel selected">
        Select a panel before viewing its overview.
      </Alert>
    );
  }

  const connection = connectionPresentation(session.state.kind, Boolean(info), infoQuery.isFetching);
  const infoError = infoQuery.error ?? session.infoError;

  return (
    <div className="grid gap-6">
      <section className="panel-surface grid gap-5 p-5 sm:p-6" aria-labelledby="panel-overview-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="pixel-label text-accent">[ Selected panel ]</p>
            <h1 className="page-title mt-3 text-2xl font-bold text-ink" id="panel-overview-heading">
              {info?.name ?? panel.origin}
            </h1>
            <p className="mt-2 break-all font-mono text-sm text-ink-muted">{panel.origin}</p>
          </div>
          <p className="flex items-center gap-2 text-sm font-bold text-ink" aria-live="polite">
            <span className={connection.className} aria-hidden="true" />
            {connection.label}
          </p>
        </div>

        {infoError ? (
          <Alert kind="warning" title="Panel information unavailable">
            {getProbeErrorMessage(infoError)}
          </Alert>
        ) : null}

        {info ? (
          <dl className="grid gap-3 border-t border-line pt-5 sm:grid-cols-2 lg:grid-cols-3">
            <OverviewFact label="Version" value={info.version} />
            <OverviewFact label="API protocol" value={`Protocol ${info.api.protocolVersion}`} />
            <OverviewFact
              label="Hosted cookies"
              value={info.capabilities.auth.partitionedCookies ? 'Available' : 'Unavailable'}
            />
          </dl>
        ) : (
          <p className="text-sm text-ink-muted">Loading public panel information…</p>
        )}
      </section>

      <section className="grid gap-4" aria-labelledby="panel-sections-heading">
        <div>
          <p className="pixel-label text-accent">[ Navigate ]</p>
          <h2 className="section-title mt-2 text-xl font-bold text-ink" id="panel-sections-heading">
            Panel sections
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SectionLink to={`/panel/${panel.id}/servers`} title="Servers" detail="View and manage servers you can access." />
          <SectionLink to={`/panel/${panel.id}/account`} title="Account" detail="Profile, security, and browser sessions." />
          {admin ? (
            <SectionLink
              to={`/panel/${panel.id}/admin/users`}
              title="Administration"
              detail="Manage users and MOD permissions."
            />
          ) : null}
        </div>
      </section>

      {admin ? <SystemMetricsPanel /> : null}
    </div>
  );
};

const connectionPresentation = (
  sessionKind: ShellSession['kind'],
  hasInfo: boolean,
  isFetching: boolean,
): { label: string; className: string } => {
  if (sessionKind === 'error') {
    return { label: 'Panel connection needs attention', className: 'status-dot status-dot--danger' };
  }
  if (hasInfo && !isFetching) {
    return { label: 'Panel connected', className: 'status-dot' };
  }
  return { label: 'Checking panel connection', className: 'status-dot status-dot--warning' };
};

const OverviewFact = ({ label, value }: { label: string; value: string }): React.JSX.Element => (
  <div className="border border-line bg-bg p-3">
    <dt className="pixel-label text-ink-muted">{label}</dt>
    <dd className="mt-2 font-bold text-ink">{value}</dd>
  </div>
);

const SectionLink = ({ to, title, detail }: { to: string; title: string; detail: string }): React.JSX.Element => (
  <Link className="overview-section-link panel-surface-raised block p-4 transition hover:border-accent" to={to}>
    <h3 className="font-bold text-ink">{title}</h3>
    <p className="mt-2 leading-6 text-ink-muted">{detail}</p>
  </Link>
);
