import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { panelKeys } from '@/api/query-keys';
import { isSystemStats } from '@/api/types';
import type { SystemStats } from '@/api/types';
import { usePanelSession } from '@/auth/panel-session-context';

const disabledStatsKey = ['system-stats', 'disabled'] as const;

type MetricsConnectionState = 'idle' | 'connecting' | 'connected' | 'unavailable';

type ConnectionSnapshot = {
  identity: string;
  state: MetricsConnectionState;
};

export type SystemStatsState = {
  stats: SystemStats | undefined;
  lastUpdatedAt: number;
  connection: MetricsConnectionState;
  reconnect: () => void;
};

/**
 * Admin-only cookie-authenticated system telemetry. It deliberately has no
 * HTTP fallback: socket data is display-only and cannot become an authority.
 */
export const useSystemStats = (): SystemStatsState => {
  const session = usePanelSession();
  const queryClient = useQueryClient();
  const [cycle, setCycle] = useState(0);
  const [connectionSnapshot, setConnectionSnapshot] = useState<ConnectionSnapshot>({
    identity: '',
    state: 'idle',
  });
  const socketRef = useRef<Socket | null>(null);
  const profile = session.state.kind === 'authenticated' ? session.state.profile : null;
  const authenticated = profile !== null;
  const panel = session.panel;
  const panelId = panel?.id ?? '';
  const panelOrigin = panel?.origin ?? '';
  const profileId = profile?.id ?? '';
  const statsKey = useMemo(
    () => (panel && profile ? panelKeys.systemStats(panel, profile.id) : disabledStatsKey),
    [panel, profile],
  );
  const identity = panel && profile ? `${panelId}\u0000${panelOrigin}\u0000${profileId}` : '';
  const canConnect =
    authenticated &&
    profile?.role === 'ADMIN' &&
    !profile.temporaryAuth &&
    panel !== null &&
    session.client !== null &&
    session.info?.api.protocolVersion === 1 &&
    session.info.capabilities.auth.partitionedCookies &&
    !session.info.capabilities.realtime.websocketTicket;

  const statsQuery = useQuery({
    queryKey: statsKey,
    queryFn: async (): Promise<undefined> => undefined,
    enabled: false,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!canConnect || identity === '') {
      socketRef.current?.disconnect();
      socketRef.current = null;
      queryClient.removeQueries({ queryKey: statsKey, exact: true });
      setConnectionSnapshot({ identity, state: 'idle' });
      return;
    }

    let disposed = false;
    const socket = io(panelOrigin, {
      path: '/socket.io',
      transports: ['websocket'],
      upgrade: false,
      withCredentials: true,
      auth: undefined,
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
      randomizationFactor: 0.5,
      reconnectionAttempts: 6,
      timeout: 5_000,
    });
    socketRef.current = socket;
    setConnectionSnapshot({ identity, state: 'connecting' });

    const clearStats = (): void => {
      queryClient.removeQueries({ queryKey: statsKey, exact: true });
    };
    const onConnect = (): void => {
      if (!disposed) {
        setConnectionSnapshot({ identity, state: 'connected' });
      }
    };
    const onConnectError = (): void => {
      clearStats();
      if (!disposed) {
        setConnectionSnapshot({ identity, state: 'unavailable' });
      }
    };
    const onDisconnect = (reason: string): void => {
      clearStats();
      if (!disposed) {
        setConnectionSnapshot({
          identity,
          state: reason === 'io server disconnect' ? 'unavailable' : 'connecting',
        });
      }
    };
    const onReconnectFailed = (): void => {
      clearStats();
      if (!disposed) {
        setConnectionSnapshot({ identity, state: 'unavailable' });
      }
    };
    const onStats = (payload: unknown): void => {
      if (isSystemStats(payload)) {
        queryClient.setQueryData<SystemStats>(statsKey, payload);
      }
    };

    socket.on('connect', onConnect);
    socket.on('connect_error', onConnectError);
    socket.on('disconnect', onDisconnect);
    socket.on('system.stats', onStats);
    socket.io.on('reconnect_failed', onReconnectFailed);

    return () => {
      disposed = true;
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
      socket.off('disconnect', onDisconnect);
      socket.off('system.stats', onStats);
      socket.io.off('reconnect_failed', onReconnectFailed);
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      clearStats();
    };
  }, [canConnect, cycle, identity, panelOrigin, profileId, queryClient, statsKey]);

  const reconnect = useCallback((): void => {
    if (canConnect) {
      setCycle((currentCycle) => currentCycle + 1);
    }
  }, [canConnect]);

  return {
    stats: statsQuery.data,
    lastUpdatedAt: statsQuery.data === undefined ? 0 : statsQuery.dataUpdatedAt,
    connection: connectionSnapshot.identity === identity ? connectionSnapshot.state : 'idle',
    reconnect,
  };
};
