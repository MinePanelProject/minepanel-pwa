/**
 * Cross-tab session advisory, scoped to the canonical backend origin
 * (external-review Finding 4). Cross-tab session cookies are per-ORIGIN: two
 * saved panel records that point at the same canonical backend share one
 * cookie jar and MUST share the advisory; a different origin MUST NOT.
 * Messages are credential-free ('cleared' only) — never profile or token data.
 */

export const sessionChannelName = (origin: string): string => `minepanel:session:${origin}`;

export type SessionChannel = {
  post: (message: string) => void;
  subscribe: (listener: (message: string) => void) => () => void;
  close: () => void;
};

export const createSessionChannel = (
  origin: string,
  channelConstructor: typeof BroadcastChannel | null = typeof BroadcastChannel === 'undefined' ? null : BroadcastChannel,
): SessionChannel | null => {
  if (channelConstructor === null) {
    return null;
  }

  const channel = new channelConstructor(sessionChannelName(origin));

  return {
    post(message) {
      channel.postMessage(message);
    },
    subscribe(listener) {
      const handler = (event: MessageEvent<string>): void => {
        listener(String(event.data));
      };
      channel.addEventListener('message', handler);
      return () => {
        channel.removeEventListener('message', handler);
      };
    },
    close() {
      channel.close();
    },
  };
};