import { beforeEach, describe, expect, it } from 'vitest';
import { InstanceRegistry } from './instance-registry';

let registry: InstanceRegistry;

beforeEach(async () => {
  registry = new InstanceRegistry();
  const instances = await registry.list();
  await Promise.all(instances.map((instance) => registry.remove(instance.id)));
});

describe('InstanceRegistry', () => {
  it('adds canonical non-secret connection metadata with a stable ID', async () => {
    const instance = await registry.add({ origin: 'https://panel.example.com/' });

    expect(instance).toMatchObject({
      id: expect.any(String),
      origin: 'https://panel.example.com',
      createdAt: expect.any(String),
      lastUsedAt: expect.any(String),
    });
    expect(await registry.get(instance.id)).toEqual(instance);
    expect(Object.keys(instance)).toEqual(['id', 'origin', 'createdAt', 'lastUsedAt']);
  });

  it('updates only safe local metadata', async () => {
    const instance = await registry.add({ origin: 'https://panel.example.com' });
    const updated = await registry.update(instance.id, { label: 'Home panel' });

    expect(updated).toMatchObject({
      id: instance.id,
      origin: instance.origin,
      label: 'Home panel',
    });
    expect(Object.keys(updated)).not.toContain('accessToken');
    expect(Object.keys(updated)).not.toContain('refreshToken');
    expect(Object.keys(updated)).not.toContain('preAuthToken');
    expect(Object.keys(updated)).not.toContain('webSocketTicket');
  });

  it('removes an instance without affecting another panel', async () => {
    const first = await registry.add({ origin: 'https://first.example.com' });
    const second = await registry.add({ origin: 'https://second.example.com' });

    await registry.remove(first.id);

    expect(await registry.get(first.id)).toBeUndefined();
    expect(await registry.get(second.id)).toEqual(second);
  });

  it('prevents duplicate canonical origins', async () => {
    await registry.add({ origin: 'https://panel.example.com' });

    await expect(registry.add({ origin: 'https://panel.example.com/' })).rejects.toThrow(
      'This panel is already saved.',
    );
  });
});
