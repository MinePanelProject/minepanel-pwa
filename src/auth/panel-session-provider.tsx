import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { BackendClient } from '@/api/backend-client';
import type { PanelInfo } from '@/api/types';
import { panelKeys, type InstanceIdentity } from '@/api/query-keys';
import { SessionController } from './session-controller';
import { createSessionChannel, type SessionChannel } from './session-channel';
import {
  PanelSessionContext,
  SessionControllerContext,
  type PanelSessionValue,
  type ShellSession,
} from './panel-session-context';

type PanelSessionProviderProps = {
  panel: InstanceIdentity | null;
  client: BackendClient | null;
  children: React.ReactNode;
};

/**
 * Owns all session state for one selected panel. Resets and removes the
 * complete panel query scope on panel switch, unmount, and every
 * authentication boundary (architect decision §3).
 */
export const PanelSessionProvider = ({
  panel,
  client,
  children,
}: PanelSessionProviderProps): React.JSX.Element => {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ShellSession>({ kind: 'loading' });
  const [info, setInfo] = useState<PanelInfo | null>(null);
  const [infoError, setInfoError] = useState<unknown>(null);
  const controllerRef = useRef<SessionController | null>(null);
  const panelRef = useRef(panel);
  const channelRef = useRef<SessionChannel | null>(null);

  const controller = useMemo(() => {
    panelRef.current = panel;
    if (panel === null || client === null) return null;
    return new SessionController({
      client,
      onState: setState,
      onInfo: (nextInfo, error) => {
        setInfo(nextInfo);
        setInfoError(error);
      },
      onBoundary: () => {
        const activePanel = panelRef.current;
        if (activePanel === null) return;
        void queryClient.cancelQueries({ queryKey: panelKeys.root(activePanel) });
        queryClient.removeQueries({ queryKey: panelKeys.root(activePanel) });
      },
      onWholeSessionEnded: () => {
        channelRef.current?.post('cleared');
      },
    });
  }, [client, panel, queryClient]);

  useEffect(() => {
    controllerRef.current = controller;
    if (controller === null) {
      setInfo(null);
      setInfoError(null);
      setState({ kind: 'anonymous' });
      return undefined;
    }
    void controller.start();
    return () => {
      controller.dispose();
      if (panel !== null) {
        void queryClient.cancelQueries({ queryKey: panelKeys.root(panel) });
        queryClient.removeQueries({ queryKey: panelKeys.root(panel) });
      }
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [controller, panel, queryClient]);

  // Finding 1 wiring: a terminally invalid refresh session discovered by ANY
  // authenticated endpoint must end this panel's shell session. The callback
  // is per-client (per-panel); no global singleton exists.
  useEffect(() => {
    if (client === null) {
      return undefined;
    }
    client.onSessionTerminal = () => {
      controllerRef.current?.handleTerminalRefresh();
    };
    return () => {
      client.onSessionTerminal = null;
    };
  }, [client]);

  // Credential-free cross-tab advisory scoped to the canonical backend origin
  // (Finding 4): server-wide session termination (logout-all, ban, forced
  // recovery) in any tab of the SAME backend clears this tab's identity and
  // panel scope. Different origins use different channel names and can never
  // clear each other. Messages never carry profile or token data.
  useEffect(() => {
    const origin = panel?.origin;
    if (!origin) {
      return undefined;
    }
    const channel = createSessionChannel(origin);
    if (channel === null) {
      return undefined;
    }
    channelRef.current = channel;
    const unsubscribe = channel.subscribe((message) => {
      if (message === 'cleared') {
        controllerRef.current?.handleWholeSessionEnded();
      }
    });
    return () => {
      unsubscribe();
      channel.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [panel?.origin]);

  const value = useMemo<PanelSessionValue>(
    () => ({
      panel,
      client,
      info,
      infoError,
      state,
      signOut: async () => controllerRef.current?.signOut(),
      retryRestore: () => controllerRef.current?.retryRestore(),
      notifyProfileChanged: () => controllerRef.current?.notifyProfileChanged(),
    }),
    [client, info, infoError, panel, state],
  );

  return (
    <SessionControllerContext.Provider value={controller}>
      <PanelSessionContext.Provider value={value}>{children}</PanelSessionContext.Provider>
    </SessionControllerContext.Provider>
  );
};