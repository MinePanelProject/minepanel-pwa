import { Button } from '@/components/ui/button';
import { usePanelSession } from '@/auth/panel-session-context';
import { useSystemStats } from '@/realtime/system-stats';

const formatStorage = (valueMb: number): string => {
  if (valueMb >= 1024) {
    return `${(valueMb / 1024).toFixed(1)} GiB`;
  }

  return `${Math.round(valueMb)} MiB`;
};

const connectionCopy = {
  idle: 'Metrics inactive',
  connecting: 'Connecting to live metrics',
  connected: 'Live metrics connected',
  unavailable: 'Live metrics unavailable',
} as const;

const connectionClass = {
  idle: 'status-dot status-dot--neutral',
  connecting: 'status-dot status-dot--warning',
  connected: 'status-dot',
  unavailable: 'status-dot status-dot--danger',
} as const;

/** Admin telemetry only. Socket values are intentionally display-only. */
export const SystemMetricsPanel = (): React.JSX.Element | null => {
  const session = usePanelSession();
  const metrics = useSystemStats();
  const isAdmin = session.state.kind === 'authenticated' && session.state.profile.role === 'ADMIN';

  if (!isAdmin) {
    return null;
  }

  return (
    <section className="panel-surface grid gap-5 p-5" aria-labelledby="system-metrics-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="pixel-title text-accent">[ System telemetry ]</p>
          <h2 className="mt-2 text-xl font-bold text-ink" id="system-metrics-heading">
            Host metrics
          </h2>
          <p className="mt-1 text-sm leading-6 text-ink-muted">Display telemetry only; it does not authorize actions.</p>
        </div>
        <p className="flex items-center gap-2 text-sm font-bold text-ink" aria-live="polite">
          <span className={connectionClass[metrics.connection]} aria-hidden="true" />
          {connectionCopy[metrics.connection]}
        </p>
      </div>

      {metrics.stats ? (
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-live="polite">
          <Metric label="Total RAM" value={formatStorage(metrics.stats.totalRamMb)} />
          <Metric label="Used RAM" value={formatStorage(metrics.stats.usedRamMb)} />
          <Metric label="Free disk" value={formatStorage(metrics.stats.freeDiskMb)} />
          <Metric label="CPU count" value={String(metrics.stats.cpuCount)} />
        </dl>
      ) : (
        <p className="border border-line bg-bg p-4 text-sm text-ink-muted" aria-live="polite">
          No live metrics are available yet.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-muted">
        <p>
          Last updated:{' '}
          {metrics.lastUpdatedAt > 0 ? (
            <time dateTime={new Date(metrics.lastUpdatedAt).toISOString()}>
              {new Date(metrics.lastUpdatedAt).toLocaleTimeString()}
            </time>
          ) : (
            'Not received'
          )}
        </p>
        {metrics.connection === 'unavailable' ? (
          <Button variant="secondary" onClick={metrics.reconnect}>
            Reconnect metrics
          </Button>
        ) : null}
      </div>
    </section>
  );
};

const Metric = ({ label, value }: { label: string; value: string }): React.JSX.Element => (
  <div className="border border-line bg-bg p-3">
    <dt className="pixel-title text-ink-muted">{label}</dt>
    <dd className="mt-2 text-lg font-bold text-ink">{value}</dd>
  </div>
);
