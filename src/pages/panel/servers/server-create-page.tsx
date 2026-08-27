import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { BackendApiError, getApiErrorMessage } from '@/api/errors';
import { panelKeys } from '@/api/query-keys';
import {
  ACCESS_TYPES,
  DIFFICULTIES,
  GAMEMODES,
  SERVER_PROVIDERS,
  type AccessType,
  type CreateServerInput,
  type Difficulty,
  type Gamemode,
  type ServerProvider,
} from '@/api/types';
import { usePanelSession } from '@/auth/panel-session-context';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

const resourceFeedback = (error: unknown): string => {
  if (!(error instanceof BackendApiError) || error.status !== 422 || error.code !== 'InsufficientResources') {
    return getApiErrorMessage(error);
  }
  if (error.details !== null && typeof error.details === 'object') {
    const details = error.details as { available?: unknown; required?: unknown; resource?: unknown };
    const available = typeof details.available === 'number' && Number.isFinite(details.available) ? details.available : null;
    const required = typeof details.required === 'number' && Number.isFinite(details.required) ? details.required : null;
    const resource = typeof details.resource === 'string' && /^[A-Za-z ]{1,32}$/.test(details.resource) ? details.resource : 'capacity';
    if (available !== null && required !== null) return `Insufficient ${resource}: ${available} available, ${required} required.`;
  }
  return 'Insufficient server resources are available for this configuration.';
};

export const ServerCreatePage = (): React.JSX.Element => {
  const { instanceId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { panel, client, state } = usePanelSession();
  const [feedback, setFeedback] = useState<string | null>(null);
  const authenticatedAdmin = state.kind === 'authenticated' && state.profile.role === 'ADMIN' && panel !== null && client !== null;
  const profile = state.kind === 'authenticated' ? state.profile : null;
  // Identity-generation guard: never re-create a removed panel query scope
  // when a mutation settles after logout or panel switch.
  const authenticatedRef = useRef(state.kind);
  authenticatedRef.current = state.kind;

  const createMutation = useMutation({
    mutationFn: async (input: CreateServerInput) => {
      if (!client) throw new Error('No panel client is available.');
      return client.createServer(input);
    },
    onSuccess: async (server) => {
      if (!panel || !profile || authenticatedRef.current !== 'authenticated') return;
      queryClient.setQueryData(panelKeys.server(panel, profile.id, server.id), server);
      await queryClient.invalidateQueries({ queryKey: panelKeys.userRoot(panel, profile.id) });
      navigate(`/panel/${instanceId ?? panel.id}/servers/${server.id}`);
    },
    onError: (error) => setFeedback(resourceFeedback(error)),
  });

  if (!authenticatedAdmin || !profile || !panel) return <Alert kind="error">Only administrators can create servers.</Alert>;

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const maxPlayersValue = values.get('maxPlayers');
    const motd = String(values.get('motd') ?? '').trim();
    const levelSeed = String(values.get('levelSeed') ?? '').trim();
    const input: CreateServerInput = {
      name: String(values.get('name') ?? '').trim(),
      provider: String(values.get('provider')) as ServerProvider,
      version: String(values.get('version') ?? '').trim(),
      port: Number(values.get('port')),
      difficulty: String(values.get('difficulty')) as Difficulty,
      gamemode: String(values.get('gamemode')) as Gamemode,
      pvp: values.get('pvp') === 'on',
      memoryLimitMb: Number(values.get('memoryLimitMb')),
      onlineMode: values.get('onlineMode') === 'on',
      viewDistance: Number(values.get('viewDistance')),
      allowFlight: values.get('allowFlight') === 'on',
      accessType: String(values.get('accessType')) as AccessType,
    };
    if (typeof maxPlayersValue === 'string' && maxPlayersValue !== '') input.maxPlayers = Number(maxPlayersValue);
    if (motd !== '') input.motd = motd;
    if (levelSeed !== '') input.levelSeed = levelSeed;
    setFeedback(null);
    createMutation.mutate(input);
  };

  const serverListPath = `/panel/${instanceId ?? panel.id}/servers`;
  return (
    <section aria-labelledby="create-server-heading" className="max-w-3xl">
      <Link className="text-sm font-bold text-accent" to={serverListPath}>← All servers</Link>
      <div className="panel-surface mt-5 p-5 sm:p-7">
        <p className="pixel-label text-xs text-accent">[ Administrator ]</p>
        <h1 className="page-title mt-3" id="create-server-heading">Create server</h1>
        <p className="mt-3 text-sm leading-6 text-ink-muted">The panel remains authoritative for every server constraint and resource check.</p>
        <form className="mt-7 grid gap-5 sm:grid-cols-2" onSubmit={submit}>
          <Field id="name" label="Server name" name="name" required minLength={1} maxLength={50} hint="1–50 characters." />
          <Field as="select" id="provider" label="Provider" name="provider" defaultValue="PAPER">{SERVER_PROVIDERS.map((provider) => <option key={provider} value={provider}>{provider}</option>)}</Field>
          <Field id="version" label="Version" name="version" required pattern="\d+\.\d+(\.\d+)?" placeholder="1.21.1" hint="Use major.minor or major.minor.patch." />
          <Field id="port" label="Port" name="port" type="number" required min={25565} max={25665} defaultValue={25565} hint="25565–25665." />
          <Field id="maxPlayers" label="Maximum players" name="maxPlayers" type="number" min={1} max={10000} hint="Optional; 1–10,000." />
          <Field id="memoryLimitMb" label="Memory limit (MB)" name="memoryLimitMb" type="number" required min={512} defaultValue={1024} hint="At least 512 MB." />
          <Field as="select" id="difficulty" label="Difficulty" name="difficulty" defaultValue="NORMAL">{DIFFICULTIES.map((difficulty) => <option key={difficulty} value={difficulty}>{difficulty}</option>)}</Field>
          <Field as="select" id="gamemode" label="Game mode" name="gamemode" defaultValue="SURVIVAL">{GAMEMODES.map((gamemode) => <option key={gamemode} value={gamemode}>{gamemode}</option>)}</Field>
          <Field id="motd" label="MOTD" name="motd" maxLength={59} hint="Optional; up to 59 characters." />
          <Field id="levelSeed" label="Level seed" name="levelSeed" maxLength={100} hint="Optional; up to 100 characters." />
          <Field id="viewDistance" label="View distance" name="viewDistance" type="number" required min={2} max={32} defaultValue={10} hint="2–32 chunks." />
          <Field as="select" id="accessType" label="Access type" name="accessType" defaultValue="OPEN">{ACCESS_TYPES.map((accessType) => <option key={accessType} value={accessType}>{accessType}</option>)}</Field>
          <label className="flex min-h-11 items-center gap-3 border-t border-line pt-4 text-sm font-bold text-ink"><input className="size-5 accent-accent" defaultChecked name="pvp" type="checkbox" /> Enable PVP</label>
          <label className="flex min-h-11 items-center gap-3 border-t border-line pt-4 text-sm font-bold text-ink"><input className="size-5 accent-accent" defaultChecked name="onlineMode" type="checkbox" /> Online mode</label>
          <label className="flex min-h-11 items-center gap-3 border-t border-line pt-4 text-sm font-bold text-ink"><input className="size-5 accent-accent" name="allowFlight" type="checkbox" /> Allow flight</label>
          <div className="sm:col-span-2"><Button loading={createMutation.isPending} type="submit">Create server</Button></div>
        </form>
        {feedback ? <Alert kind="error" title="Server not created"><span aria-live="assertive">{feedback}</span></Alert> : null}
      </div>
    </section>
  );
};
