import { describe, expect, it } from 'vitest';
import { createSessionChannel, sessionChannelName } from './session-channel';

type Listener = (event: { data: string }) => void;

/** Minimal BroadcastChannel stand-in capturing channel names and routing. */
class FakeBroadcastChannel {
  static instances = new Map<string, FakeBroadcastChannel[]>();
  private listeners = new Set<Listener>();

  constructor(readonly name: string) {
    const list = FakeBroadcastChannel.instances.get(name) ?? [];
    list.push(this);
    FakeBroadcastChannel.instances.set(name, list);
  }

  addEventListener(_type: 'message', listener: Listener): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: Listener): void {
    this.listeners.delete(listener);
  }

  postMessage(message: string): void {
    for (const instance of FakeBroadcastChannel.instances.get(this.name) ?? []) {
      if (instance !== this) {
        instance.listeners.forEach((listener) => listener({ data: message }));
      }
    }
  }

  close(): void {
    const list = FakeBroadcastChannel.instances.get(this.name) ?? [];
    FakeBroadcastChannel.instances.set(
      this.name,
      list.filter((instance) => instance !== this),
    );
    this.listeners.clear();
  }
}

describe('session channel (Finding 4 regression)', () => {
  it('scopes cross-tab termination to the canonical backend origin', () => {
    FakeBroadcastChannel.instances.clear();

    const channelA1 = createSessionChannel('https://panel-a.example', FakeBroadcastChannel as unknown as typeof BroadcastChannel);
    const channelA2 = createSessionChannel('https://panel-a.example', FakeBroadcastChannel as unknown as typeof BroadcastChannel);
    const channelB = createSessionChannel('https://panel-b.example', FakeBroadcastChannel as unknown as typeof BroadcastChannel);

    const receivedA: string[] = [];
    const receivedB: string[] = [];
    const unsubscribeA = channelA2?.subscribe((m) => receivedA.push(m));
    const unsubscribeB = channelB?.subscribe((m) => receivedB.push(m));

    channelA1?.post('cleared');

    expect(receivedA).toEqual(['cleared']);
    expect(receivedB).toEqual([]);
    expect(sessionChannelName('https://panel-a.example')).not.toBe(sessionChannelName('https://panel-b.example'));

    unsubscribeA?.();
    unsubscribeB?.();
    channelA1?.close();
    channelA2?.close();
    channelB?.close();
  });

  it('returns null when BroadcastChannel is unavailable and posts no messages', () => {
    const channel = createSessionChannel('https://panel-a.example', null);
    expect(channel).toBeNull();
  });
});