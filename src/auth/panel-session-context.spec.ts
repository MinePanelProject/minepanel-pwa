import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { panelKeys, type InstanceIdentity } from '@/api/query-keys';

const panelA: InstanceIdentity = { id: 'saved-a', origin: 'https://a.example' };
const panelB: InstanceIdentity = { id: 'saved-b', origin: 'https://b.example' };

const removePanelScope = async (client: QueryClient, panel: InstanceIdentity): Promise<void> => {
  await client.cancelQueries({ queryKey: panelKeys.root(panel) });
  client.removeQueries({ queryKey: panelKeys.root(panel) });
};

describe('panel query isolation', () => {
  it('never presents panel A server data under panel B identity after a switch', () => {
    const client = new QueryClient();
    client.setQueryData(panelKeys.servers(panelA, 'user-a', { limit: 20, offset: 0 }), { data: [{ id: 'a-server' }], total: 1 });
    client.setQueryData(panelKeys.servers(panelB, 'user-b', { limit: 20, offset: 0 }), { data: [{ id: 'b-server' }], total: 1 });
    expect(client.getQueryData(panelKeys.servers(panelB, 'user-b', { limit: 20, offset: 0 }))).toEqual({ data: [{ id: 'b-server' }], total: 1 });
    expect(client.getQueryData(panelKeys.servers(panelB, 'user-a', { limit: 20, offset: 0 }))).toBeUndefined();
  });

  it('removes all panel-root data before a removed panel can be reselected', async () => {
    const client = new QueryClient();
    client.setQueryData(panelKeys.profile(panelA), { id: 'user-a' });
    client.setQueryData(panelKeys.sessions(panelA, 'user-a'), [{ id: 'session-a' }]);
    client.setQueryData(panelKeys.servers(panelB, 'user-b', { limit: 20, offset: 0 }), { data: [{ id: 'b-server' }], total: 1 });
    await removePanelScope(client, panelA);
    expect(client.getQueryData(panelKeys.profile(panelA))).toBeUndefined();
    expect(client.getQueryData(panelKeys.sessions(panelA, 'user-a'))).toBeUndefined();
    expect(client.getQueryData(panelKeys.servers(panelB, 'user-b', { limit: 20, offset: 0 }))).toEqual({ data: [{ id: 'b-server' }], total: 1 });
  });
});
